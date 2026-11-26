package conversation

import (
	"slices"
	"testing"

	"github.com/abhinavxd/libredesk/internal/conversation/models"
	"github.com/abhinavxd/libredesk/internal/dbutil"
	"github.com/abhinavxd/libredesk/internal/testutil"
	"github.com/jmoiron/sqlx/types"
	"github.com/zerodha/logf"
)

// noSettings: settingsStore không có gì (múi giờ rỗng).
type noSettings struct{}

func (noSettings) GetAppRootURL() (string, error)                    { return "", nil }
func (noSettings) GetByPrefix(prefix string) (types.JSONText, error) { return nil, nil }
func (noSettings) Get(key string) (types.JSONText, error)            { return types.JSONText(`""`), nil }

// listWorld: agent thuộc team T1. c1 của T1, c2 của T2, c3 giao cho agent, c4 không team, không người.
// Agent được nhắc tới trong cả bốn hội thoại.
type listWorld struct {
	m              *Manager
	agent, t1, t2  int
	c1, c2, c3, c4 int
}

func newListWorld(t *testing.T) *listWorld {
	t.Helper()
	db := testutil.NewDB(t, "conversation_list_access")
	var q queries
	if err := dbutil.ScanSQLFile("queries.sql", &q, db, efs); err != nil {
		t.Fatal(err)
	}
	lo := logf.New(logf.Opts{})
	w := &listWorld{m: &Manager{q: q, db: db, lo: &lo, i18n: testutil.NewI18n(t), settingsStore: noSettings{}}}
	one := func(dst *int, query string, args ...any) {
		t.Helper()
		if err := db.QueryRow(query, args...).Scan(dst); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	var inbox, contact, other, open int
	one(&inbox, `INSERT INTO inboxes (name, channel) VALUES ('Zalo acc2', 'livechat') RETURNING id`)
	one(&contact, `INSERT INTO users (type, first_name, last_name, external_user_id) VALUES ('contact', 'Khách', '', 'k1') RETURNING id`)
	one(&w.agent, `INSERT INTO users (type, email, first_name) VALUES ('agent', 'a@acme.test', 'A') RETURNING id`)
	one(&other, `INSERT INTO users (type, email, first_name) VALUES ('agent', 'b@acme.test', 'B') RETURNING id`)
	one(&w.t1, `INSERT INTO teams (name, conversation_assignment_type, timezone) VALUES ('branch:B1', 'Manual', 'UTC') RETURNING id`)
	one(&w.t2, `INSERT INTO teams (name, conversation_assignment_type, timezone) VALUES ('branch:B2', 'Manual', 'UTC') RETURNING id`)
	db.MustExec(`INSERT INTO team_members (user_id, team_id) VALUES ($1, $2)`, w.agent, w.t1)
	one(&open, `SELECT id FROM conversation_statuses WHERE name = 'Open'`)
	conv := func(dst *int, team, user any) {
		one(dst, `INSERT INTO conversations (contact_id, inbox_id, status_id, assigned_team_id, assigned_user_id, last_message_at)
			VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`, contact, inbox, open, team, user)
		var msg int
		one(&msg, `INSERT INTO conversation_messages (type, status, conversation_id, content, sender_id, sender_type, private)
			VALUES ('outgoing', 'sent', $1, '@A', $2, 'agent', true) RETURNING id`, *dst, other)
		db.MustExec(`INSERT INTO conversation_mentions (conversation_id, message_id, mentioned_user_id, mentioned_by_user_id) VALUES ($1, $2, $3, $4)`,
			*dst, msg, w.agent, other)
	}
	conv(&w.c1, w.t1, nil)
	conv(&w.c2, w.t2, nil)
	conv(&w.c3, nil, w.agent)
	conv(&w.c4, nil, nil)
	return w
}

// idsOf: hàm lấy id (đã sắp) từ kết quả danh sách, dừng test nếu lỗi.
func idsOf(t *testing.T) func([]models.ConversationListItem, error) []int {
	return func(items []models.ConversationListItem, err error) []int {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		ids := make([]int, 0, len(items))
		for _, it := range items {
			ids = append(ids, it.ID)
		}
		slices.Sort(ids)
		return ids
	}
}

// Agent không có team: danh sách theo team trả rỗng, không lỗi SQL IN ().
func TestConversationListNoTeams(t *testing.T) {
	w := newListWorld(t)
	listIDs := idsOf(t)
	got := listIDs(w.m.GetViewConversationsList(w.agent, w.agent, nil,
		[]string{models.TeamAllConversations}, "", "", "", 1, 50))
	if len(got) != 0 {
		t.Fatalf("team all without teams: %v", got)
	}
	got = listIDs(w.m.GetViewConversationsList(w.agent, w.agent, []int{},
		[]string{models.TeamUnassignedConversations, models.AssignedConversations}, "", "", "", 1, 50))
	if !slices.Equal(got, []int{w.c3}) {
		t.Fatalf("assigned + team inbox without teams: %v", got)
	}
}

// "Được nhắc tới" chỉ trả hội thoại người gọi xem được.
func TestMentionedConversationsFilteredByAccess(t *testing.T) {
	w := newListWorld(t)
	listIDs := idsOf(t)
	branchAgent := []string{models.AssignedConversations, models.TeamAllConversations}
	got := listIDs(w.m.GetMentionedConversationsList(w.agent, []int{w.t1}, branchAgent, "", "", "", 1, 50))
	if !slices.Equal(got, []int{w.c1, w.c3}) {
		t.Fatalf("branch agent: %v, want %v", got, []int{w.c1, w.c3})
	}
	// read_all: mọi hội thoại có nhắc tới, như trước.
	got = listIDs(w.m.GetMentionedConversationsList(w.agent, []int{w.t1}, []string{models.AllConversations}, "", "", "", 1, 50))
	if !slices.Equal(got, []int{w.c1, w.c2, w.c3, w.c4}) {
		t.Fatalf("read_all: %v", got)
	}
	// Không quyền xem nào: rỗng, không phải mọi lần nhắc.
	got = listIDs(w.m.GetMentionedConversationsList(w.agent, []int{w.t1}, nil, "", "", "", 1, 50))
	if len(got) != 0 {
		t.Fatalf("no access: %v", got)
	}
	// Không team: chỉ hội thoại được giao.
	got = listIDs(w.m.GetMentionedConversationsList(w.agent, nil, branchAgent, "", "", "", 1, 50))
	if !slices.Equal(got, []int{w.c3}) {
		t.Fatalf("no teams: %v", got)
	}
}
