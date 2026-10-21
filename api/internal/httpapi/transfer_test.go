package httpapi

import "testing"

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
