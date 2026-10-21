package httpapi

import (
	"archive/zip"
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/artchsh/kore/api/internal/auth"
)

func TestTransferRoutes(t *testing.T) {
	e := newEnv(t)
	if rec := e.do(t, nil, "GET", "/api/nodes/x/download", ""); rec.Code != 401 {
		t.Fatalf("anon dl: %d", rec.Code)
	}
	if rec := e.do(t, nil, "POST", "/api/download/zip", `{"ids":["a"]}`); rec.Code != 401 {
		t.Fatalf("anon zip: %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "GET", "/api/nodes/nope/download", ""); rec.Code != 404 {
		t.Fatalf("missing: %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "POST", "/api/download/zip", `{"ids":[]}`); rec.Code != 400 {
		t.Fatalf("empty: %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "POST", "/api/download/zip", `{"ids":["nope"]}`); rec.Code != 404 {
		t.Fatalf("zip missing: %d", rec.Code)
	}
}

func TestZipAcceptsFormPost(t *testing.T) {
	e := newEnv(t)
	a := e.putFile(t, e.user, "a.txt", "text/plain", []byte("aaa"))
	b := e.putFile(t, e.user, "b.txt", "text/plain", []byte("bb"))
	form := func(body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("POST", "/api/download/zip", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		tok, err := auth.NewSession(t.Context(), e.db, e.user.ID, 3600e9)
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tok})
		out := httptest.NewRecorder()
		e.h.ServeHTTP(out, req)
		return out
	}
	rec := form(url.Values{"ids": {a.ID, b.ID}}.Encode())
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/zip" ||
		!strings.HasPrefix(rec.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatalf("zip: %d %v %s", rec.Code, rec.Header(), rec.Body)
	}
	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	if strings.Join(names, ",") != "a.txt,b.txt" {
		t.Fatalf("entries: %v", names)
	}
	if rec := form(""); rec.Code != 400 {
		t.Fatalf("no ids: %d", rec.Code)
	}
	if rec := form("ids=nope"); rec.Code != 404 {
		t.Fatalf("missing: %d", rec.Code)
	}
	if rec := form("ids=%zz"); rec.Code != 400 {
		t.Fatalf("malformed: %d", rec.Code)
	}
}
