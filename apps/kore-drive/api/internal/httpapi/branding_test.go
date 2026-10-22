package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/settings"
	"github.com/artchsh/kore/api/internal/users"
)

var (
	pngBytes  = append([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), bytes.Repeat([]byte{1}, 64)...)
	jpegBytes = append([]byte("\xff\xd8\xff\xe0\x00\x10JFIF\x00"), bytes.Repeat([]byte{2}, 64)...)
	webpBytes = append([]byte("RIFF\x24\x00\x00\x00WEBPVP8 "), bytes.Repeat([]byte{3}, 64)...)
)

// upload posts a multipart body with one file part (field name and file name given).
func (e *env) upload(t *testing.T, as *users.User, field, filename string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile(field, filename)
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(data)
	mw.Close()
	req := httptest.NewRequest("POST", "/api/admin/branding/login-image", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
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

type brandingView struct {
	LoginImage bool  `json:"login_image"`
	Version    int64 `json:"version"`
}

func getBranding(t *testing.T, e *env) brandingView {
	t.Helper()
	rec := e.do(t, nil, "GET", "/api/branding", "")
	if rec.Code != 200 {
		t.Fatalf("GET /api/branding: %d %s", rec.Code, rec.Body)
	}
	var b brandingView
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	return b
}

func imagePath(e *env) string { return filepath.Join(e.dataDir, "branding", "login-image") }

func TestSniffImage(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"png", pngBytes, "image/png"},
		{"jpeg", jpegBytes, "image/jpeg"},
		{"webp", webpBytes, "image/webp"},
		{"svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), ""},
		{"html", []byte(`<!doctype html><script>alert(1)</script>`), ""},
		{"gif", []byte("GIF89a\x01\x00\x01\x00"), ""},
		{"riff not webp", []byte("RIFF\x24\x00\x00\x00WAVEfmt "), ""},
		{"short png prefix", []byte("\x89PN"), ""},
		{"empty", nil, ""},
	}
	for _, c := range cases {
		if got := sniffImage(c.data); got != c.want {
			t.Errorf("%s: sniffImage = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestBrandingAdminOnly(t *testing.T) {
	e := newEnv(t)
	if rec := e.upload(t, &e.user, "file", "a.png", pngBytes); rec.Code != 403 || jsonBody(t, rec)["error"] != "forbidden" {
		t.Errorf("user upload: %d %s", rec.Code, rec.Body)
	}
	if rec := e.upload(t, nil, "file", "a.png", pngBytes); rec.Code != 401 {
		t.Errorf("anon upload: %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "DELETE", "/api/admin/branding/login-image", ""); rec.Code != 403 {
		t.Errorf("user delete: %d", rec.Code)
	}
	if rec := e.do(t, nil, "DELETE", "/api/admin/branding/login-image", ""); rec.Code != 401 {
		t.Errorf("anon delete: %d", rec.Code)
	}
	if _, err := os.Stat(imagePath(e)); !os.IsNotExist(err) {
		t.Errorf("image written by a non-admin: %v", err)
	}
}

func TestBrandingRejectsNonImages(t *testing.T) {
	e := newEnv(t)
	for name, data := range map[string][]byte{
		"evil.png":  []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`),
		"page.png":  []byte(`<html><body>hi</body></html>`),
		"anim.gif":  []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00"),
		"empty.png": {},
	} {
		rec := e.upload(t, &e.admin, "file", name, data)
		if rec.Code != 415 || jsonBody(t, rec)["error"] != "unsupported_image" {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
	if b := getBranding(t, e); b.LoginImage {
		t.Error("a rejected upload set the login image")
	}
	entries, _ := os.ReadDir(filepath.Join(e.dataDir, "branding"))
	if len(entries) != 0 {
		t.Errorf("temp files left behind: %v", entries)
	}
}

func TestBrandingBadRequest(t *testing.T) {
	e := newEnv(t)
	if rec := e.upload(t, &e.admin, "other", "a.png", pngBytes); rec.Code != 400 || jsonBody(t, rec)["error"] != "bad_request" {
		t.Errorf("wrong field: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do(t, &e.admin, "POST", "/api/admin/branding/login-image", `{}`); rec.Code != 400 {
		t.Errorf("not multipart: %d %s", rec.Code, rec.Body)
	}
}

func TestBrandingOversize(t *testing.T) {
	e := newEnv(t)
	big := append(append([]byte{}, pngBytes...), make([]byte, maxLoginImageBytes)...)
	rec := e.upload(t, &e.admin, "file", "big.png", big)
	if rec.Code != 413 || jsonBody(t, rec)["error"] != "too_large" {
		t.Errorf("oversize: %d %s", rec.Code, rec.Body)
	}
	if b := getBranding(t, e); b.LoginImage {
		t.Error("oversize upload set the login image")
	}
	// Exactly at the cap is fine.
	ok := append(append([]byte{}, pngBytes...), make([]byte, maxLoginImageBytes-len(pngBytes))...)
	if rec := e.upload(t, &e.admin, "file", "max.png", ok); rec.Code != 200 {
		t.Errorf("at cap: %d %s", rec.Code, rec.Body)
	}
}

func TestBrandingUploadServeReplaceReset(t *testing.T) {
	e := newEnv(t)
	if b := getBranding(t, e); b.LoginImage {
		t.Fatal("fresh instance has a login image")
	}
	rec := e.do(t, nil, "GET", "/api/branding/login-image", "")
	if rec.Code != 404 || jsonBody(t, rec)["error"] != "not_found" {
		t.Fatalf("no image: %d %s", rec.Code, rec.Body)
	}

	// The client file name never reaches the filesystem.
	rec = e.upload(t, &e.admin, "file", "../../escape.png", pngBytes)
	if rec.Code != 200 {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body)
	}
	b1 := getBranding(t, e)
	if !b1.LoginImage || b1.Version <= 0 {
		t.Fatalf("after upload: %+v", b1)
	}
	if _, err := os.Stat(filepath.Join(e.dataDir, "..", "escape.png")); !os.IsNotExist(err) {
		t.Error("client file name used as a path")
	}
	if got, _ := settings.Get(context.Background(), e.db, settings.KeyLoginImageType); got != "image/png" {
		t.Errorf("stored type %q", got)
	}

	// Public GET, no session.
	rec = e.do(t, nil, "GET", "/api/branding/login-image?v=1", "")
	if rec.Code != 200 || !bytes.Equal(rec.Body.Bytes(), pngBytes) {
		t.Fatalf("serve: %d (%d bytes)", rec.Code, rec.Body.Len())
	}
	h := rec.Header()
	for k, want := range map[string]string{
		"Content-Type":            "image/png",
		"X-Content-Type-Options":  "nosniff",
		"Content-Security-Policy": "default-src 'none'; sandbox",
		"Cache-Control":           "public, max-age=3600",
	} {
		if h.Get(k) != want {
			t.Errorf("%s = %q, want %q", k, h.Get(k), want)
		}
	}
	etag := h.Get("ETag")
	if etag == "" {
		t.Error("no ETag")
	}
	req := httptest.NewRequest("GET", "/api/branding/login-image", nil)
	req.Header.Set("If-None-Match", etag)
	rec = httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if rec.Code != 304 {
		t.Errorf("If-None-Match: %d", rec.Code)
	}

	// Replace with a JPEG: atomic rename over the old file, new type and version.
	if rec := e.upload(t, &e.admin, "file", "b.jpg", jpegBytes); rec.Code != 200 {
		t.Fatalf("replace: %d %s", rec.Code, rec.Body)
	}
	b2 := getBranding(t, e)
	if !b2.LoginImage || b2.Version <= b1.Version {
		t.Errorf("version did not advance: %d -> %d", b1.Version, b2.Version)
	}
	rec = e.do(t, nil, "GET", "/api/branding/login-image", "")
	if rec.Header().Get("Content-Type") != "image/jpeg" || !bytes.Equal(rec.Body.Bytes(), jpegBytes) {
		t.Errorf("after replace: %q %d bytes", rec.Header().Get("Content-Type"), rec.Body.Len())
	}
	if rec.Header().Get("ETag") == etag {
		t.Error("ETag unchanged after replace")
	}
	entries, _ := os.ReadDir(filepath.Join(e.dataDir, "branding"))
	if len(entries) != 1 || entries[0].Name() != "login-image" {
		t.Errorf("branding dir: %v", entries)
	}

	// Reset.
	if rec := e.do(t, &e.admin, "DELETE", "/api/admin/branding/login-image", ""); rec.Code != 200 {
		t.Fatalf("reset: %d %s", rec.Code, rec.Body)
	}
	b3 := getBranding(t, e)
	if b3.LoginImage || b3.Version <= b2.Version {
		t.Errorf("after reset: %+v (before %+v)", b3, b2)
	}
	if _, err := os.Stat(imagePath(e)); !os.IsNotExist(err) {
		t.Errorf("file not removed: %v", err)
	}
	if _, ok := settings.Get(context.Background(), e.db, settings.KeyLoginImageType); ok {
		t.Error("type setting not removed")
	}
	rec = e.do(t, nil, "GET", "/api/branding/login-image", "")
	if rec.Code != 404 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
		t.Errorf("after reset GET: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	// Reset again is harmless.
	if rec := e.do(t, &e.admin, "DELETE", "/api/admin/branding/login-image", ""); rec.Code != 200 {
		t.Errorf("second reset: %d", rec.Code)
	}
}

func TestBrandingWebp(t *testing.T) {
	e := newEnv(t)
	if rec := e.upload(t, &e.admin, "file", "c.webp", webpBytes); rec.Code != 200 {
		t.Fatalf("webp: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do(t, nil, "GET", "/api/branding/login-image", ""); rec.Header().Get("Content-Type") != "image/webp" {
		t.Errorf("webp type %q", rec.Header().Get("Content-Type"))
	}
}
