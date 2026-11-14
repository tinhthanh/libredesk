package email

// Email servers an admin configures (IMAP and SMTP hosts) are outbound connections like
// webhooks: with the SSRF guard on, they may not reach private or reserved addresses (the
// cluster's Postgres, Redis, other services, cloud metadata) unless allowed.

import (
	"crypto/tls"
	"net"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/abhinavxd/libredesk/internal/ssrf"
)

var dialControl atomic.Pointer[ssrf.Control]

// SetDialControl sets the SSRF guard for IMAP and SMTP connections (nil: none).
func SetDialControl(c ssrf.Control) {
	if c == nil {
		dialControl.Store(nil)
		return
	}
	dialControl.Store(&c)
}

func control() ssrf.Control {
	if c := dialControl.Load(); c != nil {
		return *c
	}
	return nil
}

const dialTimeout = 30 * time.Second

// dialGuarded opens a TCP connection through the SSRF guard.
func dialGuarded(address string) (net.Conn, error) {
	d := net.Dialer{Timeout: dialTimeout, Control: control()}
	return d.Dial("tcp", address)
}

// dialGuardedTLS opens a TLS connection through the SSRF guard.
func dialGuardedTLS(address string, cfg *tls.Config) (net.Conn, error) {
	d := &net.Dialer{Timeout: dialTimeout, Control: control()}
	return tls.DialWithDialer(d, "tcp", address, cfg)
}

// checkHost refuses a host whose addresses the SSRF guard blocks. smtppool dials on its own, so
// its host is checked when the pool is made.
//
// No host (email not set up) and a host that doesn't resolve are not refused here: there is no
// address to judge, and refusing would stop Libredesk from starting (the notifier's pool is made
// at start). Sending fails later on its own; only an address the guard blocks is refused.
func checkHost(host string, port int) error {
	c := control()
	if c == nil || host == "" {
		return nil
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		return nil
	}
	for _, ip := range ips {
		if err := c("tcp", net.JoinHostPort(ip.String(), strconv.Itoa(port)), nil); err != nil {
			return err
		}
	}
	return nil
}
