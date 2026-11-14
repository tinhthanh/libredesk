package main

import (
	"testing"

	cmodels "github.com/abhinavxd/libredesk/internal/conversation/models"
	"github.com/abhinavxd/libredesk/internal/macro/models"
)

func TestKeepAuthorizedPrevious(t *testing.T) {
	prev := []cmodels.PreviousConversation{{UUID: "a"}, {UUID: "b"}, {UUID: "c"}}
	got := keepAuthorizedPrevious(prev, []string{"c", "a"})
	if len(got) != 2 || got[0].UUID != "a" || got[1].UUID != "c" {
		t.Fatalf("got %+v", got)
	}
	if got := keepAuthorizedPrevious(prev, nil); len(got) != 0 {
		t.Fatalf("nothing allowed, got %+v", got)
	}
}

func TestMacroVisibleTo(t *testing.T) {
	team, other, me, someone := 3, 4, 7, 8
	cases := []struct {
		name string
		m    models.Macro
		want bool
	}{
		{"for all", models.Macro{Visibility: "all"}, true},
		{"my team", models.Macro{Visibility: "team", TeamID: &team}, true},
		{"another team", models.Macro{Visibility: "team", TeamID: &other}, false},
		{"mine", models.Macro{Visibility: "user", UserID: &me}, true},
		{"someone else's", models.Macro{Visibility: "user", UserID: &someone}, false},
		{"unknown visibility", models.Macro{Visibility: "x"}, false},
	}
	for _, c := range cases {
		if got := macroVisibleTo(c.m, me, []int{team}); got != c.want {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
}
