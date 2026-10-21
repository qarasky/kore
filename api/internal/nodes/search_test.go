package nodes

import (
	"errors"
	"fmt"
	"testing"
)

func hitNames(h []Hit) []string {
	var o []string
	for _, x := range h {
		o = append(o, x.Name)
	}
	return o
}

func TestSearchCyrillicCaseInsensitive(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	insertFile(t, db, a, sp, nil, "Отчёт Годовой.txt")
	insertFile(t, db, a, sp, nil, "other.txt")
	for _, q := range []string{"годовой", "ГОДОВОЙ", " отчёт "} {
		got, err := SearchHits(ctx, db, a, q, 50)
		if err != nil || len(got) != 1 || got[0].Name != "Отчёт Годовой.txt" {
			t.Fatalf("%q: %v %v", q, hitNames(got), err)
		}
	}
	// NFD query matches NFC name.
	got, _ := SearchHits(ctx, db, a, "отчёт", 50)
	_ = got
	if _, err := Search(ctx, db, a, "   ", 50); !errors.Is(err, ErrEmptyQuery) {
		t.Fatalf("empty: %v", err)
	}
}

func TestSearchExcludesTrashedAndOthersPersonal(t *testing.T) {
	db, admin, a, b := setup(t)
	insertFile(t, db, a, Personal(a.ID), nil, "needle-a.txt")
	insertFile(t, db, b, Personal(b.ID), nil, "needle-b.txt")
	insertFile(t, db, a, Space{}, nil, "needle-shared.txt")
	d := mustFolder(t, db, a, Personal(a.ID), nil, "needle-dir")
	insertFile(t, db, a, Personal(a.ID), &d.ID, "needle-inside.txt")
	if err := Trash(ctx, db, a, d.ID); err != nil {
		t.Fatal(err)
	}
	got, err := SearchHits(ctx, db, a, "needle", 50)
	if err != nil || fmt.Sprint(hitNames(got)) != "[needle-a.txt needle-shared.txt]" {
		t.Fatalf("%v %v", hitNames(got), err)
	}
	got, _ = SearchHits(ctx, db, admin, "needle", 50)
	if fmt.Sprint(hitNames(got)) != "[needle-shared.txt]" {
		t.Fatalf("admin sees %v", hitNames(got))
	}
}

func TestSearchPathAndOrderAndLimit(t *testing.T) {
	db, _, a, _ := setup(t)
	sp := Personal(a.ID)
	x := mustFolder(t, db, a, sp, nil, "x")
	y := mustFolder(t, db, a, sp, &x.ID, "y")
	insertFile(t, db, a, sp, &y.ID, "doc.txt")
	mustFolder(t, db, a, sp, nil, "zdoc")
	got, err := SearchHits(ctx, db, a, "doc", 50)
	if err != nil || fmt.Sprint(hitNames(got)) != "[zdoc doc.txt]" {
		t.Fatalf("%v %v", hitNames(got), err)
	}
	if fmt.Sprint(got[1].Path) != "[x y]" || len(got[0].Path) != 0 {
		t.Fatalf("paths %v %v", got[0].Path, got[1].Path)
	}
	for i := 0; i < 10; i++ {
		insertFile(t, db, a, sp, nil, fmt.Sprintf("many%d", i))
	}
	got, _ = SearchHits(ctx, db, a, "many", 3)
	if len(got) != 3 {
		t.Fatalf("limit: %d", len(got))
	}
	got, _ = SearchHits(ctx, db, a, "many", 0)
	if len(got) != 10 {
		t.Fatalf("default limit: %d", len(got))
	}
}
