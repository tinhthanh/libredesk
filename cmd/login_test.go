package main

import "testing"

func TestSystemLoginRefused(t *testing.T) {
	cases := []struct {
		name                 string
		email                string
		allow, viaProxy, out bool
	}{
		{"System through the proxy, not allowed", "System", false, true, true},
		{"system in other case, padded", "  system ", false, true, true},
		{"System directly, in the cluster", "System", false, false, false},
		{"System through the proxy, allowed (upstream default)", "System", true, true, false},
		{"an agent through the proxy", "agent@acme.test", false, true, false},
	}
	for _, c := range cases {
		if got := systemLoginRefused(c.email, c.allow, c.viaProxy); got != c.out {
			t.Errorf("%s: got %v, want %v", c.name, got, c.out)
		}
	}
}
