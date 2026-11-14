package auth

import (
	"strings"
	"testing"

	"github.com/valyala/fasthttp"
	"github.com/zerodha/fastglue"
)

func csrfSetCookie(ctx *fasthttp.RequestCtx) string {
	return string(ctx.Response.Header.PeekCookie("csrf_token"))
}

func TestCSRFCookie_StrictAndRotatedAtSignIn(t *testing.T) {
	a := &Auth{cfg: Config{SecureCookies: true}}
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetCookie("csrf_token", "planted")
	r := &fastglue.Request{RequestCtx: ctx}

	if err := a.SetCSRFCookie(r); err != nil {
		t.Fatal(err)
	}
	if got := csrfSetCookie(ctx); got != "" {
		t.Fatalf("SetCSRFCookie keeps an existing token, set %q", got)
	}
	if err := a.RotateCSRFCookie(r); err != nil {
		t.Fatal(err)
	}
	c := csrfSetCookie(ctx)
	if c == "" || strings.Contains(c, "planted") {
		t.Fatalf("rotation sets a new token: %q", c)
	}
	low := strings.ToLower(c)
	if !strings.Contains(low, "samesite=strict") || !strings.Contains(low, "secure") {
		t.Fatalf("cookie attributes: %q", c)
	}
	a.ClearCSRFCookie(r)
	if c := strings.ToLower(csrfSetCookie(ctx)); !strings.Contains(c, "expires=") {
		t.Fatalf("clear expires the cookie: %q", c)
	}
}
