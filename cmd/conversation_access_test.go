package main

import (
	"slices"
	"testing"

	cmodels "github.com/abhinavxd/libredesk/internal/conversation/models"
	"github.com/abhinavxd/libredesk/internal/migrations"
)

func TestConversationAccessLists(t *testing.T) {
	if got := conversationAccessLists([]string{"conversations:read", "conversations:read_unassigned", "conversations:read_all"}); !slices.Equal(got, []string{cmodels.AllConversations}) {
		t.Fatalf("read_all: %v", got)
	}
	// Vai trò chi nhánh: hội thoại được giao và của team mình (team_all bao team_inbox).
	got := conversationAccessLists(migrations.BranchAgentPermissions)
	if !slices.Equal(got, []string{cmodels.AssignedConversations, cmodels.TeamAllConversations}) {
		t.Fatalf("branch agent: %v", got)
	}
	if got := conversationAccessLists([]string{"conversations:read"}); len(got) != 0 {
		t.Fatalf("read only: %v", got)
	}
}
