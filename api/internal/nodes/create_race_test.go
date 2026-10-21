package nodes

import (
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

// liveOrphans counts live nodes that have a trashed (or trash-rooted) ancestor.
func liveOrphans(t *testing.T, db *sql.DB) int {
	t.Helper()
	var n int
	err := db.QueryRow(`WITH RECURSIVE a(id, anc) AS (
		SELECT id, parent_id FROM nodes WHERE trashed_at IS NULL AND trash_root IS NULL AND parent_id IS NOT NULL
		UNION ALL SELECT a.id, p.parent_id FROM a JOIN nodes p ON p.id=a.anc WHERE p.parent_id IS NOT NULL)
		SELECT count(DISTINCT a.id) FROM a JOIN nodes p ON p.id=a.anc
		WHERE p.trashed_at IS NOT NULL OR p.trash_root IS NOT NULL`).Scan(&n)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestCreateFolderUnderTrashedParentNotFound(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	p := mustFolder(t, db, a, sp, nil, "p")
	c := mustFolder(t, db, a, sp, &p.ID, "c")
	if err := Trash(ctx, db, a, p.ID); err != nil {
		t.Fatal(err)
	}
	for _, parent := range []string{p.ID, c.ID} {
		if _, err := CreateFolder(ctx, db, a, sp, &parent, "x"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("create under trashed %s: %v", parent, err)
		}
	}
	if n := liveOrphans(t, db); n != 0 {
		t.Fatalf("%d live orphans", n)
	}
}

// A Trash of the parent that lands between CreateFolder's parent check and
// its INSERT must not leave a live child under a trashed parent.
func TestCreateFolderCheckAndInsertAtomic(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	p := mustFolder(t, db, a, sp, nil, "p")
	var wg sync.WaitGroup
	var trashErr error
	createFolderHook = func() {
		wg.Add(1)
		go func() {
			defer wg.Done()
			trashErr = Trash(ctx, db, a, p.ID)
		}()
		time.Sleep(150 * time.Millisecond) // let Trash run (or block on the tx)
	}
	defer func() { createFolderHook = nil }()
	_, err := CreateFolder(ctx, db, a, sp, &p.ID, "child")
	wg.Wait()
	if err != nil || trashErr != nil {
		t.Fatalf("create %v, trash %v", err, trashErr)
	}
	if n := liveOrphans(t, db); n != 0 {
		t.Fatalf("%d live orphans under a trashed parent", n)
	}
}

func TestCreateFolderVsTrashHammer(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	for i := 0; i < 50; i++ {
		p := mustFolder(t, db, a, sp, nil, fmt.Sprintf("p%d", i))
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			for j := 0; j < 3; j++ {
				_, err := CreateFolder(ctx, db, a, sp, &p.ID, fmt.Sprintf("c%d", j))
				if err != nil && !errors.Is(err, ErrNotFound) {
					t.Error(err)
				}
			}
		}()
		go func() {
			defer wg.Done()
			if err := Trash(ctx, db, a, p.ID); err != nil {
				t.Error(err)
			}
		}()
		wg.Wait()
	}
	if n := liveOrphans(t, db); n != 0 {
		t.Fatalf("%d live orphans", n)
	}
}
