package main

// Omnichannel (omi): POST /api/v1/auth/trusted-session, the endpoint the per-clinic omi-api adapter
// calls to open a Libredesk session for a Vetgo user (contract: libredesk-trusted-session.yaml in the
// Vetgo app repository). It is internal: Caddy answers 404 from outside, and here it answers 404
// unless the connection comes from [omi_api] trusted_ips with the right X-Omi-Api-Secret, so the
// route does not even show it exists. Everything specific to it lives in this file.

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"regexp"
	"strings"
	"sync"
	"time"

	amodels "github.com/abhinavxd/libredesk/internal/auth/models"
	"github.com/abhinavxd/libredesk/internal/envelope"
	rmodels "github.com/abhinavxd/libredesk/internal/role/models"
	"github.com/abhinavxd/libredesk/internal/user/models"
	"github.com/knadh/koanf/v2"
	"github.com/redis/go-redis/v9"
	"github.com/valyala/fasthttp"
	"github.com/zerodha/fastglue"
)

const (
	omiAPISecretHeader = "X-Omi-Api-Secret"
	// omiSubAttr: custom attribute linking an agent to a Vetgo user (claim sub of the omi token).
	omiSubAttr = "omi_sub"
	// Rate limit per sub, not per IP: every call comes from the adapter's one IP.
	omiTrustedPerMinute = 20
	placeholderSuffix   = ".omi.invalid"
)

// omiAPIConfig: the [omi_api] section. secret comes from LIBREDESK_OMI_API__SECRET; empty turns the
// endpoint off (404).
type omiAPIConfig struct {
	secret     string
	trusted    []*net.IPNet
	autoCreate bool
	roleMap    map[string]string // omi_role -> Libredesk role name
}

func loadOmiAPIConfig(k *koanf.Koanf) (omiAPIConfig, error) {
	c := omiAPIConfig{
		secret:     k.String("omi_api.secret"),
		autoCreate: k.Bool("omi_api.auto_create_agents"),
		roleMap:    map[string]string{"admin": rmodels.RoleAdmin, "agent": rmodels.RoleAgent},
	}
	for omiRole, role := range k.StringMap("omi_api.role_map") {
		if omiRole != "admin" && omiRole != "agent" {
			return c, errors.New("omi_api.role_map: keys must be admin or agent")
		}
		if role = strings.TrimSpace(role); role != "" {
			c.roleMap[omiRole] = role
		}
	}
	for _, s := range k.Strings("omi_api.trusted_ips") {
		s = strings.TrimSpace(s)
		if !strings.Contains(s, "/") {
			if strings.Contains(s, ":") {
				s += "/128"
			} else {
				s += "/32"
			}
		}
		_, n, err := net.ParseCIDR(s)
		if err != nil {
			return c, errors.New("omi_api.trusted_ips: bad entry " + s)
		}
		c.trusted = append(c.trusted, n)
	}
	if c.secret != "" && len(c.secret) < 32 {
		return c, errors.New("omi_api.secret must be at least 32 characters")
	}
	return c, nil
}

var (
	omiAPIOnce sync.Once
	omiAPICfg  omiAPIConfig
)

// omiAPIConf reads [omi_api] once. A bad section logs and turns the endpoint off.
func omiAPIConf(app *App) omiAPIConfig {
	omiAPIOnce.Do(func() {
		c, err := loadOmiAPIConfig(ko)
		if err != nil {
			app.lo.Error("omi_api config invalid, trusted-session disabled", "error", err)
			c = omiAPIConfig{}
		}
		omiAPICfg = c
	})
	return omiAPICfg
}

// allowed: the connection comes from a trusted IP and carries the secret. Header IPs are never read.
func (c omiAPIConfig) allowed(remote net.IP, secret string) bool {
	if c.secret == "" || remote == nil {
		return false
	}
	ipOK := false
	for _, n := range c.trusted {
		if n.Contains(remote) {
			ipOK = true
			break
		}
	}
	secretOK := subtle.ConstantTimeCompare([]byte(secret), []byte(c.secret)) == 1
	return ipOK && secretOK
}

// trustedSessionReq: body of the request (libredesk-trusted-session.yaml, TrustedSessionRequest).
type trustedSessionReq struct {
	Sub              string `json:"sub"`
	Email            string `json:"email"`
	EmailPlaceholder bool   `json:"email_placeholder"`
	Name             string `json:"name"`
	OmiRole          string `json:"omi_role"`
	AutoCreate       bool   `json:"auto_create"`
	// BranchIDs: optional. Absent: teams untouched. null: every branch team. Array: those branches.
	BranchIDs branchIDsField `json:"branch_ids"`
}

// branchIDPattern: a branch id of the Vetgo app (brandId), e.g. B1, branch_001.
var branchIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// maxBranchIDs bounds the array; a clinic has a handful of branches.
const maxBranchIDs = 200

// branchIDsField tells an absent branch_ids (Set false) from null (Set, All) and from an array.
type branchIDsField struct {
	Set bool
	All bool
	IDs []string
}

func (b *branchIDsField) UnmarshalJSON(data []byte) error {
	b.Set = true
	if strings.TrimSpace(string(data)) == "null" {
		b.All, b.IDs = true, nil
		return nil
	}
	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		return errors.New("branch_ids must be null or an array of strings")
	}
	if len(ids) > maxBranchIDs {
		return errors.New("too many branch_ids")
	}
	seen := make(map[string]struct{}, len(ids))
	b.IDs = make([]string, 0, len(ids))
	for _, id := range ids {
		if !branchIDPattern.MatchString(id) {
			return errors.New("bad branch id")
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		b.IDs = append(b.IDs, id)
	}
	return nil
}

// branchTeamSyncer: what syncing branch teams needs (team manager; a fake in tests).
type branchTeamSyncer interface {
	SyncBranchTeams(userID int, branchIDs []string, all bool) error
}

// syncBranchTeams applies branch_ids to the agent's teams. Returns whether teams were touched (the
// caller then drops the agent cache). Absent branch_ids: nothing, as before the field existed.
func syncBranchTeams(st branchTeamSyncer, userID int, b branchIDsField) (bool, error) {
	if !b.Set {
		return false, nil
	}
	if err := st.SyncBranchTeams(userID, b.IDs, b.All); err != nil {
		return false, err
	}
	return true, nil
}

func decodeTrustedSessionReq(body []byte) (trustedSessionReq, error) {
	var req trustedSessionReq
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return req, err
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Name = strings.TrimSpace(req.Name)
	switch {
	case req.Sub == "" || len(req.Sub) > 255 || req.Sub == "system":
		return req, errors.New("bad sub")
	case len(req.Email) > 320 || !strings.Contains(req.Email, "@") || strings.EqualFold(req.Email, models.SystemUserEmail):
		return req, errors.New("bad email")
	case req.EmailPlaceholder != strings.HasSuffix(req.Email, placeholderSuffix):
		return req, errors.New("email_placeholder does not match the address")
	case req.OmiRole != "admin" && req.OmiRole != "agent":
		return req, errors.New("bad omi_role")
	}
	if req.Name == "" {
		req.Name = strings.SplitN(req.Email, "@", 2)[0]
	}
	return req, nil
}

// agentStore: what resolving an agent needs from the user manager (a fake in tests).
type agentStore interface {
	agentIDBySub(sub string) (int, error)
	agentByID(id int) (models.User, error)
	agentByEmail(email string) (models.User, bool, error)
	omiSub(id int) (string, error)
	setOmiSub(id int, sub string) error
	createAgent(name, email, role string) (models.User, error)
}

var errAgentNotFound = errors.New("agent_not_found")

// resolveAgent finds the agent of a Vetgo user, or creates it.
//   - By sub first (custom attribute omi_sub): survives email changes in Vetgo.
//   - Then by email, only an agent not yet linked to another sub (a link is never taken over).
//     A placeholder email is derived from the sub, so it can only match that same user.
//   - Not found: create with the role mapped from omi_role when auto_create (request and config),
//     link it, else agent_not_found. An existing agent keeps its email and roles.
func resolveAgent(st agentStore, req trustedSessionReq, cfg omiAPIConfig) (models.User, bool, error) {
	id, err := st.agentIDBySub(req.Sub)
	if err != nil {
		return models.User{}, false, err
	}
	if id != 0 {
		u, err := st.agentByID(id)
		return u, false, err
	}
	u, found, err := st.agentByEmail(req.Email)
	if err != nil {
		return models.User{}, false, err
	}
	if found {
		linked, err := st.omiSub(u.ID)
		if err != nil {
			return models.User{}, false, err
		}
		if linked != "" && linked != req.Sub {
			return models.User{}, false, errAgentNotFound
		}
		if linked == "" {
			if err := st.setOmiSub(u.ID, req.Sub); err != nil {
				return models.User{}, false, err
			}
		}
		return u, false, nil
	}
	if !req.AutoCreate || !cfg.autoCreate {
		return models.User{}, false, errAgentNotFound
	}
	u, err = st.createAgent(req.Name, req.Email, cfg.roleMap[req.OmiRole])
	if err != nil {
		return models.User{}, false, err
	}
	if err := st.setOmiSub(u.ID, req.Sub); err != nil {
		return models.User{}, false, err
	}
	return u, true, nil
}

// branchRole: the roles an existing agent moves to when its clinic turns branch teams on. Before that,
// omi-api agents were created as "Agent", which reads every conversation; trusted-session with
// branch_ids now maps omi_role agent to a branch role (omi_api.role_map.agent). Only an agent whose
// roles are exactly the old default ["Agent"] moves: an admin, or an agent whose roles an admin set by
// hand, keeps them. ok false: nothing to change.
func branchRole(req trustedSessionReq, cfg omiAPIConfig, user models.User) ([]string, bool) {
	target := cfg.roleMap["agent"]
	if !req.BranchIDs.Set || req.OmiRole != "agent" || target == "" || target == rmodels.RoleAgent {
		return nil, false
	}
	if len(user.Roles) != 1 || user.Roles[0] != rmodels.RoleAgent {
		return nil, false
	}
	return []string{target}, true
}

// appAgentStore: agentStore over the app's user manager.
type appAgentStore struct{ app *App }

func (s appAgentStore) agentIDBySub(sub string) (int, error) {
	return s.app.user.GetAgentIDByOmiSub(sub)
}
func (s appAgentStore) agentByID(id int) (models.User, error) { return s.app.user.GetAgent(id, "") }
func (s appAgentStore) omiSub(id int) (string, error)         { return s.app.user.GetOmiSub(id) }
func (s appAgentStore) setOmiSub(id int, sub string) error {
	return s.app.user.SaveCustomAttributes(id, map[string]any{omiSubAttr: sub}, false)
}
func (s appAgentStore) agentByEmail(email string) (models.User, bool, error) {
	u, err := s.app.user.GetAgent(0, email)
	if err != nil {
		if e, ok := err.(envelope.Error); ok && e.ErrorType == envelope.NotFoundError {
			return models.User{}, false, nil
		}
		return models.User{}, false, err
	}
	return u, true, nil
}
func (s appAgentStore) createAgent(name, email, role string) (models.User, error) {
	return s.app.user.CreateAgent(name, "", email, []string{role})
}

// omiRateAllowed: at most omiTrustedPerMinute calls per sub per minute (Redis, shared by restarts).
// Redis down: allow (the IP and secret checks already passed).
func omiRateAllowed(ctx context.Context, rdb *redis.Client, sub string) bool {
	if rdb == nil {
		return true
	}
	sum := sha256.Sum256([]byte(sub))
	key := "omi_api:trusted:" + hex.EncodeToString(sum[:16])
	n, err := rdb.Incr(ctx, key).Result()
	if err != nil {
		return true
	}
	if n == 1 {
		rdb.Expire(ctx, key, time.Minute)
	}
	return n <= omiTrustedPerMinute
}

// takeResponseCookie reads a cookie the handler just set on the response and removes it, so the
// session goes back in the body instead of a Set-Cookie header.
func takeResponseCookie(resp *fasthttp.Response, name string) string {
	c := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(c)
	c.SetKey(name)
	if !resp.Header.Cookie(c) {
		return ""
	}
	v := string(c.Value())
	resp.Header.DelCookie(name)
	return v
}

func sendTrustedErr(r *fastglue.Request, status int, code, msg string) error {
	body, _ := json.Marshal(map[string]string{"status": "error", "message": msg, "code": code})
	r.RequestCtx.SetStatusCode(status)
	r.RequestCtx.SetContentType("application/json; charset=utf-8")
	r.RequestCtx.SetBody(body)
	return nil
}

// handleTrustedSession: POST /api/v1/auth/trusted-session.
func handleTrustedSession(r *fastglue.Request) error {
	app := r.Context.(*App)
	cfg := omiAPIConf(app)
	if !cfg.allowed(r.RequestCtx.RemoteIP(), string(r.RequestCtx.Request.Header.Peek(omiAPISecretHeader))) {
		r.RequestCtx.SetStatusCode(fasthttp.StatusNotFound)
		return nil
	}
	req, err := decodeTrustedSessionReq(r.RequestCtx.PostBody())
	if err != nil {
		return r.SendErrorEnvelope(fasthttp.StatusBadRequest, app.i18n.T("globals.messages.badRequest"), nil, envelope.InputError)
	}
	if !omiRateAllowed(r.RequestCtx, app.redis, req.Sub) {
		return r.SendErrorEnvelope(fasthttp.StatusTooManyRequests, app.i18n.T("globals.messages.tooManyRequests"), nil, envelope.GeneralError)
	}

	user, created, err := resolveAgent(appAgentStore{app}, req, cfg)
	switch {
	case errors.Is(err, errAgentNotFound):
		app.lo.Warn("trusted-session: no agent", "sub", req.Sub, "placeholder", req.EmailPlaceholder)
		return sendTrustedErr(r, fasthttp.StatusForbidden, "agent_not_found", app.i18n.T("validation.notFoundUser"))
	case err != nil:
		app.lo.Error("trusted-session: resolving agent", "sub", req.Sub, "error", err)
		return sendErrorEnvelope(r, err)
	}
	if user.Type != models.UserTypeAgent || user.IsSystemUser() {
		return sendTrustedErr(r, fasthttp.StatusForbidden, "agent_not_found", app.i18n.T("validation.notFoundUser"))
	}
	if !user.Enabled {
		return sendTrustedErr(r, fasthttp.StatusForbidden, "agent_disabled", app.i18n.T("user.accountDisabled"))
	}

	// Branch teams on: an agent still on the old default role moves to the branch role (branchRole),
	// before the session, so the first page already reads only its branches.
	if roles, ok := branchRole(req, cfg, user); ok && !created {
		if err := app.user.UpdateAgent(user.ID, user.FirstName, user.LastName, user.Email.String, roles, user.Enabled, "", ""); err != nil {
			app.lo.Error("trusted-session: moving agent to branch role", "user_id", user.ID, "error", err)
			return sendErrorEnvelope(r, err)
		}
		app.user.InvalidateAgentCache(user.ID)
		app.lo.Info("trusted-session: agent moved to branch role", "user_id", user.ID, "role", roles[0])
	}

	// Branch teams before the session: a failed sync must not leave the agent with old branches.
	if synced, err := syncBranchTeams(app.team, user.ID, req.BranchIDs); err != nil {
		app.lo.Error("trusted-session: syncing branch teams", "user_id", user.ID, "error", err)
		return sendErrorEnvelope(r, err)
	} else if synced {
		app.user.InvalidateAgentCache(user.ID)
	}

	// Same steps as a password sign-in, then the two cookies go into the body.
	if err := app.auth.SaveSession(amodels.User{
		ID:        user.ID,
		Email:     user.Email.String,
		FirstName: user.FirstName,
		LastName:  user.LastName,
	}, r); err != nil {
		app.lo.Error("trusted-session: saving session", "user_id", user.ID, "error", err)
		return sendErrorEnvelope(r, envelope.NewError(envelope.GeneralError, app.i18n.T("globals.messages.somethingWentWrong"), nil))
	}
	if err := app.auth.RotateCSRFCookie(r); err != nil {
		app.lo.Error("trusted-session: csrf cookie", "user_id", user.ID, "error", err)
		return sendErrorEnvelope(r, envelope.NewError(envelope.GeneralError, app.i18n.T("globals.messages.somethingWentWrong"), nil))
	}
	resp := &r.RequestCtx.Response
	sessionCookie := takeResponseCookie(resp, "libredesk_session")
	csrf := takeResponseCookie(resp, "csrf_token")
	if sessionCookie == "" || csrf == "" {
		app.lo.Error("trusted-session: session cookies not set", "user_id", user.ID)
		return sendErrorEnvelope(r, envelope.NewError(envelope.GeneralError, app.i18n.T("globals.messages.somethingWentWrong"), nil))
	}

	if err := app.user.UpdateLastLoginAt(user.ID); err != nil {
		app.lo.Error("trusted-session: last login", "user_id", user.ID, "error", err)
	}
	app.user.InvalidateAgentCache(user.ID)
	if err := app.activityLog.Login(user.ID, user.Email.String, r.RequestCtx.RemoteIP().String()); err != nil {
		app.lo.Error("error creating login activity log", "error", err)
	}
	app.lo.Info("trusted-session opened", "user_id", user.ID, "sub", req.Sub, "created", created, "placeholder", req.EmailPlaceholder,
		"branch_ids_set", req.BranchIDs.Set, "branch_all", req.BranchIDs.All, "branch_count", len(req.BranchIDs.IDs))

	return r.SendEnvelope(map[string]any{
		"session_cookie": sessionCookie,
		"csrf_token":     csrf,
		"agent": map[string]any{
			"id":      user.ID,
			"email":   user.Email.String,
			"name":    strings.TrimSpace(user.FirstName + " " + user.LastName),
			"roles":   []string(user.Roles),
			"enabled": user.Enabled,
			"created": created,
		},
	})
}
