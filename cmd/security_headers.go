package main

import (
	"strings"

	"github.com/valyala/fasthttp"
	"github.com/zerodha/fastglue"
)

// Security headers. Every response gets nosniff and a referrer policy, and is kept out of
// other sites' frames, except the pages made to be framed elsewhere (the live chat widget,
// CSAT, the public help center), which keep their own rules. The agent app's index page also
// gets a Content-Security-Policy: no script but the app's own, no plugins, no <base>, no
// frames of it elsewhere. Message HTML comes from customers, so a sanitizer slip must not
// become script (see shared-ui/utils/safeHtml.js).

// framedElsewhere are path prefixes whose pages other sites embed.
var framedElsewhere = []string{"/widget", "/csat/", "/hc/"}

// securityHeaders is a fastglue Before middleware: headers every response carries. A handler
// may still set its own (the widget's frame-ancestors, the help center's frame options).
func securityHeaders(r *fastglue.Request) *fastglue.Request {
	h := &r.RequestCtx.Response.Header
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	path := string(r.RequestCtx.Path())
	for _, p := range framedElsewhere {
		if strings.HasPrefix(path, p) {
			return r
		}
	}
	h.Set("X-Frame-Options", "SAMEORIGIN")
	return r
}

// agentAppCSP is the Content-Security-Policy of the agent app served on host.
//   - script-src blob: is for the branch-call audio worklet, which the app builds from a Blob.
//   - style-src 'unsafe-inline': Vue, the editor and the charts set style attributes.
//   - img-src/media-src https: attachments are signed links to S3/R2 and avatars come from the
//     platforms' CDNs; data: and blob: are previews of what is being uploaded.
//   - frame-src: YouTube embeds in help center articles.
func agentAppCSP(host string) string {
	ws := ""
	if host != "" {
		ws = " wss://" + host + " ws://" + host
	}
	return strings.Join([]string{
		"default-src 'self'",
		"script-src 'self' blob:",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: https:",
		"media-src 'self' data: blob: https:",
		"font-src 'self' data:",
		"connect-src 'self'" + ws,
		"frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'self'",
	}, "; ")
}

// setAgentAppCSP puts the agent app's policy on the response.
func setAgentAppCSP(ctx *fasthttp.RequestCtx) {
	ctx.Response.Header.Set("Content-Security-Policy", agentAppCSP(string(ctx.Host())))
}
