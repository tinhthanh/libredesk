package inboxpurge

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/abhinavxd/libredesk/internal/testutil"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
	"github.com/zerodha/logf"
)

// memStore is the media store in memory.
type memStore struct {
	mu    sync.Mutex
	files map[string][]byte
}

func (s *memStore) GetBlob(name string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.files[name]
	if !ok {
		return nil, os.ErrNotExist
	}
	return b, nil
}

func (s *memStore) Delete(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.files[name]; !ok {
		return os.ErrNotExist
	}
	delete(s.files, name)
	return nil
}

func (s *memStore) has(name string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.files[name]
	return ok
}

// world is two inboxes: A is purged, B stays. Contacts:
//   - only: talks only to A (with a picture and a note): goes with A.
//   - both: has a conversation in A and one in B: stays, loses its conversation in A.
//   - other: only B: stays.
//   - sender: has its conversation in A but also wrote in a conversation of B: stays.
//
// An agent replies in A and stays.
type world struct {
	db                        *sqlx.DB
	store                     *memStore
	inboxA, inboxB            int
	only, both, other, sender int
	agent                     int
	convA, convBoth, convB    int
	imgA, docA, avatar, fileB string
}

func newWorld(t *testing.T, name string) *world {
	t.Helper()
	db := testutil.NewDB(t, name)
	w := &world{db: db, store: &memStore{files: map[string][]byte{}}}
	one := func(dst *int, q string, args ...any) {
		t.Helper()
		if err := db.QueryRow(q, args...).Scan(dst); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	str := func(dst *string, q string, args ...any) {
		t.Helper()
		if err := db.QueryRow(q, args...).Scan(dst); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	one(&w.inboxA, `INSERT INTO inboxes (name, channel, config, secret) VALUES ('Zalo acc2', 'livechat', '{"k":"v"}', 'inbox-secret') RETURNING id`)
	one(&w.inboxB, `INSERT INTO inboxes (name, channel) VALUES ('Zalo shop1', 'livechat') RETURNING id`)
	contact := func(dst *int, ext string) {
		one(dst, `INSERT INTO users (type, first_name, external_user_id, "password") VALUES ('contact', $1, $1, 'pw-hash') RETURNING id`, ext)
	}
	contact(&w.only, "only")
	contact(&w.both, "both")
	contact(&w.other, "other")
	contact(&w.sender, "sender")
	one(&w.agent, `INSERT INTO users (type, email, first_name) VALUES ('agent', 'agent@acme.test', 'Agent') RETURNING id`)

	var open int
	one(&open, `SELECT id FROM conversation_statuses WHERE name = 'Open'`)
	conv := func(dst *int, contact, inbox int) {
		one(dst, `INSERT INTO conversations (contact_id, inbox_id, status_id) VALUES ($1, $2, $3) RETURNING id`, contact, inbox, open)
	}
	var convSender, convOther int
	conv(&w.convA, w.only, w.inboxA)
	conv(&w.convBoth, w.both, w.inboxA)
	conv(&w.convB, w.both, w.inboxB)
	conv(&convOther, w.other, w.inboxB)
	conv(&convSender, w.sender, w.inboxA)

	msg := func(conv, sender int, senderType, text string) int {
		var id int
		one(&id, `INSERT INTO conversation_messages (type, status, conversation_id, content, sender_id, sender_type)
			VALUES ('incoming', 'received', $1, $2, $3, $4) RETURNING id`, conv, text, sender, senderType)
		return id
	}
	mA := msg(w.convA, w.only, "contact", "xin chào")
	msg(w.convA, w.agent, "agent", "chào anh")
	msg(w.convBoth, w.both, "contact", "hỏi giá")
	mB := msg(w.convB, w.both, "contact", "bên B")
	msg(convOther, w.other, "contact", "khác")
	msg(convSender, w.sender, "contact", "ở A")
	msg(w.convB, w.sender, "contact", "ghé B") // sender wrote in B: it stays

	media := func(dst *string, model string, id int, ctype string, body string) {
		str(dst, `INSERT INTO media (store, filename, content_type, model_type, model_id) VALUES ('fs', 'f', $1, $2, $3) RETURNING uuid::text`,
			ctype, model, id)
		w.store.files[*dst] = []byte(body)
	}
	media(&w.imgA, "messages", mA, "image/jpeg", "jpeg-A")
	w.store.files["thumb_"+w.imgA] = []byte("thumb-A")
	media(&w.docA, "messages", mA, "application/pdf", "pdf-A")
	media(&w.avatar, "users", w.only, "image/png", "avatar-only")
	media(&w.fileB, "messages", mB, "image/jpeg", "jpeg-B")

	var tag int
	one(&tag, `INSERT INTO tags (name) VALUES ('vip') RETURNING id`)
	db.MustExec(`INSERT INTO conversation_tags (tag_id, conversation_id) VALUES ($1, $2)`, tag, w.convA)
	db.MustExec(`INSERT INTO contact_notes (contact_id, note, user_id) VALUES ($1, 'khách quen', $2)`, w.only, w.agent)
	return w
}

func newPurger(w *world, dir string) *Purger {
	lo := logf.New(logf.Opts{Level: logf.ErrorLevel})
	return New(w.db, w.store, &lo, Opts{Dir: dir, Keep: 30 * 24 * time.Hour, ThumbPrefix: "thumb_"})
}

func count(t *testing.T, db *sqlx.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := db.Get(&n, q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

func TestPurge_RemovesTheInboxAndWhatIsOnlyItsAfterArchivingIt(t *testing.T) {
	w := newWorld(t, "inboxpurge_purge")
	dir := t.TempDir()
	res, err := newPurger(w, dir).Purge(context.Background(), w.inboxA)
	if err != nil {
		t.Fatalf("purge: %v", err)
	}

	if res.Conversations != 3 || res.Messages != 4 || res.Contacts != 1 || res.Files != 3 {
		t.Errorf("result = %+v, want 3 conversations, 4 messages, 1 contact, 3 files", res)
	}

	// Gone: the inbox, its conversations, the contact only it had, their files and the thumbnail.
	if n := count(t, w.db, `SELECT count(*) FROM inboxes WHERE id = $1`, w.inboxA); n != 0 {
		t.Errorf("inbox A still there")
	}
	if n := count(t, w.db, `SELECT count(*) FROM conversations WHERE inbox_id = $1`, w.inboxA); n != 0 {
		t.Errorf("%d conversations of A left", n)
	}
	if n := count(t, w.db, `SELECT count(*) FROM users WHERE id = $1`, w.only); n != 0 {
		t.Errorf("contact only of A still there")
	}
	if n := count(t, w.db, `SELECT count(*) FROM contact_notes`); n != 0 {
		t.Errorf("%d contact notes left", n)
	}
	if n := count(t, w.db, `SELECT count(*) FROM media WHERE uuid::text = ANY($1)`, pq.StringArray{w.imgA, w.docA, w.avatar}); n != 0 {
		t.Errorf("%d media rows of A left", n)
	}
	for _, f := range []string{w.imgA, "thumb_" + w.imgA, w.docA, w.avatar} {
		if w.store.has(f) {
			t.Errorf("file %s still in the store", f)
		}
	}

	// Kept: inbox B and everything in it, the contacts it talks to, the agent.
	if n := count(t, w.db, `SELECT count(*) FROM conversations WHERE inbox_id = $1`, w.inboxB); n != 2 {
		t.Errorf("inbox B has %d conversations, want 2", n)
	}
	if n := count(t, w.db, `SELECT count(*) FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.inbox_id = $1`, w.inboxB); n != 3 {
		t.Errorf("inbox B has %d messages, want 3", n)
	}
	if n := count(t, w.db, `SELECT count(*) FROM users WHERE id IN ($1, $2, $3, $4)`, w.both, w.other, w.sender, w.agent); n != 4 {
		t.Errorf("%d of the 4 kept users left", n)
	}
	if !w.store.has(w.fileB) || count(t, w.db, `SELECT count(*) FROM media WHERE uuid::text = $1`, w.fileB) != 1 {
		t.Errorf("inbox B's file was touched")
	}

	// The archive: every file checksummed, contents as they were, no secret.
	arch := filepath.Join(dir, res.Archive)
	if _, err := os.Stat(filepath.Join(arch, okMarker)); err != nil {
		t.Fatalf("no %s: %v", okMarker, err)
	}
	sums, err := os.ReadFile(filepath.Join(arch, "SHA256SUMS"))
	if err != nil {
		t.Fatal(err)
	}
	listed := 0
	sc := bufio.NewScanner(bytes.NewReader(sums))
	for sc.Scan() {
		sum, rel, _ := strings.Cut(sc.Text(), "  ")
		b, err := os.ReadFile(filepath.Join(arch, rel))
		if err != nil {
			t.Fatalf("%s listed but unreadable: %v", rel, err)
		}
		h := sha256.Sum256(b)
		if hex.EncodeToString(h[:]) != sum {
			t.Errorf("%s: checksum mismatch", rel)
		}
		listed++
	}
	if listed != 11 { // 7 exports, 3 files, MANIFEST.json
		t.Errorf("SHA256SUMS lists %d files, want 11", listed)
	}
	if b, _ := os.ReadFile(filepath.Join(arch, "files", w.imgA)); string(b) != "jpeg-A" {
		t.Errorf("archived image = %q", b)
	}
	lines := func(f string) int {
		b, _ := os.ReadFile(filepath.Join(arch, f))
		return bytes.Count(b, []byte("\n"))
	}
	for f, want := range map[string]int{"inbox.jsonl": 1, "conversations.jsonl": 3, "messages.jsonl": 4,
		"conversation_tags.jsonl": 1, "contacts.jsonl": 1, "contact_notes.jsonl": 1, "media.jsonl": 3} {
		if got := lines(f); got != want {
			t.Errorf("%s has %d lines, want %d", f, got, want)
		}
	}
	all, _ := os.ReadFile(filepath.Join(arch, "inbox.jsonl"))
	contacts, _ := os.ReadFile(filepath.Join(arch, "contacts.jsonl"))
	for _, secret := range []string{"inbox-secret", `"k"`, "pw-hash"} {
		if bytes.Contains(all, []byte(secret)) || bytes.Contains(contacts, []byte(secret)) {
			t.Errorf("archive holds secret %q", secret)
		}
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Errorf("archive dir has %d entries, want just the archive (no temporary left)", len(entries))
	}
}

func TestPurge_WithoutAnArchiveDirDeletesNothing(t *testing.T) {
	w := newWorld(t, "inboxpurge_noarchive")
	_, err := newPurger(w, "").Purge(context.Background(), w.inboxA)
	if !errors.Is(err, ErrNoArchive) {
		t.Fatalf("err = %v, want ErrNoArchive", err)
	}
	if n := count(t, w.db, `SELECT count(*) FROM conversations WHERE inbox_id = $1`, w.inboxA); n != 3 {
		t.Errorf("inbox A has %d conversations, want 3", n)
	}
}

func TestPurge_AnArchiveThatCannotBeWrittenDeletesNothing(t *testing.T) {
	w := newWorld(t, "inboxpurge_archivefails")
	dir := t.TempDir()
	// A file the purge reads fails (not "missing"): the archive stops, and so does the purge.
	w.store.files[w.docA] = nil
	failing := &failingStore{memStore: w.store, fail: w.docA}
	lo := logf.New(logf.Opts{Level: logf.ErrorLevel})
	p := New(w.db, failing, &lo, Opts{Dir: dir, Keep: time.Hour, ThumbPrefix: "thumb_"})
	if _, err := p.Purge(context.Background(), w.inboxA); err == nil {
		t.Fatal("purge succeeded with a file it could not read")
	}
	if n := count(t, w.db, `SELECT count(*) FROM inboxes WHERE id = $1`, w.inboxA); n != 1 {
		t.Errorf("inbox A deleted without a complete archive")
	}
	if !w.store.has(w.imgA) {
		t.Errorf("a file was deleted without a complete archive")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("a partial archive was left: %v", entries)
	}
}

type failingStore struct {
	*memStore
	fail string
}

func (s *failingStore) GetBlob(name string) ([]byte, error) {
	if name == s.fail {
		return nil, errors.New("disk on fire")
	}
	return s.memStore.GetBlob(name)
}

func TestPurge_AnUnknownInboxIsNotFound(t *testing.T) {
	w := newWorld(t, "inboxpurge_unknown")
	if _, err := newPurger(w, t.TempDir()).Purge(context.Background(), 99999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestPrune_RemovesArchivesOlderThanKeep(t *testing.T) {
	dir := t.TempDir()
	mk := func(name string, age time.Duration, marker bool) {
		d := filepath.Join(dir, name)
		if err := os.MkdirAll(d, 0o700); err != nil {
			t.Fatal(err)
		}
		at := time.Now().Add(-age)
		if marker {
			m := filepath.Join(d, okMarker)
			if err := os.WriteFile(m, nil, 0o600); err != nil {
				t.Fatal(err)
			}
			os.Chtimes(m, at, at)
		}
		os.Chtimes(d, at, at)
	}
	mk("inbox-1-old", 31*24*time.Hour, true)
	mk("inbox-2-new", 2*24*time.Hour, true)
	mk(".tmp-inbox-3-cut", 40*24*time.Hour, false)
	lo := logf.New(logf.Opts{Level: logf.ErrorLevel})
	p := New(nil, nil, &lo, Opts{Dir: dir, Keep: 30 * 24 * time.Hour})
	n, err := p.Prune()
	if err != nil || n != 2 {
		t.Fatalf("Prune = %d, %v; want 2", n, err)
	}
	left, _ := os.ReadDir(dir)
	if len(left) != 1 || left[0].Name() != "inbox-2-new" {
		t.Errorf("left %v, want only inbox-2-new", left)
	}
}
