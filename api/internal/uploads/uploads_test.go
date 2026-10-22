package uploads

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/qarasky/kore/api/internal/nodes"
	"github.com/qarasky/kore/api/internal/quota"
	"github.com/qarasky/kore/api/internal/settings"
	"github.com/qarasky/kore/api/internal/store"
	"github.com/qarasky/kore/api/internal/users"
	"github.com/qarasky/kore/api/internal/volume"
)

var ctx = context.Background()

const kib = 1024

type fixture struct {
	db      *sql.DB
	dataDir string
	a, b    users.User
}

func setup(t *testing.T, quotaBytes int64) *fixture {
	t.Helper()
	dir := t.TempDir()
	if err := volume.Init(dir); err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(filepath.Join(dir, "kore.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	a, err := users.Create(ctx, db, "a@x.io", "x", "user", quotaBytes)
	if err != nil {
		t.Fatal(err)
	}
	b, err := users.Create(ctx, db, "b@x.io", "x", "user", quotaBytes)
	if err != nil {
		t.Fatal(err)
	}
	return &fixture{db: db, dataDir: dir, a: a, b: b}
}

func randBytes(t *testing.T, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return b
}

func blobBytes(t *testing.T, f *fixture, n nodes.Node) []byte {
	t.Helper()
	if n.BlobID == nil {
		t.Fatal("node has no blob")
	}
	p, err := volume.BlobPath(f.dataDir, *n.BlobID)
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func used(t *testing.T, f *fixture, u users.User) int64 {
	t.Helper()
	n, err := quota.Used(ctx, f.db, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// upload sends data in chunkSize pieces starting at the session's offset.
func sendAll(t *testing.T, up *Uploads, actor users.User, s Session, data []byte) {
	t.Helper()
	off := s.ReceivedBytes
	for off < int64(len(data)) {
		end := off + s.ChunkSize
		if end > int64(len(data)) {
			end = int64(len(data))
		}
		got, err := up.Append(ctx, actor, s.ID, off, bytes.NewReader(data[off:end]))
		if err != nil {
			t.Fatalf("append at %d: %v", off, err)
		}
		if got != end {
			t.Fatalf("offset after append = %d, want %d", got, end)
		}
		off = end
	}
}

func TestResumeAfterRestart(t *testing.T) {
	f := setup(t, 1<<30)
	data := randBytes(t, 10*kib+123)
	up := New(f.db, f.dataDir)
	s, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "movie.bin", int64(len(data)), 2*kib)
	if err != nil {
		t.Fatal(err)
	}
	if used(t, f, f.a) != int64(len(data)) {
		t.Fatalf("reservation not counted: %d", used(t, f, f.a))
	}
	// First half.
	for off := int64(0); off < 6*kib; off += 2 * kib {
		if _, err := up.Append(ctx, f.a, s.ID, off, bytes.NewReader(data[off:off+2*kib])); err != nil {
			t.Fatal(err)
		}
	}

	// "Restart": a fresh instance over the same DB and data dir.
	up2 := New(f.db, f.dataDir)
	s2, err := up2.Get(ctx, f.a, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if s2.ReceivedBytes != 6*kib || s2.Size != int64(len(data)) || s2.ChunkSize != 2*kib {
		t.Fatalf("resumed session %+v", s2)
	}
	sendAll(t, up2, f.a, s2, data)
	n, err := up2.Complete(ctx, f.a, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if n.Name != "movie.bin" || n.Size != int64(len(data)) || n.IsDir || n.Uploader != f.a.ID {
		t.Fatalf("node %+v", n)
	}
	if !bytes.Equal(blobBytes(t, f, n), data) {
		t.Fatal("blob bytes differ from uploaded bytes")
	}
	// Reservation released, file counted exactly once.
	if got := used(t, f, f.a); got != int64(len(data)) {
		t.Fatalf("used after complete = %d", got)
	}
	if _, err := up2.Get(ctx, f.a, s.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("session survived completion: %v", err)
	}
	if _, err := os.Stat(filepath.Join(f.dataDir, "tmp", "uploads", s.ID)); !os.IsNotExist(err) {
		t.Fatalf("staging dir left behind: %v", err)
	}
}

func TestWrongOffsetConflict(t *testing.T) {
	f := setup(t, 1<<30)
	data := randBytes(t, 4*kib)
	up := New(f.db, f.dataDir)
	s, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "x.bin", int64(len(data)), 2*kib)
	if err != nil {
		t.Fatal(err)
	}
	var oe *OffsetError
	if _, err := up.Append(ctx, f.a, s.ID, 5, bytes.NewReader(data[:10])); !errors.As(err, &oe) || oe.Expected != 0 {
		t.Fatalf("got %v", err)
	}
	if _, err := up.Append(ctx, f.a, s.ID, 0, bytes.NewReader(data[:2*kib])); err != nil {
		t.Fatal(err)
	}
	// Retried chunk (response was lost): offset check rejects it, file intact.
	if _, err := up.Append(ctx, f.a, s.ID, 0, bytes.NewReader(data[:2*kib])); !errors.As(err, &oe) || oe.Expected != 2*kib {
		t.Fatalf("retry: got %v", err)
	}
	// Torn write: bytes on disk beyond received_bytes (crash before DB
	// update) are truncated before appending.
	staged := filepath.Join(f.dataDir, "tmp", "uploads", s.ID, "data")
	fh, err := os.OpenFile(staged, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		t.Fatal(err)
	}
	fh.Write([]byte("garbage"))
	fh.Close()
	sendAll(t, up, f.a, Session{ID: s.ID, ChunkSize: s.ChunkSize, ReceivedBytes: 2 * kib}, data)
	// Body bigger than chunk_size, or past declared size, is rejected.
	s3, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "y.bin", 3*kib, 2*kib)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := up.Append(ctx, f.a, s3.ID, 0, bytes.NewReader(randBytes(t, 2*kib+1))); !errors.Is(err, ErrChunkTooLarge) {
		t.Fatalf("oversized chunk: %v", err)
	}
	if _, err := up.Append(ctx, f.a, s3.ID, 0, bytes.NewReader(randBytes(t, 2*kib))); err != nil {
		t.Fatal(err)
	}
	if _, err := up.Append(ctx, f.a, s3.ID, 2*kib, bytes.NewReader(randBytes(t, 2*kib))); !errors.Is(err, ErrExceedsSize) {
		t.Fatalf("past size: %v", err)
	}
	if g, _ := up.Get(ctx, f.a, s3.ID); g.ReceivedBytes != 2*kib {
		t.Fatalf("rejected chunk advanced offset to %d", g.ReceivedBytes)
	}
	// Incomplete upload cannot complete.
	if _, err := up.Complete(ctx, f.a, s3.ID); !errors.Is(err, ErrIncomplete) {
		t.Fatalf("complete early: %v", err)
	}
	// Other users cannot see or touch the session.
	if _, err := up.Get(ctx, f.b, s.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user get: %v", err)
	}
	if _, err := up.Append(ctx, f.b, s3.ID, 2*kib, bytes.NewReader([]byte("x"))); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user append: %v", err)
	}
	if _, err := up.Complete(ctx, f.b, s.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user complete: %v", err)
	}
	if err := up.Cancel(ctx, f.b, s.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user cancel: %v", err)
	}
	n, err := up.Complete(ctx, f.a, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(blobBytes(t, f, n), data) {
		t.Fatal("file corrupted by retry / torn write")
	}
}

func TestConcurrentSameNameBothSucceed(t *testing.T) {
	f := setup(t, 1<<30)
	up := New(f.db, f.dataDir)
	sp := nodes.Space{} // shared space: both users may upload
	folder, err := nodes.CreateFolder(ctx, f.db, f.a, sp, nil, "docs")
	if err != nil {
		t.Fatal(err)
	}
	actors := []users.User{f.a, f.b, f.a, f.b}
	datas := make([][]byte, len(actors))
	sessions := make([]Session, len(actors))
	for i, u := range actors {
		datas[i] = randBytes(t, 3*kib+i)
		s, err := up.Create(ctx, u, sp, &folder.ID, "report.pdf", int64(len(datas[i])), 1*kib)
		if err != nil {
			t.Fatal(err)
		}
		sessions[i] = s
	}
	var wg sync.WaitGroup
	results := make([]nodes.Node, len(actors))
	errs := make([]error, len(actors))
	for i := range actors {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			off := int64(0)
			for off < int64(len(datas[i])) {
				end := min(off+1*kib, int64(len(datas[i])))
				if _, err := up.Append(ctx, actors[i], sessions[i].ID, off, bytes.NewReader(datas[i][off:end])); err != nil {
					errs[i] = err
					return
				}
				off = end
			}
			results[i], errs[i] = up.Complete(ctx, actors[i], sessions[i].ID)
		}(i)
	}
	wg.Wait()
	names := map[string]bool{}
	for i, err := range errs {
		if err != nil {
			t.Fatalf("upload %d: %v", i, err)
		}
		names[results[i].Name] = true
		if !bytes.Equal(blobBytes(t, f, results[i]), datas[i]) {
			t.Fatalf("upload %d content mismatch", i)
		}
		if results[i].ParentID == nil || *results[i].ParentID != folder.ID || results[i].SpaceOwner != nil {
			t.Fatalf("upload %d placed wrong: %+v", i, results[i])
		}
	}
	for _, want := range []string{"report.pdf", "report (1).pdf", "report (2).pdf", "report (3).pdf"} {
		if !names[want] {
			t.Fatalf("missing %q in %v", want, names)
		}
	}
}

func TestMaxFileSizeEnforced(t *testing.T) {
	f := setup(t, 1<<30)
	up := New(f.db, f.dataDir)
	if err := settings.Set(ctx, f.db, settings.KeyMaxFileBytes, "5000"); err != nil {
		t.Fatal(err)
	}
	if _, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "big.bin", 5001, kib); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("over max: %v", err)
	}
	if _, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "ok.bin", 5000, kib); err != nil {
		t.Fatalf("at max: %v", err)
	}
	// Declared sizes are validated.
	for _, c := range []struct {
		size, chunk int64
		want        error
	}{
		{-1, kib, ErrInvalidSize},
		{10, kib - 1, ErrInvalidChunkSize},
		{10, 64<<20 + 1, ErrInvalidChunkSize},
		{10, 0, ErrInvalidChunkSize},
	} {
		if _, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "v.bin", c.size, c.chunk); !errors.Is(err, c.want) {
			t.Fatalf("size=%d chunk=%d: got %v want %v", c.size, c.chunk, err, c.want)
		}
	}
	if _, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "a/b", 10, kib); !errors.Is(err, nodes.ErrInvalidName) {
		t.Fatalf("bad name: %v", err)
	}
	// Other user's personal space, or a missing parent: not found.
	if _, err := up.Create(ctx, f.a, nodes.Personal(f.b.ID), nil, "v.bin", 10, kib); !errors.Is(err, nodes.ErrNotFound) {
		t.Fatalf("foreign space: %v", err)
	}
	bad := "nope"
	if _, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), &bad, "v.bin", 10, kib); !errors.Is(err, nodes.ErrNotFound) {
		t.Fatalf("missing parent: %v", err)
	}
	// Unlimited when 0.
	settings.Set(ctx, f.db, settings.KeyMaxFileBytes, "0")
	if _, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "huge.bin", 1<<29, kib); err != nil {
		t.Fatalf("unlimited: %v", err)
	}
}

func TestQuotaRejectedAtCreate(t *testing.T) {
	f := setup(t, 10*kib)
	up := New(f.db, f.dataDir)
	s, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "a.bin", 6*kib, kib)
	if err != nil {
		t.Fatal(err)
	}
	// The open upload reserves its full size.
	if _, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "b.bin", 5*kib, kib); !errors.Is(err, quota.ErrExceeded) {
		t.Fatalf("got %v", err)
	}
	var n int
	f.db.QueryRow(`SELECT count(*) FROM uploads`).Scan(&n)
	if n != 1 {
		t.Fatalf("rejected upload left a row: %d", n)
	}
	// Cancelling frees the reservation.
	if err := up.Cancel(ctx, f.a, s.ID); err != nil {
		t.Fatal(err)
	}
	if used(t, f, f.a) != 0 {
		t.Fatal("cancel did not release reservation")
	}
	if _, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "b.bin", 10*kib, kib); err != nil {
		t.Fatalf("after cancel: %v", err)
	}
}

func TestSweepReleasesReservation(t *testing.T) {
	f := setup(t, 1<<30)
	up := New(f.db, f.dataDir)
	old, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "old.bin", 4*kib, kib)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := up.Append(ctx, f.a, old.ID, 0, bytes.NewReader(randBytes(t, kib))); err != nil {
		t.Fatal(err)
	}
	fresh, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "fresh.bin", 2*kib, kib)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := up.Append(ctx, f.a, fresh.ID, 0, bytes.NewReader(randBytes(t, kib))); err != nil {
		t.Fatal(err)
	}
	// "old" was created long ago and last touched long ago; "fresh" was
	// created long ago but is still active, so it survives.
	past := time.Now().Add(-48 * time.Hour).Unix()
	f.db.Exec(`UPDATE uploads SET created_at=?, updated_at=? WHERE id=?`, past, past, old.ID)
	f.db.Exec(`UPDATE uploads SET created_at=? WHERE id=?`, past, fresh.ID)
	if used(t, f, f.a) != 6*kib {
		t.Fatalf("used before sweep = %d", used(t, f, f.a))
	}
	n, err := Sweep(ctx, f.db, f.dataDir, 24*time.Hour)
	if err != nil || n != 1 {
		t.Fatalf("sweep n=%d err=%v", n, err)
	}
	if used(t, f, f.a) != 2*kib {
		t.Fatalf("used after sweep = %d", used(t, f, f.a))
	}
	if _, err := os.Stat(filepath.Join(f.dataDir, "tmp", "uploads", old.ID)); !os.IsNotExist(err) {
		t.Fatalf("staging dir not removed: %v", err)
	}
	if _, err := up.Get(ctx, f.a, old.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("swept session still visible: %v", err)
	}
	if _, err := up.Get(ctx, f.a, fresh.ID); err != nil {
		t.Fatalf("active session swept: %v", err)
	}
	// Orphan staging dirs (no session row) are removed too.
	orphan := filepath.Join(f.dataDir, "tmp", "uploads", volume.NewBlobID())
	os.MkdirAll(orphan, 0o755)
	os.Chtimes(orphan, time.Now().Add(-48*time.Hour), time.Now().Add(-48*time.Hour))
	if _, err := Sweep(ctx, f.db, f.dataDir, 24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatalf("orphan staging dir kept: %v", err)
	}
	if _, err := os.Stat(filepath.Join(f.dataDir, "tmp", "uploads", fresh.ID)); err != nil {
		t.Fatalf("active staging dir removed: %v", err)
	}
}

func TestZeroByteFile(t *testing.T) {
	f := setup(t, 0) // zero quota still allows an empty file
	up := New(f.db, f.dataDir)
	s, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "empty.txt", 0, kib)
	if err != nil {
		t.Fatal(err)
	}
	if s.ReceivedBytes != 0 {
		t.Fatalf("received %d", s.ReceivedBytes)
	}
	if _, err := up.Append(ctx, f.a, s.ID, 0, bytes.NewReader([]byte("x"))); !errors.Is(err, ErrExceedsSize) {
		t.Fatalf("byte into empty upload: %v", err)
	}
	n, err := up.Complete(ctx, f.a, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if n.Size != 0 || n.Name != "empty.txt" || n.Mime != "text/plain; charset=utf-8" {
		t.Fatalf("node %+v", n)
	}
	if b := blobBytes(t, f, n); len(b) != 0 {
		t.Fatalf("blob has %d bytes", len(b))
	}
}

func TestMimeDetection(t *testing.T) {
	f := setup(t, 1<<30)
	up := New(f.db, f.dataDir)
	png := append([]byte("\x89PNG\r\n\x1a\n"), randBytes(t, 100)...)
	for _, c := range []struct {
		name string
		data []byte
		want string
	}{
		{"photo.png", png, "image/png"},
		{"noext", png, "image/png"},                             // sniffed
		{"weird.zzqx", png, "image/png"},                        // unknown extension: sniffed
		{"page.html", []byte("hi"), "text/html; charset=utf-8"}, // by extension
	} {
		s, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, c.name, int64(len(c.data)), kib)
		if err != nil {
			t.Fatal(err)
		}
		sendAll(t, up, f.a, s, c.data)
		n, err := up.Complete(ctx, f.a, s.ID)
		if err != nil {
			t.Fatal(err)
		}
		if n.Mime != c.want {
			t.Fatalf("%s: mime %q want %q", c.name, n.Mime, c.want)
		}
	}
}

func TestCompleteIsRetryableAfterCrash(t *testing.T) {
	f := setup(t, 1<<30)
	up := New(f.db, f.dataDir)
	data := randBytes(t, 2*kib)
	s, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), nil, "c.bin", int64(len(data)), kib)
	if err != nil {
		t.Fatal(err)
	}
	sendAll(t, up, f.a, s, data)
	// Simulate a crash after the staged file was renamed into the blob store
	// but before the completion transaction committed.
	blob, _ := volume.BlobPath(f.dataDir, s.ID)
	os.MkdirAll(filepath.Dir(blob), 0o755)
	if err := os.Rename(filepath.Join(f.dataDir, "tmp", "uploads", s.ID, "data"), blob); err != nil {
		t.Fatal(err)
	}
	n, err := up.Complete(ctx, f.a, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(blobBytes(t, f, n), data) {
		t.Fatal("content mismatch")
	}
}

func TestCompleteIntoTrashedParentFails(t *testing.T) {
	f := setup(t, 1<<30)
	up := New(f.db, f.dataDir)
	folder, err := nodes.CreateFolder(ctx, f.db, f.a, nodes.Personal(f.a.ID), nil, "d")
	if err != nil {
		t.Fatal(err)
	}
	data := randBytes(t, kib)
	s, err := up.Create(ctx, f.a, nodes.Personal(f.a.ID), &folder.ID, "c.bin", int64(len(data)), kib)
	if err != nil {
		t.Fatal(err)
	}
	sendAll(t, up, f.a, s, data)
	f.db.Exec(`UPDATE nodes SET trashed_at=1 WHERE id=?`, folder.ID)
	if _, err := up.Complete(ctx, f.a, s.ID); !errors.Is(err, nodes.ErrNotFound) {
		t.Fatalf("got %v", err)
	}
	var cnt int
	f.db.QueryRow(`SELECT count(*) FROM nodes WHERE is_dir=0`).Scan(&cnt)
	if cnt != 0 {
		t.Fatal("orphan node created")
	}
	// Session and staged bytes are intact; cancel cleans everything up.
	if g, err := up.Get(ctx, f.a, s.ID); err != nil || g.ReceivedBytes != int64(len(data)) {
		t.Fatalf("session after failed complete: %+v %v", g, err)
	}
	if b, err := os.ReadFile(filepath.Join(f.dataDir, "tmp", "uploads", s.ID, "data")); err != nil || !bytes.Equal(b, data) {
		t.Fatalf("staged bytes not restored: %v", err)
	}
	if err := up.Cancel(ctx, f.a, s.ID); err != nil {
		t.Fatal(err)
	}
	blob, _ := volume.BlobPath(f.dataDir, s.ID)
	if _, err := os.Stat(blob); !os.IsNotExist(err) {
		t.Fatal("blob left after cancel")
	}
}

func TestUploadIntoTrashedSubtreeRejected(t *testing.T) {
	f := setup(t, 1<<30)
	up := New(f.db, f.dataDir)
	sp := nodes.Personal(f.a.ID)
	top, _ := nodes.CreateFolder(ctx, f.db, f.a, sp, nil, "top")
	sub, _ := nodes.CreateFolder(ctx, f.db, f.a, sp, &top.ID, "sub")
	if err := nodes.Trash(ctx, f.db, f.a, top.ID); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{top.ID, sub.ID} {
		if _, err := up.Create(ctx, f.a, sp, &id, "x.bin", kib, kib); !errors.Is(err, nodes.ErrNotFound) {
			t.Fatalf("create into %s: %v", id, err)
		}
	}
	// A file inside the trashed folder is no parent either (not a dir, but also not live).
	ff := insertFileNode(t, f, &sub.ID)
	if _, err := up.Create(ctx, f.a, sp, &ff, "x.bin", kib, kib); !errors.Is(err, nodes.ErrNotFound) {
		t.Fatalf("create into file in trash: %v", err)
	}
}

func insertFileNode(t *testing.T, f *fixture, parent *string) string {
	t.Helper()
	id := users.NewID()
	_, err := f.db.Exec(`INSERT INTO nodes(id,space_owner,uploader,parent_id,name,is_dir,size,mime,created_at,updated_at,trash_root) VALUES(?,?,?,?,?,0,1,'',1,1,(SELECT trash_root FROM nodes WHERE id=?))`,
		id, f.a.ID, f.a.ID, parent, "ff", parent)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
