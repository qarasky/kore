package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/qarasky/kore/api/internal/auth"
	"github.com/qarasky/kore/api/internal/store"
	"github.com/qarasky/kore/api/internal/users"
	"github.com/qarasky/kore/api/internal/volume"
)

type env struct {
	h       http.Handler
	db      *sql.DB
	dataDir string
	admin   users.User
	user    users.User
}

func newEnv(t *testing.T) *env {
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
	a, err := users.Create(context.Background(), db, "admin@x.io", "admin", 0)
	if err != nil {
		t.Fatal(err)
	}
	u, err := users.Create(context.Background(), db, "user@x.io", "user", 100)
	if err != nil {
		t.Fatal(err)
	}
	return &env{h: New(db, dir), db: db, dataDir: dir, admin: a, user: u}
}

func (e *env) do(t *testing.T, as *users.User, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if as != nil {
		tok, err := auth.NewSession(context.Background(), e.db, as.ID, 3600e9)
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tok})
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

func jsonBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	m := map[string]any{}
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
	return m
}

func TestNonAdminForbidden(t *testing.T) {
	e := newEnv(t)
	routes := [][2]string{
		{"GET", "/api/admin/users"},
		{"PATCH", "/api/admin/users/" + e.user.ID},
		{"DELETE", "/api/admin/users/" + e.user.ID},
		{"GET", "/api/admin/settings"}, {"PATCH", "/api/admin/settings"}, {"GET", "/api/admin/usage"},
	}
	for _, r := range routes {
		rec := e.do(t, &e.user, r[0], r[1], `{}`)
		if rec.Code != 403 {
			t.Errorf("%s %s: %d", r[0], r[1], rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Errorf("%s %s content-type %q", r[0], r[1], ct)
		}
		if rec := e.do(t, nil, r[0], r[1], `{}`); rec.Code != 401 {
			t.Errorf("anon %s %s: %d", r[0], r[1], rec.Code)
		}
	}
}

func TestSettingsValidation(t *testing.T) {
	e := newEnv(t)
	rec := e.do(t, &e.admin, "GET", "/api/admin/settings", "")
	m := jsonBody(t, rec)
	if m["trash_retention_days"].(float64) != 30 || m["max_file_bytes"].(float64) != 0 {
		t.Fatalf("%v", m)
	}
	for _, body := range []string{`{"trash_retention_days":0}`, `{"trash_retention_days":4000}`, `{"max_file_bytes":-5}`, `{"default_quota_bytes":-1}`, `nope`} {
		if rec := e.do(t, &e.admin, "PATCH", "/api/admin/settings", body); rec.Code != 400 {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
}

func addNode(t *testing.T, e *env, id, owner string, size int64) {
	t.Helper()
	_, err := e.db.Exec(`INSERT INTO nodes(id,space_owner,uploader,name,size,created_at,updated_at) VALUES(?,?,?,?,?,0,0)`,
		id, owner, owner, "secret-"+id+".txt", size)
	if err != nil {
		t.Fatal(err)
	}
}

func TestDeleteUserWithFilesConflict(t *testing.T) {
	e := newEnv(t)
	addNode(t, e, "n1", e.user.ID, 10)
	addNode(t, e, "n2", e.user.ID, 5)
	rec := e.do(t, &e.admin, "DELETE", "/api/admin/users/"+e.user.ID, "")
	if rec.Code != 409 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	m := jsonBody(t, rec)
	if m["error"] != "user_has_files" || m["file_count"].(float64) != 2 {
		t.Fatalf("%v", m)
	}
	e.db.Exec(`DELETE FROM nodes`)
	if rec := e.do(t, &e.admin, "DELETE", "/api/admin/users/"+e.user.ID, ""); rec.Code != 204 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if rec := e.do(t, &e.admin, "DELETE", "/api/admin/users/"+e.user.ID, ""); rec.Code != 404 {
		t.Fatalf("%d", rec.Code)
	}
}

func TestCannotRemoveLastAdmin(t *testing.T) {
	e := newEnv(t)
	if rec := e.do(t, &e.admin, "DELETE", "/api/admin/users/"+e.admin.ID, ""); rec.Code != 409 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if rec := e.do(t, &e.admin, "PATCH", "/api/admin/users/"+e.admin.ID, `{"role":"user"}`); rec.Code != 409 {
		t.Fatalf("demote: %d", rec.Code)
	}
	if rec := e.do(t, &e.admin, "PATCH", "/api/admin/users/"+e.user.ID, `{"role":"admin"}`); rec.Code != 200 {
		t.Fatalf("promote: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do(t, &e.admin, "PATCH", "/api/admin/users/"+e.admin.ID, `{"role":"user","quota_bytes":7}`); rec.Code != 200 {
		t.Fatalf("demote with 2 admins: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do(t, &e.user, "PATCH", "/api/admin/users/"+e.admin.ID, `{"email":"zzz"}`); rec.Code != 400 {
		t.Fatalf("bad email: %d", rec.Code)
	}
}

func TestUsageHasNoFileNames(t *testing.T) {
	e := newEnv(t)
	addNode(t, e, "n1", e.user.ID, 10)
	addNode(t, e, "n2", e.user.ID, 5)
	rec := e.do(t, &e.admin, "GET", "/api/admin/usage", "")
	if rec.Code != 200 {
		t.Fatalf("%d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "secret") {
		t.Fatalf("leaks names: %s", rec.Body)
	}
	var out []struct {
		UserID     string `json:"user_id"`
		UsedBytes  int64  `json:"used_bytes"`
		QuotaBytes int64  `json:"quota_bytes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out) != 2 {
		t.Fatalf("%v %s", err, rec.Body)
	}
	for _, r := range out {
		if r.UserID == e.user.ID && (r.UsedBytes != 15 || r.QuotaBytes != 100) {
			t.Fatalf("%+v", r)
		}
	}
}

func (e *env) doTok(method, path, body, tok string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tok})
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

func TestJSONNotFoundAndUnauthorized(t *testing.T) {
	e := newEnv(t)
	check := func(rec *httptest.ResponseRecorder, code int, errc string) {
		t.Helper()
		if rec.Code != code || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
			t.Fatalf("%d %q", rec.Code, rec.Header().Get("Content-Type"))
		}
		if jsonBody(t, rec)["error"] != errc {
			t.Fatalf("%s", rec.Body)
		}
	}
	check(e.do(t, nil, "GET", "/api/nope", ""), 404, "not_found")
	check(e.do(t, nil, "GET", "/api/auth/me", ""), 401, "unauthorized")
	check(e.do(t, nil, "POST", "/api/healthz", ""), 405, "method_not_allowed")
}

func TestPatchUserQuotaEmailCollision(t *testing.T) {
	e := newEnv(t)
	path := "/api/admin/users/" + e.user.ID
	rec := e.do(t, &e.admin, "PATCH", path, `{"quota_bytes":4242}`)
	if rec.Code != 200 || jsonBody(t, rec)["quota_bytes"].(float64) != 4242 {
		t.Fatalf("quota: %d %s", rec.Code, rec.Body)
	}
	rec = e.do(t, &e.admin, "PATCH", path, `{"email":"new@x.io"}`)
	m := jsonBody(t, rec)
	if rec.Code != 200 || m["email"] != "new@x.io" || m["quota_bytes"].(float64) != 4242 {
		t.Fatalf("email: %d %s", rec.Code, rec.Body)
	}
	rec = e.do(t, &e.admin, "PATCH", path, `{"email":"ADMIN@x.io"}`)
	if rec.Code != 409 || jsonBody(t, rec)["error"] != "email_in_use" {
		t.Fatalf("collision: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do(t, &e.admin, "PATCH", "/api/admin/users/nope", `{"quota_bytes":1}`); rec.Code != 404 {
		t.Fatalf("missing: %d", rec.Code)
	}
}
