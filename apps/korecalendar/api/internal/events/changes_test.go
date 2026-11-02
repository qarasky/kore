package events

import (
	"context"
	"reflect"
	"sort"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/users"
)

func (f fixture) changes(t *testing.T, since int64, limit int) ChangeSet {
	t.Helper()
	cs, err := Changes(context.Background(), f.db, f.user.ID, since, limit)
	if err != nil {
		t.Fatal(err)
	}
	return cs
}

func (f fixture) simple(t *testing.T, title string) Event {
	return f.create(t, Input{Title: title, Start: "2026-11-04T09:00:00", TZ: "UTC"})
}

func TestChangesCollapsePerEvent(t *testing.T) {
	f := newFixture(t)
	e := f.simple(t, "v1")
	for _, title := range []string{"v2", "v3"} {
		if _, err := Update(context.Background(), f.db, f.actor(), e.ID, Patch{Title: str(title)}, ScopeAll, "", nil); err != nil {
			t.Fatal(err)
		}
	}
	cs := f.changes(t, 0, 100)
	if len(cs.Upserted) != 1 || cs.Upserted[0].Title != "v3" || len(cs.Deleted) != 0 || cs.More {
		t.Fatalf("%+v", cs)
	}
	var max int64
	f.db.QueryRow(`SELECT max(seq) FROM changes`).Scan(&max)
	if cs.Cursor != max {
		t.Fatalf("cursor %d, want %d", cs.Cursor, max)
	}
}

func TestDeleteAppearsInDeletedAndRestoreAsUpsert(t *testing.T) {
	f := newFixture(t)
	e := f.simple(t, "x")
	afterCreate := f.changes(t, 0, 100).Cursor
	Delete(context.Background(), f.db, f.actor(), e.ID, ScopeAll, "", nil)
	cs := f.changes(t, afterCreate, 100)
	if !reflect.DeepEqual(cs.Deleted, []string{e.ID}) || len(cs.Upserted) != 0 {
		t.Fatalf("after delete: %+v", cs)
	}
	if all := f.changes(t, 0, 100); !reflect.DeepEqual(all.Deleted, []string{e.ID}) || len(all.Upserted) != 0 {
		t.Fatalf("from scratch a deleted event is a tombstone: %+v", all)
	}
	Restore(context.Background(), f.db, f.actor(), e.ID)
	cs = f.changes(t, cs.Cursor, 100)
	if len(cs.Upserted) != 1 || cs.Upserted[0].ID != e.ID || len(cs.Deleted) != 0 {
		t.Fatalf("after restore: %+v", cs)
	}
}

func TestPaginationWithMore(t *testing.T) {
	f := newFixture(t)
	want := []string{}
	for i := 0; i < 5; i++ {
		want = append(want, f.simple(t, string(rune('a'+i))).ID)
	}
	// touch the first one again: it must still be reported once, in its last position
	Update(context.Background(), f.db, f.actor(), want[0], Patch{Notes: str("n")}, ScopeAll, "", nil)
	var got []string
	var since int64
	pages := 0
	for {
		cs := f.changes(t, since, 2)
		pages++
		for _, e := range cs.Upserted {
			got = append(got, e.ID)
		}
		since = cs.Cursor
		if !cs.More {
			break
		}
		if pages > 10 {
			t.Fatal("pagination does not terminate")
		}
	}
	sort.Strings(got)
	sort.Strings(want)
	if pages != 3 || !reflect.DeepEqual(got, want) {
		t.Fatalf("pages=%d got %v want %v", pages, got, want)
	}
}

func TestChangesOnlyOwn(t *testing.T) {
	f := newFixture(t)
	f.simple(t, "mine")
	other, _ := users.Create(context.Background(), f.db, "b@example.com", "x", "user")
	cs, err := Changes(context.Background(), f.db, other.ID, 0, 100)
	if err != nil || len(cs.Upserted) != 0 || len(cs.Deleted) != 0 {
		t.Fatalf("%+v %v", cs, err)
	}
}

func TestNoChangesKeepsCursorAndReturnsEmptyLists(t *testing.T) {
	f := newFixture(t)
	f.simple(t, "x")
	cursor := f.changes(t, 0, 100).Cursor
	cs := f.changes(t, cursor, 100)
	if cs.Cursor != cursor || cs.Upserted == nil || cs.Deleted == nil || cs.More {
		t.Fatalf("%+v", cs)
	}
}

func TestSplitReportsBothSeries(t *testing.T) {
	f := newFixture(t)
	e := f.create(t, Input{Title: "Gym", Start: "2026-11-04T16:00:00", TZ: "UTC", RRule: "FREQ=WEEKLY"})
	cursor := f.changes(t, 0, 100).Cursor
	res, err := Update(context.Background(), f.db, f.actor(), e.ID, Patch{Title: str("Gym v2")}, ScopeFollowing, "2026-11-18T16:00:00", nil)
	if err != nil || res.Created == nil {
		t.Fatal(err)
	}
	cs := f.changes(t, cursor, 100)
	ids := []string{}
	for _, u := range cs.Upserted {
		ids = append(ids, u.ID)
	}
	sort.Strings(ids)
	want := []string{e.ID, res.Created.ID}
	sort.Strings(want)
	if !reflect.DeepEqual(ids, want) {
		t.Fatalf("upserted %v, want %v", ids, want)
	}
}
