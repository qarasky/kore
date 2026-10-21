package quota

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"github.com/artchsh/kore/api/internal/store"
)

func setup(t *testing.T, quota int64) *sql.DB {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(`INSERT INTO users(id,email,pw_hash,role,quota_bytes,created_at) VALUES('u1','a@b.c','x','user',?,0),('u2','d@e.f','x','user',1000,0)`, quota); err != nil {
		t.Fatal(err)
	}
	return db
}

func addFile(t *testing.T, db *sql.DB, id, uploader string, owner any, size int64, trashed any) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO nodes(id,space_owner,uploader,name,is_dir,size,mime,trashed_at,created_at,updated_at) VALUES(?,?,?,?,0,?,'',?,0,0)`, id, owner, uploader, id, size, trashed); err != nil {
		t.Fatal(err)
	}
}

func addUpload(t *testing.T, db db, id, user string, size int64) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO uploads(id,user_id,name,size,chunk_size,created_at) VALUES(?,?,?,?,1,0)`, id, user, id, size); err != nil {
		t.Fatal(err)
	}
}

type db interface {
	Exec(string, ...any) (sql.Result, error)
}

func mustUsed(t *testing.T, d *sql.DB, user string, want int64) {
	t.Helper()
	got, err := Used(context.Background(), d, user)
	if err != nil || got != want {
		t.Fatalf("Used=%d err=%v want %d", got, err, want)
	}
}

func TestTrashedCountsUntilPurged(t *testing.T) {
	d := setup(t, 100)
	addFile(t, d, "f1", "u1", "u1", 30, nil)
	addFile(t, d, "f2", "u1", "u1", 20, 123)
	if _, err := d.Exec(`INSERT INTO nodes(id,space_owner,uploader,name,is_dir,size,mime,created_at,updated_at) VALUES('d1','u1','u1','d',1,0,'',0,0)`); err != nil {
		t.Fatal(err)
	}
	mustUsed(t, d, "u1", 50)
	d.Exec(`DELETE FROM nodes WHERE id='f2'`)
	mustUsed(t, d, "u1", 30)
}

func TestSharedCountsAgainstUploader(t *testing.T) {
	d := setup(t, 100)
	addFile(t, d, "f1", "u1", "u1", 40, nil)
	mustUsed(t, d, "u1", 40)
	// Simulate nodes.Move personal -> shared: space_owner changes, uploader never does.
	if _, err := d.Exec(`UPDATE nodes SET space_owner=NULL WHERE id='f1'`); err != nil {
		t.Fatal(err)
	}
	mustUsed(t, d, "u1", 40)
	mustUsed(t, d, "u2", 0)
	// A file u2 uploaded into u1's space counts against u2 only.
	addFile(t, d, "f2", "u2", "u1", 15, nil)
	mustUsed(t, d, "u1", 40)
	mustUsed(t, d, "u2", 15)
}

func TestReservationCountsAndReleases(t *testing.T) {
	d := setup(t, 100)
	addFile(t, d, "f1", "u1", "u1", 10, nil)
	addUpload(t, d, "up1", "u1", 60)
	mustUsed(t, d, "u1", 70)
	r, err := Remaining(context.Background(), d, "u1")
	if err != nil || r != 30 {
		t.Fatalf("remaining=%d err=%v", r, err)
	}
	d.Exec(`DELETE FROM uploads WHERE id='up1'`)
	mustUsed(t, d, "u1", 10)
}

func TestReserveExceeded(t *testing.T) {
	d := setup(t, 100)
	addFile(t, d, "f1", "u1", "u1", 90, nil)
	ctx := context.Background()
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := Reserve(ctx, tx, "u1", 11); !errors.Is(err, ErrExceeded) {
		t.Fatalf("got %v", err)
	}
	if err := Reserve(ctx, tx, "u1", 10); err != nil {
		t.Fatalf("exact fit: %v", err)
	}
	if err := Reserve(ctx, tx, "nobody", 1); err == nil {
		t.Fatal("unknown user accepted")
	}
}

func TestDeleteWorksAtFullQuota(t *testing.T) {
	d := setup(t, 100)
	addFile(t, d, "f1", "u1", "u1", 100, nil)
	r, _ := Remaining(context.Background(), d, "u1")
	if r != 0 {
		t.Fatalf("remaining=%d", r)
	}
	if _, err := d.Exec(`UPDATE nodes SET trashed_at=5 WHERE id='f1'`); err != nil {
		t.Fatalf("trash: %v", err)
	}
	if _, err := d.Exec(`DELETE FROM nodes WHERE id='f1'`); err != nil {
		t.Fatalf("purge: %v", err)
	}
	mustUsed(t, d, "u1", 0)
}

func TestRemainingNeverNegative(t *testing.T) {
	d := setup(t, 10)
	addFile(t, d, "f1", "u1", "u1", 50, nil)
	if r, err := Remaining(context.Background(), d, "u1"); err != nil || r != 0 {
		t.Fatalf("remaining=%d err=%v", r, err)
	}
}

func TestConcurrentReserveExactlyOneWins(t *testing.T) {
	d := setup(t, 100)
	ctx := context.Background()
	const n = 8
	var wg sync.WaitGroup
	errs := make([]error, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			tx, err := d.BeginTx(ctx, nil)
			if err != nil {
				errs[i] = err
				return
			}
			defer tx.Rollback()
			if err := Reserve(ctx, tx, "u1", 60); err != nil {
				errs[i] = err
				return
			}
			if _, err := tx.Exec(`INSERT INTO uploads(id,user_id,name,size,chunk_size,created_at) VALUES(?,?,?,?,1,0)`, string(rune('a'+i)), "u1", "n", 60); err != nil {
				errs[i] = err
				return
			}
			errs[i] = tx.Commit()
		}(i)
	}
	close(start)
	wg.Wait()
	ok := 0
	for _, e := range errs {
		switch {
		case e == nil:
			ok++
		case errors.Is(e, ErrExceeded):
		default:
			t.Fatalf("unexpected error: %v", e)
		}
	}
	if ok != 1 {
		t.Fatalf("%d reservations succeeded, want 1", ok)
	}
	mustUsed(t, d, "u1", 60)
}
