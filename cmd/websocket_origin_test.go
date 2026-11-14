package main

import "testing"

func TestAgentWSOriginAllowed(t *testing.T) {
	cases := []struct {
		name, origin, host string
		dev, want          bool
	}{
		{"same host over https", "https://clinic.acme.test", "clinic.acme.test", false, true},
		{"same localhost host over http (an SSH tunnel)", "http://localhost:9000", "localhost:9000", false, true},
		{"another localhost port in production", "http://localhost:5173", "clinic.acme.test", false, false},
		{"another localhost port in dev", "http://localhost:5173", "localhost:9000", true, true},
		{"another site", "https://evil.example", "clinic.acme.test", true, false},
		{"plain http elsewhere", "http://clinic.acme.test", "clinic.acme.test", false, false},
		{"no origin", "", "clinic.acme.test", true, false},
	}
	for _, c := range cases {
		if got := agentWSOriginAllowed(c.origin, c.host, c.dev); got != c.want {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
}
