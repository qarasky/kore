package httpapi

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"

	"github.com/qarasky/kore/api/internal/auth"
	"github.com/qarasky/kore/api/internal/nodes"
)

var (
	pngData = append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, bytes.Repeat([]byte{7}, 100)...)
	pdfData = []byte("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n")
)

const (
	imageCSP = "default-src 'none'; sandbox"
	pdfCSP   = "default-src 'none'; object-src 'self'; frame-ancestors 'self'"
)

func TestViewServesVerifiedImagesInline(t *testing.T) {
	e := newEnv(t)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<30, e.user.ID)
	// The stored mime is never trusted: here it claims HTML.
	n := e.putFile(t, e.user, "Фото 1.png", "text/html", pngData)
	rec := e.do(t, &e.user, "GET", "/api/nodes/"+n.ID+"/view", "")
	if rec.Code != 200 || !bytes.Equal(rec.Body.Bytes(), pngData) {
		t.Fatalf("%d %q", rec.Code, rec.Body.Bytes()[:8])
	}
	h := rec.Header()
	want := map[string]string{
		"Content-Type":            "image/png",
		"X-Content-Type-Options":  "nosniff",
		"Cache-Control":           "private, no-store",
		"Content-Security-Policy": imageCSP,
		"Accept-Ranges":           "bytes",
	}
	for k, v := range want {
		if h.Get(k) != v {
			t.Errorf("%s = %q, want %q", k, h.Get(k), v)
		}
	}
	if cd := h.Get("Content-Disposition"); !strings.HasPrefix(cd, `inline; filename="`) || !strings.Contains(cd, "filename*=UTF-8''%D0%A4%D0%BE%D1%82%D0%BE%201.png") {
		t.Errorf("disposition %q", cd)
	}

	// Range requests work and keep the headers.
	rec = e.req(t, &e.user, "GET", "/api/nodes/"+n.ID+"/view", nil, map[string]string{"Range": "bytes=0-7"})
	if rec.Code != 206 || !bytes.Equal(rec.Body.Bytes(), pngData[:8]) || rec.Header().Get("Content-Range") != "bytes 0-7/108" ||
		rec.Header().Get("Content-Type") != "image/png" || rec.Header().Get("Content-Security-Policy") != imageCSP {
		t.Fatalf("range: %d %v", rec.Code, rec.Header())
	}
	// An unsatisfiable range is a JSON error.
	if rec = e.req(t, &e.user, "GET", "/api/nodes/"+n.ID+"/view", nil, map[string]string{"Range": "bytes=5000-"}); rec.Code != 416 || jsonBody(t, rec)["error"] != "range_not_satisfiable" {
		t.Fatalf("416: %d %s", rec.Code, rec.Body)
	}
	// HEAD answers without a body (the web client checks with it).
	if rec = e.do(t, &e.user, "HEAD", "/api/nodes/"+n.ID+"/view", ""); rec.Code != 200 || rec.Body.Len() != 0 || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("head: %d %v", rec.Code, rec.Header())
	}
}

func TestViewPDF(t *testing.T) {
	e := newEnv(t)
	n := e.putFile(t, e.user, "doc.PDF", "application/octet-stream", pdfData)
	rec := e.do(t, &e.user, "GET", "/api/nodes/"+n.ID+"/view", "")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/pdf" || rec.Header().Get("Content-Security-Policy") != pdfCSP ||
		rec.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.HasPrefix(rec.Header().Get("Content-Disposition"), "inline;") {
		t.Fatalf("%d %v", rec.Code, rec.Header())
	}
}

func TestViewRefusesWhatIsNotAVerifiedImageOrPDF(t *testing.T) {
	e := newEnv(t)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<30, e.user.ID)
	html := []byte("<!doctype html><script>alert(document.cookie)</script>")
	for name, data := range map[string][]byte{
		"logo.svg":    []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"fake.png":    html,
		"fake.pdf":    html,
		"late.pdf":    append(append(bytes.Repeat([]byte(" "), 1100), "%PDF-1.4"...), html...),
		"swapped.jpg": pngData,
		"notes.txt":   []byte("hello"),
		"page.html":   pdfData,
		"empty.png":   nil,
	} {
		n := e.putFile(t, e.user, name, "image/png", data)
		rec := e.do(t, &e.user, "GET", "/api/nodes/"+n.ID+"/view", "")
		if rec.Code != 415 || rec.Header().Get("Content-Type") != "application/json" || jsonBody(t, rec)["error"] != "not_previewable" {
			t.Errorf("%s: %d %v %s", name, rec.Code, rec.Header(), rec.Body)
		}
	}
	// SVG still downloads as before.
	svg := e.putFile(t, e.user, "x.svg", "image/svg+xml", []byte("<svg/>"))
	if rec := e.do(t, &e.user, "GET", "/api/nodes/"+svg.ID+"/download", ""); rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatalf("svg download: %d %v", rec.Code, rec.Header())
	}
	// A GIF/script polyglot is served, but only ever as an image that
	// cannot be sniffed into anything else or run as a document.
	poly := e.putFile(t, e.user, "poly.gif", "text/html", []byte("GIF89a=1;alert(document.cookie)//<html><script>alert(1)</script>"))
	rec := e.do(t, &e.user, "GET", "/api/nodes/"+poly.ID+"/view", "")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/gif" || rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("Content-Security-Policy") != imageCSP {
		t.Fatalf("polyglot: %d %v", rec.Code, rec.Header())
	}
}

func TestViewAccess(t *testing.T) {
	e := newEnv(t)
	n := e.putFile(t, e.user, "a.png", "", pngData)
	if rec := e.do(t, nil, "GET", "/api/nodes/"+n.ID+"/view", ""); rec.Code != 401 {
		t.Fatalf("anon %d", rec.Code)
	}
	// Someone else's personal file: 404, admins included.
	if rec := e.do(t, &e.admin, "GET", "/api/nodes/"+n.ID+"/view", ""); rec.Code != 404 || jsonBody(t, rec)["error"] != "not_found" {
		t.Fatalf("admin %d", rec.Code)
	}
	d, _ := nodes.CreateFolder(context.Background(), e.db, e.user, nodes.Personal(e.user.ID), nil, "d.png")
	if rec := e.do(t, &e.user, "GET", "/api/nodes/"+d.ID+"/view", ""); rec.Code != 400 || jsonBody(t, rec)["error"] != "is_directory" {
		t.Fatalf("dir %d %s", rec.Code, rec.Body)
	}
	if err := nodes.Trash(context.Background(), e.db, e.user, n.ID); err != nil {
		t.Fatal(err)
	}
	if rec := e.do(t, &e.user, "GET", "/api/nodes/"+n.ID+"/view", ""); rec.Code != 404 {
		t.Fatalf("trashed %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "GET", "/api/nodes/nope/view", ""); rec.Code != 404 {
		t.Fatalf("missing %d", rec.Code)
	}
}

// A 20 MB image is streamed from the file, not read into memory.
func TestViewStreamsLargeImages(t *testing.T) {
	e := newEnv(t)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<30, e.user.ID)
	big := make([]byte, 20<<20)
	copy(big, pngData)
	n := e.putFile(t, e.user, "big.png", "", big)
	big = nil
	srv := httptest.NewServer(e.h)
	defer srv.Close()
	tok, err := auth.NewSession(context.Background(), e.db, e.user.ID, 3600e9)
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("GET", srv.URL+"/api/nodes/"+n.ID+"/view", nil)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tok})
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.Copy(io.Discard, res.Body)
	res.Body.Close()
	runtime.ReadMemStats(&after)
	if res.StatusCode != 200 || got != 20<<20 {
		t.Fatalf("%d %d", res.StatusCode, got)
	}
	// Client and server share this process; both only use small buffers.
	if alloc := after.TotalAlloc - before.TotalAlloc; alloc > 4<<20 {
		t.Fatalf("allocated %d bytes for a 20 MiB response", alloc)
	}
}

// A PDF opened top-level (a typed URL, a link, "open frame in new tab") is
// downloaded; framed or fetched it stays inline. Images are unaffected.
func TestViewPDFTopLevelIsAttachment(t *testing.T) {
	e := newEnv(t)
	pdf := e.putFile(t, e.user, "Отчёт.pdf", "", pdfData)
	png := e.putFile(t, e.user, "a.png", "", pngData)
	for _, c := range []struct {
		id, dest, want string
	}{
		{pdf.ID, "document", "attachment;"},
		{pdf.ID, "Document", "attachment;"},
		{pdf.ID, "iframe", "inline;"},
		{pdf.ID, "embed", "inline;"},
		{pdf.ID, "object", "inline;"},
		{pdf.ID, "empty", "inline;"},
		{pdf.ID, "", "inline;"},
		{png.ID, "document", "inline;"},
	} {
		hdr := map[string]string{}
		if c.dest != "" {
			hdr["Sec-Fetch-Dest"] = c.dest
		}
		rec := e.req(t, &e.user, "GET", "/api/nodes/"+c.id+"/view", nil, hdr)
		cd := rec.Header().Get("Content-Disposition")
		if rec.Code != 200 || !strings.HasPrefix(cd, c.want) {
			t.Errorf("dest %q: %d %q, want %s", c.dest, rec.Code, cd, c.want)
		}
		if c.id == pdf.ID && !strings.Contains(cd, "filename*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82.pdf") {
			t.Errorf("dest %q: filename* missing: %q", c.dest, cd)
		}
		if vary := rec.Header().Values("Vary"); c.id == pdf.ID && !strings.Contains(strings.Join(vary, ","), "Sec-Fetch-Dest") {
			t.Errorf("dest %q: Vary %v", c.dest, vary)
		}
	}
}
