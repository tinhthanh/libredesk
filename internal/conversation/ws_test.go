package conversation

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	cmodels "github.com/abhinavxd/libredesk/internal/conversation/models"
	"github.com/volatiletech/null/v9"
)

func TestConvToBroadcastOmitsPerUserFields(t *testing.T) {
	c := &cmodels.ConversationListItem{
		ID:                   42,
		UnreadMessageCount:   7,
		MentionedMessageUUID: null.StringFrom("abc-123"),
		Subject:              null.StringFrom("hello"),
	}
	b, err := json.Marshal(convToBroadcast(c))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	if strings.Contains(s, "unread_message_count") || strings.Contains(s, "mentioned_message_uuid") {
		t.Fatalf("per-user field leaked: %s", s)
	}
	if !strings.Contains(s, `"id":42`) || !strings.Contains(s, "hello") {
		t.Fatalf("normal fields missing: %s", s)
	}
	if got, _ := json.Marshal(convToBroadcast(nil)); string(got) != "null" {
		t.Fatalf("nil conv = %s", got)
	}
}

func TestWSTimeKeepsSubSecondPrecision(t *testing.T) {
	at := time.Date(2026, 11, 22, 10, 0, 10, 800_000_000, time.UTC)
	s := wsTime(at)
	if s != "2026-11-22T10:00:10.8Z" {
		t.Fatalf("wsTime = %q", s)
	}
	back, err := time.Parse(time.RFC3339, s)
	if err != nil || !back.Equal(at) {
		t.Fatalf("parse %q = %v, %v", s, back, err)
	}
	if b, _ := json.Marshal(at); string(b) != `"`+s+`"` {
		t.Fatalf("WS %q differs from REST %s", s, b)
	}
}

func TestWSMetaFields(t *testing.T) {
	got := wsMetaFields(json.RawMessage(`{"echo_id":"e1","omni_event":"call","to":["a@b"],"x":1}`))
	if len(got) != 2 || got["echo_id"] != "e1" || got["omni_event"] != "call" {
		t.Fatalf("wsMetaFields = %v", got)
	}
	for _, raw := range []string{"", "null", "{}", "not json", `{"omni_event":""}`, `{"omni_event":3}`} {
		if got := wsMetaFields(json.RawMessage(raw)); len(got) != 0 {
			t.Fatalf("wsMetaFields(%q) = %v", raw, got)
		}
	}
}
