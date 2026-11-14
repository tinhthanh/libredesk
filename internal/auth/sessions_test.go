package auth

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestEndUserSessions_EndsOnlyThoseIssuedBefore(t *testing.T) {
	mr := miniredis.RunT(t)
	a := &Auth{rd: redis.NewClient(&redis.Options{Addr: mr.Addr()})}
	ctx := context.Background()

	before := time.Now().UnixMilli()
	if a.sessionEnded(ctx, 7, before) {
		t.Fatal("nothing ended yet")
	}
	if err := a.EndUserSessions(ctx, 7); err != nil {
		t.Fatal(err)
	}
	if !a.sessionEnded(ctx, 7, before) {
		t.Error("a session issued before is over")
	}
	if !a.sessionEnded(ctx, 7, 0) {
		t.Error("a session with no issue time (older code) is over")
	}
	if a.sessionEnded(ctx, 7, time.Now().UnixMilli()+5) {
		t.Error("a session issued after is valid")
	}
	if a.sessionEnded(ctx, 8, before) {
		t.Error("another user's sessions are untouched")
	}
}
