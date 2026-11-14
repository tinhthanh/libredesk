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
