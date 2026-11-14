package main

// Who may change whom. users:manage and roles:manage alone are not the Admin role: a holder may
// not touch the System user, may not act on an Admin or hand out the Admin role, and may not edit
// the role they hold (granting themselves more). Only an Admin may.

import (
	"strings"

	amodels "github.com/abhinavxd/libredesk/internal/auth/models"
	"github.com/abhinavxd/libredesk/internal/envelope"
	rmodels "github.com/abhinavxd/libredesk/internal/role/models"
	"github.com/zerodha/fastglue"
)

func hasRole(roles []string, name string) bool {
	for _, r := range roles {
		if strings.EqualFold(strings.TrimSpace(r), name) {
			return true
		}
	}
	return false
}

// agentChangeRefusal is the i18n key of why the caller may not change this agent, or "".
func agentChangeRefusal(callerAdmin, targetIsSystem bool, targetRoles, newRoles []string) string {
	if targetIsSystem {
		return "user.cannotChangeSystemUser"
	}
	if !callerAdmin && (hasRole(targetRoles, rmodels.RoleAdmin) || hasRole(newRoles, rmodels.RoleAdmin)) {
		return "user.onlyAdminCanManageAdmins"
	}
	return ""
}

// roleChangeRefusal is the i18n key of why the caller may not edit or delete this role, or "".
func roleChangeRefusal(callerAdmin bool, callerRoles []string, roleName string) string {
	if callerAdmin {
		return ""
	}
	if strings.EqualFold(roleName, rmodels.RoleAdmin) || hasRole(callerRoles, roleName) {
		return "role.cannotEditOwnRole"
	}
	return ""
}

// callerRoles are the roles of whoever made the request.
func callerRoles(app *App, r *fastglue.Request) ([]string, error) {
	auser := r.RequestCtx.UserValue("user").(amodels.User)
	agent, err := app.user.GetAgent(auser.ID, "")
	if err != nil {
		return nil, err
	}
	return agent.Roles, nil
}

// refuse answers a refusal of agentChangeRefusal or roleChangeRefusal.
func refuse(app *App, r *fastglue.Request, key string) error {
	return sendErrorEnvelope(r, envelope.NewError(envelope.PermissionError, app.i18n.T(key), nil))
}

// sessionsMustEnd says whether an agent's change ends the sessions they have: a new password,
// a different set of roles, or the account disabled.
func sessionsMustEnd(newPassword bool, oldRoles, newRoles []string, wasEnabled, enabled bool) bool {
	if newPassword || (wasEnabled && !enabled) {
		return true
	}
	if len(oldRoles) != len(newRoles) {
		return true
	}
	for _, r := range newRoles {
		if !hasRole(oldRoles, r) {
			return true
		}
	}
	return false
}
