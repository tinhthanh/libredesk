package main

import "testing"

func TestSafeNext(t *testing.T) {
	cases := map[string]string{
		"":                                 "/home",
		"/inboxes/all":                     "/inboxes/all",
		"/inboxes/all?x=1":                 "/inboxes/all?x=1",
		"https://evil.example/login":       "/home",
		"//evil.example":                   "/home",
		"/\\evil.example":                  "/home",
		"\\\\evil.example":                 "/home",
		"/redirect?u=https://evil.example": "/home",
		"javascript:alert(1)":              "/home",
		"/x\r\nLocation: //evil":           "/home",
	}
	for in, want := range cases {
		if got := safeNext(in, "/home"); got != want {
			t.Errorf("safeNext(%q) = %q, want %q", in, got, want)
		}
	}
}
