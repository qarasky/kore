package quota

import (
	"context"
	"testing"
)

func addNamed(t *testing.T, d db, id, uploader string, owner any, name string, size int64, trashed, trashRoot any) {
	t.Helper()
	if _, err := d.Exec(`INSERT INTO nodes(id,space_owner,uploader,name,is_dir,size,mime,trashed_at,trash_root,created_at,updated_at) VALUES(?,?,?,?,0,?,'',?,?,0,0)`,
		id, owner, uploader, name, size, trashed, trashRoot); err != nil {
		t.Fatal(err)
	}
}

func TestBreakdown(t *testing.T) {
	d := setup(t, 10_000)
	ctx := context.Background()
	addNamed(t, d, "p1", "u1", "u1", "a.JPG", 100, nil, nil)
	addNamed(t, d, "p2", "u1", "u1", "b.png", 50, nil, nil)
	addNamed(t, d, "s1", "u1", nil, "clip.mp4", 400, nil, nil)           // shared upload counts
	addNamed(t, d, "t1", "u1", "u1", "old.zip", 70, 123, nil)            // trash root
	addNamed(t, d, "t2", "u1", nil, "inside.pdf", 30, nil, "somefolder") // inside a trashed shared folder
	addNamed(t, d, "x1", "u1", "u2", "odd.txt", 999, nil, nil)           // uploaded by u1, in u2's space
	addNamed(t, d, "o1", "u2", nil, "theirs.mp4", 5000, nil, nil)        // someone else's upload
	addNamed(t, d, "n1", "u1", "u1", "README", 5, nil, nil)
	if _, err := d.Exec(`INSERT INTO nodes(id,space_owner,uploader,name,is_dir,size,mime,created_at,updated_at) VALUES('d1','u1','u1','dir.zip',1,0,'',0,0)`); err != nil {
		t.Fatal(err)
	}
	addUpload(t, d, "up1", "u1", 25)

	b, err := GetBreakdown(ctx, d, "u1")
	if err != nil {
		t.Fatal(err)
	}
	used, _ := Used(ctx, d, "u1")
	if b.UsedBytes != used || used != 100+50+400+70+30+999+5+25 {
		t.Fatalf("used %d (Used %d)", b.UsedBytes, used)
	}
	if b.QuotaBytes != 10_000 || b.UploadingBytes != 25 || b.TrashBytes != 100 {
		t.Fatalf("quota %d uploading %d trash %d", b.QuotaBytes, b.UploadingBytes, b.TrashBytes)
	}
	got := map[string][2]int64{}
	var sum int64
	for _, c := range b.Categories {
		got[c.Key] = [2]int64{c.Bytes, c.Count}
		sum += c.Bytes
	}
	want := map[string][2]int64{
		"images": {150, 2}, "video": {400, 1}, "archives": {70, 1},
		"documents": {30 + 999, 2}, "other": {5, 1},
	}
	if len(got) != len(want) {
		t.Fatalf("categories %v", b.Categories)
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("%s: got %v want %v (all %v)", k, got[k], v, b.Categories)
		}
	}
	if sum != b.UsedBytes-b.UploadingBytes {
		t.Fatalf("categories sum %d, used-uploading %d", sum, b.UsedBytes-b.UploadingBytes)
	}
	for i := 1; i < len(b.Categories); i++ {
		if b.Categories[i-1].Bytes < b.Categories[i].Bytes {
			t.Fatalf("not sorted: %v", b.Categories)
		}
	}
	// Largest: live files I can access (my space or shared), by size.
	var ids []string
	for _, f := range b.Largest {
		ids = append(ids, f.ID)
	}
	if len(ids) != 4 || ids[0] != "s1" || ids[1] != "p1" || ids[2] != "p2" || ids[3] != "n1" {
		t.Fatalf("largest %v", ids)
	}
	if b.Largest[0].Space != "shared" || b.Largest[1].Space != "personal" || b.Largest[0].ParentID != nil {
		t.Fatalf("largest fields %+v", b.Largest)
	}
}

func TestBreakdownLargestCapsAtTen(t *testing.T) {
	d := setup(t, 1<<30)
	for i := 0; i < 15; i++ {
		addNamed(t, d, string(rune('a'+i)), "u1", "u1", string(rune('a'+i))+".bin", int64(i+1), nil, nil)
	}
	b, err := GetBreakdown(context.Background(), d, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Largest) != 10 || b.Largest[0].Size != 15 || b.Largest[9].Size != 6 {
		t.Fatalf("%+v", b.Largest)
	}
}

func TestBreakdownEmpty(t *testing.T) {
	d := setup(t, 100)
	b, err := GetBreakdown(context.Background(), d, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if b.UsedBytes != 0 || len(b.Categories) != 0 || len(b.Largest) != 0 || b.Categories == nil || b.Largest == nil {
		t.Fatalf("%+v", b)
	}
}
