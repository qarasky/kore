package httpapi

import (
	"bytes"
	"strings"
	"testing"
)

func TestTrashHTTPFlow(t *testing.T) {
	e := newEnv(t)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<20, e.user.ID)
	mk := func(body string) string {
		rec := e.do(t, &e.user, "POST", "/api/nodes", body)
		if rec.Code != 201 {
			t.Fatalf("create: %d %s", rec.Code, rec.Body)
		}
		return jsonBody(t, rec)["id"].(string)
	}
	dir := mk(`{"space":"personal","name":"dir"}`)
	sub := mk(`{"space":"personal","parent_id":"` + dir + `","name":"sub"}`)
	if rec := e.do(t, nil, "DELETE", "/api/nodes/"+dir, ""); rec.Code != 401 {
		t.Fatalf("anon: %d", rec.Code)
	}
	if rec := e.do(t, &e.admin, "DELETE", "/api/nodes/"+dir, ""); rec.Code != 404 {
		t.Fatalf("admin on personal: %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "DELETE", "/api/nodes/"+dir, ""); rec.Code != 204 {
		t.Fatalf("trash: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do(t, &e.user, "DELETE", "/api/nodes/"+dir, ""); rec.Code != 404 {
		t.Fatalf("retrash: %d", rec.Code)
	}
	// Descendants are 404 for every access path.
	for _, c := range [][3]string{
		{"PATCH", "/api/nodes/" + sub, `{"name":"z"}`},
		{"PATCH", "/api/nodes/" + sub, `{"parent_id":null}`},
		{"GET", "/api/nodes/" + sub + "/path", ""},
		{"GET", "/api/nodes/" + sub + "/download", ""},
		{"POST", "/api/nodes", `{"space":"personal","parent_id":"` + sub + `","name":"n"}`},
		{"POST", "/api/uploads", `{"space":"personal","parent":"` + sub + `","name":"n","size":1,"chunk_size":1048576}`},
		{"DELETE", "/api/trash/" + sub, ""},
		{"POST", "/api/nodes/" + sub + "/restore", ""},
	} {
		if rec := e.do(t, &e.user, c[0], c[1], c[2]); rec.Code != 404 {
			t.Fatalf("%s %s: %d %s", c[0], c[1], rec.Code, rec.Body)
		}
	}
	rec := e.do(t, &e.user, "GET", "/api/trash?space=personal", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"id":"`+dir+`"`) || strings.Contains(rec.Body.String(), sub) || !strings.Contains(rec.Body.String(), `"trashed_at"`) {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do(t, &e.user, "GET", "/api/trash?space=bogus", ""); rec.Code != 400 {
		t.Fatalf("bad space: %d", rec.Code)
	}
	if rec := e.do(t, &e.admin, "GET", "/api/trash?space=personal", ""); rec.Code != 200 || strings.Contains(rec.Body.String(), dir) {
		t.Fatalf("admin sees own trash only: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do(t, &e.user, "POST", "/api/nodes/"+dir+"/restore", ""); rec.Code != 200 || jsonBody(t, rec)["id"] != dir {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do(t, &e.user, "DELETE", "/api/trash/"+dir, ""); rec.Code != 404 {
		t.Fatalf("purge live: %d", rec.Code)
	}
	e.do(t, &e.user, "DELETE", "/api/nodes/"+dir, "")
	if rec := e.do(t, &e.user, "DELETE", "/api/trash/"+dir, ""); rec.Code != 204 {
		t.Fatalf("purge: %d", rec.Code)
	}
	e.do(t, &e.user, "DELETE", "/api/nodes/"+mk(`{"space":"personal","name":"again"}`), "")
	if rec := e.do(t, &e.user, "DELETE", "/api/trash?space=bogus", ""); rec.Code != 400 {
		t.Fatalf("bad space: %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "DELETE", "/api/trash?space=personal", ""); rec.Code != 204 {
		t.Fatalf("empty: %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "GET", "/api/trash?space=personal", ""); strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("not empty: %s", rec.Body)
	}
}

func TestTrashAtFullQuotaThenUploadAfterEmpty(t *testing.T) {
	e := newEnv(t)
	data := bytes.Repeat([]byte("x"), 100)
	e.db.Exec(`UPDATE users SET quota_bytes=100 WHERE id=?`, e.user.ID)
	upload := func(name string) (string, int) {
		rec := e.do(t, &e.user, "POST", "/api/uploads", `{"space":"personal","parent":null,"name":"`+name+`","size":100,"chunk_size":1048576}`)
		if rec.Code != 201 {
			return "", rec.Code
		}
		id := jsonBody(t, rec)["id"].(string)
		if rec := e.req(t, &e.user, "PATCH", "/api/uploads/"+id, data, map[string]string{"Upload-Offset": "0"}); rec.Code >= 300 {
			t.Fatalf("patch: %d %s", rec.Code, rec.Body)
		}
		rec = e.do(t, &e.user, "POST", "/api/uploads/"+id+"/complete", "")
		if rec.Code != 200 && rec.Code != 201 {
			t.Fatalf("complete: %d %s", rec.Code, rec.Body)
		}
		return jsonBody(t, rec)["id"].(string), 201
	}
	id, code := upload("big.bin")
	if code != 201 {
		t.Fatalf("first upload: %d", code)
	}
	if _, code := upload("two.bin"); code != 507 {
		t.Fatalf("expected 507 at 100%%: %d", code)
	}
	if rec := e.do(t, &e.user, "DELETE", "/api/nodes/"+id, ""); rec.Code != 204 {
		t.Fatalf("trash at 100%%: %d %s", rec.Code, rec.Body)
	}
	if _, code := upload("two.bin"); code != 507 {
		t.Fatalf("trash still counts: %d", code)
	}
	if rec := e.do(t, &e.user, "POST", "/api/nodes/"+id+"/restore", ""); rec.Code != 200 {
		t.Fatalf("restore at 100%%: %d %s", rec.Code, rec.Body)
	}
	e.do(t, &e.user, "DELETE", "/api/nodes/"+id, "")
	if rec := e.do(t, &e.user, "DELETE", "/api/trash/"+id, ""); rec.Code != 204 {
		t.Fatalf("purge at 100%%: %d", rec.Code)
	}
	id2, code := upload("three.bin")
	if code != 201 {
		t.Fatalf("upload after purge: %d", code)
	}
	e.do(t, &e.user, "DELETE", "/api/nodes/"+id2, "")
	if rec := e.do(t, &e.user, "DELETE", "/api/trash?space=personal", ""); rec.Code != 204 {
		t.Fatalf("empty at 100%%: %d", rec.Code)
	}
	if _, code := upload("four.bin"); code != 201 {
		t.Fatalf("upload after empty: %d", code)
	}
}
