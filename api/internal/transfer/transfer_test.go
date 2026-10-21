package transfer

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/artchsh/kore/api/internal/nodes"
	"github.com/artchsh/kore/api/internal/store"
	"github.com/artchsh/kore/api/internal/users"
	"github.com/artchsh/kore/api/internal/volume"
)

var ctx = context.Background()

type env struct {
	db          *sql.DB
	dir         string
	admin, a, b users.User
}

func setup(t *testing.T) *env {
	t.Helper()
	dir := t.TempDir()
	if err := volume.Init(dir); err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(filepath.Join(dir, "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	mk := func(email, role string) users.User {
		u, err := users.Create(ctx, db, email, "x", role, 1<<30)
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	return &env{db, dir, mk("admin@x.io", "admin"), mk("a@x.io", "user"), mk("b@x.io", "user")}
}

func (e *env) folder(t *testing.T, u users.User, sp nodes.Space, parent *string, name string) nodes.Node {
	t.Helper()
	n, err := nodes.CreateFolder(ctx, e.db, u, sp, parent, name)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func (e *env) file(t *testing.T, u users.User, sp nodes.Space, parent *string, name, mime string, data []byte) nodes.Node {
	t.Helper()
	blob := volume.NewBlobID()
	p, err := volume.BlobPath(e.dir, blob)
	if err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	tx, _ := e.db.BeginTx(ctx, nil)
	n, err := nodes.CreateFileTx(ctx, tx, u, nodes.FileSpec{Space: sp, Parent: parent, Name: name, Size: int64(len(data)), BlobID: blob, Mime: mime})
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return n
}

func (e *env) dl(u users.User, id string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", "/x", nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	Download(rec, req, e.db, e.dir, u, id)
	return rec
}

func (e *env) zip(u users.User, ids ...string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	Zip(rec, httptest.NewRequest("POST", "/x", nil), e.db, e.dir, u, ids)
	return rec
}

func readZip(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	if rec.Code != 200 {
		t.Fatalf("status %d %s", rec.Code, rec.Body)
	}
	b := rec.Body.Bytes()
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		d, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = string(d)
	}
	return out
}

func keys(m map[string]string) []string {
	var k []string
	for x := range m {
		k = append(k, x)
	}
	sort.Strings(k)
	return k
}

func TestRangeRequest(t *testing.T) {
	e := setup(t)
	f := e.file(t, e.a, nodes.Personal(e.a.ID), nil, "n.html", "text/html", []byte("0123456789"))
	rec := e.dl(e.a, f.ID, map[string]string{"Range": "bytes=2-5"})
	if rec.Code != 206 || rec.Body.String() != "2345" || rec.Header().Get("Content-Range") != "bytes 2-5/10" {
		t.Fatalf("%d %q %v", rec.Code, rec.Body, rec.Header())
	}
	rec = e.dl(e.a, f.ID, nil)
	h := rec.Header()
	if rec.Code != 200 || h.Get("Content-Length") != "10" || h.Get("Content-Type") != "application/octet-stream" ||
		h.Get("X-Content-Type-Options") != "nosniff" || !strings.HasPrefix(h.Get("Content-Disposition"), "attachment") {
		t.Fatalf("%d %v", rec.Code, h)
	}
	d := e.folder(t, e.a, nodes.Personal(e.a.ID), nil, "dir")
	if rec = e.dl(e.a, d.ID, nil); rec.Code != 400 || !strings.Contains(rec.Body.String(), "is_directory") {
		t.Fatalf("dir: %d %s", rec.Code, rec.Body)
	}
	if rec = e.dl(e.b, f.ID, nil); rec.Code != 404 {
		t.Fatalf("other: %d", rec.Code)
	}
	if rec = e.dl(e.a, "nope", nil); rec.Code != 404 {
		t.Fatalf("missing: %d", rec.Code)
	}
}

func TestUnicodeFilenameHeader(t *testing.T) {
	e := setup(t)
	f := e.file(t, e.a, nodes.Personal(e.a.ID), nil, "Отчёт \"1\"; 2.txt", "text/plain", []byte("x"))
	cd := e.dl(e.a, f.ID, nil).Header().Get("Content-Disposition")
	want := "filename*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82%20%221%22%3B%202.txt"
	if !strings.HasPrefix(cd, "attachment;") || !strings.Contains(cd, want) {
		t.Fatalf("%s", cd)
	}
}

func TestZipFolderRecursive(t *testing.T) {
	e := setup(t)
	sp := nodes.Personal(e.a.ID)
	top := e.folder(t, e.a, sp, nil, "top")
	sub := e.folder(t, e.a, sp, &top.ID, "sub")
	e.folder(t, e.a, sp, &top.ID, "empty")
	e.file(t, e.a, sp, &top.ID, "a.txt", "text/plain", []byte("aaa"))
	e.file(t, e.a, sp, &sub.ID, "b.zip", "application/zip", []byte("bbb"))
	rec := e.zip(e.a, top.ID)
	got := readZip(t, rec)
	want := map[string]string{"top/": "", "top/sub/": "", "top/empty/": "", "top/a.txt": "aaa", "top/sub/b.zip": "bbb"}
	if strings.Join(keys(got), "|") != strings.Join(keys(want), "|") {
		t.Fatalf("%v", keys(got))
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("%s=%q", k, got[k])
		}
	}
	cd := rec.Header().Get("Content-Disposition")
	if rec.Header().Get("Content-Type") != "application/zip" || !strings.Contains(cd, "filename*=UTF-8''top.zip") {
		t.Fatalf("%v", rec.Header())
	}
	b := rec.Body.Bytes()
	zr, _ := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	for _, f := range zr.File {
		if f.Name == "top/sub/b.zip" && f.Method != zip.Store {
			t.Fatal("zip should be stored")
		}
		if f.Name == "top/a.txt" && f.Method != zip.Deflate {
			t.Fatal("txt should be deflated")
		}
	}
	// Multiple selection uses the generic name.
	f := e.file(t, e.a, sp, nil, "z.txt", "", []byte("z"))
	if cd := e.zip(e.a, top.ID, f.ID).Header().Get("Content-Disposition"); !strings.Contains(cd, "kore-download.zip") {
		t.Fatal(cd)
	}
}

func TestZipSkipsTrashed(t *testing.T) {
	e := setup(t)
	sp := nodes.Personal(e.a.ID)
	top := e.folder(t, e.a, sp, nil, "top")
	e.file(t, e.a, sp, &top.ID, "keep.txt", "", []byte("k"))
	gone := e.file(t, e.a, sp, &top.ID, "gone.txt", "", []byte("g"))
	dir := e.folder(t, e.a, sp, &top.ID, "gdir")
	inner := e.file(t, e.a, sp, &dir.ID, "inner.txt", "", []byte("i"))
	e.db.Exec(`UPDATE nodes SET trashed_at=1 WHERE id=?`, gone.ID)
	e.db.Exec(`UPDATE nodes SET trashed_at=1, trash_root=? WHERE id=?`, dir.ID, dir.ID)
	e.db.Exec(`UPDATE nodes SET trash_root=? WHERE id=?`, dir.ID, inner.ID)
	got := readZip(t, e.zip(e.a, top.ID))
	if strings.Join(keys(got), "|") != "top/|top/keep.txt" {
		t.Fatalf("%v", keys(got))
	}
}

func TestZipDuplicateTopLevelNames(t *testing.T) {
	e := setup(t)
	a := nodes.Personal(e.a.ID)
	f1 := e.file(t, e.a, a, nil, "same.txt", "", []byte("1"))
	f2 := e.file(t, e.a, nodes.Space{}, nil, "same.txt", "", []byte("2"))
	f3 := e.file(t, e.a, nodes.Space{}, nil, "same (1).txt", "", []byte("3"))
	got := readZip(t, e.zip(e.a, f1.ID, f2.ID, f3.ID))
	if len(got) != 3 || got["same.txt"] != "1" || got["same (1).txt"] != "2" || got["same (1) (1).txt"] != "3" {
		t.Fatalf("%v", got)
	}
}

func TestZipDeniedForOthersPersonalNode(t *testing.T) {
	e := setup(t)
	mine := e.file(t, e.a, nodes.Personal(e.a.ID), nil, "p.txt", "", []byte("p"))
	shared := e.file(t, e.a, nodes.Space{}, nil, "s.txt", "", []byte("s"))
	for _, u := range []users.User{e.b, e.admin} {
		rec := e.zip(u, shared.ID, mine.ID)
		if rec.Code != 404 || strings.Contains(rec.Body.String(), "PK") {
			t.Fatalf("%d", rec.Code)
		}
	}
	if rec := e.zip(e.a, shared.ID, "missing"); rec.Code != 404 {
		t.Fatalf("%d", rec.Code)
	}
	if rec := e.zip(e.a); rec.Code != 400 {
		t.Fatalf("empty %d", rec.Code)
	}
	if rec := e.zip(e.a, make([]string, 1001)...); rec.Code != 400 {
		t.Fatalf("cap %d", rec.Code)
	}
}

func TestSanitizeName(t *testing.T) {
	for in, want := range map[string]string{"a/b": "a_b", "..": "__", "x\x00y": "xy", "": "_", "/": "_"} {
		if got := sanitizeName(in); got != want {
			t.Errorf("%q: %q want %q", in, got, want)
		}
	}
}

func TestZipMissingBlobAborts(t *testing.T) {
	e := setup(t)
	f := e.file(t, e.a, nodes.Personal(e.a.ID), nil, "x.txt", "", []byte("x"))
	var blob string
	e.db.QueryRow(`SELECT blob_id FROM nodes WHERE id=?`, f.ID).Scan(&blob)
	p, _ := volume.BlobPath(e.dir, blob)
	os.Remove(p)
	defer func() {
		if r := recover(); r != http.ErrAbortHandler {
			t.Fatalf("recover=%v", r)
		}
	}()
	e.zip(e.a, f.ID)
}
