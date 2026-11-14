package main

import "testing"

func TestCSRFRequired_EveryMethodButTheSafeOnes(t *testing.T) {
	for _, m := range []string{"POST", "PUT", "DELETE", "PATCH", "PROPFIND"} {
		if !csrfRequired(m) {
			t.Errorf("%s must carry the token", m)
		}
	}
	for _, m := range []string{"GET", "HEAD", "OPTIONS"} {
		if csrfRequired(m) {
			t.Errorf("%s is safe", m)
		}
	}
}

func TestCSRFMatches(t *testing.T) {
	if csrfMatches("", "") || csrfMatches("a", "") || csrfMatches("", "a") || csrfMatches("a", "b") {
		t.Error("missing or different tokens never match")
	}
	if !csrfMatches("tok", "tok") {
		t.Error("equal tokens match")
	}
}
