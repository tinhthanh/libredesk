package migrations

import (
	"slices"
	"testing"

	authzmodels "github.com/abhinavxd/libredesk/internal/authz/models"
	"github.com/abhinavxd/libredesk/internal/testutil"
	"github.com/lib/pq"
)

// Mọi quyền của vai trò chi nhánh phải là quyền hợp lệ, và không có quyền xem rộng.
func TestBranchAgentPermissions(t *testing.T) {
	for _, p := range BranchAgentPermissions {
		if !authzmodels.PermissionExists(p) {
			t.Errorf("unknown permission %q", p)
		}
	}
	for _, p := range []string{
		authzmodels.PermConversationsReadAll,
		authzmodels.PermConversationsReadUnassigned,
		authzmodels.PermConversationsUpdateTeamAssignee,
		authzmodels.PermContactsReadAll,
	} {
		if slices.Contains(BranchAgentPermissions, p) {
			t.Errorf("branch role must not have %q", p)
		}
	}
}

// Migration tạo vai trò một lần; chạy lại không đổi vai trò admin đã sửa, không đụng Agent.
func TestV2_8_1_omni_1(t *testing.T) {
	db := testutil.NewDB(t, "migration_omni_1")
	var agentBefore pq.StringArray
	if err := db.Get(&agentBefore, `SELECT permissions FROM roles WHERE name = 'Agent'`); err != nil {
		t.Fatal(err)
	}
	if err := V2_8_1_omni_1(db, nil, nil); err != nil {
		t.Fatal(err)
	}
	var perms pq.StringArray
	if err := db.Get(&perms, `SELECT permissions FROM roles WHERE name = $1`, BranchAgentRole); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal([]string(perms), BranchAgentPermissions) {
		t.Fatalf("permissions: %v", perms)
	}

	if _, err := db.Exec(`UPDATE roles SET permissions = '{conversations:read}' WHERE name = $1`, BranchAgentRole); err != nil {
		t.Fatal(err)
	}
	if err := V2_8_1_omni_1(db, nil, nil); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.Get(&n, `SELECT count(*) FROM roles WHERE name = $1`, BranchAgentRole); err != nil || n != 1 {
		t.Fatalf("role count %d %v", n, err)
	}
	if err := db.Get(&perms, `SELECT permissions FROM roles WHERE name = $1`, BranchAgentRole); err != nil || len(perms) != 1 {
		t.Fatalf("rerun must keep the edited role: %v %v", perms, err)
	}
	var agentAfter pq.StringArray
	if err := db.Get(&agentAfter, `SELECT permissions FROM roles WHERE name = 'Agent'`); err != nil || !slices.Equal(agentBefore, agentAfter) {
		t.Fatalf("Agent role changed: %v -> %v", agentBefore, agentAfter)
	}
}
