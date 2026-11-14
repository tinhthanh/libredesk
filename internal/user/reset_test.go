package user

import (
	"testing"
)

func TestHashResetToken(t *testing.T) {
	h := hashResetToken("abc")
	if h == "abc" || len(h) != 64 || h != hashResetToken("abc") || h == hashResetToken("abd") {
		t.Fatalf("hash %q", h)
	}
}

// The token mailed out works once; the table holds only its hash.
func TestResetToken_StoredHashedAndUsableOnce(t *testing.T) {
	u, db := newTestManager(t)
	agent, err := u.CreateAgent("Ada", "Agent", "ada@acme.test", []string{"Agent"})
	if err != nil {
		t.Fatal(err)
	}
	token, err := u.SetResetPasswordToken(agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	var stored string
	if err := db.Get(&stored, `SELECT reset_password_token FROM users WHERE id = $1`, agent.ID); err != nil {
		t.Fatal(err)
	}
	if stored == token || stored != hashResetToken(token) {
		t.Fatalf("stored %q for token %q", stored, token)
	}
	if _, err := u.ResetPassword(stored, "Strong-Pass-123!"); err == nil {
		t.Fatal("the stored hash is no token")
	}
	if id, err := u.ResetPassword(token, "Strong-Pass-123!"); err != nil || id != agent.ID {
		t.Fatalf("reset with the mailed token: id %d err %v", id, err)
	}
	if _, err := u.ResetPassword(token, "Strong-Pass-456!"); err == nil {
		t.Fatal("a token works once")
	}
}

// An unknown email and a wrong password get the same answer.
func TestVerifyPassword_UnknownEmailAnswersLikeAWrongPassword(t *testing.T) {
	u, _ := newTestManager(t)
	if _, err := u.CreateAgent("Ada", "Agent", "ada@acme.test", []string{"Agent"}); err != nil {
		t.Fatal(err)
	}
	_, unknown := u.VerifyPassword("nobody@acme.test", []byte("x"))
	_, wrong := u.VerifyPassword("ada@acme.test", []byte("x"))
	if unknown == nil || wrong == nil || unknown.Error() != wrong.Error() {
		t.Fatalf("unknown %v, wrong %v", unknown, wrong)
	}
}
