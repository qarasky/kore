// Package uploads implements chunked, resumable uploads.
//
// Lifecycle: Create reserves quota by inserting an uploads row (the row IS
// the reservation, see package quota) in the same transaction as the quota
// check. Append writes one chunk to <dataDir>/tmp/uploads/<id>/data, fsyncs
// it, and only then persists received_bytes, so the database never claims
// bytes that are not durable. Complete renames the staged file to the blob
// path (blob id = upload id, same volume, atomic) and, in one transaction,
// inserts the node under a name chosen by nodes.UniqueName and deletes the
// uploads row (releasing the reservation as the node starts counting).
//
// Crash safety of Complete: the blob id equals the upload id, so a crash
// between the rename and the commit leaves the uploads row plus a blob file
// and no node; a retried Complete picks the blob up again. If the completion
// transaction fails, the blob is renamed back to the staging path so the
// session is left exactly as it was. Cancel and Sweep remove both the staging
// dir and any such blob (no node can reference a blob whose upload row still
// exists, because the node insert and the row delete commit together).
//
// Per-upload operations are serialized by an in-process lock; Kore runs a
// single process per data directory.
package uploads

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/artchsh/kore/api/internal/nodes"
	"github.com/artchsh/kore/api/internal/quota"
	"github.com/artchsh/kore/api/internal/settings"
	"github.com/artchsh/kore/api/internal/users"
	"github.com/artchsh/kore/api/internal/volume"
)

// Chunk size bounds accepted at Create.
const (
	MinChunkSize int64 = 1 << 10
	MaxChunkSize int64 = 64 << 20
)

var (
	ErrNotFound         = errors.New("upload not found")
	ErrTooLarge         = errors.New("file exceeds the maximum file size")
	ErrInvalidSize      = errors.New("invalid upload size")
	ErrInvalidChunkSize = errors.New("invalid chunk size")
	ErrChunkTooLarge    = errors.New("chunk exceeds the upload's chunk size")
	ErrExceedsSize      = errors.New("chunk exceeds the declared upload size")
	ErrIncomplete       = errors.New("upload incomplete")
	ErrBusy             = errors.New("upload busy")
	ErrCorrupt          = errors.New("staged upload data is missing or inconsistent")
)

// OffsetError reports a PATCH whose offset differs from received_bytes.
type OffsetError struct{ Expected int64 }

func (e *OffsetError) Error() string {
	return fmt.Sprintf("upload offset mismatch: expected %d", e.Expected)
}

// Session is an in-progress upload.
type Session struct {
	ID            string
	UserID        string
	Space         nodes.Space
	ParentID      *string
	Name          string
	Size          int64
	ChunkSize     int64
	ReceivedBytes int64
	CreatedAt     int64
	UpdatedAt     int64
}

// Uploads manages upload sessions stored in db with staging under dataDir.
type Uploads struct {
	db      *sql.DB
	dataDir string
}

// New returns an Uploads over db and dataDir. All state lives in the
// database and on disk, so a new instance resumes existing sessions.
func New(db *sql.DB, dataDir string) *Uploads { return &Uploads{db: db, dataDir: dataDir} }

// busy holds the ids of uploads with an operation in progress (process-wide,
// so separate Uploads instances over the same data dir still serialize).
var busy = struct {
	sync.Mutex
	ids map[string]struct{}
}{ids: map[string]struct{}{}}

func tryLock(id string) (unlock func(), ok bool) {
	busy.Lock()
	defer busy.Unlock()
	if _, held := busy.ids[id]; held {
		return nil, false
	}
	busy.ids[id] = struct{}{}
	return func() {
		busy.Lock()
		delete(busy.ids, id)
		busy.Unlock()
	}, true
}

// validID reports whether id has the shape of an upload id (a UUIDv4), so it
// is safe to use as a path component.
func validID(id string) bool {
	_, err := volume.BlobPath("", id)
	return err == nil
}

func stagingDir(dataDir, id string) string  { return filepath.Join(dataDir, "tmp", "uploads", id) }
func stagingFile(dataDir, id string) string { return filepath.Join(stagingDir(dataDir, id), "data") }

// Create starts an upload of size bytes named name into sp/parent, reserving
// size bytes of the actor's quota.
func (u *Uploads) Create(ctx context.Context, actor users.User, sp nodes.Space, parent *string, name string, size, chunkSize int64) (Session, error) {
	name, err := nodes.NormalizeName(name)
	if err != nil {
		return Session{}, err
	}
	if size < 0 {
		return Session{}, ErrInvalidSize
	}
	if chunkSize < MinChunkSize || chunkSize > MaxChunkSize {
		return Session{}, ErrInvalidChunkSize
	}
	if max := settings.MaxFileBytes(ctx, u.db); max > 0 && size > max {
		return Session{}, ErrTooLarge
	}
	now := time.Now().Unix()
	s := Session{ID: volume.NewBlobID(), UserID: actor.ID, Space: sp, ParentID: parent, Name: name,
		Size: size, ChunkSize: chunkSize, CreatedAt: now, UpdatedAt: now}

	tx, err := u.db.BeginTx(ctx, nil)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback()
	if err := nodes.CheckParent(ctx, tx, actor, sp, parent); err != nil {
		return Session{}, err
	}
	if err := quota.Reserve(ctx, tx, actor.ID, size); err != nil {
		return Session{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO uploads(id,user_id,space_owner,parent_id,name,size,chunk_size,received_bytes,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,0,?,?)`, s.ID, s.UserID, sp.Owner, parent, name, size, chunkSize, now, now); err != nil {
		return Session{}, err
	}
	if err := tx.Commit(); err != nil {
		return Session{}, err
	}
	return s, nil
}

// Get returns the actor's upload session; other users' sessions are
// ErrNotFound.
func (u *Uploads) Get(ctx context.Context, actor users.User, id string) (Session, error) {
	if !validID(id) {
		return Session{}, ErrNotFound
	}
	var s Session
	var owner, parent sql.NullString
	err := u.db.QueryRowContext(ctx, `SELECT id,user_id,space_owner,parent_id,name,size,chunk_size,received_bytes,created_at,updated_at
		FROM uploads WHERE id=? AND user_id=?`, id, actor.ID).
		Scan(&s.ID, &s.UserID, &owner, &parent, &s.Name, &s.Size, &s.ChunkSize, &s.ReceivedBytes, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, err
	}
	if owner.Valid {
		s.Space.Owner = &owner.String
	}
	if parent.Valid {
		s.ParentID = &parent.String
	}
	return s, nil
}

// Append writes body at offset, which must equal the session's
// received_bytes (else *OffsetError). The body may hold at most chunk_size
// bytes (ErrChunkTooLarge) and may not extend past the declared size
// (ErrExceedsSize); rejected or failed chunks leave the session unchanged.
// It returns the new offset.
func (u *Uploads) Append(ctx context.Context, actor users.User, id string, offset int64, body io.Reader) (int64, error) {
	if !validID(id) {
		return 0, ErrNotFound
	}
	unlock, ok := tryLock(id)
	if !ok {
		if _, err := u.Get(ctx, actor, id); err != nil {
			return 0, err
		}
		return 0, ErrBusy
	}
	defer unlock()
	s, err := u.Get(ctx, actor, id)
	if err != nil {
		return 0, err
	}
	if offset != s.ReceivedBytes {
		return s.ReceivedBytes, &OffsetError{Expected: s.ReceivedBytes}
	}
	dir := stagingDir(u.dataDir, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return s.ReceivedBytes, err
	}
	f, err := os.OpenFile(filepath.Join(dir, "data"), os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return s.ReceivedBytes, err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return s.ReceivedBytes, err
	}
	switch {
	case fi.Size() < s.ReceivedBytes:
		return s.ReceivedBytes, ErrCorrupt
	case fi.Size() > s.ReceivedBytes:
		// A previous chunk was written but its offset never persisted
		// (crash, DB error): discard the unacknowledged bytes.
		if err := f.Truncate(s.ReceivedBytes); err != nil {
			return s.ReceivedBytes, err
		}
	}
	if _, err := f.Seek(s.ReceivedBytes, io.SeekStart); err != nil {
		return s.ReceivedBytes, err
	}
	undo := func() { f.Truncate(s.ReceivedBytes) }

	limit := min(s.ChunkSize, s.Size-s.ReceivedBytes)
	n, err := io.Copy(f, io.LimitReader(body, limit))
	if err != nil {
		undo()
		return s.ReceivedBytes, err
	}
	if n == limit {
		var one [1]byte
		m, rerr := io.ReadFull(body, one[:])
		if m > 0 {
			undo()
			if limit == s.ChunkSize {
				return s.ReceivedBytes, ErrChunkTooLarge
			}
			return s.ReceivedBytes, ErrExceedsSize
		}
		if rerr != nil && !errors.Is(rerr, io.EOF) {
			undo()
			return s.ReceivedBytes, rerr
		}
	}
	if err := f.Sync(); err != nil {
		undo()
		return s.ReceivedBytes, err
	}
	if s.ReceivedBytes == 0 {
		// Make the new file's directory entry durable too.
		if err := syncDir(dir); err != nil {
			undo()
			return s.ReceivedBytes, err
		}
	}
	next := s.ReceivedBytes + n
	res, err := u.db.ExecContext(ctx, `UPDATE uploads SET received_bytes=?, updated_at=? WHERE id=? AND received_bytes=?`,
		next, time.Now().Unix(), id, s.ReceivedBytes)
	if err != nil {
		undo()
		return s.ReceivedBytes, err
	}
	if k, _ := res.RowsAffected(); k != 1 {
		undo()
		return s.ReceivedBytes, ErrNotFound
	}
	return next, nil
}

// Complete turns a fully received upload into a file node. The final name is
// chosen at completion time, so concurrent same-name uploads all succeed.
func (u *Uploads) Complete(ctx context.Context, actor users.User, id string) (nodes.Node, error) {
	if !validID(id) {
		return nodes.Node{}, ErrNotFound
	}
	unlock, ok := tryLock(id)
	if !ok {
		if _, err := u.Get(ctx, actor, id); err != nil {
			return nodes.Node{}, err
		}
		return nodes.Node{}, ErrBusy
	}
	defer unlock()
	s, err := u.Get(ctx, actor, id)
	if err != nil {
		return nodes.Node{}, err
	}
	if s.ReceivedBytes != s.Size {
		return nodes.Node{}, ErrIncomplete
	}
	staged := stagingFile(u.dataDir, id)
	blob, err := volume.BlobPath(u.dataDir, id)
	if err != nil {
		return nodes.Node{}, err
	}
	if err := u.stageToBlob(s, staged, blob); err != nil {
		return nodes.Node{}, err
	}
	// From here on the bytes live at blob; on failure, put them back.
	restore := func() {
		os.MkdirAll(stagingDir(u.dataDir, id), 0o755)
		os.Rename(blob, staged)
	}
	mt := detectMime(s.Name, blob)

	tx, err := u.db.BeginTx(ctx, nil)
	if err != nil {
		restore()
		return nodes.Node{}, err
	}
	n, err := completeTx(ctx, tx, actor, s, mt)
	if err != nil {
		tx.Rollback()
		restore()
		return nodes.Node{}, err
	}
	if err := tx.Commit(); err != nil {
		// Only undo the rename if the commit really did not happen.
		var x int
		if qerr := u.db.QueryRowContext(context.WithoutCancel(ctx), `SELECT 1 FROM uploads WHERE id=?`, id).Scan(&x); qerr == nil {
			restore()
		}
		return nodes.Node{}, err
	}
	os.RemoveAll(stagingDir(u.dataDir, id))
	return n, nil
}

func completeTx(ctx context.Context, tx *sql.Tx, actor users.User, s Session, mt string) (nodes.Node, error) {
	var rb, size int64
	err := tx.QueryRowContext(ctx, `SELECT received_bytes,size FROM uploads WHERE id=? AND user_id=?`, s.ID, actor.ID).Scan(&rb, &size)
	if errors.Is(err, sql.ErrNoRows) {
		return nodes.Node{}, ErrNotFound
	}
	if err != nil {
		return nodes.Node{}, err
	}
	if rb != size {
		return nodes.Node{}, ErrIncomplete
	}
	n, err := nodes.CreateFileTx(ctx, tx, actor, nodes.FileSpec{
		Space: s.Space, Parent: s.ParentID, Name: s.Name, Size: s.Size, BlobID: s.ID, Mime: mt,
	})
	if err != nil {
		return nodes.Node{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM uploads WHERE id=?`, s.ID); err != nil {
		return nodes.Node{}, err
	}
	return n, nil
}

// stageToBlob moves the staged bytes to blob, or verifies that an earlier,
// interrupted Complete already did.
func (u *Uploads) stageToBlob(s Session, staged, blob string) error {
	fi, err := os.Stat(staged)
	if errors.Is(err, os.ErrNotExist) {
		if bi, berr := os.Stat(blob); berr == nil {
			if bi.Size() != s.Size {
				return ErrCorrupt
			}
			return nil // renamed by an interrupted Complete
		}
		if s.Size != 0 {
			return ErrCorrupt
		}
		// Zero-byte upload: no chunk was ever written.
		if err := os.MkdirAll(filepath.Dir(staged), 0o755); err != nil {
			return err
		}
		f, err := os.OpenFile(staged, os.O_WRONLY|os.O_CREATE, 0o644)
		if err != nil {
			return err
		}
		if err := f.Close(); err != nil {
			return err
		}
		fi, err = os.Stat(staged)
	}
	if err != nil {
		return err
	}
	if fi.Size() != s.Size {
		return ErrCorrupt
	}
	if err := os.MkdirAll(filepath.Dir(blob), 0o755); err != nil {
		return err
	}
	if err := os.Rename(staged, blob); err != nil {
		return err
	}
	return syncDir(filepath.Dir(blob))
}

// detectMime uses the extension, falling back to sniffing the first 512 bytes.
func detectMime(name, path string) string {
	if t := mime.TypeByExtension(filepath.Ext(name)); t != "" {
		return t
	}
	f, err := os.Open(path)
	if err != nil {
		return "application/octet-stream"
	}
	defer f.Close()
	buf := make([]byte, 512)
	n, _ := io.ReadFull(f, buf)
	if n == 0 {
		return "application/octet-stream"
	}
	return http.DetectContentType(buf[:n])
}

// Cancel deletes the actor's upload session and its staged bytes, releasing
// the reservation.
func (u *Uploads) Cancel(ctx context.Context, actor users.User, id string) error {
	if !validID(id) {
		return ErrNotFound
	}
	unlock, ok := tryLock(id)
	if !ok {
		if _, err := u.Get(ctx, actor, id); err != nil {
			return err
		}
		return ErrBusy
	}
	defer unlock()
	res, err := u.db.ExecContext(ctx, `DELETE FROM uploads WHERE id=? AND user_id=?`, id, actor.ID)
	if err != nil {
		return err
	}
	if k, _ := res.RowsAffected(); k != 1 {
		return ErrNotFound
	}
	removeFiles(u.dataDir, id)
	return nil
}

// removeFiles deletes an upload's staging dir and any blob an interrupted
// Complete left behind. Call only after the uploads row is gone (or known to
// exist), never for a completed upload.
func removeFiles(dataDir, id string) {
	os.RemoveAll(stagingDir(dataDir, id))
	if blob, err := volume.BlobPath(dataDir, id); err == nil {
		os.Remove(blob)
	}
}

// DeleteUserSessionsTx deletes every upload session of userID inside tx
// (releasing their reservations) and returns their ids; pass them to
// RemoveSessionFiles after the transaction commits.
func DeleteUserSessionsTx(ctx context.Context, tx *sql.Tx, userID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM uploads WHERE user_id=?`, userID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM uploads WHERE user_id=?`, userID); err != nil {
		return nil, err
	}
	return ids, nil
}

// RemoveSessionFiles deletes the staged bytes of upload sessions whose rows
// are already gone. Sessions with an operation in progress are skipped; that
// operation fails on the missing row, and Sweep / SweepOrphanBlobs reclaim
// what it leaves behind.
func RemoveSessionFiles(dataDir string, ids []string) {
	for _, id := range ids {
		if !validID(id) {
			continue
		}
		unlock, ok := tryLock(id)
		if !ok {
			continue
		}
		removeFiles(dataDir, id)
		unlock()
	}
}

// Sweep deletes upload sessions with no activity for olderThan (freeing
// their reservations) and their staged bytes, plus staging dirs that have
// no session and have not been modified for olderThan. It returns the number
// of sessions deleted. Uploads with an operation in progress are skipped.
func Sweep(ctx context.Context, db *sql.DB, dataDir string, olderThan time.Duration) (int, error) {
	cutoff := time.Now().Add(-olderThan)
	rows, err := db.QueryContext(ctx, `SELECT id FROM uploads WHERE updated_at < ?`, cutoff.Unix())
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	n := 0
	for _, id := range ids {
		unlock, ok := tryLock(id)
		if !ok {
			continue
		}
		res, err := db.ExecContext(ctx, `DELETE FROM uploads WHERE id=? AND updated_at < ?`, id, cutoff.Unix())
		if err != nil {
			unlock()
			return n, err
		}
		if k, _ := res.RowsAffected(); k == 1 {
			if validID(id) {
				removeFiles(dataDir, id)
			}
			n++
		}
		unlock()
	}

	entries, err := os.ReadDir(filepath.Join(dataDir, "tmp", "uploads"))
	if errors.Is(err, os.ErrNotExist) {
		return n, nil
	}
	if err != nil {
		return n, err
	}
	for _, e := range entries {
		id := e.Name()
		if !e.IsDir() || !validID(id) {
			continue
		}
		info, err := e.Info()
		if err != nil || !info.ModTime().Before(cutoff) {
			continue
		}
		unlock, ok := tryLock(id)
		if !ok {
			continue
		}
		var x int
		err = db.QueryRowContext(ctx, `SELECT 1 FROM uploads WHERE id=?`, id).Scan(&x)
		if errors.Is(err, sql.ErrNoRows) {
			// No session: either cancelled/swept mid-cleanup or a completed
			// upload whose staging dir removal was interrupted. Never touch
			// the blob here, it may belong to a live node.
			os.RemoveAll(stagingDir(dataDir, id))
		}
		unlock()
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return n, err
		}
	}
	return n, nil
}

func syncDir(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
