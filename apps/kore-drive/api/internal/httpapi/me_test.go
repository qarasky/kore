package httpapi

import "testing"

func TestMyUsage(t *testing.T) {
	e := newEnv(t)
	if rec := e.do(t, nil, "GET", "/api/me/usage", ""); rec.Code != 401 {
		t.Fatalf("anon: %d", rec.Code)
	}
	check := func(wantUsed, wantQuota float64) {
		t.Helper()
		rec := e.do(t, &e.user, "GET", "/api/me/usage", "")
		if rec.Code != 200 {
			t.Fatalf("usage: %d %s", rec.Code, rec.Body)
		}
		b := jsonBody(t, rec)
		if b["used_bytes"] != wantUsed || b["quota_bytes"] != wantQuota {
			t.Fatalf("usage: %v, want used=%v quota=%v", b, wantUsed, wantQuota)
		}
	}
	check(0, 100)

	f := e.putFile(t, e.user, "a.bin", "", make([]byte, 30))
	e.putFile(t, e.admin, "other.bin", "", make([]byte, 50)) // someone else's
	check(30, 100)

	// Trashed files still count until purged.
	if rec := e.do(t, &e.user, "DELETE", "/api/nodes/"+f.ID, ""); rec.Code != 204 {
		t.Fatalf("trash: %d", rec.Code)
	}
	check(30, 100)

	// Open uploads count at their declared size.
	if rec := e.do(t, &e.user, "POST", "/api/uploads", `{"space":"personal","parent":null,"name":"u.bin","size":20,"chunk_size":1048576}`); rec.Code != 201 {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body)
	}
	check(50, 100)

	// The quota is read fresh, not from a stale session snapshot.
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1<<20, e.user.ID)
	check(50, 1<<20)
}

func TestMySettings(t *testing.T) {
	e := newEnv(t)
	if rec := e.do(t, nil, "GET", "/api/me/settings", ""); rec.Code != 401 {
		t.Fatalf("anon: %d", rec.Code)
	}
	get := func() map[string]any {
		t.Helper()
		rec := e.do(t, &e.user, "GET", "/api/me/settings", "")
		if rec.Code != 200 {
			t.Fatalf("settings: %d %s", rec.Code, rec.Body)
		}
		return jsonBody(t, rec)
	}
	b := get()
	if b["trash_retention_days"] != float64(30) || b["share_links_enabled"] != true ||
		b["share_default_expiry_days"] != float64(7) || len(b) != 3 {
		t.Fatalf("default: %v", b)
	}
	if rec := e.do(t, &e.admin, "PATCH", "/api/admin/settings", `{"trash_retention_days":7}`); rec.Code != 200 {
		t.Fatalf("patch: %d %s", rec.Code, rec.Body)
	}
	if b := get(); b["trash_retention_days"] != float64(7) {
		t.Fatalf("after patch: %v", b)
	}
}
