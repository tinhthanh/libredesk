package main

import "testing"

func TestAgentChangeRefusal(t *testing.T) {
	cases := []struct {
		name                  string
		callerAdmin, system   bool
		targetRoles, newRoles []string
		want                  string
	}{
		{"nobody changes the System user, not even an Admin", true, true, []string{"Admin"}, nil, "user.cannotChangeSystemUser"},
		{"a manager can't act on an Admin", false, false, []string{"Admin"}, []string{"Agent"}, "user.onlyAdminCanManageAdmins"},
		{"a manager can't hand out Admin", false, false, []string{"Agent"}, []string{"Agent", "admin"}, "user.onlyAdminCanManageAdmins"},
		{"a manager changes an agent", false, false, []string{"Agent"}, []string{"Agent"}, ""},
		{"an Admin changes an Admin", true, false, []string{"Admin"}, []string{"Admin"}, ""},
	}
	for _, c := range cases {
		if got := agentChangeRefusal(c.callerAdmin, c.system, c.targetRoles, c.newRoles); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestRoleChangeRefusal(t *testing.T) {
	if got := roleChangeRefusal(false, []string{"Manager"}, "Manager"); got == "" {
		t.Error("a manager can't edit the role they hold")
	}
	if got := roleChangeRefusal(false, []string{"Manager"}, "Admin"); got == "" {
		t.Error("a manager can't edit the Admin role")
	}
	if got := roleChangeRefusal(false, []string{"Manager"}, "Agent"); got != "" {
		t.Error("a manager edits another role")
	}
	if got := roleChangeRefusal(true, []string{"Admin"}, "Admin"); got != "" {
		t.Error("an Admin edits any role")
	}
}

func TestSessionsMustEnd(t *testing.T) {
	cases := []struct {
		name            string
		pw              bool
		old, new        []string
		wasOn, on, want bool
	}{
		{"new password", true, []string{"Agent"}, []string{"Agent"}, true, true, true},
		{"disabled", false, []string{"Agent"}, []string{"Agent"}, true, false, true},
		{"role added", false, []string{"Agent"}, []string{"Agent", "Admin"}, true, true, true},
		{"role swapped", false, []string{"Agent"}, []string{"Manager"}, true, true, true},
		{"name only", false, []string{"Agent"}, []string{"agent"}, true, true, false},
	}
	for _, c := range cases {
		if got := sessionsMustEnd(c.pw, c.old, c.new, c.wasOn, c.on); got != c.want {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
}
