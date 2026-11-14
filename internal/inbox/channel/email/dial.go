package email

// Email servers an admin configures (IMAP and SMTP hosts) are outbound connections like
// webhooks: with the SSRF guard on, they may not reach private or reserved addresses (the
// cluster's Postgres, Redis, other services, cloud metadata) unless allowed.

import (
	"crypto/tls"
	"fmt"
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
func checkHost(host string, port int) error {
	c := control()
	if c == nil {
		return nil
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("resolving %s: %w", host, err)
	}
	for _, ip := range ips {
		if err := c("tcp", net.JoinHostPort(ip.String(), strconv.Itoa(port)), nil); err != nil {
			return err
		}
	}
	return nil
}
