package migrations

import (
	"github.com/jmoiron/sqlx"
	"github.com/knadh/koanf/v2"
	"github.com/knadh/stuffbin"
	"github.com/lib/pq"
)

// Omnichannel (omi): migrations of the fork are named vX.Y.(Z+1)-omni.N, a pre-release of the next
// upstream patch, so they sort after the upstream release they build on and before any later one.

// BranchAgentRole: role for the staff of a clinic branch. They see the conversations of their branch
// teams (branch:<id>, branch:all; trusted-session puts them there) and the ones assigned to them,
// never everything: no read_all, read_unassigned, update_team_assignee or contacts:read_all.
const BranchAgentRole = "Nhân viên chi nhánh"

// BranchAgentPermissions: what the role grants. view:manage is not for branch scoping: the agent
// app loads /api/v1/views/me on every page (an error toast without it), and a view is how an agent
// lists every conversation of their teams (views apply the same access rules).
var BranchAgentPermissions = []string{
	"conversations:read",
	"conversations:read_assigned",
	"conversations:read_team_inbox",
	"conversations:read_team_all",
	"conversations:write",
	"conversations:update_status",
	"conversations:update_priority",
	"conversations:update_tags",
	"conversations:update_user_assignee",
	"messages:read",
	"messages:write",
	"view:manage",
}

// V2_8_1_omni_1 creates the branch agent role when it is missing. An existing role of that name is
// left as is, so an admin who changed its permissions keeps them.
func V2_8_1_omni_1(db *sqlx.DB, fs stuffbin.FileSystem, ko *koanf.Koanf) error {
	_, err := db.Exec(`
		INSERT INTO roles ("name", description, permissions)
		VALUES ($1, $2, $3)
		ON CONFLICT ("name") DO NOTHING`,
		BranchAgentRole,
		"Nhân viên chi nhánh: chỉ thấy hội thoại của các chi nhánh mình (team branch:<mã>) và hội thoại được giao.",
		pq.Array(BranchAgentPermissions),
	)
	return err
}
