package transfer

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/artchsh/kore/api/internal/nodes"
)

func TestUnsatisfiableRangeIsJSON(t *testing.T) {
	e := setup(t)
	f := e.file(t, e.a, nodes.Personal(e.a.ID), nil, "n.txt", "text/plain", []byte("0123456789"))
	rec := e.dl(e.a, f.ID, map[string]string{"Range": "bytes=50-60"})
	if rec.Code != 416 {
		t.Fatalf("code %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type %q body %q", ct, rec.Body)
	}
	var m map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil || m["error"] != "range_not_satisfiable" {
		t.Fatalf("body %q: %v", rec.Body, err)
	}
	if cr := rec.Header().Get("Content-Range"); cr != "bytes */10" {
		t.Fatalf("content-range %q", cr)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd != "" {
		t.Fatalf("error kept content-disposition %q", cd)
	}
}

func TestPreconditionFailedIsJSON(t *testing.T) {
	e := setup(t)
	f := e.file(t, e.a, nodes.Personal(e.a.ID), nil, "n.txt", "text/plain", []byte("0123456789"))
	past := time.Unix(1, 0).UTC().Format("Mon, 02 Jan 2006 15:04:05 GMT")
	rec := e.dl(e.a, f.ID, map[string]string{"If-Unmodified-Since": past})
	if rec.Code != 412 || rec.Header().Get("Content-Type") != "application/json" ||
		!strings.Contains(rec.Body.String(), `"precondition_failed"`) {
		t.Fatalf("%d %v %q", rec.Code, rec.Header(), rec.Body)
	}
}

func TestDownloadsAreNotCached(t *testing.T) {
	e := setup(t)
	f := e.file(t, e.a, nodes.Personal(e.a.ID), nil, "n.txt", "text/plain", []byte("0123456789"))
	for _, hdr := range []map[string]string{nil, {"Range": "bytes=1-2"}} {
		rec := e.dl(e.a, f.ID, hdr)
		if rec.Code != 200 && rec.Code != 206 {
			t.Fatalf("code %d", rec.Code)
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "private, no-store" {
			t.Fatalf("download cache-control %q", cc)
		}
	}
	if rec := e.dl(e.a, f.ID, map[string]string{"Range": "bytes=1-2"}); rec.Body.String() != "12" {
		t.Fatalf("range body %q", rec.Body)
	}
	rec := e.zip(e.a, f.ID)
	if rec.Code != 200 || rec.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("zip %d cache-control %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
}
