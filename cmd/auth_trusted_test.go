package main

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"

	"github.com/abhinavxd/libredesk/internal/user/models"
	"github.com/alicebob/miniredis/v2"
	"github.com/knadh/koanf/providers/confmap"
	"github.com/knadh/koanf/v2"
	"github.com/redis/go-redis/v9"
	"github.com/valyala/fasthttp"
	"github.com/volatiletech/null/v9"
)

var testSecret = strings.Repeat("s", 32)

func omiKoanf(t *testing.T, m map[string]any) *koanf.Koanf {
	t.Helper()
	k := koanf.New(".")
	if err := k.Load(confmap.Provider(m, "."), nil); err != nil {
		t.Fatal(err)
	}
	return k
}

func TestLoadOmiAPIConfig(t *testing.T) {
	c, err := loadOmiAPIConfig(omiKoanf(t, map[string]any{
		"omi_api.secret":             testSecret,
		"omi_api.trusted_ips":        []string{"10.210.1.11", "10.0.0.0/8"},
		"omi_api.auto_create_agents": true,
		"omi_api.role_map.agent":     "Support",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.trusted) != 2 || !c.autoCreate || c.roleMap["agent"] != "Support" || c.roleMap["admin"] != "Admin" {
		t.Fatalf("config: %+v", c)
	}
	// Không có mục [omi_api]: tắt.
	c, err = loadOmiAPIConfig(omiKoanf(t, map[string]any{}))
	if err != nil || c.secret != "" || c.allowed(net.ParseIP("10.210.1.11"), "") {
		t.Fatalf("empty config must be off: %+v %v", c, err)
	}
	for name, m := range map[string]map[string]any{
		"short secret": {"omi_api.secret": "short"},
		"bad ip":       {"omi_api.secret": testSecret, "omi_api.trusted_ips": []string{"nope"}},
		"bad role key": {"omi_api.secret": testSecret, "omi_api.role_map.owner": "Admin"},
	} {
		if _, err := loadOmiAPIConfig(omiKoanf(t, m)); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
}

func TestOmiAPIAllowed(t *testing.T) {
	c, _ := loadOmiAPIConfig(omiKoanf(t, map[string]any{
		"omi_api.secret":      testSecret,
		"omi_api.trusted_ips": []string{"10.210.1.11"},
	}))
	adapter := net.ParseIP("10.210.1.11")
	if !c.allowed(adapter, testSecret) {
		t.Fatal("adapter with secret must be allowed")
	}
	if c.allowed(net.ParseIP("10.210.1.200"), testSecret) {
		t.Fatal("other IP (Caddy) must be refused")
	}
	if c.allowed(adapter, "") || c.allowed(adapter, strings.Repeat("x", 32)) {
		t.Fatal("missing or wrong secret must be refused")
	}
}

func TestDecodeTrustedSessionReq(t *testing.T) {
	ok := `{"sub":"owner:vetgo-uat","email":"U-4DEE5A66D2C524EA@vetgo-uat.omi.invalid","email_placeholder":true,"name":"","omi_role":"admin","auto_create":true}`
	req, err := decodeTrustedSessionReq([]byte(ok))
	if err != nil || req.Email != "u-4dee5a66d2c524ea@vetgo-uat.omi.invalid" || req.Name != "u-4dee5a66d2c524ea" {
		t.Fatalf("valid: %+v %v", req, err)
	}
	bad := map[string]string{
		"unknown field":         `{"sub":"1","email":"a@b.c","email_placeholder":false,"name":"A","omi_role":"agent","auto_create":true,"x":1}`,
		"sub system":            `{"sub":"system","email":"a@b.c","email_placeholder":false,"name":"A","omi_role":"agent","auto_create":true}`,
		"sub empty":             `{"sub":"","email":"a@b.c","email_placeholder":false,"name":"A","omi_role":"agent","auto_create":true}`,
		"System email":          `{"sub":"1","email":"System","email_placeholder":false,"name":"A","omi_role":"agent","auto_create":true}`,
		"phone as email":        `{"sub":"1","email":"0901234567","email_placeholder":false,"name":"A","omi_role":"agent","auto_create":true}`,
		"placeholder flag lies": `{"sub":"1","email":"a@b.c","email_placeholder":true,"name":"A","omi_role":"agent","auto_create":true}`,
		"real flag on fake":     `{"sub":"1","email":"u-1@x.omi.invalid","email_placeholder":false,"name":"A","omi_role":"agent","auto_create":true}`,
		"vetgo role":            `{"sub":"1","email":"a@b.c","email_placeholder":false,"name":"A","omi_role":"ADMIN_ALL_PERMISSION","auto_create":true}`,
	}
	for name, body := range bad {
		if _, err := decodeTrustedSessionReq([]byte(body)); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
}

// fakeStore: agentStore trong bộ nhớ.
type fakeStore struct {
	agents  map[int]*models.User
	subs    map[int]string
	nextID  int
	created []string // "email:role"
}

func newFakeStore() *fakeStore {
	return &fakeStore{agents: map[int]*models.User{}, subs: map[int]string{}, nextID: 1}
}

func (f *fakeStore) add(email string, enabled bool, sub string) int {
	id := f.nextID
	f.nextID++
	f.agents[id] = &models.User{ID: id, Email: null.StringFrom(email), Type: models.UserTypeAgent, Enabled: enabled}
	if sub != "" {
		f.subs[id] = sub
	}
	return id
}

func (f *fakeStore) agentIDBySub(sub string) (int, error) {
	for id, s := range f.subs {
		if s == sub {
			return id, nil
		}
	}
	return 0, nil
}
func (f *fakeStore) agentByID(id int) (models.User, error) { return *f.agents[id], nil }
func (f *fakeStore) agentByEmail(email string) (models.User, bool, error) {
	for _, a := range f.agents {
		if a.Email.String == email {
			return *a, true, nil
		}
	}
	return models.User{}, false, nil
}
func (f *fakeStore) omiSub(id int) (string, error)      { return f.subs[id], nil }
func (f *fakeStore) setOmiSub(id int, sub string) error { f.subs[id] = sub; return nil }
func (f *fakeStore) createAgent(name, email, role string) (models.User, error) {
	id := f.add(email, true, "")
	f.created = append(f.created, email+":"+role)
	return *f.agents[id], nil
}

func TestResolveAgent(t *testing.T) {
	cfg := omiAPIConfig{autoCreate: true, roleMap: map[string]string{"admin": "Admin", "agent": "Agent"}}
	req := func(sub, email, role string) trustedSessionReq {
		return trustedSessionReq{Sub: sub, Email: email, EmailPlaceholder: strings.HasSuffix(email, placeholderSuffix), OmiRole: role, AutoCreate: true, Name: "A"}
	}

	t.Run("by sub, even after the email changed in Vetgo", func(t *testing.T) {
		st := newFakeStore()
		id := st.add("old@x.vn", true, "user-1")
		u, created, err := resolveAgent(st, req("user-1", "new@x.vn", "agent"), cfg)
		if err != nil || created || u.ID != id || len(st.created) != 0 {
			t.Fatalf("%+v %v %v", u, created, err)
		}
	})
	t.Run("by email, unlinked agent gets linked", func(t *testing.T) {
		st := newFakeStore()
		id := st.add("an@x.vn", true, "")
		u, _, err := resolveAgent(st, req("user-1", "an@x.vn", "admin"), cfg)
		if err != nil || u.ID != id || st.subs[id] != "user-1" || len(st.created) != 0 {
			t.Fatalf("link: %+v %v %v", u, st.subs, err)
		}
	})
	t.Run("email linked to another sub is not taken over", func(t *testing.T) {
		st := newFakeStore()
		st.add("an@x.vn", true, "user-9")
		if _, _, err := resolveAgent(st, req("user-1", "an@x.vn", "agent"), cfg); !errors.Is(err, errAgentNotFound) {
			t.Fatalf("want agent_not_found, got %v", err)
		}
	})
	t.Run("create with mapped role and link", func(t *testing.T) {
		st := newFakeStore()
		u, created, err := resolveAgent(st, req("owner:vetgo-uat", "u-4dee5a66d2c524ea@vetgo-uat.omi.invalid", "admin"), cfg)
		if err != nil || !created || st.created[0] != "u-4dee5a66d2c524ea@vetgo-uat.omi.invalid:Admin" || st.subs[u.ID] != "owner:vetgo-uat" {
			t.Fatalf("create: %+v %v %v %v", u, st.created, st.subs, err)
		}
		// Lần sau tìm theo sub, không tạo thêm.
		if _, created, _ := resolveAgent(st, req("owner:vetgo-uat", "u-4dee5a66d2c524ea@vetgo-uat.omi.invalid", "admin"), cfg); created || len(st.created) != 1 {
			t.Fatal("second sign-in must reuse the agent")
		}
	})
	t.Run("no auto create", func(t *testing.T) {
		st := newFakeStore()
		r := req("user-1", "an@x.vn", "agent")
		r.AutoCreate = false
		if _, _, err := resolveAgent(st, r, cfg); !errors.Is(err, errAgentNotFound) {
			t.Fatalf("request off: %v", err)
		}
		off := cfg
		off.autoCreate = false
		if _, _, err := resolveAgent(st, req("user-1", "an@x.vn", "agent"), off); !errors.Is(err, errAgentNotFound) {
			t.Fatalf("config off: %v", err)
		}
		if len(st.created) != 0 {
			t.Fatal("nothing must be created")
		}
	})
	t.Run("disabled agent is returned as is (handler answers agent_disabled)", func(t *testing.T) {
		st := newFakeStore()
		st.add("an@x.vn", false, "user-1")
		u, _, err := resolveAgent(st, req("user-1", "an@x.vn", "agent"), cfg)
		if err != nil || u.Enabled {
			t.Fatalf("%+v %v", u, err)
		}
	})
}

func TestTakeResponseCookie(t *testing.T) {
	var resp fasthttp.Response
	for _, kv := range [][2]string{{"libredesk_session", "sess-1"}, {"csrf_token", "csrf-1"}, {"other", "x"}} {
		c := fasthttp.AcquireCookie()
		c.SetKey(kv[0])
		c.SetValue(kv[1])
		resp.Header.SetCookie(c)
		fasthttp.ReleaseCookie(c)
	}
	if v := takeResponseCookie(&resp, "libredesk_session"); v != "sess-1" {
		t.Fatalf("session: %q", v)
	}
	if v := takeResponseCookie(&resp, "csrf_token"); v != "csrf-1" {
		t.Fatalf("csrf: %q", v)
	}
	if h := resp.Header.String(); strings.Contains(h, "libredesk_session") || strings.Contains(h, "csrf_token") || !strings.Contains(h, "other=x") {
		t.Fatalf("Set-Cookie left on the response:\n%s", h)
	}
	if v := takeResponseCookie(&resp, "libredesk_session"); v != "" {
		t.Fatal("cookie must be gone")
	}
}

func TestOmiRateAllowed(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()
	for i := 0; i < omiTrustedPerMinute; i++ {
		if !omiRateAllowed(ctx, rdb, "user-1") {
			t.Fatalf("call %d refused", i+1)
		}
	}
	if omiRateAllowed(ctx, rdb, "user-1") {
		t.Fatal("over the limit must be refused")
	}
	if !omiRateAllowed(ctx, rdb, "user-2") {
		t.Fatal("another sub has its own limit")
	}
	mr.FastForward(61e9)
	if !omiRateAllowed(ctx, rdb, "user-1") {
		t.Fatal("window must reset after a minute")
	}
}
