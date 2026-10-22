package httpapi

import (
	"encoding/json"
	"testing"

	"github.com/qarasky/kore/api/internal/nodes"
)

func TestMyUsageBreakdown(t *testing.T) {
	e := newEnv(t)
	if rec := e.do(t, nil, "GET", "/api/me/usage/breakdown", ""); rec.Code != 401 {
		t.Fatalf("anon: %d", rec.Code)
	}
	e.db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, 1000, e.user.ID)
	img, _ := e.putFileIn(t, e.user, nodes.Personal(e.user.ID), "a.png", make([]byte, 40))
	e.putFileIn(t, e.user, nodes.Space{}, "b.mp4", make([]byte, 60))
	gone, _ := e.putFileIn(t, e.user, nodes.Personal(e.user.ID), "c.zip", make([]byte, 20))
	e.do(t, &e.user, "DELETE", "/api/nodes/"+gone.ID, "")
	e.putFileIn(t, e.admin, nodes.Space{}, "other.pdf", make([]byte, 99))
	sharedGone, _ := e.putFileIn(t, e.user, nodes.Space{}, "team.zip", make([]byte, 8))
	e.do(t, &e.user, "DELETE", "/api/nodes/"+sharedGone.ID, "")
	if rec := e.do(t, &e.user, "POST", "/api/uploads", `{"space":"personal","parent":null,"name":"u.bin","size":5,"chunk_size":1048576}`); rec.Code != 201 {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body)
	}
	rec := e.do(t, &e.user, "GET", "/api/me/usage/breakdown", "")
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var b struct {
		UsedBytes      int64 `json:"used_bytes"`
		QuotaBytes     int64 `json:"quota_bytes"`
		UploadingBytes int64 `json:"uploading_bytes"`
		TrashBytes     int64 `json:"trash_bytes"`
		TrashPersonal  int64 `json:"trash_personal_bytes"`
		TrashShared    int64 `json:"trash_shared_bytes"`
		Categories     []struct {
			Key   string `json:"key"`
			Bytes int64  `json:"bytes"`
			Count int64  `json:"count"`
		} `json:"categories"`
		Largest []struct {
			ID       string  `json:"id"`
			Name     string  `json:"name"`
			Size     int64   `json:"size"`
			Space    string  `json:"space"`
			ParentID *string `json:"parent_id"`
		} `json:"largest"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	if b.UsedBytes != 133 || b.UsedBytes != int64(e.usedBy(t, e.user)) || b.QuotaBytes != 1000 || b.UploadingBytes != 5 ||
		b.TrashBytes != 28 || b.TrashPersonal != 20 || b.TrashShared != 8 {
		t.Fatalf("%+v", b)
	}
	if len(b.Categories) != 3 || b.Categories[0].Key != "video" || b.Categories[1].Key != "images" || b.Categories[2].Key != "archives" || b.Categories[2].Bytes != 28 {
		t.Fatalf("categories %+v", b.Categories)
	}
	if len(b.Largest) != 2 || b.Largest[0].Name != "b.mp4" || b.Largest[0].Space != "shared" || b.Largest[1].ID != img.ID || b.Largest[1].Space != "personal" {
		t.Fatalf("largest %+v", b.Largest)
	}
}
