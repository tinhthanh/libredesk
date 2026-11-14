package email

import (
	"strings"
	"testing"

	imodels "github.com/abhinavxd/libredesk/internal/inbox/models"
	"github.com/abhinavxd/libredesk/internal/ssrf"
	"github.com/zerodha/logf"
)

func TestEmailServersGoThroughTheSSRFGuard(t *testing.T) {
	lo := logf.New(logf.Opts{})
	SetDialControl(ssrf.NewControl(true, nil, &lo))
	t.Cleanup(func() { SetDialControl(nil) })

	if _, err := dialGuarded("127.0.0.1:6379"); err == nil || !strings.Contains(err.Error(), "ssrf") {
		t.Errorf("IMAP to a private address: %v", err)
	}
	if err := checkHost("localhost", 25); err == nil || !strings.Contains(err.Error(), "ssrf") {
		t.Errorf("SMTP host resolving to loopback: %v", err)
	}
	if _, err := NewSmtpPool([]imodels.SMTPConfig{{Host: "127.0.0.1", Port: 5432, MaxConns: 1}}, nil); err == nil {
		t.Error("an SMTP pool to a private address is refused")
	}
}

func TestEmailServersUnguardedWhenSSRFIsOff(t *testing.T) {
	SetDialControl(nil)
	if err := checkHost("localhost", 25); err != nil {
		t.Errorf("no guard, no refusal: %v", err)
	}
}

// An instance with email not set up (no SMTP host) must still start: the notifier makes its pool
// at start, and a host that can't be judged is not refused (sending fails later on its own).
func TestCheckHostLetsAnEmptyOrUnresolvableHostThrough(t *testing.T) {
	lo := logf.New(logf.Opts{})
	SetDialControl(ssrf.NewControl(true, nil, &lo))
	t.Cleanup(func() { SetDialControl(nil) })

	if err := checkHost("", 587); err != nil {
		t.Fatalf("empty host refused: %v", err)
	}
	if err := checkHost("no-such-host.invalid", 587); err != nil {
		t.Fatalf("unresolvable host refused: %v", err)
	}
	if err := checkHost("localhost", 587); err == nil {
		t.Fatal("a host resolving to a blocked address was let through")
	}
}
