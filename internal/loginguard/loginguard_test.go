package loginguard

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newGuard(t *testing.T, o Opts) (*Guard, *miniredis.Miniredis) {
	mr := miniredis.RunT(t)
	return New(redis.NewClient(&redis.Options{Addr: mr.Addr()}), o), mr
}

func TestLockedAfterTheLimitUntilTheWindowEnds(t *testing.T) {
	g, mr := newGuard(t, Opts{Failures: 3, FailureWindow: time.Minute})
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		g.Failed(ctx, "ada@acme.test")
	}
	if g.Locked(ctx, "ada@acme.test") {
		t.Fatal("locked before the limit")
	}
	g.Failed(ctx, "ada@acme.test")
	if !g.Locked(ctx, "ADA@acme.test ") {
		t.Fatal("not locked at the limit (email normalised)")
	}
	mr.FastForward(61 * time.Second)
	if g.Locked(ctx, "ada@acme.test") {
		t.Fatal("still locked after the window")
	}
}

func TestSuccessClearsTheFailures(t *testing.T) {
	g, _ := newGuard(t, Opts{Failures: 3})
	ctx := context.Background()
	g.Failed(ctx, "ada@acme.test")
	g.Failed(ctx, "ada@acme.test")
	g.Succeeded(ctx, "ada@acme.test")
	g.Failed(ctx, "ada@acme.test")
	g.Failed(ctx, "ada@acme.test")
	if g.Locked(ctx, "ada@acme.test") {
		t.Fatal("a success starts the count again")
	}
}

func TestUnknownEmailsCountTheSameAndEmailsAreIndependent(t *testing.T) {
	g, mr := newGuard(t, Opts{Failures: 2})
	ctx := context.Background()
	g.Failed(ctx, "nobody@acme.test")
	g.Failed(ctx, "nobody@acme.test")
	if !g.Locked(ctx, "nobody@acme.test") {
		t.Fatal("an unknown email locks like a real one")
	}
	if g.Locked(ctx, "ada@acme.test") {
		t.Fatal("another email is untouched")
	}
	for _, k := range mr.Keys() {
		if strings.Contains(k, "acme") {
			t.Fatalf("a key holds the email: %s", k)
		}
	}
}

func TestResetRequestsPerEmail(t *testing.T) {
	g, mr := newGuard(t, Opts{Resets: 3, ResetWindow: time.Hour})
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if !g.AllowReset(ctx, "ada@acme.test") {
			t.Fatalf("reset %d refused", i+1)
		}
	}
	if g.AllowReset(ctx, "ada@acme.test") {
		t.Fatal("a 4th reset within the hour is sent")
	}
	if !g.AllowReset(ctx, "bob@acme.test") {
		t.Fatal("another email is untouched")
	}
	mr.FastForward(time.Hour + time.Second)
	if !g.AllowReset(ctx, "ada@acme.test") {
		t.Fatal("allowed again after the window")
	}
}

func TestDefaults(t *testing.T) {
	g, _ := newGuard(t, Opts{})
	if g.opts.Failures != 10 || g.opts.FailureWindow != 15*time.Minute || g.opts.Resets != 3 || g.opts.ResetWindow != time.Hour {
		t.Fatalf("defaults %+v", g.opts)
	}
}
