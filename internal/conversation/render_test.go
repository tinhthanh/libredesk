package conversation

import (
	"errors"
	"testing"

	umodels "github.com/abhinavxd/libredesk/internal/user/models"
	"github.com/volatiletech/null/v9"
)

// systemOnly is a userStore that knows the System user (id 1) and an agent (id 2); anything
// else it is asked for fails the test, so the System path is shown to fetch nothing more.
type systemOnly struct {
	userStore
	t *testing.T
}

func (s systemOnly) GetAgent(id int, _ string) (umodels.User, error) {
	switch id {
	case 1:
		return umodels.User{ID: 1, Email: null.StringFrom(umodels.SystemUserEmail)}, nil
	case 2:
		return umodels.User{}, errors.New("no agent in this test")
	}
	s.t.Fatalf("unexpected GetAgent(%d)", id)
	return umodels.User{}, nil
}

func TestRenderMessageContent_StoresWhatTheSystemUserSendsAsItIs(t *testing.T) {
	m := &Manager{userStore: systemOnly{t: t}}
	// What the omnichannel gateway relays: a customer's own text, braces and all.
	content := `<p>{{ "<style>p{}</style>" }} {{ .Contact.FirstName }}</p>`
	if got := m.renderMessageContent("c", 1, content); got != content {
		t.Fatalf("System content was rendered: %q", got)
	}
}

func TestRenderMessageContent_LeavesContentWithoutBracesAlone(t *testing.T) {
	m := &Manager{userStore: systemOnly{t: t}}
	if got := m.renderMessageContent("c", 99, "<p>hi</p>"); got != "<p>hi</p>" {
		t.Fatalf("got %q", got)
	}
}
