package main

import "strings"

// safeNext is where to send someone after signing in: next when it is a path on this site,
// fallback otherwise. "//host", "/\\host" and anything with a scheme would leave the site (an
// open redirect a phishing link could use).
func safeNext(next, fallback string) string {
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.HasPrefix(next, "/\\") {
		return fallback
	}
	if strings.ContainsAny(next, "\r\n\\") || strings.Contains(next, "://") {
		return fallback
	}
	return next
}
