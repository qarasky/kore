package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/qarasky/kore/api/internal/auth"
	"github.com/qarasky/kore/api/internal/nodes"
	"github.com/qarasky/kore/api/internal/users"
	"github.com/qarasky/kore/api/internal/volume"
)

type shareEnv struct {
	*env
	s     *server
	clock time.Time
	other users.User
}

func newShareEnv(t *testing.T) *shareEnv {
	t.Helper()
	e := newEnv(t)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<30, e.user.ID)
	ph, _ := auth.HashPassword("password-1")
	o, err := users.Create(context.Background(), e.db, "other@x.io", ph, "user", 1<<30)
	if err != nil {
		t.Fatal(err)
	}
	se := &shareEnv{env: e, clock: time.Unix(1_800_000_000, 0), other: o}
	se.s = newServer(e.db, e.dataDir)
	se.s.now = func() time.Time { return se.clock }
	e.h = se.s.handler()
	return se
}

// put stores a file with a real blob under parent (nil = space root).
func (e *shareEnv) put(t *testing.T, u users.User, sp nodes.Space, parent *string, name string, data []byte) nodes.Node {
	t.Helper()
	ctx := context.Background()
	blob := volume.NewBlobID()
	p, _ := volume.BlobPath(e.dataDir, blob)
	os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	tx, _ := e.db.BeginTx(ctx, nil)
	n, err := nodes.CreateFileTx(ctx, tx, u, nodes.FileSpec{Space: sp, Parent: parent, Name: name, Size: int64(len(data)), BlobID: blob, Mime: "application/octet-stream"})
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return n
}

func (e *shareEnv) folder(t *testing.T, u users.User, sp nodes.Space, parent *string, name string) nodes.Node {
	t.Helper()
	n, err := nodes.CreateFolder(context.Background(), e.db, u, sp, parent, name)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func (e *shareEnv) share(t *testing.T, as users.User, body string) map[string]any {
	t.Helper()
	rec := e.do(t, &as, "POST", "/api/shares", body)
	if rec.Code != 201 {
		t.Fatalf("create share: %d %s", rec.Code, rec.Body)
	}
	return jsonBody(t, rec)
}

// pub is an anonymous request from a public client address.
func (e *shareEnv) pub(method, path, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.RemoteAddr = "203.0.113.7:1234"
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

func pubPath(tok string) string { return "/api/public/shares/" + tok }

func code(t *testing.T, rec *httptest.ResponseRecorder, status int, errCode string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status %d want %d: %s", rec.Code, status, rec.Body)
	}
	if errCode != "" {
		if got := jsonBody(t, rec)["error"]; got != errCode {
			t.Fatalf("error %v want %s", got, errCode)
		}
	}
}

func TestShareCreateAndAuthorization(t *testing.T) {
	e := newShareEnv(t)
	mine := e.put(t, e.user, nodes.Personal(e.user.ID), nil, "a.txt", []byte("hello"))
	theirs := e.put(t, e.other, nodes.Personal(e.other.ID), nil, "b.txt", []byte("x"))

	if rec := e.do(t, nil, "POST", "/api/shares", `{"node_id":"`+mine.ID+`"}`); rec.Code != 401 {
		t.Fatalf("anon create: %d", rec.Code)
	}
	// Someone else's personal node: 404, admins included.
	code(t, e.do(t, &e.user, "POST", "/api/shares", `{"node_id":"`+theirs.ID+`"}`), 404, "not_found")
	code(t, e.do(t, &e.admin, "POST", "/api/shares", `{"node_id":"`+theirs.ID+`"}`), 404, "not_found")
	code(t, e.do(t, &e.user, "POST", "/api/shares", `{"node_id":""}`), 404, "not_found")
	code(t, e.do(t, &e.user, "POST", "/api/shares", `{"node_id":"`+mine.ID+`","expires_in_days":3}`), 400, "invalid_expiry")
	code(t, e.do(t, &e.user, "POST", "/api/shares", `{"node_id":"`+mine.ID+`","password":"abc"}`), 400, "password_too_short")
	code(t, e.do(t, &e.user, "POST", "/api/shares", `{"node_id":"`+mine.ID+`","password":"`+strings.Repeat("p", 1025)+`"}`), 400, "password_too_long")

	sh := e.share(t, e.user, `{"node_id":"`+mine.ID+`"}`)
	tok := sh["token"].(string)
	if len(tok) != 43 || sh["url_path"] != "/s/"+tok || sh["node_name"] != "a.txt" || sh["status"] != "active" ||
		sh["has_password"] != false || sh["is_dir"] != false {
		t.Fatalf("share %v", sh)
	}
	// Default expiry: 7 days from the (injected) clock.
	if sh["expires_at"] != float64(e.clock.Add(7*24*time.Hour).Unix()) {
		t.Fatalf("expires_at %v", sh["expires_at"])
	}
	never := e.share(t, e.user, `{"node_id":"`+mine.ID+`","expires_in_days":null}`)
	if never["expires_at"] != nil || never["token"] == tok {
		t.Fatalf("never %v", never)
	}
	one := e.share(t, e.user, `{"node_id":"`+mine.ID+`","expires_in_days":1}`)
	if one["expires_at"] != float64(e.clock.Add(24*time.Hour).Unix()) {
		t.Fatalf("one day %v", one)
	}

	// Lists are per user, newest first; others see nothing, admin too.
	list := func(as users.User, path string) []map[string]any {
		t.Helper()
		rec := e.do(t, &as, "GET", path, "")
		if rec.Code != 200 {
			t.Fatalf("list %s: %d %s", path, rec.Code, rec.Body)
		}
		var out []map[string]any
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}
	if l := list(e.user, "/api/shares"); len(l) != 3 {
		t.Fatalf("mine %d", len(l))
	}
	if l := list(e.admin, "/api/shares"); len(l) != 0 {
		t.Fatalf("admin sees %d", len(l))
	}
	if l := list(e.user, "/api/nodes/"+mine.ID+"/shares"); len(l) != 3 {
		t.Fatalf("node shares %d", len(l))
	}
	code(t, e.do(t, &e.other, "GET", "/api/nodes/"+mine.ID+"/shares", ""), 404, "not_found")

	// Others can't patch, revoke or delete it.
	id := sh["id"].(string)
	for _, as := range []users.User{e.other, e.admin} {
		code(t, e.do(t, &as, "PATCH", "/api/shares/"+id, `{"revoked":true}`), 404, "not_found")
		code(t, e.do(t, &as, "DELETE", "/api/shares/"+id, ""), 404, "not_found")
		code(t, e.do(t, &as, "DELETE", "/api/shares/"+id+"?purge=1", ""), 404, "not_found")
	}
	// Owner: patch expiry/password, revoke, purge.
	rec := e.do(t, &e.user, "PATCH", "/api/shares/"+id, `{"expires_in_days":30,"password":"secret-pw"}`)
	code(t, rec, 200, "")
	if b := jsonBody(t, rec); b["has_password"] != true || b["expires_at"] != float64(e.clock.Add(30*24*time.Hour).Unix()) {
		t.Fatalf("patched %v", b)
	}
	if b := jsonBody(t, e.do(t, &e.user, "PATCH", "/api/shares/"+id, `{"password":null}`)); b["has_password"] != false {
		t.Fatalf("cleared %v", b)
	}
	code(t, e.do(t, &e.user, "PATCH", "/api/shares/"+id, `{}`), 400, "bad_request")
	code(t, e.do(t, &e.user, "DELETE", "/api/shares/"+id, ""), 204, "")
	if l := list(e.user, "/api/nodes/"+mine.ID+"/shares"); len(l) != 3 || l[2]["status"] != "revoked" {
		t.Fatalf("after revoke %v", l)
	}
	code(t, e.do(t, &e.user, "DELETE", "/api/shares/"+id+"?purge=1", ""), 204, "")
	if l := list(e.user, "/api/shares"); len(l) != 2 {
		t.Fatalf("after purge %d", len(l))
	}
}

func TestShareCannotShareTrashed(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Personal(e.user.ID), nil, "a.txt", []byte("x"))
	if err := nodes.Trash(context.Background(), e.db, e.user, f.ID); err != nil {
		t.Fatal(err)
	}
	code(t, e.do(t, &e.user, "POST", "/api/shares", `{"node_id":"`+f.ID+`"}`), 404, "not_found")
}

func TestShareDisabled(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Personal(e.user.ID), nil, "a.txt", []byte("hello"))
	tok := e.share(t, e.user, `{"node_id":"`+f.ID+`"}`)["token"].(string)
	code(t, e.do(t, &e.admin, "PATCH", "/api/admin/settings", `{"share_links_enabled":false,"share_default_expiry_days":0}`), 200, "")
	b := jsonBody(t, e.do(t, &e.admin, "GET", "/api/admin/settings", ""))
	if b["share_links_enabled"] != false || b["share_default_expiry_days"] != float64(0) {
		t.Fatalf("settings %v", b)
	}
	code(t, e.pub("GET", pubPath(tok), ""), 403, "shares_disabled")
	code(t, e.pub("GET", pubPath(tok)+"/download", ""), 403, "shares_disabled")
	code(t, e.do(t, &e.user, "POST", "/api/shares", `{"node_id":"`+f.ID+`"}`), 403, "shares_disabled")
	code(t, e.do(t, &e.admin, "PATCH", "/api/admin/settings", `{"share_default_expiry_days":3651}`), 400, "invalid_share_default_expiry_days")
	code(t, e.do(t, &e.admin, "PATCH", "/api/admin/settings", `{"share_links_enabled":true}`), 200, "")
	code(t, e.pub("GET", pubPath(tok), ""), 200, "")
	// Default expiry 0 = never.
	if sh := e.share(t, e.user, `{"node_id":"`+f.ID+`"}`); sh["expires_at"] != nil {
		t.Fatalf("default never: %v", sh)
	}
	ms := jsonBody(t, e.do(t, &e.user, "GET", "/api/me/settings", ""))
	if ms["share_links_enabled"] != true || ms["share_default_expiry_days"] != float64(0) {
		t.Fatalf("me settings %v", ms)
	}
}

func TestPublicFileShare(t *testing.T) {
	e := newShareEnv(t)
	data := []byte("0123456789abcdef")
	f := e.put(t, e.user, nodes.Space{}, nil, "notes.txt", data)
	tok := e.share(t, e.user, `{"node_id":"`+f.ID+`"}`)["token"].(string)

	rec := e.pub("GET", pubPath(tok), "")
	code(t, rec, 200, "")
	m := jsonBody(t, rec)
	if m["name"] != "notes.txt" || m["size"] != float64(len(data)) || m["is_dir"] != false || m["unlocked"] != true || m["status"] != "active" {
		t.Fatalf("meta %v", m)
	}
	if strings.Contains(rec.Body.String(), "@") || strings.Contains(rec.Body.String(), e.user.ID) {
		t.Fatalf("meta leaks: %s", rec.Body)
	}
	rec = e.pub("GET", pubPath(tok)+"/download", "")
	code(t, rec, 200, "")
	if !bytes.Equal(rec.Body.Bytes(), data) || !strings.HasPrefix(rec.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("download %q %v", rec.Body, rec.Header())
	}
	req := httptest.NewRequest("GET", pubPath(tok)+"/download", nil)
	req.Header.Set("Range", "bytes=2-5")
	rr := httptest.NewRecorder()
	e.h.ServeHTTP(rr, req)
	if rr.Code != 206 || rr.Body.String() != "2345" {
		t.Fatalf("range %d %q", rr.Code, rr.Body)
	}
	rec = e.pub("GET", pubPath(tok)+"/preview", "")
	if rec.Code != 200 || rec.Body.String() != string(data) {
		t.Fatalf("preview %d %s", rec.Code, rec.Body)
	}
	// Full downloads are counted, ranges are not.
	// (Counted in the background: poll briefly.)
	var count int
	for i := 0; i < 100; i++ {
		e.db.QueryRow(`SELECT download_count FROM shares WHERE token=?`, tok).Scan(&count)
		if count == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(50 * time.Millisecond)
	e.db.QueryRow(`SELECT download_count FROM shares WHERE token=?`, tok).Scan(&count)
	if count != 1 {
		t.Fatalf("count %d", count)
	}
	// A folder-only route on a file share, and a foreign node id.
	code(t, e.pub("GET", pubPath(tok)+"/children", ""), 404, "not_found")
	other := e.put(t, e.user, nodes.Space{}, nil, "other.txt", []byte("no"))
	code(t, e.pub("GET", pubPath(tok)+"/download?node="+other.ID, ""), 404, "not_found")
	// Unknown and malformed tokens look identical.
	a := e.pub("GET", pubPath(strings.Repeat("A", 43)), "")
	b := e.pub("GET", pubPath("nope"), "")
	if a.Code != 404 || b.Code != 404 || a.Body.String() != b.Body.String() {
		t.Fatalf("unknown token %d %s / %d %s", a.Code, a.Body, b.Code, b.Body)
	}
}

func TestPublicHeadersEverywhere(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Space{}, nil, "p.png", append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 32)...))
	d := e.folder(t, e.user, nodes.Space{}, nil, "dir")
	ft := e.share(t, e.user, `{"node_id":"`+f.ID+`"}`)["token"].(string)
	dt := e.share(t, e.user, `{"node_id":"`+d.ID+`"}`)["token"].(string)
	paths := []string{pubPath(ft), pubPath(ft) + "/download", pubPath(ft) + "/view", pubPath(ft) + "/preview",
		pubPath(dt) + "/children", pubPath(dt) + "/zip", pubPath("x"), pubPath(ft) + "/nope"}
	for _, p := range paths {
		rec := e.pub("GET", p, "")
		h := rec.Header()
		if !strings.Contains(h.Get("Cache-Control"), "no-store") || h.Get("X-Robots-Tag") != "noindex, nofollow" ||
			h.Get("Referrer-Policy") != "no-referrer" || h.Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s (%d): headers %v", p, rec.Code, h)
		}
	}
	rec := e.pub("POST", pubPath(ft)+"/unlock", `{"password":"x"}`)
	if rec.Header().Get("X-Robots-Tag") == "" {
		t.Fatal("unlock headers")
	}
	// The view hardening is shared with the authenticated endpoint.
	rec = e.pub("GET", pubPath(ft)+"/view", "")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" || rec.Header().Get("Content-Security-Policy") == "" {
		t.Fatalf("view %d %v", rec.Code, rec.Header())
	}
}

func TestPublicViewSniffRules(t *testing.T) {
	e := newShareEnv(t)
	svg := e.put(t, e.user, nodes.Space{}, nil, "x.svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`))
	fake := e.put(t, e.user, nodes.Space{}, nil, "x.png", []byte("<html>not a png</html>"))
	pdf := e.put(t, e.user, nodes.Space{}, nil, "x.pdf", []byte("%PDF-1.4\n%%EOF"))
	for _, n := range []nodes.Node{svg, fake} {
		tok := e.share(t, e.user, `{"node_id":"`+n.ID+`"}`)["token"].(string)
		code(t, e.pub("GET", pubPath(tok)+"/view", ""), 415, "not_previewable")
	}
	tok := e.share(t, e.user, `{"node_id":"`+pdf.ID+`"}`)["token"].(string)
	req := httptest.NewRequest("GET", pubPath(tok)+"/view", nil)
	req.Header.Set("Sec-Fetch-Dest", "document")
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("pdf top-level %d %v", rec.Code, rec.Header())
	}
	bin := e.put(t, e.user, nodes.Space{}, nil, "bin.txt", []byte("a\x00b"))
	tok = e.share(t, e.user, `{"node_id":"`+bin.ID+`"}`)["token"].(string)
	code(t, e.pub("GET", pubPath(tok)+"/preview", ""), 415, "not_text")
}

func TestPublicFolderScope(t *testing.T) {
	e := newShareEnv(t)
	sp := nodes.Personal(e.user.ID)
	parent := e.folder(t, e.user, sp, nil, "parent")
	root := e.folder(t, e.user, sp, &parent.ID, "root")
	sibling := e.folder(t, e.user, sp, &parent.ID, "sibling")
	sub := e.folder(t, e.user, sp, &root.ID, "sub")
	inRoot := e.put(t, e.user, sp, &root.ID, "a.txt", []byte("AAA"))
	inSub := e.put(t, e.user, sp, &sub.ID, "b.txt", []byte("BB"))
	inSibling := e.put(t, e.user, sp, &sibling.ID, "s.txt", []byte("S"))
	inParent := e.put(t, e.user, sp, &parent.ID, "p.txt", []byte("P"))
	trashed := e.put(t, e.user, sp, &sub.ID, "gone.txt", []byte("G"))
	trashedDir := e.folder(t, e.user, sp, &root.ID, "trashdir")
	underTrashed := e.put(t, e.user, sp, &trashedDir.ID, "deep.txt", []byte("D"))
	ctx := context.Background()
	nodes.Trash(ctx, e.db, e.user, trashed.ID)
	nodes.Trash(ctx, e.db, e.user, trashedDir.ID)
	otherShareFile := e.put(t, e.user, sp, nil, "elsewhere.txt", []byte("E"))
	e.share(t, e.user, `{"node_id":"`+otherShareFile.ID+`"}`)

	tok := e.share(t, e.user, `{"node_id":"`+root.ID+`"}`)["token"].(string)
	m := jsonBody(t, e.pub("GET", pubPath(tok), ""))
	if m["name"] != "root" || m["is_dir"] != true || m["size"] != float64(5) {
		t.Fatalf("meta %v", m)
	}
	rec := e.pub("GET", pubPath(tok)+"/children", "")
	code(t, rec, 200, "")
	var ch struct {
		Breadcrumb []map[string]any `json:"breadcrumb"`
		Children   []map[string]any `json:"children"`
	}
	json.Unmarshal(rec.Body.Bytes(), &ch)
	if len(ch.Children) != 2 || ch.Children[0]["name"] != "sub" || ch.Children[0]["size"] != float64(0) ||
		ch.Children[1]["name"] != "a.txt" || len(ch.Breadcrumb) != 1 {
		t.Fatalf("children %s", rec.Body)
	}
	if strings.Contains(rec.Body.String(), "@x.io") || strings.Contains(rec.Body.String(), "uploader") {
		t.Fatalf("leak %s", rec.Body)
	}
	rec = e.pub("GET", pubPath(tok)+"/children?folder="+sub.ID, "")
	json.Unmarshal(rec.Body.Bytes(), &ch)
	if rec.Code != 200 || len(ch.Children) != 1 || ch.Children[0]["name"] != "b.txt" ||
		len(ch.Breadcrumb) != 2 || ch.Breadcrumb[0]["name"] != "root" || ch.Breadcrumb[1]["name"] != "sub" {
		t.Fatalf("sub %s", rec.Body)
	}
	if rec := e.pub("GET", pubPath(tok)+"/download?node="+inSub.ID, ""); rec.Code != 200 || rec.Body.String() != "BB" {
		t.Fatalf("sub download %d %s", rec.Code, rec.Body)
	}
	if rec := e.pub("GET", pubPath(tok)+"/download?node="+inRoot.ID, ""); rec.Body.String() != "AAA" {
		t.Fatalf("root download %s", rec.Body)
	}
	code(t, e.pub("GET", pubPath(tok)+"/download", ""), 400, "is_directory")
	// Escapes: parent, sibling, their files, other shares' nodes, trashed
	// descendants (direct and under a trashed folder): all 404.
	for _, id := range []string{parent.ID, sibling.ID, inSibling.ID, inParent.ID, otherShareFile.ID, trashed.ID,
		trashedDir.ID, underTrashed.ID, "../" + parent.ID, "nope"} {
		for _, p := range []string{"/children?folder=", "/download?node=", "/preview?node=", "/view?node=", "/zip?node="} {
			code(t, e.pub("GET", pubPath(tok)+p+id, ""), 404, "not_found")
		}
	}

	// Zip of the shared folder: trashed items excluded, names relative.
	rec = e.pub("GET", pubPath(tok)+"/zip", "")
	code(t, rec, 200, "")
	if !strings.Contains(rec.Header().Get("Content-Disposition"), `root.zip`) {
		t.Fatalf("zip name %v", rec.Header())
	}
	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	sort.Strings(names)
	if strings.Join(names, ",") != "root/,root/a.txt,root/sub/,root/sub/b.txt" {
		t.Fatalf("zip entries %v", names)
	}
	rec = e.pub("GET", pubPath(tok)+"/zip?node="+sub.ID, "")
	if rec.Code != 200 || !strings.Contains(rec.Header().Get("Content-Disposition"), "sub.zip") {
		t.Fatalf("sub zip %d", rec.Code)
	}
	code(t, e.pub("GET", pubPath(tok)+"/zip?node="+inRoot.ID, ""), 400, "not_a_folder")
}

func TestPublicTrashRestoreMoveAndCascade(t *testing.T) {
	e := newShareEnv(t)
	ctx := context.Background()
	sp := nodes.Personal(e.user.ID)
	dir := e.folder(t, e.user, sp, nil, "dir")
	f := e.put(t, e.user, sp, &dir.ID, "a.txt", []byte("A"))
	tok := e.share(t, e.user, `{"node_id":"`+f.ID+`"}`)["token"].(string)

	// Trashing the item (or its folder) makes the link unavailable; restore
	// brings it back.
	nodes.Trash(ctx, e.db, e.user, dir.ID)
	code(t, e.pub("GET", pubPath(tok), ""), 410, "unavailable")
	code(t, e.pub("GET", pubPath(tok)+"/download", ""), 410, "unavailable")
	if l := e.list(t, e.user); l[0]["status"] != "item_trashed" {
		t.Fatalf("list %v", l)
	}
	if _, err := nodes.Restore(ctx, e.db, e.user, dir.ID); err != nil {
		t.Fatal(err)
	}
	code(t, e.pub("GET", pubPath(tok), ""), 200, "")
	// Moving keeps the link.
	if _, err := nodes.Move(ctx, e.db, e.user, f.ID, nil); err != nil {
		t.Fatal(err)
	}
	if rec := e.pub("GET", pubPath(tok)+"/download", ""); rec.Code != 200 || rec.Body.String() != "A" {
		t.Fatalf("after move %d", rec.Code)
	}
	// Purging the node deletes the share row.
	nodes.Trash(ctx, e.db, e.user, f.ID)
	if err := nodes.PurgeNode(ctx, e.db, e.dataDir, e.user, f.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	e.db.QueryRow(`SELECT count(*) FROM shares`).Scan(&n)
	if n != 0 {
		t.Fatalf("shares after purge %d", n)
	}
	code(t, e.pub("GET", pubPath(tok), ""), 404, "not_found")
}

func (e *shareEnv) list(t *testing.T, as users.User) []map[string]any {
	t.Helper()
	var out []map[string]any
	json.Unmarshal(e.do(t, &as, "GET", "/api/shares", "").Body.Bytes(), &out)
	return out
}

func TestShareStatusInList(t *testing.T) {
	e := newShareEnv(t)
	ctx := context.Background()
	f := e.put(t, e.user, nodes.Space{}, nil, "a.txt", []byte("A"))
	e.share(t, e.user, `{"node_id":"`+f.ID+`","expires_in_days":1}`)
	nodes.Trash(ctx, e.db, e.user, f.ID)
	if l := e.list(t, e.user); l[0]["status"] != "item_trashed" {
		t.Fatalf("%v", l)
	}
	nodes.Restore(ctx, e.db, e.user, f.ID)
	e.clock = e.clock.Add(25 * time.Hour)
	if l := e.list(t, e.user); l[0]["status"] != "expired" {
		t.Fatalf("%v", l)
	}
}

func TestShareMovedIntoOthersPersonalSpace(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.other, nodes.Space{}, nil, "a.txt", []byte("A"))
	tok := e.share(t, e.user, `{"node_id":"`+f.ID+`"}`)["token"].(string)
	// The uploader moves it into their own personal space: the user's link
	// must not expose it, and the owner list no longer names it.
	if _, err := nodes.MoveTo(context.Background(), e.db, e.other, f.ID, &nodes.Space{Owner: &e.other.ID}, nil); err != nil {
		t.Fatal(err)
	}
	code(t, e.pub("GET", pubPath(tok), ""), 410, "unavailable")
	code(t, e.pub("GET", pubPath(tok)+"/download", ""), 410, "unavailable")
	if l := e.list(t, e.user); l[0]["status"] != "unavailable" || l[0]["node_name"] != "" {
		t.Fatalf("%v", l)
	}
}

func TestPublicExpiryAndRevoke(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Space{}, nil, "a.txt", []byte("A"))
	sh := e.share(t, e.user, `{"node_id":"`+f.ID+`","expires_in_days":1}`)
	tok := sh["token"].(string)
	code(t, e.pub("GET", pubPath(tok), ""), 200, "")
	e.clock = e.clock.Add(24*time.Hour - time.Second)
	code(t, e.pub("GET", pubPath(tok)+"/download", ""), 200, "")
	e.clock = e.clock.Add(time.Second)
	code(t, e.pub("GET", pubPath(tok), ""), 410, "expired")
	code(t, e.pub("GET", pubPath(tok)+"/download", ""), 410, "expired")
	// Extending re-enables it; revoking kills it.
	code(t, e.do(t, &e.user, "PATCH", "/api/shares/"+sh["id"].(string), `{"expires_in_days":7}`), 200, "")
	code(t, e.pub("GET", pubPath(tok), ""), 200, "")
	code(t, e.do(t, &e.user, "DELETE", "/api/shares/"+sh["id"].(string), ""), 204, "")
	code(t, e.pub("GET", pubPath(tok), ""), 410, "revoked")
	code(t, e.pub("GET", pubPath(tok)+"/download", ""), 410, "revoked")
}

func cookieFrom(t *testing.T, rec *httptest.ResponseRecorder, path string) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Path == path {
			return c
		}
	}
	t.Fatalf("no cookie for %s: %v", path, rec.Result().Cookies())
	return nil
}

func TestPublicPasswordFlow(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Space{}, nil, "secret-name.txt", []byte("TOP"))
	sh := e.share(t, e.user, `{"node_id":"`+f.ID+`","password":"open sesame"}`)
	tok, id := sh["token"].(string), sh["id"].(string)
	sh2 := e.share(t, e.user, `{"node_id":"`+f.ID+`","password":"open sesame"}`)
	tok2 := sh2["token"].(string)

	rec := e.pub("GET", pubPath(tok), "")
	code(t, rec, 200, "")
	m := jsonBody(t, rec)
	if m["has_password"] != true || m["unlocked"] != false || strings.Contains(rec.Body.String(), "secret-name") || m["size"] != nil {
		t.Fatalf("locked meta leaks: %s", rec.Body)
	}
	for _, p := range []string{"/download", "/preview", "/view", "/children", "/zip"} {
		code(t, e.pub("GET", pubPath(tok)+p, ""), 401, "password_required")
	}
	// Signed in as the owner or an admin changes nothing on public routes.
	for _, as := range []users.User{e.user, e.admin} {
		rec := e.do(t, &as, "GET", pubPath(tok)+"/download", "")
		code(t, rec, 401, "password_required")
	}
	code(t, e.pub("POST", pubPath(tok)+"/unlock", `{"password":"wrong"}`), 403, "wrong_password")
	rec = e.pub("POST", pubPath(tok)+"/unlock", `{"password":"open sesame"}`)
	code(t, rec, 204, "")
	api := cookieFrom(t, rec, "/api/public/shares/"+tok)
	page := cookieFrom(t, rec, "/s/"+tok)
	if !api.HttpOnly || api.SameSite != http.SameSiteLaxMode || api.Value != page.Value || !strings.HasPrefix(api.Name, "kore_share_") {
		t.Fatalf("cookie %+v", api)
	}
	m = jsonBody(t, e.pub("GET", pubPath(tok), "", api))
	if m["unlocked"] != true || m["name"] != "secret-name.txt" {
		t.Fatalf("unlocked meta %v", m)
	}
	if rec := e.pub("GET", pubPath(tok)+"/download", "", api); rec.Body.String() != "TOP" {
		t.Fatalf("download %d", rec.Code)
	}
	// Share A's cookie (even renamed to B's cookie name) does not unlock B.
	forged := &http.Cookie{Name: "kore_share_" + sh2["id"].(string)[:16], Value: api.Value}
	code(t, e.pub("GET", pubPath(tok2)+"/download", "", api, forged), 401, "password_required")
	// A forged value doesn't either.
	code(t, e.pub("GET", pubPath(tok)+"/download", "", &http.Cookie{Name: api.Name, Value: "9999999999.00"}), 401, "password_required")
	// Cookies expire after 12h.
	e.clock = e.clock.Add(12*time.Hour + time.Second)
	code(t, e.pub("GET", pubPath(tok)+"/download", "", api), 401, "password_required")
	e.clock = e.clock.Add(-12*time.Hour - time.Second)
	// Changing the password invalidates old cookies; clearing it opens the link.
	code(t, e.do(t, &e.user, "PATCH", "/api/shares/"+id, `{"password":"new password"}`), 200, "")
	code(t, e.pub("GET", pubPath(tok)+"/download", "", api), 401, "password_required")
	code(t, e.do(t, &e.user, "PATCH", "/api/shares/"+id, `{"password":null}`), 200, "")
	code(t, e.pub("GET", pubPath(tok)+"/download", ""), 200, "")
	// Over HTTPS the cookie is Secure.
	req := httptest.NewRequest("POST", pubPath(tok2)+"/unlock", strings.NewReader(`{"password":"open sesame"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-Proto", "https")
	rr := httptest.NewRecorder()
	e.h.ServeHTTP(rr, req)
	if c := cookieFrom(t, rr, "/s/"+tok2); !c.Secure {
		t.Fatal("cookie not Secure over https")
	}
}

func TestPublicUnlockRateLimit(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Space{}, nil, "a.txt", []byte("A"))
	tok := e.share(t, e.user, `{"node_id":"`+f.ID+`","password":"right-pass"}`)["token"].(string)
	for i := 0; i < 5; i++ {
		code(t, e.pub("POST", pubPath(tok)+"/unlock", `{"password":"bad"}`), 403, "wrong_password")
	}
	code(t, e.pub("POST", pubPath(tok)+"/unlock", `{"password":"right-pass"}`), 429, "too_many_attempts")
	// Other addresses have their own bucket.
	req := httptest.NewRequest("POST", pubPath(tok)+"/unlock", strings.NewReader(`{"password":"right-pass"}`))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "198.51.100.1:1"
	rr := httptest.NewRecorder()
	e.h.ServeHTTP(rr, req)
	code(t, rr, 204, "")
}

func TestPublicUnlockBusy(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Space{}, nil, "a.txt", []byte("A"))
	tok := e.share(t, e.user, `{"node_id":"`+f.ID+`","password":"right-pass"}`)["token"].(string)
	restore := auth.SetHashConcurrencyForTest(0, 10*time.Millisecond)
	defer restore()
	var wg sync.WaitGroup
	codes := make([]int, 3)
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i] = e.pub("POST", pubPath(tok)+"/unlock", `{"password":"right-pass"}`).Code
		}()
	}
	wg.Wait()
	for _, c := range codes {
		if c != 503 {
			t.Fatalf("codes %v", codes)
		}
	}
	// Busy attempts are refunded: more of them than any budget allows.
	for i := 0; i < 8; i++ {
		code(t, e.pub("POST", pubPath(tok)+"/unlock", `{"password":"right-pass"}`), 503, "busy")
	}
	restore()
	code(t, e.pub("POST", pubPath(tok)+"/unlock", `{"password":"right-pass"}`), 204, "")
}

func TestPublicRateLimitAndZipCap(t *testing.T) {
	e := newShareEnv(t)
	d := e.folder(t, e.user, nodes.Space{}, nil, "d")
	tok := e.share(t, e.user, `{"node_id":"`+d.ID+`"}`)["token"].(string)
	// Fill the zip slots: the next zip is 503 busy.
	for i := 0; i < cap(e.s.zipSlots); i++ {
		e.s.zipSlots <- struct{}{}
	}
	code(t, e.pub("GET", pubPath(tok)+"/zip", ""), 503, "busy")
	for i := 0; i < cap(e.s.zipSlots); i++ {
		<-e.s.zipSlots
	}
	code(t, e.pub("GET", pubPath(tok)+"/zip", ""), 200, "")
	e.s.publicLimit = auth.NewLimiter(3, time.Minute)
	for i := 0; i < 3; i++ {
		code(t, e.pub("GET", pubPath(tok), ""), 200, "")
	}
	code(t, e.pub("GET", pubPath(tok), ""), 429, "rate_limited")
	code(t, e.pub("GET", pubPath("unknown"), ""), 429, "rate_limited")
}

func TestShareCascadeOnUserDelete(t *testing.T) {
	e := newShareEnv(t)
	f := e.put(t, e.user, nodes.Space{}, nil, "a.txt", []byte("A"))
	p := e.put(t, e.user, nodes.Personal(e.user.ID), nil, "b.txt", []byte("B"))
	e.share(t, e.user, `{"node_id":"`+f.ID+`"}`)
	e.share(t, e.user, `{"node_id":"`+p.ID+`"}`)
	code(t, e.do(t, &e.admin, "DELETE", "/api/admin/users/"+e.user.ID+"?files=purge", ""), 204, "")
	var n int
	e.db.QueryRow(`SELECT count(*) FROM shares`).Scan(&n)
	if n != 0 {
		t.Fatalf("shares left %d", n)
	}
}

func TestSharedFlagInListing(t *testing.T) {
	e := newShareEnv(t)
	a := e.put(t, e.user, nodes.Space{}, nil, "a.txt", []byte("A"))
	e.put(t, e.user, nodes.Space{}, nil, "b.txt", []byte("B"))
	e.share(t, e.user, `{"node_id":"`+a.ID+`"}`)
	flags := func(as users.User) map[string]bool {
		var out []map[string]any
		json.Unmarshal(e.do(t, &as, "GET", "/api/nodes?space=shared", "").Body.Bytes(), &out)
		m := map[string]bool{}
		for _, n := range out {
			m[n["name"].(string)] = n["shared"] == true
		}
		return m
	}
	if f := flags(e.user); !f["a.txt"] || f["b.txt"] {
		t.Fatalf("%v", f)
	}
	// Another user's links are not theirs to see.
	if f := flags(e.other); f["a.txt"] {
		t.Fatalf("other %v", f)
	}
}

func TestPublicNeverLogsTokens(t *testing.T) {
	e := newShareEnv(t)
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)
	f := e.put(t, e.user, nodes.Space{}, nil, "a.txt", []byte("A"))
	tok := e.share(t, e.user, `{"node_id":"`+f.ID+`","password":"pass-word"}`)["token"].(string)
	// Break the blob so the error paths log.
	var blob string
	e.db.QueryRow(`SELECT blob_id FROM nodes WHERE id=?`, f.ID).Scan(&blob)
	p, _ := volume.BlobPath(e.dataDir, blob)
	os.Remove(p)
	rec := e.pub("POST", pubPath(tok)+"/unlock", `{"password":"pass-word"}`)
	c := cookieFrom(t, rec, "/api/public/shares/"+tok)
	for _, path := range []string{"", "/download", "/view", "/preview", "/zip", "/children"} {
		r := e.pub("GET", pubPath(tok)+path, "", c)
		io.Copy(io.Discard, r.Body)
	}
	e.pub("POST", pubPath(tok)+"/unlock", `{"password":"nope"}`)
	if out := buf.String(); strings.Contains(out, tok) || strings.Contains(out, "pass-word") || strings.Contains(out, c.Value) {
		t.Fatalf("log leaks secrets: %s", out)
	}
}
