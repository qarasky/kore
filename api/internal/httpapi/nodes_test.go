package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/nodes"
	"github.com/artchsh/kore/api/internal/users"
)

func TestNodesHTTPFlow(t *testing.T) {
	e := newEnv(t)
	rec := e.do(t, nil, "GET", "/api/nodes?space=shared", "")
	if rec.Code != 401 {
		t.Fatalf("anon: %d", rec.Code)
	}
	rec = e.do(t, &e.user, "POST", "/api/nodes", `{"space":"personal","name":"Док"}`)
	if rec.Code != 201 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	f := jsonBody(t, rec)
	if f["name"] != "Док" || f["space"] != "personal" || f["is_dir"] != true || f["parent_id"] != nil {
		t.Fatalf("%v", f)
	}
	id := f["id"].(string)
	if rec = e.do(t, &e.user, "POST", "/api/nodes", `{"space":"personal","name":"Док"}`); rec.Code != 409 || jsonBody(t, rec)["error"] != "name_taken" {
		t.Fatalf("dup: %d %s", rec.Code, rec.Body)
	}
	if rec = e.do(t, &e.user, "POST", "/api/nodes", `{"space":"personal","name":".."}`); rec.Code != 400 {
		t.Fatalf("bad name: %d", rec.Code)
	}
	if rec = e.do(t, &e.user, "GET", "/api/nodes?space=bogus", ""); rec.Code != 400 {
		t.Fatalf("bad space: %d", rec.Code)
	}
	// Admin cannot touch another user's personal node: 404 not 403.
	for _, c := range [][3]string{
		{"PATCH", "/api/nodes/" + id, `{"name":"z"}`},
		{"GET", "/api/nodes/" + id + "/path", ""},
		{"GET", "/api/nodes?space=personal&parent=" + id, ""},
	} {
		if rec = e.do(t, &e.admin, c[0], c[1], c[2]); rec.Code != 404 {
			t.Fatalf("%s %s: %d", c[0], c[1], rec.Code)
		}
	}
	// Rename + move to shared space.
	rec = e.do(t, &e.user, "PATCH", "/api/nodes/"+id, `{"name":"Doc2"}`)
	if rec.Code != 200 || jsonBody(t, rec)["name"] != "Doc2" {
		t.Fatalf("rename: %d %s", rec.Code, rec.Body)
	}
	rec = e.do(t, &e.user, "PATCH", "/api/nodes/"+id, `{"parent_id":null,"space":"shared"}`)
	if rec.Code != 200 || jsonBody(t, rec)["space"] != "shared" {
		t.Fatalf("to shared: %d %s", rec.Code, rec.Body)
	}
	// Any user can now see/edit it.
	rec = e.do(t, &e.admin, "GET", "/api/nodes?space=shared", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"id":"`+id+`"`) {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	// Into itself is rejected.
	if rec = e.do(t, &e.admin, "PATCH", "/api/nodes/"+id, `{"parent_id":"`+id+`"}`); rec.Code != 400 {
		t.Fatalf("self: %d", rec.Code)
	}
	// Breadcrumbs.
	rec = e.do(t, &e.admin, "POST", "/api/nodes", `{"space":"shared","parent_id":"`+id+`","name":"sub"}`)
	sub := jsonBody(t, rec)["id"].(string)
	rec = e.do(t, &e.user, "GET", "/api/nodes/"+sub+"/path", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Doc2") || !strings.Contains(rec.Body.String(), "sub") {
		t.Fatalf("path: %d %s", rec.Code, rec.Body)
	}
	if rec = e.do(t, &e.user, "PATCH", "/api/nodes/"+sub, `{}`); rec.Code != 400 {
		t.Fatalf("empty patch: %d", rec.Code)
	}
}

func TestPatchIsAtomicAndSpaceChecks(t *testing.T) {
	e := newEnv(t)
	mk := func(body string) map[string]any {
		rec := e.do(t, &e.user, "POST", "/api/nodes", body)
		if rec.Code != 201 {
			t.Fatalf("create: %d %s", rec.Code, rec.Body)
		}
		return jsonBody(t, rec)
	}
	dir := mk(`{"space":"personal","name":"dir"}`)["id"].(string)
	mk(`{"space":"personal","parent_id":"` + dir + `","name":"new"}`)
	n := mk(`{"space":"personal","name":"old"}`)["id"].(string)
	rec := e.do(t, &e.user, "PATCH", "/api/nodes/"+n, `{"name":"new","parent_id":"`+dir+`"}`)
	if rec.Code != 409 {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	rec = e.do(t, &e.user, "GET", "/api/nodes?space=personal", "")
	if !strings.Contains(rec.Body.String(), `"name":"old"`) {
		t.Fatalf("rename leaked: %s", rec.Body)
	}
	// space contradicting the parent's space.
	rec = e.do(t, &e.user, "PATCH", "/api/nodes/"+n, `{"parent_id":"`+dir+`","space":"shared"}`)
	if rec.Code != 400 || jsonBody(t, rec)["error"] != "space_mismatch" {
		t.Fatalf("mismatch: %d %s", rec.Code, rec.Body)
	}
	// Move into dir, then rename + same-space "space" must not jump to root.
	if rec = e.do(t, &e.user, "PATCH", "/api/nodes/"+n, `{"parent_id":"`+dir+`","name":"moved"}`); rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	rec = e.do(t, &e.user, "PATCH", "/api/nodes/"+n, `{"name":"again","space":"personal"}`)
	if rec.Code != 200 || jsonBody(t, rec)["parent_id"] != dir {
		t.Fatalf("space alone moved node: %d %s", rec.Code, rec.Body)
	}
}

func TestMoveIntoPersonalChargesMover(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	ph, _ := auth.HashPassword("password-1")
	b, err := users.Create(ctx, e.db, "b@x.io", ph, "user", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 30, e.user.ID)
	big, _ := e.putFileIn(t, b, nodes.Space{}, "big.txt", make([]byte, 31))
	small, _ := e.putFileIn(t, b, nodes.Space{}, "small.txt", make([]byte, 30))

	// Over the mover's quota: 507 and nothing changes.
	rec := e.do(t, &e.user, "PATCH", "/api/nodes/"+big.ID, `{"parent_id":null,"space":"personal"}`)
	if rec.Code != 507 || jsonBody(t, rec)["error"] != "quota_exceeded" {
		t.Fatalf("over quota: %d %s", rec.Code, rec.Body)
	}
	var up string
	var owner sql.NullString
	e.db.QueryRow(`SELECT uploader,space_owner FROM nodes WHERE id=?`, big.ID).Scan(&up, &owner)
	if up != b.ID || owner.Valid {
		t.Fatalf("big changed: %q %v", up, owner)
	}

	rec = e.do(t, &e.user, "PATCH", "/api/nodes/"+small.ID, `{"parent_id":null,"space":"personal"}`)
	if rec.Code != 200 {
		t.Fatalf("move: %d %s", rec.Code, rec.Body)
	}
	if got := e.usedBy(t, b); got != 31 {
		t.Fatalf("b used %v, want 31", got)
	}
	if got := e.usedBy(t, e.user); got != 30 {
		t.Fatalf("user used %v, want 30", got)
	}
}

func TestListReportsFolderSizes(t *testing.T) {
	e := newEnv(t)
	rec := e.do(t, &e.user, "POST", "/api/nodes", `{"space":"personal","name":"dir"}`)
	dir := jsonBody(t, rec)["id"].(string)
	e.putFileIn(t, e.user, nodes.Personal(e.user.ID), "loose.txt", make([]byte, 5))
	ctx := context.Background()
	// Two files inside dir.
	for i, n := range []int{11, 22} {
		if _, err := e.db.ExecContext(ctx, `INSERT INTO nodes(id,space_owner,uploader,parent_id,name,is_dir,size,mime,created_at,updated_at) VALUES(?,?,?,?,?,0,?,'',1,1)`,
			users.NewID(), e.user.ID, e.user.ID, dir, string(rune('a'+i)), n); err != nil {
			t.Fatal(err)
		}
	}
	rec = e.do(t, &e.user, "GET", "/api/nodes?space=personal", "")
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var list []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	sizes := map[string]float64{}
	for _, n := range list {
		sizes[n["name"].(string)] = n["size"].(float64)
	}
	if sizes["dir"] != 33 || sizes["loose.txt"] != 5 {
		t.Fatalf("sizes %v", sizes)
	}
}
