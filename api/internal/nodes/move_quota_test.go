package nodes

import (
	"database/sql"
	"errors"
	"testing"

	"github.com/artchsh/kore/api/internal/quota"
	"github.com/artchsh/kore/api/internal/users"
)

func sizedFile(t *testing.T, db *sql.DB, u users.User, sp Space, parent *string, name string, size int64) string {
	t.Helper()
	id := users.NewID()
	_, err := db.Exec(`INSERT INTO nodes(id,space_owner,uploader,parent_id,name,is_dir,size,mime,created_at,updated_at) VALUES(?,?,?,?,?,0,?,'',1,1)`,
		id, sp.Owner, u.ID, parent, name, size)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func setQuota(t *testing.T, db *sql.DB, u users.User, q int64) {
	t.Helper()
	if _, err := db.Exec(`UPDATE users SET quota_bytes=? WHERE id=?`, q, u.ID); err != nil {
		t.Fatal(err)
	}
}

func used(t *testing.T, db *sql.DB, u users.User) int64 {
	t.Helper()
	n, err := quota.Used(ctx, db, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func uploaderOf(t *testing.T, db *sql.DB, id string) (uploader string, owner sql.NullString) {
	t.Helper()
	if err := db.QueryRow(`SELECT uploader,space_owner FROM nodes WHERE id=?`, id).Scan(&uploader, &owner); err != nil {
		t.Fatal(err)
	}
	return uploader, owner
}

func TestMoveIntoPersonalReattributesUploader(t *testing.T) {
	db, _, a, b := setup(t)
	setQuota(t, db, a, 1000)
	setQuota(t, db, b, 1000)
	id := sizedFile(t, db, b, Space{}, nil, "b.bin", 300)
	if used(t, db, b) != 300 || used(t, db, a) != 0 {
		t.Fatal("precondition")
	}
	pa := Personal(a.ID)
	m, err := MoveTo(ctx, db, a, id, &pa, nil)
	if err != nil {
		t.Fatal(err)
	}
	if m.Uploader != a.ID {
		t.Fatalf("returned uploader %q", m.Uploader)
	}
	if got := used(t, db, b); got != 0 {
		t.Fatalf("used(b)=%d, want 0", got)
	}
	if got := used(t, db, a); got != 300 {
		t.Fatalf("used(a)=%d, want 300", got)
	}
	// Moving back to shared keeps uploader = a.
	if _, err := MoveTo(ctx, db, a, id, &Space{}, nil); err != nil {
		t.Fatal(err)
	}
	if up, _ := uploaderOf(t, db, id); up != a.ID {
		t.Fatalf("uploader after move to shared %q", up)
	}
}

func TestMoveIntoPersonalOverQuotaRejected(t *testing.T) {
	db, _, a, b := setup(t)
	setQuota(t, db, a, 500)
	setQuota(t, db, b, 1000)
	sizedFile(t, db, a, Personal(a.ID), nil, "mine.bin", 300)
	id := sizedFile(t, db, b, Space{}, nil, "b.bin", 201)
	pa := Personal(a.ID)
	if _, err := MoveTo(ctx, db, a, id, &pa, nil); !errors.Is(err, quota.ErrExceeded) {
		t.Fatalf("got %v, want ErrExceeded", err)
	}
	up, owner := uploaderOf(t, db, id)
	if up != b.ID || owner.Valid {
		t.Fatalf("node changed: uploader=%q owner=%v", up, owner)
	}
	if used(t, db, a) != 300 || used(t, db, b) != 201 {
		t.Fatal("usage changed")
	}
	// Exactly at the limit is fine.
	setQuota(t, db, a, 501)
	if _, err := MoveTo(ctx, db, a, id, &pa, nil); err != nil {
		t.Fatalf("at limit: %v", err)
	}
}

func TestMoveOwnFileRoundTripKeepsQuota(t *testing.T) {
	db, _, a, _ := setup(t)
	setQuota(t, db, a, 100)
	pa := Personal(a.ID)
	id := sizedFile(t, db, a, pa, nil, "mine.bin", 150) // already over quota
	if _, err := MoveTo(ctx, db, a, id, &Space{}, nil); err != nil {
		t.Fatal(err)
	}
	if used(t, db, a) != 150 {
		t.Fatal("used changed after move to shared")
	}
	// No uploader changes, so no new bytes: allowed even while over quota.
	if _, err := MoveTo(ctx, db, a, id, &pa, nil); err != nil {
		t.Fatalf("move back: %v", err)
	}
	if used(t, db, a) != 150 {
		t.Fatal("used changed after move back")
	}
}

func TestMoveFolderSubtreeReattributes(t *testing.T) {
	db, _, a, b := setup(t)
	setQuota(t, db, a, 1000)
	setQuota(t, db, b, 1000)
	top := mustFolder(t, db, b, Space{}, nil, "top")
	sub := mustFolder(t, db, b, Space{}, &top.ID, "sub")
	f1 := sizedFile(t, db, b, Space{}, &top.ID, "1.bin", 10)
	f2 := sizedFile(t, db, b, Space{}, &sub.ID, "2.bin", 20)
	f3 := sizedFile(t, db, a, Space{}, &sub.ID, "3.bin", 40) // a's own
	pa := Personal(a.ID)
	if _, err := MoveTo(ctx, db, a, top.ID, &pa, nil); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{top.ID, sub.ID, f1, f2, f3} {
		if up, owner := uploaderOf(t, db, id); up != a.ID || owner.String != a.ID {
			t.Fatalf("%s uploader=%q owner=%v", id, up, owner)
		}
	}
	if used(t, db, a) != 70 || used(t, db, b) != 0 {
		t.Fatalf("used a=%d b=%d", used(t, db, a), used(t, db, b))
	}
}

func TestMoveFolderSubtreeOverQuotaCountsOnlyForeignBytes(t *testing.T) {
	db, _, a, b := setup(t)
	setQuota(t, db, b, 1000)
	top := mustFolder(t, db, b, Space{}, nil, "top")
	f1 := sizedFile(t, db, b, Space{}, &top.ID, "1.bin", 10)
	sizedFile(t, db, a, Space{}, &top.ID, "mine.bin", 40) // a: used 40
	pa := Personal(a.ID)
	setQuota(t, db, a, 49) // 40 + 10 = 50 > 49
	if _, err := MoveTo(ctx, db, a, top.ID, &pa, nil); !errors.Is(err, quota.ErrExceeded) {
		t.Fatalf("got %v", err)
	}
	if up, owner := uploaderOf(t, db, f1); up != b.ID || owner.Valid {
		t.Fatalf("f1 changed: %q %v", up, owner)
	}
	setQuota(t, db, a, 50)
	if _, err := MoveTo(ctx, db, a, top.ID, &pa, nil); err != nil {
		t.Fatalf("at limit: %v", err)
	}
}

func TestMoveWithinSharedKeepsUploader(t *testing.T) {
	db, _, a, b := setup(t)
	dst := mustFolder(t, db, a, Space{}, nil, "dst")
	id := sizedFile(t, db, b, Space{}, nil, "b.bin", 5)
	if _, err := Move(ctx, db, a, id, &dst.ID); err != nil {
		t.Fatal(err)
	}
	if up, _ := uploaderOf(t, db, id); up != b.ID {
		t.Fatalf("uploader %q", up)
	}
}
