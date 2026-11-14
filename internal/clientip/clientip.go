// Package clientip finds the address of whoever sent a request. Only a proxy the deployment
// trusts (app.trusted_proxies) may say who the client is, through X-Real-Ip or the
// X-Forwarded-For entry it appended; headers such as X-Client-IP are never read, since any
// client can send them and they would let it pick its own rate limit bucket or logged address.
package clientip

import (
	"fmt"
	"net/netip"
	"strings"

	"github.com/valyala/fasthttp"
)

// Resolver knows which peers are proxies the deployment trusts.
type Resolver struct {
	trusted []netip.Prefix
}

// New parses CIDRs (or single addresses) of trusted proxies; none trusts nobody.
func New(cidrs []string) (*Resolver, error) {
	r := &Resolver{}
	for _, c := range cidrs {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if !strings.Contains(c, "/") {
			a, err := netip.ParseAddr(c)
			if err != nil {
				return nil, fmt.Errorf("trusted proxy %q: %w", c, err)
			}
			c = netip.PrefixFrom(a, a.BitLen()).String()
		}
		p, err := netip.ParsePrefix(c)
		if err != nil {
			return nil, fmt.Errorf("trusted proxy %q: %w", c, err)
		}
		r.trusted = append(r.trusted, p.Masked())
	}
	return r, nil
}

func (r *Resolver) isTrusted(a netip.Addr) bool {
	a = a.Unmap()
	for _, p := range r.trusted {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// peer is the TCP peer of the request.
func peer(ctx *fasthttp.RequestCtx) netip.Addr {
	a, _ := netip.AddrFromSlice(ctx.RemoteIP())
	return a.Unmap()
}

// ViaTrustedProxy says whether the request came through a proxy the deployment trusts.
func (r *Resolver) ViaTrustedProxy(ctx *fasthttp.RequestCtx) bool {
	return r.isTrusted(peer(ctx))
}

// ViaProxy says whether the request came through any proxy: a trusted peer, or headers a proxy
// adds. A direct call inside the cluster (the gateway, omi-admin) carries neither.
func (r *Resolver) ViaProxy(ctx *fasthttp.RequestCtx) bool {
	if r.ViaTrustedProxy(ctx) {
		return true
	}
	h := &ctx.Request.Header
	return len(h.Peek("X-Forwarded-For")) > 0 || len(h.Peek("X-Real-Ip")) > 0
}

// IP is the client's address: the peer, or, when the peer is a trusted proxy, the address
// that proxy reports (X-Real-Ip, else the rightmost X-Forwarded-For entry not itself a
// trusted proxy).
func (r *Resolver) IP(ctx *fasthttp.RequestCtx) string {
	p := peer(ctx)
	if !p.IsValid() {
		return ctx.RemoteIP().String()
	}
	if !r.isTrusted(p) {
		return p.String()
	}
	if a, err := netip.ParseAddr(strings.TrimSpace(string(ctx.Request.Header.Peek("X-Real-Ip")))); err == nil {
		return a.Unmap().String()
	}
	parts := strings.Split(string(ctx.Request.Header.Peek("X-Forwarded-For")), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		a, err := netip.ParseAddr(strings.TrimSpace(parts[i]))
		if err != nil {
			break
		}
		a = a.Unmap()
		if !r.isTrusted(a) {
			return a.String()
		}
	}
	return p.String()
}
