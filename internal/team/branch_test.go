package team

import (
	"slices"
	"testing"

	"github.com/abhinavxd/libredesk/internal/testutil"
	"github.com/jmoiron/sqlx"
	"github.com/volatiletech/null/v9"
	"github.com/zerodha/logf"
)

func newBranchTestManager(t *testing.T) (*Manager, *sqlx.DB) {
	t.Helper()
	db := testutil.NewDB(t, "team_branch")
	lo := logf.New(logf.Opts{})
	mgr, err := New(Opts{DB: db, Lo: &lo, I18n: testutil.NewI18n(t)})
	if err != nil {
		t.Fatalf("creating team manager: %v", err)
	}
	return mgr, db
}

func userTeamNames(t *testing.T, db *sqlx.DB, userID int) []string {
	t.Helper()
	var names []string
	if err := db.Select(&names, `SELECT t.name FROM teams t JOIN team_members tm ON tm.team_id = t.id WHERE tm.user_id = $1 ORDER BY t.name COLLATE "C"`, userID); err != nil {
		t.Fatal(err)
	}
	return names
}

// Đồng bộ team chi nhánh: tạo team thiếu (phân công thủ công), rời team chi nhánh khác, giữ team thường.
func TestSyncBranchTeams(t *testing.T) {
	m, db := newBranchTestManager(t)
	var agent int
	if err := db.Get(&agent, `INSERT INTO users (type, email, first_name) VALUES ('agent', 'agent@acme.test', 'Agent') RETURNING id`); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Create("Support", "Asia/Ho_Chi_Minh", "Round robin", null.Int{}, null.Int{}, "", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Create("branch:OLD", "Asia/Ho_Chi_Minh", "Round robin", null.Int{}, null.Int{}, "", 0); err != nil {
		t.Fatal(err)
	}
	if err := m.UpsertUserTeams(agent, []string{"Support", "branch:OLD"}); err != nil {
		t.Fatal(err)
	}

	if err := m.SyncBranchTeams(agent, []string{"B1", "B2"}, false); err != nil {
		t.Fatal(err)
	}
	if got := userTeamNames(t, db, agent); !slices.Equal(got, []string{"Support", "branch:B1", "branch:B2", "branch:all"}) {
		t.Fatalf("array: %v", got)
	}
	var assignment string
	if err := db.Get(&assignment, `SELECT conversation_assignment_type FROM teams WHERE name = 'branch:B1'`); err != nil || assignment != "Manual" {
		t.Fatalf("new branch team must be manual: %q %v", assignment, err)
	}
	// Team đã có giữ nguyên cách phân công.
	if err := db.Get(&assignment, `SELECT conversation_assignment_type FROM teams WHERE name = 'branch:OLD'`); err != nil || assignment != "Round robin" {
		t.Fatalf("existing team changed: %q %v", assignment, err)
	}

	// Lần sau chỉ còn B2: rời B1, không tạo trùng.
	if err := m.SyncBranchTeams(agent, []string{"B2"}, false); err != nil {
		t.Fatal(err)
	}
	if got := userTeamNames(t, db, agent); !slices.Equal(got, []string{"Support", "branch:B2", "branch:all"}) {
		t.Fatalf("narrowed: %v", got)
	}

	// Mảng rỗng: chỉ branch:all.
	if err := m.SyncBranchTeams(agent, nil, false); err != nil {
		t.Fatal(err)
	}
	if got := userTeamNames(t, db, agent); !slices.Equal(got, []string{"Support", "branch:all"}) {
		t.Fatalf("empty: %v", got)
	}

	// null: mọi team chi nhánh đang có, không tạo thêm.
	if err := m.SyncBranchTeams(agent, nil, true); err != nil {
		t.Fatal(err)
	}
	if got := userTeamNames(t, db, agent); !slices.Equal(got, []string{"Support", "branch:B1", "branch:B2", "branch:OLD", "branch:all"}) {
		t.Fatalf("all: %v", got)
	}
	var n int
	if err := db.Get(&n, `SELECT count(*) FROM teams WHERE name LIKE 'branch:%'`); err != nil || n != 4 {
		t.Fatalf("branch teams: %d %v", n, err)
	}
}
