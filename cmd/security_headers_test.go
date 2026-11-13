package main

import (
	"strings"
	"testing"

	"github.com/valyala/fasthttp"
	"github.com/zerodha/fastglue"
)

func headersFor(path string) *fasthttp.ResponseHeader {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI(path)
	securityHeaders(&fastglue.Request{RequestCtx: ctx})
	return &ctx.Response.Header
}

func TestSecurityHeaders_AppPagesAreKeptOutOfOtherSitesFrames(t *testing.T) {
	for _, p := range []string{"/", "/inboxes/assigned", "/api/v1/agents/me", "/uploads/x"} {
		h := headersFor(p)
		if got := string(h.Peek("X-Frame-Options")); got != "SAMEORIGIN" {
			t.Errorf("%s: X-Frame-Options %q", p, got)
		}
		if got := string(h.Peek("X-Content-Type-Options")); got != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options %q", p, got)
		}
		if got := string(h.Peek("Referrer-Policy")); got != "strict-origin-when-cross-origin" {
			t.Errorf("%s: Referrer-Policy %q", p, got)
		}
	}
}

func TestSecurityHeaders_PagesOtherSitesEmbedKeepTheirOwnFrameRules(t *testing.T) {
	for _, p := range []string{"/widget", "/widget/assets/a.js", "/csat/abc/widget", "/hc/acme/en"} {
		if got := string(headersFor(p).Peek("X-Frame-Options")); got != "" {
			t.Errorf("%s: X-Frame-Options %q, want none", p, got)
		}
	}
}

func TestAgentAppCSP_AllowsOnlyTheAppsOwnScript(t *testing.T) {
	csp := agentAppCSP("clinic.example")
	for _, want := range []string{
		"script-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'",
		"connect-src 'self' wss://clinic.example ws://clinic.example",
	} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP %q lacks %q", csp, want)
		}
	}
	if strings.Contains(csp, "unsafe-eval") || strings.Contains(csp, "script-src 'self' blob: 'unsafe-inline'") {
		t.Errorf("CSP %q lets inline or eval'd script run", csp)
	}
}
