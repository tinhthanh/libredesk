package ratelimit

import (
	"fmt"
	"net"
	"testing"

	"github.com/abhinavxd/libredesk/internal/clientip"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/valyala/fasthttp"
)

// A client that changes X-Client-IP (or any header a client sets) on every request still
// counts against one bucket, its own address.
func TestCheck_SpoofedHeadersShareTheClientsBucket(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ip, _ := clientip.New([]string{"10.42.0.0/16"})
	l := New(rdb, ip.IP)
	l.AddRule(Rule{Name: "auth", Enabled: true, RequestsPerMinute: 3})

	limited := 0
	for i := 0; i < 6; i++ {
		var req fasthttp.Request
		req.Header.Set("X-Client-IP", fmt.Sprintf("1.2.3.%d", i))
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("5.6.7.%d", i))
		ctx := &fasthttp.RequestCtx{}
		ctx.Init(&req, &net.TCPAddr{IP: net.ParseIP("203.0.113.9"), Port: 1}, nil)
		if l.Check(ctx, "auth") != nil {
			limited++
		}
	}
	if limited != 3 {
		t.Fatalf("limited %d of 6, want 3", limited)
	}
}
