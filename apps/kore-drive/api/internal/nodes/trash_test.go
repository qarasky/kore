package nodes

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/qarasky/kore/api/internal/quota"
	"github.com/qarasky/kore/api/internal/users"
	"github.com/qarasky/kore/api/internal/volume"
)

// blobFile creates a file node with a real blob on disk.
func blobFile(t *testing.T, db *sql.DB, dir string, u users.User, sp Space, parent *string, name string, data []byte) (Node, string) {
	t.Helper()
	blob := volume.NewBlobID()
	p, err := volume.BlobPath(dir, blob)
	if err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	n, err := CreateFileTx(ctx, tx, u, FileSpec{Space: sp, Parent: parent, Name: name, Size: int64(len(data)), BlobID: blob, Mime: "text/plain"})
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return n, p
}

func initDir(t *testing.T) string {
	t.Helper()
	d := t.TempDir()
	if err := volume.Init(d); err != nil {
		t.Fatal(err)
	}
	return d
}

func names(ns []Node) []string {
	out := []string{}
	for _, n := range ns {
		out = append(out, n.Name)
	}
	return out
}

func TestTrashFolderHidesDescendants(t *testing.T) {
	db, _, a, b := setup(t)
	dir := initDir(t)
	sp := Personal(a.ID)
	f := mustFolder(t, db, a, sp, nil, "f")
	c := mustFolder(t, db, a, sp, &f.ID, "c")
	file, _ := blobFile(t, db, dir, a, sp, &c.ID, "x.txt", []byte("x"))
	if err := Trash(ctx, db, b, f.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user trash: %v", err)
	}
	if err := Trash(ctx, db, a, f.ID); err != nil {
		t.Fatal(err)
	}
	if l, _ := List(ctx, db, a, sp, nil); len(l) != 0 {
		t.Fatalf("root not empty: %v", names(l))
	}
	// Descendants are unreachable by id.
	for _, id := range []string{f.ID, c.ID, file.ID} {
		if _, err := Get(ctx, db, a, id); !errors.Is(err, ErrNotFound) {
			t.Fatalf("get %s: %v", id, err)
		}
	}
	if _, err := List(ctx, db, a, sp, &c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("list into descendant: %v", err)
	}
	if _, err := Path(ctx, db, a, file.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("path: %v", err)
	}
	if _, err := Rename(ctx, db, a, file.ID, "y"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("rename: %v", err)
	}
	if _, err := Move(ctx, db, a, file.ID, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("move: %v", err)
	}
	if _, err := CreateFolder(ctx, db, a, sp, &c.ID, "n"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("create into: %v", err)
	}
	other := mustFolder(t, db, a, sp, nil, "other")
	if _, err := Move(ctx, db, a, other.ID, &c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("move into: %v", err)
	}
	// Only the root is listed in trash; trashing again is 404.
	tl, err := ListTrash(ctx, db, a, sp)
	if err != nil || len(tl) != 1 || tl[0].ID != f.ID || tl[0].TrashedAt == 0 {
		t.Fatalf("trash list: %v %v", tl, err)
	}
	if err := Trash(ctx, db, a, f.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("retrash: %v", err)
	}
	if err := Trash(ctx, db, a, c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("trash descendant: %v", err)
	}
	// Restore brings everything back.
	r, err := Restore(ctx, db, a, f.ID)
	if err != nil || r.Name != "f" {
		t.Fatal(r, err)
	}
	if _, err := Get(ctx, db, a, file.ID); err != nil {
		t.Fatalf("descendant after restore: %v", err)
	}
	if tl, _ := ListTrash(ctx, db, a, sp); len(tl) != 0 {
		t.Fatalf("trash not empty: %v", tl)
	}
}

func TestRestoreToDeletedParentGoesToRoot(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	p := mustFolder(t, db, a, sp, nil, "p")
	c := mustFolder(t, db, a, sp, &p.ID, "c")
	if err := Trash(ctx, db, a, c.ID); err != nil {
		t.Fatal(err)
	}
	if err := Trash(ctx, db, a, p.ID); err != nil {
		t.Fatal(err)
	}
	// Parent is itself trashed -> space root.
	r, err := Restore(ctx, db, a, c.ID)
	if err != nil || r.ParentID != nil {
		t.Fatalf("%v %v", r, err)
	}
	// Parent purged -> space root.
	d := mustFolder(t, db, a, sp, &r.ID, "d")
	if err := Trash(ctx, db, a, d.ID); err != nil {
		t.Fatal(err)
	}
	if err := Trash(ctx, db, a, r.ID); err != nil {
		t.Fatal(err)
	}
	if err := PurgeNode(ctx, db, t.TempDir(), a, r.ID); err != nil {
		t.Fatal(err)
	}
	r2, err := Restore(ctx, db, a, d.ID)
	if err != nil || r2.ParentID != nil {
		t.Fatalf("%v %v", r2, err)
	}
	// Live parent -> original place.
	live := mustFolder(t, db, a, sp, nil, "live")
	e := mustFolder(t, db, a, sp, &live.ID, "e")
	Trash(ctx, db, a, e.ID)
	r3, err := Restore(ctx, db, a, e.ID)
	if err != nil || r3.ParentID == nil || *r3.ParentID != live.ID {
		t.Fatalf("%v %v", r3, err)
	}
	if _, err := Restore(ctx, db, a, e.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restore live: %v", err)
	}
}

func TestRestoreNameCollision(t *testing.T) {
	db, _, a, _ := setup(t)
	dir := initDir(t)
	sp := Personal(a.ID)
	f, _ := blobFile(t, db, dir, a, sp, nil, "doc.txt", []byte("1"))
	if err := Trash(ctx, db, a, f.ID); err != nil {
		t.Fatal(err)
	}
	blobFile(t, db, dir, a, sp, nil, "doc.txt", []byte("2"))
	r, err := Restore(ctx, db, a, f.ID)
	if err != nil || r.Name != "doc (1).txt" {
		t.Fatalf("%v %v", r, err)
	}
	l, _ := List(ctx, db, a, sp, nil)
	if len(l) != 2 {
		t.Fatalf("%v", names(l))
	}
}

func TestPurgeRemovesBlobs(t *testing.T) {
	db, _, a, b := setup(t)
	dir := initDir(t)
	sp := Personal(a.ID)
	f := mustFolder(t, db, a, sp, nil, "f")
	x, px := blobFile(t, db, dir, a, sp, &f.ID, "x", []byte("x"))
	_, py := blobFile(t, db, dir, a, sp, nil, "y", []byte("y"))
	if err := PurgeNode(ctx, db, dir, a, f.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("purge live: %v", err)
	}
	Trash(ctx, db, a, f.ID)
	if err := PurgeNode(ctx, db, dir, a, x.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("purge non-root: %v", err)
	}
	if err := PurgeNode(ctx, db, dir, b, f.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("purge other user: %v", err)
	}
	if err := PurgeNode(ctx, db, dir, a, f.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(px); !os.IsNotExist(err) {
		t.Fatalf("blob remains: %v", err)
	}
	if _, err := os.Stat(py); err != nil {
		t.Fatalf("unrelated blob gone: %v", err)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM nodes WHERE id IN (?,?)`, f.ID, x.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("rows remain: %d", n)
	}
}

func TestPurgeExpiredRespectsRetention(t *testing.T) {
	db, _, a, _ := setup(t)
	dir := initDir(t)
	sp := Personal(a.ID)
	old, pold := blobFile(t, db, dir, a, sp, nil, "old", []byte("o"))
	fresh, pfresh := blobFile(t, db, dir, a, sp, nil, "fresh", []byte("f"))
	keep, _ := blobFile(t, db, dir, a, sp, nil, "keep", []byte("k"))
	for _, n := range []Node{old, fresh} {
		if err := Trash(ctx, db, a, n.ID); err != nil {
			t.Fatal(err)
		}
	}
	db.Exec(`UPDATE nodes SET trashed_at=? WHERE id=?`, time.Now().Add(-31*24*time.Hour).Unix(), old.ID)
	db.Exec(`UPDATE nodes SET trashed_at=? WHERE id=?`, time.Now().Add(-29*24*time.Hour).Unix(), fresh.ID)
	n, err := PurgeExpired(ctx, db, dir, 30)
	if err != nil || n != 1 {
		t.Fatalf("%d %v", n, err)
	}
	if _, err := os.Stat(pold); !os.IsNotExist(err) {
		t.Fatal("old blob remains")
	}
	if _, err := os.Stat(pfresh); err != nil {
		t.Fatal("fresh blob gone")
	}
	if _, err := Get(ctx, db, a, keep.ID); err != nil {
		t.Fatal(err)
	}
	if tl, _ := ListTrash(ctx, db, a, sp); len(tl) != 1 || tl[0].ID != fresh.ID {
		t.Fatalf("%v", tl)
	}
	if n, err := PurgeExpired(ctx, db, dir, 0); err != nil || n != 0 {
		t.Fatalf("retention 0 must be a no-op: %d %v", n, err)
	}
}

func TestEmptyTrashFreesQuota(t *testing.T) {
	db, _, a, b := setup(t)
	dir := initDir(t)
	db.Exec(`UPDATE users SET quota_bytes=10 WHERE id=?`, a.ID)
	sp := Personal(a.ID)
	f := mustFolder(t, db, a, sp, nil, "f")
	blobFile(t, db, dir, a, sp, &f.ID, "x", []byte("0123456789"))
	if err := Trash(ctx, db, a, f.ID); err != nil {
		t.Fatal(err)
	}
	if u, _ := quota.Used(ctx, db, a.ID); u != 10 {
		t.Fatalf("trash must keep counting quota: %d", u)
	}
	if err := EmptyTrash(ctx, db, dir, b, sp); !errors.Is(err, ErrNotFound) {
		t.Fatalf("empty other's trash: %v", err)
	}
	if err := EmptyTrash(ctx, db, dir, a, sp); err != nil {
		t.Fatal(err)
	}
	if u, _ := quota.Used(ctx, db, a.ID); u != 0 {
		t.Fatalf("quota not freed: %d", u)
	}
	if tl, _ := ListTrash(ctx, db, a, sp); len(tl) != 0 {
		t.Fatalf("%v", tl)
	}
}

func TestSharedTrashVisibleToEveryone(t *testing.T) {
	db, _, a, b := setup(t)
	sh := Space{}
	f := mustFolder(t, db, a, sh, nil, "s")
	if err := Trash(ctx, db, b, f.ID); err != nil {
		t.Fatal(err)
	}
	if tl, err := ListTrash(ctx, db, a, sh); err != nil || len(tl) != 1 {
		t.Fatalf("%v %v", tl, err)
	}
	if _, err := ListTrash(ctx, db, b, Personal(a.ID)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("%v", err)
	}
	if _, err := Restore(ctx, db, a, f.ID); err != nil {
		t.Fatal(err)
	}
}

func TestTrashNestedKeepsInnerRoot(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	p := mustFolder(t, db, a, sp, nil, "p")
	c := mustFolder(t, db, a, sp, &p.ID, "c")
	g := mustFolder(t, db, a, sp, &c.ID, "g")
	Trash(ctx, db, a, c.ID)
	Trash(ctx, db, a, p.ID)
	tl, _ := ListTrash(ctx, db, a, sp)
	if len(tl) != 2 {
		t.Fatalf("both roots expected: %v", tl)
	}
	if err := PurgeNode(ctx, db, t.TempDir(), a, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := Restore(ctx, db, a, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := Get(ctx, db, a, g.ID); err != nil {
		t.Fatalf("grandchild lost: %v", err)
	}
}

func TestSweepOrphanBlobs(t *testing.T) {
	db, _, a, _ := setup(t)
	dir := initDir(t)
	_, kept := blobFile(t, db, dir, a, Personal(a.ID), nil, "k", []byte("k"))
	mk := func(age time.Duration) string {
		p, _ := volume.BlobPath(dir, volume.NewBlobID())
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte("o"), 0o644)
		ts := time.Now().Add(-age)
		os.Chtimes(p, ts, ts)
		return p
	}
	oldOrphan, newOrphan := mk(2*time.Hour), mk(time.Minute)
	staged := filepath.Join(dir, "tmp", "uploads", "u1", "data")
	os.MkdirAll(filepath.Dir(staged), 0o755)
	os.WriteFile(staged, []byte("s"), 0o644)
	os.Chtimes(staged, time.Now().Add(-5*time.Hour), time.Now().Add(-5*time.Hour))
	os.Chtimes(kept, time.Now().Add(-5*time.Hour), time.Now().Add(-5*time.Hour))
	n, err := SweepOrphanBlobs(ctx, db, dir)
	if err != nil || n != 1 {
		t.Fatalf("%d %v", n, err)
	}
	if _, err := os.Stat(oldOrphan); !os.IsNotExist(err) {
		t.Fatal("old orphan remains")
	}
	for _, p := range []string{newOrphan, kept, staged} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("%s removed", p)
		}
	}
}
