package httpapi

import (
	"encoding/json"
	"testing"

	"github.com/qarasky/kore/api/internal/nodes"
)

func TestAdminDisk(t *testing.T) {
	e := newEnv(t)
	if rec := e.do(t, nil, "GET", "/api/admin/disk", ""); rec.Code != 401 {
		t.Fatalf("anon: %d", rec.Code)
	}
	if rec := e.do(t, &e.user, "GET", "/api/admin/disk", ""); rec.Code != 403 || jsonBody(t, rec)["error"] != "forbidden" {
		t.Fatalf("user: %d %s", rec.Code, rec.Body)
	}
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1000, e.user.ID)
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 500, e.admin.ID)
	e.putFileIn(t, e.user, nodes.Personal(e.user.ID), "a.bin", make([]byte, 30))
	e.putFileIn(t, e.admin, nodes.Space{}, "b.bin", make([]byte, 12))
	if rec := e.do(t, &e.user, "POST", "/api/uploads", `{"space":"personal","parent":null,"name":"u.bin","size":7,"chunk_size":1048576}`); rec.Code != 201 {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body)
	}

	rec := e.do(t, &e.admin, "GET", "/api/admin/disk", "")
	if rec.Code != 200 {
		t.Fatalf("admin: %d %s", rec.Code, rec.Body)
	}
	b := jsonBody(t, rec)
	total, used, free := b["total_bytes"].(float64), b["used_bytes"].(float64), b["free_bytes"].(float64)
	if total <= 0 || used <= 0 || free <= 0 || used+free > total {
		t.Fatalf("numbers: %v", b)
	}
	if _, ok := b["fs_path_label"].(string); !ok {
		t.Fatalf("label missing: %v", b)
	}
	// kore_used_bytes is the sum of /api/admin/usage (quota definition:
	// files by uploader, trashed included, plus open uploads).
	var rows []struct {
		UsedBytes int64 `json:"used_bytes"`
	}
	urec := e.do(t, &e.admin, "GET", "/api/admin/usage", "")
	if err := json.Unmarshal(urec.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	var sum int64
	for _, r := range rows {
		sum += r.UsedBytes
	}
	if sum != 49 || b["kore_used_bytes"] != float64(sum) {
		t.Fatalf("kore_used %v, usage sum %d", b["kore_used_bytes"], sum)
	}
	if b["quota_allocated_bytes"] != float64(1500) {
		t.Fatalf("quota sum %v", b["quota_allocated_bytes"])
	}
}
