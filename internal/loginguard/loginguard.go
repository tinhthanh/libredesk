// Package loginguard limits sign-in failures and password-reset requests per account, in Redis.
// The per-IP rate limit can't do this behind a proxy that hides clients' addresses (every client
// is the proxy's address, one bucket for all), and a per-IP limit never stopped a slow guess
// spread over many addresses. Keys hold a SHA-256 of the normalised email, never the email, and
// unknown emails are counted exactly like real ones, so the answer says nothing about which
// accounts exist.
package loginguard

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Opts are the limits; zero values take the defaults.
type Opts struct {
	// Failures within FailureWindow lock an email until the window ends (default 10 in 15m).
	Failures      int
	FailureWindow time.Duration
	// Resets within ResetWindow are the most a single email is sent (default 3 an hour).
	Resets      int
	ResetWindow time.Duration
}

// Guard counts per email.
type Guard struct {
	rd   *redis.Client
	opts Opts
}

// New is a Guard on Redis.
func New(rd *redis.Client, o Opts) *Guard {
	if o.Failures <= 0 {
		o.Failures = 10
	}
	if o.FailureWindow <= 0 {
		o.FailureWindow = 15 * time.Minute
	}
	if o.Resets <= 0 {
		o.Resets = 3
	}
	if o.ResetWindow <= 0 {
		o.ResetWindow = time.Hour
	}
	return &Guard{rd: rd, opts: o}
}

func key(kind, email string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
	return "loginguard:" + kind + ":" + hex.EncodeToString(sum[:])
}

// Locked says whether sign-ins for this email are refused for now. Redis unreachable doesn't
// lock anyone out (the per-IP limit still applies).
func (g *Guard) Locked(ctx context.Context, email string) bool {
	n, err := g.rd.Get(ctx, key("fail", email)).Int()
	return err == nil && n >= g.opts.Failures
}

// Failed counts a failed sign-in. The window starts at the first failure, so a locked email
// opens again when it ends.
func (g *Guard) Failed(ctx context.Context, email string) {
	k := key("fail", email)
	pipe := g.rd.TxPipeline()
	pipe.Incr(ctx, k)
	pipe.ExpireNX(ctx, k, g.opts.FailureWindow)
	_, _ = pipe.Exec(ctx)
}

// Succeeded clears the failures after a sign-in that went through.
func (g *Guard) Succeeded(ctx context.Context, email string) {
	_ = g.rd.Del(ctx, key("fail", email)).Err()
}

// AllowReset counts a password-reset request and says whether one may be sent to this email.
func (g *Guard) AllowReset(ctx context.Context, email string) bool {
	k := key("reset", email)
	pipe := g.rd.TxPipeline()
	n := pipe.Incr(ctx, k)
	pipe.ExpireNX(ctx, k, g.opts.ResetWindow)
	if _, err := pipe.Exec(ctx); err != nil {
		return true
	}
	return n.Val() <= int64(g.opts.Resets)
}
