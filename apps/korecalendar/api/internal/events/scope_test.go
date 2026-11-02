package events

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestPurgeDeletedRemovesOnlyOldDeletions(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	old := f.create(t, Input{Title: "old", Start: "2026-11-04T09:00:00", TZ: "UTC", RRule: "FREQ=DAILY"})
	recent := f.create(t, Input{Title: "recent", Start: "2026-11-04T09:00:00", TZ: "UTC"})
	live := f.create(t, Input{Title: "live", Start: "2026-11-04T09:00:00", TZ: "UTC"})
	f.exdate(t, old.ID, "2026-11-05T09:00:00")
	for _, e := range []Event{old, recent} {
		if _, err := Delete(ctx, f.db, f.actor(), e.ID, ScopeAll, "", nil); err != nil {
			t.Fatal(err)
		}
	}
	f.db.Exec(`UPDATE events SET deleted_at=? WHERE id=?`, time.Now().Add(-31*24*time.Hour).Unix(), old.ID)
	n, err := PurgeDeleted(ctx, f.db, time.Now().Add(-30*24*time.Hour))
	if err != nil || n != 1 {
		t.Fatalf("purged %d, %v", n, err)
	}
	var left, exdates int
	f.db.QueryRow(`SELECT count(*) FROM events`).Scan(&left)
	f.db.QueryRow(`SELECT count(*) FROM event_exdates`).Scan(&exdates)
	if left != 2 || exdates != 0 {
		t.Fatalf("events left %d, exdates left %d", left, exdates)
	}
	if _, err := Restore(ctx, f.db, f.actor(), recent.ID); err != nil {
		t.Fatalf("recent deletion should still restore: %v", err)
	}
	if _, err := Get(ctx, f.db, f.user.ID, live.ID); err != nil {
		t.Fatal(err)
	}
}

func TestRestoreOfLiveEventIsHarmless(t *testing.T) {
	f := newFixture(t)
	e := f.create(t, Input{Title: "x", Start: "2026-11-04T09:00:00", TZ: "UTC"})
	got, err := Restore(context.Background(), f.db, f.actor(), e.ID)
	if err != nil || got.Version != 1 || got.DeletedAt != nil {
		t.Fatalf("%+v, %v", got, err)
	}
}

func TestVersionConflictLeavesEventUntouched(t *testing.T) {
	f := newFixture(t)
	e := f.create(t, Input{Title: "x", Start: "2026-11-04T09:00:00", TZ: "UTC"})
	stale := 7
	title := "y"
	if _, err := Update(context.Background(), f.db, f.actor(), e.ID, Patch{Title: &title}, ScopeAll, "", &stale); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("got %v", err)
	}
	got, _ := Get(context.Background(), f.db, f.user.ID, e.ID)
	if got.Title != "x" || got.Version != 1 {
		t.Fatalf("event changed: %+v", got)
	}
}
