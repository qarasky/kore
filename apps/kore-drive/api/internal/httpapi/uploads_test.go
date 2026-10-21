package httpapi

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/users"
)

func (e *env) req(t *testing.T, as *users.User, method, path string, body []byte, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	for k, v := range hdr {
		req.Header.Set(k, v)
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

func TestUploadHTTPFlow(t *testing.T) {
	e := newEnv(t)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<20, e.user.ID)
	data := bytes.Repeat([]byte("0123456789abcdef"), 200) // 3200 bytes
	rec := e.do(t, &e.user, "POST", "/api/uploads", `{"space":"personal","parent":null,"name":"notes.txt","size":3200,"chunk_size":2048}`)
	if rec.Code != 201 {
		t.Fatalf("create %d %s", rec.Code, rec.Body)
	}
	m := jsonBody(t, rec)
	id, _ := m["id"].(string)
	if id == "" || m["received_bytes"].(float64) != 0 {
		t.Fatalf("create body %v", m)
	}
	base := "/api/uploads/" + id

	// Wrong offset: 409 with the correct offset.
	rec = e.req(t, &e.user, "PATCH", base, data[:10], map[string]string{"Upload-Offset": "7"})
	if rec.Code != 409 || rec.Header().Get("Upload-Offset") != "0" {
		t.Fatalf("wrong offset %d %q", rec.Code, rec.Header().Get("Upload-Offset"))
	}
	// Missing/invalid offset header.
	if rec := e.req(t, &e.user, "PATCH", base, data[:10], nil); rec.Code != 400 {
		t.Fatalf("missing offset %d", rec.Code)
	}
	// Body bigger than chunk_size.
	if rec := e.req(t, &e.user, "PATCH", base, data[:2049], map[string]string{"Upload-Offset": "0"}); rec.Code != 413 {
		t.Fatalf("oversized chunk %d", rec.Code)
	}
	rec = e.req(t, &e.user, "PATCH", base, data[:2048], map[string]string{"Upload-Offset": "0"})
	if rec.Code != 204 || rec.Header().Get("Upload-Offset") != "2048" {
		t.Fatalf("patch %d %q %s", rec.Code, rec.Header().Get("Upload-Offset"), rec.Body)
	}
	rec = e.req(t, &e.user, "HEAD", base, nil, nil)
	if rec.Code != 200 || rec.Header().Get("Upload-Offset") != "2048" || rec.Header().Get("Upload-Length") != "3200" {
		t.Fatalf("head %d %v", rec.Code, rec.Header())
	}
	// Not done yet.
	if rec := e.do(t, &e.user, "POST", base+"/complete", ``); rec.Code != 409 {
		t.Fatalf("early complete %d", rec.Code)
	}
	// Another user cannot see or use the upload.
	for _, r := range []struct{ m, p string }{{"HEAD", base}, {"PATCH", base}, {"POST", base + "/complete"}, {"DELETE", base}} {
		if rec := e.req(t, &e.admin, r.m, r.p, nil, map[string]string{"Upload-Offset": "2048"}); rec.Code != 404 {
			t.Fatalf("other user %s: %d", r.m, rec.Code)
		}
	}
	if rec := e.req(t, nil, "PATCH", base, nil, map[string]string{"Upload-Offset": "2048"}); rec.Code != 401 {
		t.Fatalf("anon %d", rec.Code)
	}
	rec = e.req(t, &e.user, "PATCH", base, data[2048:], map[string]string{"Upload-Offset": "2048"})
	if rec.Code != 204 || rec.Header().Get("Upload-Offset") != strconv.Itoa(len(data)) {
		t.Fatalf("patch 2 %d %s", rec.Code, rec.Body)
	}
	rec = e.do(t, &e.user, "POST", base+"/complete", ``)
	if rec.Code != 201 {
		t.Fatalf("complete %d %s", rec.Code, rec.Body)
	}
	n := jsonBody(t, rec)
	if n["name"] != "notes.txt" || n["size"].(float64) != 3200 || n["mime"] != "text/plain; charset=utf-8" || n["space"] != "personal" {
		t.Fatalf("node %v", n)
	}
	if rec := e.req(t, &e.user, "HEAD", base, nil, nil); rec.Code != 404 {
		t.Fatalf("head after complete %d", rec.Code)
	}
}

func TestUploadHTTPLimits(t *testing.T) {
	e := newEnv(t) // user quota: 100 bytes
	if rec := e.do(t, &e.user, "POST", "/api/uploads", `{"space":"personal","name":"a","size":101,"chunk_size":1024}`); rec.Code != 507 {
		t.Fatalf("quota %d %s", rec.Code, rec.Body)
	}
	e.do(t, &e.admin, "PATCH", "/api/admin/settings", `{"max_file_bytes":50}`)
	if rec := e.do(t, &e.user, "POST", "/api/uploads", `{"space":"personal","name":"a","size":51,"chunk_size":1024}`); rec.Code != 413 {
		t.Fatalf("max size %d %s", rec.Code, rec.Body)
	}
	for _, body := range []string{
		`{"space":"personal","name":"a","size":-1,"chunk_size":1024}`,
		`{"space":"personal","name":"a","size":1,"chunk_size":10}`,
		`{"space":"personal","name":"a/b","size":1,"chunk_size":1024}`,
		`{"space":"nope","name":"a","size":1,"chunk_size":1024}`,
	} {
		if rec := e.do(t, &e.user, "POST", "/api/uploads", body); rec.Code != 400 {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
	if rec := e.do(t, &e.user, "POST", "/api/uploads", `{"space":"personal","parent":"missing","name":"a","size":1,"chunk_size":1024}`); rec.Code != 404 {
		t.Fatalf("missing parent %d", rec.Code)
	}
	rec := e.do(t, &e.user, "POST", "/api/uploads", `{"space":"shared","name":"a","size":10,"chunk_size":1024}`)
	if rec.Code != 201 {
		t.Fatalf("create %d %s", rec.Code, rec.Body)
	}
	id := jsonBody(t, rec)["id"].(string)
	if rec := e.req(t, &e.user, "PATCH", "/api/uploads/"+id, bytes.Repeat([]byte("x"), 11), map[string]string{"Upload-Offset": "0"}); rec.Code != 413 {
		t.Fatalf("past size %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "DELETE", "/api/uploads/"+id, ``); rec.Code != 204 {
		t.Fatalf("cancel %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "DELETE", "/api/uploads/"+id, ``); rec.Code != 404 {
		t.Fatalf("cancel twice %d", rec.Code)
	}
}

// A chunk whose body stalls must not hold the upload's lock forever: after
// chunkIdleTimeout the read fails, the lock is released and a retry of the
// same offset succeeds.
func TestStalledChunkReleasesLock(t *testing.T) {
	old := chunkIdleTimeout
	chunkIdleTimeout = 300 * time.Millisecond
	t.Cleanup(func() { chunkIdleTimeout = old })

	e := newEnv(t)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<20, e.user.ID)
	rec := e.do(t, &e.user, "POST", "/api/uploads", `{"space":"personal","parent":null,"name":"s.bin","size":2048,"chunk_size":2048}`)
	if rec.Code != 201 {
		t.Fatalf("create %d %s", rec.Code, rec.Body)
	}
	id := jsonBody(t, rec)["id"].(string)
	srv := httptest.NewServer(e.h)
	t.Cleanup(srv.Close)
	tok, err := auth.NewSession(context.Background(), e.db, e.user.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	// A client that announces 2048 bytes, sends 10 and then goes silent.
	conn, err := net.Dial("tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	fmt.Fprintf(conn, "PATCH /api/uploads/%s HTTP/1.1\r\nHost: x\r\nCookie: %s=%s\r\nUpload-Offset: 0\r\nContent-Length: 2048\r\n\r\n0123456789",
		id, auth.CookieName, tok)

	patch := func(body []byte) *http.Response {
		req, _ := http.NewRequest("PATCH", srv.URL+"/api/uploads/"+id, bytes.NewReader(body))
		req.Header.Set("Upload-Offset", "0")
		req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tok})
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res
	}
	// While the stalled request holds the lock, a retry is busy.
	time.Sleep(100 * time.Millisecond)
	if res := patch(bytes.Repeat([]byte("a"), 2048)); res.StatusCode != 423 {
		t.Fatalf("retry during stall: %d, want 423", res.StatusCode)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		res := patch(bytes.Repeat([]byte("a"), 2048))
		if res.StatusCode == 204 {
			if got := res.Header.Get("Upload-Offset"); got != "2048" {
				t.Fatalf("offset %q", got)
			}
			break
		}
		if res.StatusCode != 423 || time.Now().After(deadline) {
			t.Fatalf("retry after stall: %d", res.StatusCode)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
