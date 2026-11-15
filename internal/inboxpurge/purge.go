// Package inboxpurge deletes one inbox for good (fork of omnichannel): its conversations,
// messages, files, and the contacts no other inbox talks to, after writing all of it to an
// archive kept for a number of days. Upstream's inbox delete is a soft delete that keeps
// everything; a channel (a Zalo or Facebook account) removed from omnichannel must leave nothing.
package inboxpurge

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
	"github.com/zerodha/logf"
)

// ErrNoArchive is returned when no archive directory is set: nothing is deleted without a copy.
var ErrNoArchive = errors.New("inboxpurge: no archive directory")

// ErrNotFound is returned when the inbox does not exist (deleted already, soft or hard, counts as existing).
var ErrNotFound = errors.New("inboxpurge: inbox not found")

// okMarker marks an archive written whole; the prune counts the days from it.
const okMarker = "BACKUP_OK"

// Store is the media storage backend: files are read into the archive, then removed.
type Store interface {
	GetBlob(name string) ([]byte, error)
	Delete(name string) error
}

// Opts configures a Purger.
type Opts struct {
	// Dir holds one archive directory per purge.
	Dir string
	// Keep is how long an archive stays before the prune removes it.
	Keep time.Duration
	// ThumbPrefix names an image's thumbnail in the store (image.ThumbPrefix).
	ThumbPrefix string
}

// Purger purges inboxes.
type Purger struct {
	db    *sqlx.DB
	store Store
	lo    *logf.Logger
	opts  Opts
	now   func() time.Time
}

// New returns a Purger.
func New(db *sqlx.DB, store Store, lo *logf.Logger, opts Opts) *Purger {
	return &Purger{db: db, store: store, lo: lo, opts: opts, now: time.Now}
}

// Result says what a purge removed and where the copy is.
type Result struct {
	Archive       string `json:"archive"`
	Conversations int    `json:"conversations"`
	Messages      int    `json:"messages"`
	Contacts      int    `json:"contacts"`
	Files         int    `json:"files"`
}

// Every query below reads its parameters from args: $1 the inbox id, $2 the ids of the contacts
// that go with it. (Postgres refuses a parameter a statement doesn't use, and not every query
// needs both.)
const args = `WITH args AS (SELECT $1::int AS inbox, $2::bigint[] AS contacts) `

// Each export is one JSON object per line. Secrets (passwords, API keys, the inbox's config and
// secret) are left out: the archive is data, not a way back in.
var exports = []struct{ file, query string }{
	{"inbox.jsonl", args + `SELECT to_jsonb(i) - ARRAY['config', 'secret'] FROM inboxes i, args WHERE i.id = args.inbox`},
	{"conversations.jsonl", args + `SELECT to_jsonb(c) FROM conversations c, args WHERE c.inbox_id = args.inbox ORDER BY c.id`},
	{"messages.jsonl", args + `SELECT to_jsonb(m) FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id, args
		WHERE c.inbox_id = args.inbox ORDER BY m.id`},
	{"conversation_tags.jsonl", args + `SELECT jsonb_build_object('conversation_id', ct.conversation_id, 'tag', t.name)
		FROM conversation_tags ct JOIN tags t ON t.id = ct.tag_id JOIN conversations c ON c.id = ct.conversation_id, args
		WHERE c.inbox_id = args.inbox ORDER BY ct.conversation_id, t.name`},
	{"contacts.jsonl", args + `SELECT to_jsonb(u) - ARRAY['password', 'reset_password_token', 'reset_password_token_expiry', 'api_key', 'api_secret']
		FROM users u, args WHERE u.id = ANY(args.contacts) ORDER BY u.id`},
	{"contact_notes.jsonl", args + `SELECT to_jsonb(n) FROM contact_notes n, args WHERE n.contact_id = ANY(args.contacts) ORDER BY n.id`},
	{"media.jsonl", args + `SELECT to_jsonb(md) FROM media md, args WHERE ` + inboxMedia + ` ORDER BY md.id`},
}

// inboxMedia selects the inbox's files: those of its messages, and the pictures of its contacts.
const inboxMedia = `((md.model_type = 'messages' AND md.model_id IN (
		SELECT m.id FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.inbox_id = args.inbox))
	OR (md.model_type = 'users' AND md.model_id = ANY(args.contacts)))`

// Contacts that go with the inbox: those with a conversation in it, none in another inbox, and no
// message in another inbox's conversation (deleting a user deletes the messages it sent).
const contactsQuery = `SELECT DISTINCT c.contact_id FROM conversations c
	WHERE c.inbox_id = $1
	  AND NOT EXISTS (SELECT 1 FROM conversations o WHERE o.contact_id = c.contact_id AND o.inbox_id <> $1)
	  AND NOT EXISTS (SELECT 1 FROM conversation_messages m JOIN conversations o ON o.id = m.conversation_id
		WHERE m.sender_id = c.contact_id AND o.inbox_id <> $1)
	ORDER BY 1`

// Purge archives inbox id and deletes it with everything that is only its own. It locks the inbox
// and its conversations first, so a message arriving meanwhile waits and then fails, rather than
// being deleted without a copy. Nothing is deleted unless the archive is complete.
func (p *Purger) Purge(ctx context.Context, id int) (Result, error) {
	if p.opts.Dir == "" {
		return Result{}, ErrNoArchive
	}
	tx, err := p.db.BeginTxx(ctx, nil)
	if err != nil {
		return Result{}, fmt.Errorf("inboxpurge: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // a no-op after Commit

	var found int
	if err := tx.GetContext(ctx, &found, `SELECT id FROM inboxes WHERE id = $1 FOR UPDATE`, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Result{}, ErrNotFound
		}
		return Result{}, fmt.Errorf("inboxpurge: lock inbox: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `SELECT 1 FROM conversations WHERE inbox_id = $1 FOR UPDATE`, id); err != nil {
		return Result{}, fmt.Errorf("inboxpurge: lock conversations: %w", err)
	}

	var ids []int64
	if err := tx.SelectContext(ctx, &ids, contactsQuery, id); err != nil {
		return Result{}, fmt.Errorf("inboxpurge: contacts: %w", err)
	}
	contacts := pq.Int64Array(ids)
	if contacts == nil {
		contacts = pq.Int64Array{}
	}

	res := Result{Contacts: len(contacts)}
	if err := tx.GetContext(ctx, &res.Conversations, `SELECT count(*) FROM conversations WHERE inbox_id = $1`, id); err != nil {
		return Result{}, fmt.Errorf("inboxpurge: count conversations: %w", err)
	}
	if err := tx.GetContext(ctx, &res.Messages, `SELECT count(*) FROM conversation_messages m
		JOIN conversations c ON c.id = m.conversation_id WHERE c.inbox_id = $1`, id); err != nil {
		return Result{}, fmt.Errorf("inboxpurge: count messages: %w", err)
	}

	var files []mediaFile
	if err := tx.SelectContext(ctx, &files, args+`SELECT md.uuid::text AS uuid, md.content_type FROM media md, args
		WHERE `+inboxMedia, id, contacts); err != nil {
		return Result{}, fmt.Errorf("inboxpurge: media: %w", err)
	}
	res.Files = len(files)

	dir, err := p.archive(ctx, tx, id, contacts, files, res)
	if err != nil {
		return Result{}, err
	}
	res.Archive = filepath.Base(dir)

	uuids := make([]string, len(files))
	for i, f := range files {
		uuids[i] = f.UUID
	}
	// The inbox takes its conversations with it (and those their messages, tags, notes...: ON DELETE
	// CASCADE); the contacts take their notes. Media rows have no foreign key, so they go by name.
	steps := []struct {
		what  string
		query string
		arg   any
	}{
		{"media", `DELETE FROM media WHERE uuid::text = ANY($1)`, pq.StringArray(uuids)},
		{"inbox", `DELETE FROM inboxes WHERE id = $1`, id},
		{"contacts", `DELETE FROM users WHERE id = ANY($1) AND type IN ('contact', 'visitor')`, contacts},
	}
	for _, s := range steps {
		if _, err := tx.ExecContext(ctx, s.query, s.arg); err != nil {
			return Result{}, fmt.Errorf("inboxpurge: delete %s: %w", s.what, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("inboxpurge: commit: %w", err)
	}

	// The rows are gone; a file left behind now would belong to nothing, so each failure is logged.
	for _, f := range files {
		p.deleteFile(f.UUID)
		if strings.HasPrefix(f.ContentType, "image/") {
			p.deleteFile(p.opts.ThumbPrefix + f.UUID)
		}
	}
	p.lo.Info("inbox purged", "inbox_id", id, "conversations", res.Conversations, "messages", res.Messages,
		"contacts", res.Contacts, "files", res.Files, "archive", res.Archive)
	return res, nil
}

type mediaFile struct {
	UUID        string `db:"uuid"`
	ContentType string `db:"content_type"`
}

func (p *Purger) deleteFile(name string) {
	if err := p.store.Delete(name); err != nil && !errors.Is(err, os.ErrNotExist) {
		p.lo.Error("inboxpurge: deleting file", "file", name, "error", err)
	}
}

// archive writes the copy into a temporary directory and renames it into place, so an archive
// directory under its final name is always complete. Files are checksummed (SHA256SUMS).
func (p *Purger) archive(ctx context.Context, tx *sqlx.Tx, id int, contacts pq.Int64Array, files []mediaFile, res Result) (string, error) {
	if err := os.MkdirAll(p.opts.Dir, 0o700); err != nil {
		return "", fmt.Errorf("inboxpurge: archive dir: %w", err)
	}
	name := fmt.Sprintf("inbox-%d-%s", id, p.now().UTC().Format("20060102-150405"))
	tmp, err := os.MkdirTemp(p.opts.Dir, ".tmp-"+name+"-")
	if err != nil {
		return "", fmt.Errorf("inboxpurge: archive dir: %w", err)
	}
	keep := false
	defer func() {
		if !keep {
			os.RemoveAll(tmp)
		}
	}()

	sums := map[string]string{}
	write := func(rel string, fill func(io.Writer) error) error {
		path := filepath.Join(tmp, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return err
		}
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		h := sha256.New()
		if err := fill(io.MultiWriter(f, h)); err != nil {
			f.Close()
			return err
		}
		if err := f.Sync(); err != nil {
			f.Close()
			return err
		}
		sums[rel] = hex.EncodeToString(h.Sum(nil))
		return f.Close()
	}

	for _, e := range exports {
		err := write(e.file, func(w io.Writer) error {
			rows, err := tx.QueryContext(ctx, e.query, id, contacts)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var line []byte
				if err := rows.Scan(&line); err != nil {
					return err
				}
				if _, err := w.Write(append(line, '\n')); err != nil {
					return err
				}
			}
			return rows.Err()
		})
		if err != nil {
			return "", fmt.Errorf("inboxpurge: export %s: %w", e.file, err)
		}
	}
	for _, f := range files {
		blob, err := p.store.GetBlob(f.UUID)
		if errors.Is(err, os.ErrNotExist) {
			// A row whose file is already gone: the row is still archived, there is nothing to copy.
			p.lo.Warn("inboxpurge: file missing, archiving its row only", "file", f.UUID)
			continue
		}
		if err != nil {
			return "", fmt.Errorf("inboxpurge: read file %s: %w", f.UUID, err)
		}
		if err := write(filepath.Join("files", filepath.Base(f.UUID)), func(w io.Writer) error {
			_, err := w.Write(blob)
			return err
		}); err != nil {
			return "", fmt.Errorf("inboxpurge: copy file %s: %w", f.UUID, err)
		}
	}

	manifest, _ := json.MarshalIndent(map[string]any{
		"inbox_id": id, "purged_at": p.now().UTC().Format(time.RFC3339),
		"conversations": res.Conversations, "messages": res.Messages, "contacts": res.Contacts, "files": res.Files,
	}, "", "  ")
	if err := write("MANIFEST.json", func(w io.Writer) error { _, err := w.Write(append(manifest, '\n')); return err }); err != nil {
		return "", fmt.Errorf("inboxpurge: manifest: %w", err)
	}
	names := make([]string, 0, len(sums))
	for n := range sums {
		names = append(names, n)
	}
	sort.Strings(names)
	var b strings.Builder
	for _, n := range names {
		fmt.Fprintf(&b, "%s  %s\n", sums[n], n)
	}
	if err := os.WriteFile(filepath.Join(tmp, "SHA256SUMS"), []byte(b.String()), 0o600); err != nil {
		return "", fmt.Errorf("inboxpurge: checksums: %w", err)
	}
	if err := os.WriteFile(filepath.Join(tmp, okMarker), nil, 0o600); err != nil {
		return "", fmt.Errorf("inboxpurge: marker: %w", err)
	}
	final := filepath.Join(p.opts.Dir, name)
	if err := os.Rename(tmp, final); err != nil {
		return "", fmt.Errorf("inboxpurge: archive: %w", err)
	}
	keep = true
	return final, nil
}

// Prune removes archives older than Keep, counted from their marker. Directories without one
// (an archive cut short) go after the same time, by their own date.
func (p *Purger) Prune() (int, error) {
	if p.opts.Dir == "" || p.opts.Keep <= 0 {
		return 0, nil
	}
	entries, err := os.ReadDir(p.opts.Dir)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("inboxpurge: prune: %w", err)
	}
	cut := p.now().Add(-p.opts.Keep)
	n := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(p.opts.Dir, e.Name())
		info, err := os.Stat(filepath.Join(dir, okMarker))
		if err != nil {
			info, err = os.Stat(dir)
		}
		if err != nil || !info.ModTime().Before(cut) {
			continue
		}
		if err := os.RemoveAll(dir); err != nil {
			p.lo.Error("inboxpurge: prune", "archive", e.Name(), "error", err)
			continue
		}
		p.lo.Info("inboxpurge: archive pruned", "archive", e.Name())
		n++
	}
	return n, nil
}

// RunPrune prunes once a day until ctx ends.
func (p *Purger) RunPrune(ctx context.Context) {
	for {
		if _, err := p.Prune(); err != nil {
			p.lo.Error("inboxpurge: prune", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(24 * time.Hour):
		}
	}
}
