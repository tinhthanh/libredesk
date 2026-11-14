package clientip

import (
	"net"
	"testing"

	"github.com/valyala/fasthttp"
)

func reqFrom(peer string, headers map[string]string) *fasthttp.RequestCtx {
	var req fasthttp.Request
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	ctx := &fasthttp.RequestCtx{}
	ctx.Init(&req, &net.TCPAddr{IP: net.ParseIP(peer), Port: 1234}, nil)
	return ctx
}

func TestIP(t *testing.T) {
	r, err := New([]string{"10.42.0.0/16", "192.0.2.7"})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name    string
		peer    string
		headers map[string]string
		want    string
	}{
		{"direct client, spoofed headers ignored", "203.0.113.9",
			map[string]string{"X-Client-IP": "1.2.3.4", "X-Real-Ip": "1.2.3.4", "X-Forwarded-For": "1.2.3.4"}, "203.0.113.9"},
		{"trusted proxy, X-Real-Ip", "10.42.0.5", map[string]string{"X-Real-Ip": "198.51.100.4"}, "198.51.100.4"},
		{"trusted proxy never reads X-Client-IP", "10.42.0.5", map[string]string{"X-Client-IP": "1.2.3.4"}, "10.42.0.5"},
		{"trusted proxy, rightmost forwarded entry", "10.42.0.5",
			map[string]string{"X-Forwarded-For": "1.2.3.4, 198.51.100.4"}, "198.51.100.4"},
		{"forwarded chain skips trusted hops", "10.42.0.5",
			map[string]string{"X-Forwarded-For": "1.2.3.4, 198.51.100.4, 192.0.2.7"}, "198.51.100.4"},
		{"single trusted address", "192.0.2.7", map[string]string{"X-Real-Ip": "198.51.100.8"}, "198.51.100.8"},
		{"garbage header falls back to peer", "10.42.0.5", map[string]string{"X-Real-Ip": "nope"}, "10.42.0.5"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := r.IP(reqFrom(c.peer, c.headers)); got != c.want {
				t.Fatalf("IP = %s, want %s", got, c.want)
			}
		})
	}
}

func TestNobodyTrustedByDefault(t *testing.T) {
	r, _ := New(nil)
	if got := r.IP(reqFrom("10.42.0.5", map[string]string{"X-Real-Ip": "1.2.3.4"})); got != "10.42.0.5" {
		t.Fatalf("IP = %s", got)
	}
	if r.ViaTrustedProxy(reqFrom("10.42.0.5", nil)) {
		t.Fatal("no proxy is trusted by default")
	}
}

func TestViaProxy(t *testing.T) {
	r, _ := New([]string{"10.42.0.0/16"})
	if !r.ViaProxy(reqFrom("10.42.0.5", nil)) {
		t.Error("a trusted peer is a proxy")
	}
	if !r.ViaProxy(reqFrom("10.43.0.9", map[string]string{"X-Forwarded-For": "1.2.3.4"})) {
		t.Error("a forwarded header means a proxy")
	}
	if r.ViaProxy(reqFrom("10.43.0.9", nil)) {
		t.Error("a direct call is no proxy")
	}
}

func TestNewRejectsBadCIDR(t *testing.T) {
	if _, err := New([]string{"10.0.0.0/99"}); err == nil {
		t.Fatal("want error")
	}
}
