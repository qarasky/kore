package nodes

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/artchsh/kore/api/internal/users"
)

// sizeIn lists sp/parent as actor and returns the listed size of the item named name.
func sizeIn(t *testing.T, db *sql.DB, actor users.User, sp Space, parent *string, name string) int64 {
	t.Helper()
	l, err := List(ctx, db, actor, sp, parent)
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range l {
		if n.Name == name {
			return n.Size
		}
	}
	t.Fatalf("%q not listed", name)
	return 0
}

func TestFolderSizeSumsNestedFiles(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	top := mustFolder(t, db, a, sp, nil, "top")
	mid := mustFolder(t, db, a, sp, &top.ID, "mid")
	deep := mustFolder(t, db, a, sp, &mid.ID, "deep")
	mustFolder(t, db, a, sp, nil, "empty")
	sizedFile(t, db, a, sp, &top.ID, "a", 10)
	sizedFile(t, db, a, sp, &mid.ID, "b", 200)
	sizedFile(t, db, a, sp, &deep.ID, "c", 3000)
	sizedFile(t, db, a, sp, nil, "loose", 7)

	if got := sizeIn(t, db, a, sp, nil, "top"); got != 3210 {
		t.Fatalf("top=%d, want 3210", got)
	}
	if got := sizeIn(t, db, a, sp, nil, "empty"); got != 0 {
		t.Fatalf("empty=%d", got)
	}
	if got := sizeIn(t, db, a, sp, nil, "loose"); got != 7 {
		t.Fatalf("file size changed: %d", got)
	}
	if got := sizeIn(t, db, a, sp, &top.ID, "mid"); got != 3200 {
		t.Fatalf("mid=%d", got)
	}
	if got := sizeIn(t, db, a, sp, &top.ID, "a"); got != 10 {
		t.Fatalf("a=%d", got)
	}
}

func TestFolderSizeExcludesTrash(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	top := mustFolder(t, db, a, sp, nil, "top")
	sub := mustFolder(t, db, a, sp, &top.ID, "sub")
	sizedFile(t, db, a, sp, &top.ID, "keep", 5)
	gone := sizedFile(t, db, a, sp, &top.ID, "gone", 50)
	sizedFile(t, db, a, sp, &sub.ID, "inSub", 500)
	if got := sizeIn(t, db, a, sp, nil, "top"); got != 555 {
		t.Fatalf("before=%d", got)
	}
	if err := Trash(ctx, db, a, gone); err != nil {
		t.Fatal(err)
	}
	if got := sizeIn(t, db, a, sp, nil, "top"); got != 505 {
		t.Fatalf("after trashing file=%d, want 505", got)
	}
	if err := Trash(ctx, db, a, sub.ID); err != nil {
		t.Fatal(err)
	}
	if got := sizeIn(t, db, a, sp, nil, "top"); got != 5 {
		t.Fatalf("after trashing subfolder=%d, want 5", got)
	}
	if _, err := Restore(ctx, db, a, sub.ID); err != nil {
		t.Fatal(err)
	}
	if got := sizeIn(t, db, a, sp, nil, "top"); got != 505 {
		t.Fatalf("after restore=%d, want 505", got)
	}
}

func TestFolderSizeFollowsMoves(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	x := mustFolder(t, db, a, sp, nil, "x")
	y := mustFolder(t, db, a, sp, nil, "y")
	f := sizedFile(t, db, a, sp, &x.ID, "f", 40)
	sizedFile(t, db, a, sp, &y.ID, "g", 2)
	if sizeIn(t, db, a, sp, nil, "x") != 40 || sizeIn(t, db, a, sp, nil, "y") != 2 {
		t.Fatal("precondition")
	}
	if _, err := Move(ctx, db, a, f, &y.ID); err != nil {
		t.Fatal(err)
	}
	if got := sizeIn(t, db, a, sp, nil, "x"); got != 0 {
		t.Fatalf("x=%d after move out", got)
	}
	if got := sizeIn(t, db, a, sp, nil, "y"); got != 42 {
		t.Fatalf("y=%d after move in", got)
	}
}

func TestFolderSizeSpaceScoping(t *testing.T) {
	db, _, a, b := setup(t)
	pa, pb := Personal(a.ID), Personal(b.ID)
	// Shared: files from both users count, and both see the same total.
	sh := mustFolder(t, db, a, Space{}, nil, "team")
	sizedFile(t, db, a, Space{}, &sh.ID, "fromA", 100)
	sizedFile(t, db, b, Space{}, &sh.ID, "fromB", 20)
	if sizeIn(t, db, a, Space{}, nil, "team") != 120 || sizeIn(t, db, b, Space{}, nil, "team") != 120 {
		t.Fatal("shared total")
	}
	// Personal folders with the same name are independent.
	da := mustFolder(t, db, a, pa, nil, "docs")
	db2 := mustFolder(t, db, b, pb, nil, "docs")
	sizedFile(t, db, a, pa, &da.ID, "mine", 3)
	sizedFile(t, db, b, pb, &db2.ID, "theirs", 9000)
	if got := sizeIn(t, db, a, pa, nil, "docs"); got != 3 {
		t.Fatalf("a docs=%d", got)
	}
	if got := sizeIn(t, db, b, pb, nil, "docs"); got != 9000 {
		t.Fatalf("b docs=%d", got)
	}
	// A row of another space hanging under a's folder (an inconsistent tree)
	// is never counted.
	sizedFile(t, db, b, pb, &da.ID, "stray", 1_000_000)
	if got := sizeIn(t, db, a, pa, nil, "docs"); got != 3 {
		t.Fatalf("foreign-space row counted: %d", got)
	}
}

func TestFolderSizeFollowsCrossSpaceMove(t *testing.T) {
	db, _, a, b := setup(t)
	pa := Personal(a.ID)
	f := mustFolder(t, db, a, pa, nil, "proj")
	in := mustFolder(t, db, a, pa, &f.ID, "in")
	sizedFile(t, db, a, pa, &in.ID, "x", 64)
	if _, err := MoveTo(ctx, db, a, f.ID, &Space{}, nil); err != nil {
		t.Fatal(err)
	}
	if got := sizeIn(t, db, b, Space{}, nil, "proj"); got != 64 {
		t.Fatalf("shared proj=%d", got)
	}
	if l, _ := List(ctx, db, a, pa, nil); len(l) != 0 {
		t.Fatalf("still in personal: %+v", l)
	}
	if _, err := MoveTo(ctx, db, a, f.ID, &pa, nil); err != nil {
		t.Fatal(err)
	}
	if got := sizeIn(t, db, a, pa, nil, "proj"); got != 64 {
		t.Fatalf("personal proj=%d", got)
	}
}

// bigTree inserts 5,051 nodes under one folder "big": 50 folders of 10
// folders, each holding 9 files of 1..9 bytes.
func bigTree(t *testing.T, db *sql.DB, u users.User, sp Space) (root string, want int64) {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	ins := func(parent *string, name string, dir bool, size int64) string {
		id := users.NewID()
		d := 0
		if dir {
			d = 1
		}
		if _, err := tx.Exec(`INSERT INTO nodes(id,space_owner,uploader,parent_id,name,is_dir,size,mime,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'',1,1)`,
			id, sp.Owner, u.ID, parent, name, d, size); err != nil {
			t.Fatal(err)
		}
		return id
	}
	root = ins(nil, "big", true, 0)
	for i := 0; i < 50; i++ {
		l1 := ins(&root, fmt.Sprintf("l1-%d", i), true, 0)
		for j := 0; j < 10; j++ {
			l2 := ins(&l1, fmt.Sprintf("l2-%d", j), true, 0)
			for k := 0; k < 9; k++ {
				ins(&l2, fmt.Sprintf("f-%d", k), false, int64(k+1))
				want += int64(k + 1)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return root, want
}

func TestFolderSizeLargeTreeUsesIndex(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	_, want := bigTree(t, db, a, sp)
	var count int
	db.QueryRow(`SELECT count(*) FROM nodes`).Scan(&count)
	if count < 5000 {
		t.Fatalf("only %d nodes", count)
	}
	start := time.Now()
	got := sizeIn(t, db, a, sp, nil, "big")
	if el := time.Since(start); el > 2*time.Second {
		t.Fatalf("list took %v", el)
	}
	if got != want {
		t.Fatalf("big=%d, want %d", got, want)
	}
	// The listed rows come from the (space, parent) prefix of
	// nodes_unique_live_name, for the root and for a folder alike; the
	// descent walks nodes_parent rather than scanning per level.
	l, _ := List(ctx, db, a, sp, nil)
	for _, parent := range []*string{nil, &l[0].ID} {
		joined := queryPlan(t, db, listSQL, sp.Owner, parent)
		if !strings.Contains(joined, "SEARCH nodes USING INDEX nodes_unique_live_name") {
			t.Fatalf("listed rows not found via nodes_unique_live_name (parent %v):\n%s", parent, joined)
		}
		if !strings.Contains(joined, "SEARCH n USING INDEX nodes_parent (parent_id=?)") {
			t.Fatalf("recursive step does not use nodes_parent:\n%s", joined)
		}
	}
	if joined := queryPlan(t, db, listPlainSQL, sp.Owner, nil); !strings.Contains(joined, "nodes_unique_live_name") {
		t.Fatalf("plain list plan:\n%s", joined)
	}
}

func queryPlan(t *testing.T, db *sql.DB, q string, args ...any) string {
	t.Helper()
	rows, err := db.Query(`EXPLAIN QUERY PLAN `+q, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan []string
	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			t.Fatal(err)
		}
		plan = append(plan, detail)
	}
	return strings.Join(plan, "\n")
}

func TestListWithoutSizes(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	d := mustFolder(t, db, a, sp, nil, "d")
	sizedFile(t, db, a, sp, &d.ID, "in", 70)
	sizedFile(t, db, a, sp, nil, "loose", 9)
	l, err := ListWithoutSizes(ctx, db, a, sp, nil)
	if err != nil || len(l) != 2 {
		t.Fatalf("%v %v", l, err)
	}
	if l[0].Name != "d" || l[0].Size != 0 || l[1].Name != "loose" || l[1].Size != 9 {
		t.Fatalf("%+v", l)
	}
	if _, err := ListWithoutSizes(ctx, db, a, Personal("someone-else"), nil); err != ErrNotFound {
		t.Fatalf("access: %v", err)
	}
}
