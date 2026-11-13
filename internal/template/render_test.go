package template

import (
	"strings"
	"testing"
	"text/template"
)

func TestRenderString_EscapesDataAndLiteralsSoNoMarkupGetsIn(t *testing.T) {
	m := &Manager{funcMap: template.FuncMap{}}
	data := map[string]any{"Contact": map[string]any{"FirstName": `<img src=x onerror=alert(1)>`}}
	content := `<p>Chào {{ .Contact.FirstName }}</p>{{ "<style>p{}</style>" }}`

	got := m.RenderString(data, content)

	for _, bad := range []string{"<img", "<style"} {
		if strings.Contains(got, bad) {
			t.Fatalf("rendered %q: %s got through unescaped", got, bad)
		}
	}
	if !strings.Contains(got, "&lt;img src=x onerror=alert(1)&gt;") || !strings.HasPrefix(got, "<p>Chào ") {
		t.Fatalf("rendered %q: want the staff HTML kept and the data escaped", got)
	}
}

func TestRenderString_KeepsContentWhenItIsNoTemplate(t *testing.T) {
	m := &Manager{funcMap: template.FuncMap{}}
	content := `<p>{{ .Missing.Field }</p>`
	if got := m.RenderString(map[string]any{}, content); got != content {
		t.Fatalf("got %q, want the content as it was", got)
	}
}
