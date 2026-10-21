package nodes

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/artchsh/kore/api/internal/store"
	"github.com/artchsh/kore/api/internal/users"
)

var ctx = context.Background()

func setup(t *testing.T) (*sql.DB, users.User, users.User, users.User) {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	mk := func(email, role string) users.User {
		u, err := users.Create(ctx, db, email, "x", role, 0)
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	return db, mk("admin@x.io", "admin"), mk("a@x.io", "user"), mk("b@x.io", "user")
}

func mustFolder(t *testing.T, db *sql.DB, u users.User, sp Space, parent *string, name string) Node {
	t.Helper()
	n, err := CreateFolder(ctx, db, u, sp, parent, name)
	if err != nil {
		t.Fatalf("CreateFolder %q: %v", name, err)
	}
	return n
}

func insertFile(t *testing.T, db *sql.DB, u users.User, sp Space, parent *string, name string) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO nodes(id,space_owner,uploader,parent_id,name,is_dir,size,mime,created_at,updated_at) VALUES(?,?,?,?,?,0,1,'',1,1)`,
		users.NewID(), sp.Owner, u.ID, parent, name)
	if err != nil {
		t.Fatal(err)
	}
}

func TestMoveIntoSelfRejected(t *testing.T) {
	db, _, a, _ := setup(t)
	f := mustFolder(t, db, a, Personal(a.ID), nil, "f")
	if _, err := Move(ctx, db, a, f.ID, &f.ID); !errors.Is(err, ErrInvalidMove) {
		t.Fatalf("got %v", err)
	}
}

func TestMoveIntoOwnDescendantRejected(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	f := mustFolder(t, db, a, sp, nil, "f")
	c := mustFolder(t, db, a, sp, &f.ID, "c")
	g := mustFolder(t, db, a, sp, &c.ID, "g")
	if _, err := Move(ctx, db, a, f.ID, &g.ID); !errors.Is(err, ErrInvalidMove) {
		t.Fatalf("got %v", err)
	}
	if _, err := Move(ctx, db, a, g.ID, &f.ID); err != nil {
		t.Fatalf("legit move: %v", err)
	}
}

func TestRenameCollisionKeepsError409(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	mustFolder(t, db, a, sp, nil, "x")
	y := mustFolder(t, db, a, sp, nil, "y")
	if _, err := Rename(ctx, db, a, y.ID, "x"); !errors.Is(err, ErrNameTaken) {
		t.Fatalf("got %v", err)
	}
	if _, err := CreateFolder(ctx, db, a, sp, nil, "x"); !errors.Is(err, ErrNameTaken) {
		t.Fatalf("create: %v", err)
	}
	// Collision on move.
	d := mustFolder(t, db, a, sp, nil, "d")
	mustFolder(t, db, a, sp, &d.ID, "y")
	if _, err := Move(ctx, db, a, y.ID, &d.ID); !errors.Is(err, ErrNameTaken) {
		t.Fatalf("move: %v", err)
	}
}

func TestUniqueNameSuffix(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	got := func(name string) string {
		s, err := UniqueName(ctx, db, sp, nil, name)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	if got("report.pdf") != "report.pdf" {
		t.Fatal("free name changed")
	}
	insertFile(t, db, a, sp, nil, "report.pdf")
	if g := got("report.pdf"); g != "report (1).pdf" {
		t.Fatal(g)
	}
	insertFile(t, db, a, sp, nil, "report (1).pdf")
	if g := got("report.pdf"); g != "report (2).pdf" {
		t.Fatal(g)
	}
	insertFile(t, db, a, sp, nil, "Makefile")
	if g := got("Makefile"); g != "Makefile (1)" {
		t.Fatal(g)
	}
}

func TestValidateNameRejectsTraversal(t *testing.T) {
	for _, bad := range []string{"", "  ", ".", "..", "a/b", "a\x00b", strings.Repeat("a", 256), strings.Repeat("я", 128)} {
		if err := ValidateName(bad); !errors.Is(err, ErrInvalidName) {
			t.Errorf("%q accepted", bad)
		}
	}
	for _, ok := range []string{"a", "...", ".hidden", strings.Repeat("a", 255), "файл.txt"} {
		if err := ValidateName(ok); err != nil {
			t.Errorf("%q rejected: %v", ok, err)
		}
	}
}

func TestCyrillicNameRoundTrip(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	// "й" decomposed (и + U+0306) must be stored NFC.
	n := mustFolder(t, db, a, sp, nil, "Отчёт й")
	if n.Name != "Отчёт й" {
		t.Fatalf("not NFC: %q", n.Name)
	}
	l, err := List(ctx, db, a, sp, nil)
	if err != nil || len(l) != 1 || l[0].Name != "Отчёт й" {
		t.Fatalf("%v %v", l, err)
	}
}

func TestAdminCannotSeeOthersPersonal(t *testing.T) {
	db, admin, a, _ := setup(t)
	f := mustFolder(t, db, a, Personal(a.ID), nil, "secret")
	if _, err := List(ctx, db, admin, Personal(a.ID), nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("list: %v", err)
	}
	if _, err := Rename(ctx, db, admin, f.ID, "z"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("rename: %v", err)
	}
	if _, err := Path(ctx, db, admin, f.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("path: %v", err)
	}
	if _, err := CreateFolder(ctx, db, admin, Personal(a.ID), nil, "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("create: %v", err)
	}
	if Can(admin, f) || !Can(a, f) {
		t.Fatal("Can wrong")
	}
}

func TestSharedEditableByAnyUser(t *testing.T) {
	db, _, a, b := setup(t)
	f := mustFolder(t, db, a, Space{}, nil, "shared")
	if f.Uploader != a.ID {
		t.Fatal("uploader")
	}
	r, err := Rename(ctx, db, b, f.ID, "renamed")
	if err != nil || r.Name != "renamed" {
		t.Fatalf("%v %v", r, err)
	}
	c := mustFolder(t, db, b, Space{}, &f.ID, "child")
	if _, err := Move(ctx, db, a, c.ID, nil); err != nil {
		t.Fatal(err)
	}
}

func TestCrossSpaceMove(t *testing.T) {
	db, _, a, b := setup(t)
	pa := Personal(a.ID)
	f := mustFolder(t, db, a, pa, nil, "f")
	c := mustFolder(t, db, a, pa, &f.ID, "c")
	sh := mustFolder(t, db, b, Space{}, nil, "sh")
	m, err := Move(ctx, db, a, f.ID, &sh.ID)
	if err != nil || m.SpaceOwner != nil || m.Uploader != a.ID {
		t.Fatalf("%+v %v", m, err)
	}
	if got, _ := Path(ctx, db, b, c.ID); len(got) != 3 || got[2].SpaceOwner != nil {
		t.Fatalf("descendant space not updated: %+v", got)
	}
	// Back to own personal root.
	back, err := MoveTo(ctx, db, a, f.ID, &pa, nil)
	if err != nil || back.SpaceOwner == nil || *back.SpaceOwner != a.ID {
		t.Fatalf("%+v %v", back, err)
	}
	// Another user's personal space is invisible.
	pb := mustFolder(t, db, b, Personal(b.ID), nil, "pb")
	if _, err := Move(ctx, db, a, f.ID, &pb.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v", err)
	}
}

func TestListOrder(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	for _, n := range []string{"file10", "File2", "file1", "b.txt", "Ёж.txt", "а.txt", "A.txt"} {
		insertFile(t, db, a, sp, nil, n)
	}
	for _, n := range []string{"zdir", "Adir"} {
		mustFolder(t, db, a, sp, nil, n)
	}
	l, err := List(ctx, db, a, sp, nil)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, n := range l {
		got = append(got, n.Name)
	}
	want := "Adir,zdir,A.txt,b.txt,file1,File2,file10,а.txt,Ёж.txt"
	if strings.Join(got, ",") != want {
		t.Fatalf("got %v", got)
	}
}

func TestPathBreadcrumbs(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	x := mustFolder(t, db, a, sp, nil, "x")
	y := mustFolder(t, db, a, sp, &x.ID, "y")
	p, err := Path(ctx, db, a, y.ID)
	if err != nil || len(p) != 2 || p[0].Name != "x" || p[1].Name != "y" {
		t.Fatalf("%v %v", p, err)
	}
}

func TestUniqueNameKeepsLimit(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	name := strings.Repeat("a", 250) + ".txt" // 254 bytes
	insertFile(t, db, a, sp, nil, name)
	got, err := UniqueName(ctx, db, sp, nil, name)
	if err != nil || len(got) > 255 || !strings.HasSuffix(got, " (1).txt") {
		t.Fatalf("%d %q %v", len(got), got, err)
	}
	if err := ValidateName(got); err != nil {
		t.Fatal(err)
	}
	// Multibyte stem truncates on a rune boundary.
	m := strings.Repeat("я", 125) + ".txt" // 254 bytes
	insertFile(t, db, a, sp, nil, m)
	got, _ = UniqueName(ctx, db, sp, nil, m)
	if len(got) > 255 || !utf8.ValidString(got) {
		t.Fatalf("%q", got)
	}
	// NFC normalization of input.
	if g, _ := UniqueName(ctx, db, sp, nil, "и\u0306.txt"); g != "й.txt" {
		t.Fatalf("%q", g)
	}
}

func TestUpdateAtomic(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	d := mustFolder(t, db, a, sp, nil, "d")
	mustFolder(t, db, a, sp, &d.ID, "new")
	o := mustFolder(t, db, a, sp, nil, "old")
	nm := "new"
	if _, err := Update(ctx, db, a, o.ID, &nm, &MoveTarget{Parent: &d.ID, ParentSet: true}); !errors.Is(err, ErrNameTaken) {
		t.Fatal(err)
	}
	l, _ := List(ctx, db, a, sp, nil)
	if len(l) != 2 || l[1].Name != "old" {
		t.Fatalf("%+v", l)
	}
}
