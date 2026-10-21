package httpapi

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/nodes"
	"github.com/artchsh/kore/api/internal/users"
	"github.com/artchsh/kore/api/internal/volume"
)

// putFileIn stores a file with a real blob in sp (parent = space root).
func (e *env) putFileIn(t *testing.T, u users.User, sp nodes.Space, name string, data []byte) (nodes.Node, string) {
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
	n, err := nodes.CreateFileTx(ctx, tx, u, nodes.FileSpec{Space: sp, Name: name, Size: int64(len(data)), BlobID: blob, Mime: "text/plain"})
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return n, p
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func (e *env) usedBy(t *testing.T, u users.User) float64 {
	t.Helper()
	rec := e.do(t, &u, "GET", "/api/me/usage", "")
	if rec.Code != 200 {
		t.Fatalf("usage: %d %s", rec.Code, rec.Body)
	}
	return jsonBody(t, rec)["used_bytes"].(float64)
}

func TestDeleteUserPurgeFiles(t *testing.T) {
	e := newEnv(t)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<20, e.user.ID)
	_, livePath := e.putFileIn(t, e.user, nodes.Personal(e.user.ID), "live.txt", make([]byte, 11))
	trashed, trashedPath := e.putFileIn(t, e.user, nodes.Personal(e.user.ID), "old.txt", make([]byte, 13))
	if rec := e.do(t, &e.user, "DELETE", "/api/nodes/"+trashed.ID, ""); rec.Code != 204 {
		t.Fatalf("trash: %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "POST", "/api/nodes", `{"space":"personal","name":"dir"}`); rec.Code != 201 {
		t.Fatalf("mkdir: %d %s", rec.Code, rec.Body)
	}
	shared, sharedPath := e.putFileIn(t, e.user, nodes.Space{}, "team.txt", make([]byte, 17))
	// An open upload with staged bytes.
	rec := e.do(t, &e.user, "POST", "/api/uploads", `{"space":"personal","parent":null,"name":"u.bin","size":4,"chunk_size":1024}`)
	if rec.Code != 201 {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body)
	}
	upID := jsonBody(t, rec)["id"].(string)
	if rec := e.req(t, &e.user, "PATCH", "/api/uploads/"+upID, []byte("abcd"), map[string]string{"Upload-Offset": "0"}); rec.Code/100 != 2 {
		t.Fatalf("chunk: %d %s", rec.Code, rec.Body)
	}
	staging := filepath.Join(e.dataDir, "tmp", "uploads", upID)
	if !exists(staging) {
		t.Fatal("no staging dir")
	}
	adminBefore := e.usedBy(t, e.admin)
	path := "/api/admin/users/" + e.user.ID

	// Without ?files=purge: refused, with the counts.
	rec = e.do(t, &e.admin, "DELETE", path, "")
	m := jsonBody(t, rec)
	if rec.Code != 409 || m["error"] != "user_has_files" || m["file_count"].(float64) != 3 ||
		m["personal_count"].(float64) != 3 || m["shared_count"].(float64) != 1 {
		t.Fatalf("no purge: %d %v", rec.Code, m)
	}
	if rec := e.do(t, &e.admin, "DELETE", path+"?files=keep", ""); rec.Code != 400 {
		t.Fatalf("bad files param: %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "DELETE", path+"?files=purge", ""); rec.Code != 403 {
		t.Fatalf("non-admin purge: %d", rec.Code)
	}
	if !exists(livePath) || !exists(trashedPath) {
		t.Fatal("refused delete touched files")
	}

	if rec := e.do(t, &e.admin, "DELETE", path+"?files=purge", ""); rec.Code != 204 {
		t.Fatalf("purge: %d %s", rec.Code, rec.Body)
	}
	if exists(livePath) || exists(trashedPath) {
		t.Fatal("personal blobs left on disk")
	}
	if exists(staging) {
		t.Fatal("staging left on disk")
	}
	if !exists(sharedPath) {
		t.Fatal("shared blob deleted")
	}
	var n int
	e.db.QueryRow(`SELECT count(*) FROM nodes WHERE space_owner=?`, e.user.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("%d personal nodes left", n)
	}
	e.db.QueryRow(`SELECT count(*) FROM uploads WHERE user_id=?`, e.user.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("%d uploads left", n)
	}
	var uploader string
	if err := e.db.QueryRow(`SELECT uploader FROM nodes WHERE id=?`, shared.ID).Scan(&uploader); err != nil || uploader != e.admin.ID {
		t.Fatalf("shared uploader %q %v", uploader, err)
	}
	if got := e.usedBy(t, e.admin); got != adminBefore+17 {
		t.Fatalf("admin used %v, want %v", got, adminBefore+17)
	}
	if rec := e.do(t, &e.admin, "GET", "/api/nodes?space=shared", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), shared.ID) {
		t.Fatalf("shared listing: %d %s", rec.Code, rec.Body)
	}
	if _, err := auth.Authenticate(context.Background(), e.db, "user@x.io", "password-1"); err == nil {
		t.Fatal("deleted user can still log in")
	}
	if rec := e.do(t, &e.admin, "DELETE", path+"?files=purge", ""); rec.Code != 404 {
		t.Fatalf("again: %d", rec.Code)
	}
}

func TestDeleteUserSharedOnlyConflict(t *testing.T) {
	e := newEnv(t)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<20, e.user.ID)
	e.putFileIn(t, e.user, nodes.Space{}, "a.txt", []byte("a"))
	rec := e.do(t, &e.admin, "DELETE", "/api/admin/users/"+e.user.ID, "")
	m := jsonBody(t, rec)
	if rec.Code != 409 || m["file_count"].(float64) != 1 || m["personal_count"].(float64) != 0 || m["shared_count"].(float64) != 1 {
		t.Fatalf("%d %v", rec.Code, m)
	}
}

func TestDeleteSelfAndLastAdminGuards(t *testing.T) {
	e := newEnv(t)
	self := "/api/admin/users/" + e.admin.ID
	for _, q := range []string{"", "?files=purge"} {
		rec := e.do(t, &e.admin, "DELETE", self+q, "")
		if rec.Code != 409 || jsonBody(t, rec)["error"] != "last_admin" {
			t.Fatalf("sole admin %q: %d %s", q, rec.Code, rec.Body)
		}
	}
	if rec := e.do(t, &e.admin, "PATCH", "/api/admin/users/"+e.user.ID, `{"role":"admin"}`); rec.Code != 200 {
		t.Fatalf("promote: %d", rec.Code)
	}
	for _, q := range []string{"", "?files=purge"} {
		rec := e.do(t, &e.admin, "DELETE", self+q, "")
		if rec.Code != 409 || jsonBody(t, rec)["error"] != "cannot_delete_self" {
			t.Fatalf("self %q: %d %s", q, rec.Code, rec.Body)
		}
	}
	// Another admin may delete this one (two admins exist).
	e.user.Role = "admin"
	if rec := e.do(t, &e.user, "DELETE", self+"?files=purge", ""); rec.Code != 204 {
		t.Fatalf("other admin: %d %s", rec.Code, rec.Body)
	}
}
