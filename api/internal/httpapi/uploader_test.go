package httpapi

import (
	"context"
	"encoding/json"
	"net/url"
	"testing"

	"github.com/qarasky/kore/api/internal/auth"
	"github.com/qarasky/kore/api/internal/nodes"
	"github.com/qarasky/kore/api/internal/users"
)

// listJSON decodes a JSON array response into id -> object.
func listJSON(t *testing.T, e *env, as users.User, path string) map[string]map[string]any {
	t.Helper()
	rec := e.do(t, &as, "GET", path, "")
	if rec.Code != 200 {
		t.Fatalf("%s: %d %s", path, rec.Code, rec.Body)
	}
	var list []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	out := map[string]map[string]any{}
	for _, n := range list {
		out[n["id"].(string)] = n
	}
	return out
}

func TestUploaderEmailOnlyInSharedSpace(t *testing.T) {
	e := newEnv(t)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<20, e.user.ID)
	ph, _ := auth.HashPassword("password-1")
	b, err := users.Create(context.Background(), e.db, "b@x.io", ph, "user", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	shared, _ := e.putFileIn(t, e.user, nodes.Space{}, "team-report.txt", []byte("x"))
	dirRec := e.do(t, &e.user, "POST", "/api/nodes", `{"space":"shared","name":"team-dir"}`)
	dir := jsonBody(t, dirRec)["id"].(string)
	mine, _ := e.putFileIn(t, e.user, nodes.Personal(e.user.ID), "my-report.txt", []byte("y"))

	// Shared list (seen by another user): file and folder carry the uploader.
	got := listJSON(t, e, b, "/api/nodes?space=shared")
	if got[shared.ID]["uploader_email"] != "user@x.io" || got[dir]["uploader_email"] != "user@x.io" {
		t.Fatalf("shared list: %v", got)
	}
	// sizes=0 too.
	if got := listJSON(t, e, b, "/api/nodes?space=shared&sizes=0"); got[shared.ID]["uploader_email"] != "user@x.io" {
		t.Fatalf("shared sizes=0: %v", got)
	}
	// Personal list: the key is absent.
	got = listJSON(t, e, e.user, "/api/nodes?space=personal")
	if _, ok := got[mine.ID]["uploader_email"]; ok || got[mine.ID] == nil {
		t.Fatalf("personal list leaks uploader: %v", got)
	}
	// Search: only the shared hit has it.
	got = listJSON(t, e, e.user, "/api/search?q="+url.QueryEscape("report"))
	if got[shared.ID]["uploader_email"] != "user@x.io" {
		t.Fatalf("search shared: %v", got)
	}
	if _, ok := got[mine.ID]["uploader_email"]; ok || got[mine.ID] == nil {
		t.Fatalf("search personal leaks uploader: %v", got)
	}
	// Trash: shared tab has it, personal tab not.
	e.do(t, &e.user, "DELETE", "/api/nodes/"+shared.ID, "")
	e.do(t, &e.user, "DELETE", "/api/nodes/"+mine.ID, "")
	if got := listJSON(t, e, b, "/api/trash?space=shared"); got[shared.ID]["uploader_email"] != "user@x.io" {
		t.Fatalf("shared trash: %v", got)
	}
	got = listJSON(t, e, e.user, "/api/trash?space=personal")
	if _, ok := got[mine.ID]["uploader_email"]; ok || got[mine.ID] == nil {
		t.Fatalf("personal trash leaks uploader: %v", got)
	}
}

func TestUploaderEmailFollowsMoves(t *testing.T) {
	e := newEnv(t)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<20, e.user.ID)
	ph, _ := auth.HashPassword("password-1")
	b, err := users.Create(context.Background(), e.db, "b@x.io", ph, "user", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	// B moves a personal file to the shared space: B is shown.
	f, _ := e.putFileIn(t, b, nodes.Personal(b.ID), "from-b.txt", []byte("b"))
	if rec := e.do(t, &b, "PATCH", "/api/nodes/"+f.ID, `{"parent_id":null,"space":"shared"}`); rec.Code != 200 {
		t.Fatalf("to shared: %d %s", rec.Code, rec.Body)
	}
	if got := listJSON(t, e, e.user, "/api/nodes?space=shared"); got[f.ID]["uploader_email"] != "b@x.io" {
		t.Fatalf("moved to shared: %v", got)
	}
	// The user moves it into their personal space: no longer exposed (and
	// the PATCH reply does not carry it either).
	rec := e.do(t, &e.user, "PATCH", "/api/nodes/"+f.ID, `{"parent_id":null,"space":"personal"}`)
	if rec.Code != 200 {
		t.Fatalf("to personal: %d %s", rec.Code, rec.Body)
	}
	if _, ok := jsonBody(t, rec)["uploader_email"]; ok {
		t.Fatalf("patch reply leaks uploader: %s", rec.Body)
	}
	got := listJSON(t, e, e.user, "/api/nodes?space=personal")
	if got[f.ID] == nil {
		t.Fatalf("not in personal: %v", got)
	}
	if _, ok := got[f.ID]["uploader_email"]; ok {
		t.Fatalf("personal leaks uploader: %v", got[f.ID])
	}
	// Back to shared: now attributed to the user who holds it.
	e.do(t, &e.user, "PATCH", "/api/nodes/"+f.ID, `{"parent_id":null,"space":"shared"}`)
	if got := listJSON(t, e, b, "/api/nodes?space=shared"); got[f.ID]["uploader_email"] != "user@x.io" {
		t.Fatalf("back to shared: %v", got)
	}
}

func TestUploaderEmailAfterPurgeShowsAdmin(t *testing.T) {
	e := newEnv(t)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<20, e.user.ID)
	f, _ := e.putFileIn(t, e.user, nodes.Space{}, "kept.txt", []byte("k"))
	if got := listJSON(t, e, e.admin, "/api/nodes?space=shared"); got[f.ID]["uploader_email"] != "user@x.io" {
		t.Fatalf("before: %v", got)
	}
	if rec := e.do(t, &e.admin, "DELETE", "/api/admin/users/"+e.user.ID+"?files=purge", ""); rec.Code != 204 {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body)
	}
	if got := listJSON(t, e, e.admin, "/api/nodes?space=shared"); got[f.ID]["uploader_email"] != "admin@x.io" {
		t.Fatalf("after purge: %v", got)
	}
}
