package httpapi

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/qarasky/kore/api/internal/nodes"
	"github.com/qarasky/kore/api/internal/users"
	"github.com/qarasky/kore/api/internal/volume"
)

func (e *env) putFile(t *testing.T, u users.User, name, mime string, data []byte) nodes.Node {
	t.Helper()
	ctx := context.Background()
	blob := volume.NewBlobID()
	p, err := volume.BlobPath(e.dataDir, blob)
	if err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	tx, _ := e.db.BeginTx(ctx, nil)
	n, err := nodes.CreateFileTx(ctx, tx, u, nodes.FileSpec{Space: nodes.Personal(u.ID), Name: name, Size: int64(len(data)), BlobID: blob, Mime: mime})
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPreviewTruncates(t *testing.T) {
	e := newEnv(t)
	small := e.putFile(t, e.user, "a.txt", "text/plain", []byte("hello"))
	rec := e.do(t, &e.user, "GET", "/api/nodes/"+small.ID+"/preview", "")
	if rec.Code != 200 || rec.Body.String() != "hello" || rec.Header().Get("X-Truncated") != "" {
		t.Fatalf("%d %q %v", rec.Code, rec.Body, rec.Header())
	}
	h := rec.Header()
	if h.Get("Content-Type") != "text/plain; charset=utf-8" || h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Cache-Control") != "private, no-store" || h.Get("Content-Disposition") != "" {
		t.Fatalf("headers %v", h)
	}
	big := e.putFile(t, e.user, "big.log", "text/plain", []byte(strings.Repeat("x", 512<<10+100)))
	rec = e.do(t, &e.user, "GET", "/api/nodes/"+big.ID+"/preview", "")
	if rec.Code != 200 || rec.Body.Len() != 512<<10 || rec.Header().Get("X-Truncated") != "true" {
		t.Fatalf("%d %d %v", rec.Code, rec.Body.Len(), rec.Header())
	}
	exact := e.putFile(t, e.user, "exact.log", "", []byte(strings.Repeat("x", 512<<10)))
	rec = e.do(t, &e.user, "GET", "/api/nodes/"+exact.ID+"/preview", "")
	if rec.Body.Len() != 512<<10 || rec.Header().Get("X-Truncated") != "" {
		t.Fatalf("exact: %d %v", rec.Body.Len(), rec.Header())
	}
	empty := e.putFile(t, e.user, "empty.txt", "", nil)
	if rec = e.do(t, &e.user, "GET", "/api/nodes/"+empty.ID+"/preview", ""); rec.Code != 200 || rec.Body.Len() != 0 {
		t.Fatalf("empty: %d", rec.Code)
	}
}

func TestPreviewCutsOnRuneBoundary(t *testing.T) {
	e := newEnv(t)
	// 1 ASCII byte shifts the 2-byte Cyrillic runes so the cut lands mid-rune.
	data := []byte("a" + strings.Repeat("ж", 300<<10))
	n := e.putFile(t, e.user, "ru.txt", "", data)
	rec := e.do(t, &e.user, "GET", "/api/nodes/"+n.ID+"/preview", "")
	if rec.Code != 200 || rec.Header().Get("X-Truncated") != "true" {
		t.Fatalf("%d %v", rec.Code, rec.Header())
	}
	if !utf8.Valid(rec.Body.Bytes()) || rec.Body.Len() != 512<<10-1 {
		t.Fatalf("valid=%v len=%d", utf8.Valid(rec.Body.Bytes()), rec.Body.Len())
	}
}

func TestPreviewRejectsBinaryWithTextExtension(t *testing.T) {
	e := newEnv(t)
	for name, data := range map[string][]byte{
		"nul.txt":     []byte("abc\x00def"),
		"badutf8.txt": []byte("abc\xff\xfedef"),
		"photo.png":   []byte("plain text but png"),
		"noext":       []byte("hi"),
	} {
		n := e.putFile(t, e.user, name, "text/plain", data)
		rec := e.do(t, &e.user, "GET", "/api/nodes/"+n.ID+"/preview", "")
		if rec.Code != 415 || jsonBody(t, rec)["error"] != "not_text" {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
	// Truncated final rune inside the 8 KiB sniff window is allowed.
	data := []byte(strings.Repeat("a", 8191) + "ж")
	n := e.putFile(t, e.user, "edge.txt", "", data)
	if rec := e.do(t, &e.user, "GET", "/api/nodes/"+n.ID+"/preview", ""); rec.Code != 200 {
		t.Fatalf("edge: %d", rec.Code)
	}
	// Allowlisted exact filename without extension.
	n = e.putFile(t, e.user, "Dockerfile", "", []byte("FROM x"))
	if rec := e.do(t, &e.user, "GET", "/api/nodes/"+n.ID+"/preview", ""); rec.Code != 200 {
		t.Fatalf("Dockerfile: %d", rec.Code)
	}
}

func TestPreviewHTMLServedAsPlain(t *testing.T) {
	e := newEnv(t)
	n := e.putFile(t, e.user, "x.html", "text/html", []byte("<script>alert(1)</script>"))
	rec := e.do(t, &e.user, "GET", "/api/nodes/"+n.ID+"/preview", "")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "text/plain; charset=utf-8" || rec.Header().Get("Content-Disposition") != "" {
		t.Fatalf("%d %v", rec.Code, rec.Header())
	}
}

func TestPreviewAccess(t *testing.T) {
	e := newEnv(t)
	n := e.putFile(t, e.user, "a.txt", "", []byte("x"))
	if rec := e.do(t, nil, "GET", "/api/nodes/"+n.ID+"/preview", ""); rec.Code != 401 {
		t.Fatalf("anon %d", rec.Code)
	}
	if rec := e.do(t, &e.admin, "GET", "/api/nodes/"+n.ID+"/preview", ""); rec.Code != 404 {
		t.Fatalf("admin %d", rec.Code)
	}
	d, _ := nodes.CreateFolder(context.Background(), e.db, e.user, nodes.Personal(e.user.ID), nil, "d")
	if rec := e.do(t, &e.user, "GET", "/api/nodes/"+d.ID+"/preview", ""); rec.Code != 400 || jsonBody(t, rec)["error"] != "is_directory" {
		t.Fatalf("dir %d %s", rec.Code, rec.Body)
	}
	if err := nodes.Trash(context.Background(), e.db, e.user, n.ID); err != nil {
		t.Fatal(err)
	}
	if rec := e.do(t, &e.user, "GET", "/api/nodes/"+n.ID+"/preview", ""); rec.Code != 404 {
		t.Fatalf("trashed %d", rec.Code)
	}
}

func TestSearchEndpoint(t *testing.T) {
	e := newEnv(t)
	d, _ := nodes.CreateFolder(context.Background(), e.db, e.user, nodes.Personal(e.user.ID), nil, "Папка")
	_ = d
	e.putFile(t, e.user, "Отчёт.txt", "", []byte("x"))
	if rec := e.do(t, nil, "GET", "/api/search?q=a", ""); rec.Code != 401 {
		t.Fatalf("anon %d", rec.Code)
	}
	for _, q := range []string{"", "%20%20", "x" + strings.Repeat("y", 200)} {
		if rec := e.do(t, &e.user, "GET", "/api/search?q="+q, ""); rec.Code != 400 {
			t.Fatalf("q=%q: %d", q, rec.Code)
		}
	}
	if rec := e.do(t, &e.user, "GET", "/api/search?q=", ""); jsonBody(t, rec)["error"] != "empty_query" {
		t.Fatalf("%s", rec.Body)
	}
	rec := e.do(t, &e.user, "GET", "/api/search?q="+url.QueryEscape("ОТЧЁТ"), "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"name":"Отчёт.txt"`) || !strings.Contains(rec.Body.String(), `"path":[]`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}
