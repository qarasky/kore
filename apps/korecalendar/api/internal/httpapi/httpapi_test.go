package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testutil"
)

func TestHealthz(t *testing.T) {
	h := New(testutil.NewDB(t), t.TempDir())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/healthz", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != `{"ok":true}` {
		t.Fatalf("body %q", got)
	}
}

func TestErrJSONShape(t *testing.T) {
	rec := httptest.NewRecorder()
	errJSON(rec, 404, "not_found", "no such thing")
	if rec.Code != 404 || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("status %d type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	want := `{"error":{"code":"not_found","message":"no such thing"}}`
	if got := strings.TrimSpace(rec.Body.String()); got != want {
		t.Fatalf("body %q, want %q", got, want)
	}
}
