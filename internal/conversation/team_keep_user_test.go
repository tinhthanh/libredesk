package conversation

import (
	"errors"
	"testing"

	"github.com/abhinavxd/libredesk/internal/automation"
	"github.com/abhinavxd/libredesk/internal/dbutil"
	"github.com/abhinavxd/libredesk/internal/inbox"
	imodels "github.com/abhinavxd/libredesk/internal/inbox/models"
	tmodels "github.com/abhinavxd/libredesk/internal/team/models"
	"github.com/abhinavxd/libredesk/internal/testutil"
	umodels "github.com/abhinavxd/libredesk/internal/user/models"
	wmodels "github.com/abhinavxd/libredesk/internal/webhook/models"
	"github.com/abhinavxd/libredesk/internal/ws"
	"github.com/volatiletech/null/v9"
	"github.com/zerodha/logf"
)

// noTeams: Get lỗi, nên không ghi hoạt động đổi team và không áp SLA (ngoài phạm vi test này).
type noTeams struct{}

func (noTeams) Get(int) (tmodels.Team, error)                { return tmodels.Team{}, errors.New("no team store") }
func (noTeams) UserBelongsToTeam(int, int) (bool, error)     { return false, nil }
func (noTeams) GetMembers(int) ([]tmodels.TeamMember, error) { return nil, nil }

type noInboxes struct{}

func (noInboxes) Get(int) (inbox.Inbox, error) { return nil, inbox.ErrInboxNotFound }
func (noInboxes) GetDBRecord(any) (imodels.Inbox, error) {
	return imodels.Inbox{}, inbox.ErrInboxNotFound
}
func (noInboxes) GetAll() ([]imodels.Inbox, error) { return nil, nil }

// countWebhooks đếm sự kiện webhook theo tên.
type countWebhooks map[wmodels.WebhookEvent]int

func (c countWebhooks) TriggerEvent(event wmodels.WebhookEvent, _ any) { c[event]++ }
func (c countWebhooks) TriggerWebhook(int, wmodels.WebhookEvent, any)  {}

// Đổi team: mặc định bỏ giao nhân viên như cũ; keep_user (gateway gán team chi nhánh) giữ nhân viên.
func TestUpdateConversationTeamAssigneeKeepUser(t *testing.T) {
	db := testutil.NewDB(t, "conversation_team_keep_user")
	var q queries
	if err := dbutil.ScanSQLFile("queries.sql", &q, db, efs); err != nil {
		t.Fatal(err)
	}
	lo := logf.New(logf.Opts{})
	i18n := testutil.NewI18n(t)
	engine, err := automation.New(automation.Opts{DB: db, Lo: &lo, I18n: i18n})
	if err != nil {
		t.Fatal(err)
	}
	hooks := countWebhooks{}
	m := &Manager{q: q, db: db, lo: &lo, i18n: i18n, settingsStore: noSettings{}, teamStore: noTeams{},
		inboxStore: noInboxes{}, webhookStore: hooks, automation: engine, wsHub: ws.NewHub(&lo, nil)}

	one := func(dst any, query string, args ...any) {
		t.Helper()
		if err := db.QueryRow(query, args...).Scan(dst); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	var inboxID, contact, agent, t1, t2, open int
	one(&inboxID, `INSERT INTO inboxes (name, channel) VALUES ('Zalo acc2', 'livechat') RETURNING id`)
	one(&contact, `INSERT INTO users (type, first_name, last_name, external_user_id) VALUES ('contact', 'Khách', '', 'k1') RETURNING id`)
	one(&agent, `INSERT INTO users (type, email, first_name) VALUES ('agent', 'a@acme.test', 'A') RETURNING id`)
	one(&t1, `INSERT INTO teams (name, conversation_assignment_type, timezone) VALUES ('branch:B1', 'Manual', 'UTC') RETURNING id`)
	one(&t2, `INSERT INTO teams (name, conversation_assignment_type, timezone) VALUES ('branch:B2', 'Manual', 'UTC') RETURNING id`)
	one(&open, `SELECT id FROM conversation_statuses WHERE name = 'Open'`)
	newConv := func() string {
		var uuid string
		one(&uuid, `INSERT INTO conversations (contact_id, inbox_id, status_id, assigned_team_id, assigned_user_id, last_message_at)
			VALUES ($1, $2, $3, $4, $5, now()) RETURNING uuid`, contact, inboxID, open, t1, agent)
		return uuid
	}
	assignees := func(uuid string) (team, user null.Int) {
		t.Helper()
		if err := db.QueryRow(`SELECT assigned_team_id, assigned_user_id FROM conversations WHERE uuid = $1`, uuid).Scan(&team, &user); err != nil {
			t.Fatal(err)
		}
		return team, user
	}
	actor := umodels.User{ID: agent, FirstName: "A"}

	kept := newConv()
	if err := m.UpdateConversationTeamAssigneeKeepUser(kept, t2, actor); err != nil {
		t.Fatal(err)
	}
	if team, user := assignees(kept); team.Int != t2 || !user.Valid || user.Int != agent {
		t.Fatalf("keep_user: team %v user %v, want team %d user %d", team, user, t2, agent)
	}
	if hooks[wmodels.EventConversationUnassigned] != 0 {
		t.Fatalf("keep_user must not unassign: %v", hooks)
	}

	dropped := newConv()
	if err := m.UpdateConversationTeamAssignee(dropped, t2, actor); err != nil {
		t.Fatal(err)
	}
	if team, user := assignees(dropped); team.Int != t2 || user.Valid {
		t.Fatalf("default: team %v user %v, want team %d and no user", team, user, t2)
	}
	if hooks[wmodels.EventConversationUnassigned] != 1 {
		t.Fatalf("default must unassign once: %v", hooks)
	}
}
