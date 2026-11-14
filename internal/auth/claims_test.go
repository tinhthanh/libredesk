package auth

import (
	"encoding/json"
	"testing"
)

func TestOIDCClaim_EmailTrusted(t *testing.T) {
	cases := map[string]bool{
		`{"email":"a@acme.test","email_verified":true}`:  true,
		`{"email":"a@acme.test","email_verified":false}`: false,
		`{"email":"a@acme.test"}`:                        true,
	}
	for raw, want := range cases {
		var c OIDCclaim
		if err := json.Unmarshal([]byte(raw), &c); err != nil {
			t.Fatal(err)
		}
		if got := c.EmailTrusted(); got != want {
			t.Errorf("%s: trusted %v, want %v", raw, got, want)
		}
	}
}
