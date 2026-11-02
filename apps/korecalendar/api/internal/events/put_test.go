package events

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/users"
)

func (f fixture) put(calID string, im Imported, o PutOptions) (ImportResult, error) {
	return Put(context.Background(), f.db, f.actor(), calID, im, o)
}

func (f fixture) secondCalendar(t *testing.T) calendars.Calendar {
	t.Helper()
	c, err := calendars.Create(context.Background(), f.db, f.user.ID, "Work", "#7b6cf0")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func ver(n int) *int { return &n }

func TestPutIfVersionMismatchIsRefusedAndChangesNothing(t *testing.T) {
	f := newFixture(t)
	r1, _ := f.put(f.cal.ID, gymImport(), PutOptions{})
	edit := gymImport()
	edit.Input.Title = "Changed"
	if _, err := f.put(f.cal.ID, edit, PutOptions{IfVersion: ver(r1.Event.Version + 1)}); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("got %v", err)
	}
	e, _ := Get(context.Background(), f.db, f.user.ID, r1.Event.ID)
	if e.Title != "Gym" || e.Version != r1.Event.Version {
		t.Fatalf("a refused put changed the event: %+v", e)
	}
}

func TestPutIfVersionMatchUpdatesAndBumpsVersion(t *testing.T) {
	f := newFixture(t)
	r1, _ := f.put(f.cal.ID, gymImport(), PutOptions{})
	edit := gymImport()
	edit.Input.Title = "Changed"
	r2, err := f.put(f.cal.ID, edit, PutOptions{IfVersion: ver(r1.Event.Version)})
	if err != nil || r2.Created || r2.Event.Title != "Changed" || r2.Event.Version != r1.Event.Version+1 {
		t.Fatalf("%+v %v", r2, err)
	}
}

func TestPutIfVersionForAnUnknownUIDIsNotFound(t *testing.T) {
	f := newFixture(t)
	if _, err := f.put(f.cal.ID, gymImport(), PutOptions{IfVersion: ver(1)}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v", err)
	}
}

func TestPutCreateOnlyRefusesAnExistingLiveUID(t *testing.T) {
	f := newFixture(t)
	f.put(f.cal.ID, gymImport(), PutOptions{})
	if _, err := f.put(f.cal.ID, gymImport(), PutOptions{CreateOnly: true}); !errors.Is(err, ErrExists) {
		t.Fatalf("got %v", err)
	}
}

func TestPutCreateOnlyAllowsADeletedUIDWhenFreed(t *testing.T) {
	f := newFixture(t)
	r1, _ := f.put(f.cal.ID, gymImport(), PutOptions{})
	Delete(context.Background(), f.db, f.actor(), r1.Event.ID, ScopeAll, "", nil)
	r2, err := f.put(f.cal.ID, gymImport(), PutOptions{CreateOnly: true, FreeDeletedUID: true})
	if err != nil || !r2.Created || r2.Event.ID == r1.Event.ID {
		t.Fatalf("%+v %v", r2, err)
	}
}

func TestPutSameCalendarRefusesAnotherCalendarAndLeavesTheEventAlone(t *testing.T) {
	f := newFixture(t)
	work := f.secondCalendar(t)
	r1, _ := f.put(f.cal.ID, gymImport(), PutOptions{})
	if _, err := f.put(work.ID, gymImport(), PutOptions{SameCalendar: true}); !errors.Is(err, ErrUIDConflict) {
		t.Fatalf("got %v", err)
	}
	e, _ := Get(context.Background(), f.db, f.user.ID, r1.Event.ID)
	if e.CalendarID != f.cal.ID || e.Version != r1.Event.Version {
		t.Fatalf("the event was touched: %+v", e)
	}
}

func TestPutFreeDeletedUIDCreatesFreshAndTheDeletedOneStaysRestorable(t *testing.T) {
	f := newFixture(t)
	work := f.secondCalendar(t)
	r1, _ := f.put(f.cal.ID, gymImport(), PutOptions{})
	Delete(context.Background(), f.db, f.actor(), r1.Event.ID, ScopeAll, "", nil)
	r2, err := f.put(work.ID, gymImport(), PutOptions{SameCalendar: true, FreeDeletedUID: true})
	if err != nil || !r2.Created || r2.Event.CalendarID != work.ID || r2.Event.ICSUID != "gym@example.com" {
		t.Fatalf("%+v %v", r2, err)
	}
	old, err := Restore(context.Background(), f.db, f.actor(), r1.Event.ID)
	if err != nil || old.DeletedAt != nil || old.CalendarID != f.cal.ID || old.ICSUID != "" {
		t.Fatalf("the deleted event should restore with no UID in its own calendar: %+v %v", old, err)
	}
	var n int
	f.db.QueryRow(`SELECT count(*) FROM events`).Scan(&n)
	if n != 2 {
		t.Fatalf("%d events", n)
	}
}

func TestPutWithoutOptionsStillRestoresASoftDeletedMatch(t *testing.T) {
	f := newFixture(t)
	r1, _ := f.put(f.cal.ID, gymImport(), PutOptions{})
	Delete(context.Background(), f.db, f.actor(), r1.Event.ID, ScopeAll, "", nil)
	r2, err := f.put(f.cal.ID, gymImport(), PutOptions{})
	if err != nil || r2.Created || r2.Event.ID != r1.Event.ID || r2.Event.DeletedAt != nil {
		t.Fatalf("%+v %v", r2, err)
	}
}

func TestPutRaceTwoWritersWithTheSameIfVersion(t *testing.T) {
	f := newFixture(t)
	r1, _ := f.put(f.cal.ID, gymImport(), PutOptions{})
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			edit := gymImport()
			edit.Input.Title = []string{"A", "B"}[i]
			_, errs[i] = f.put(f.cal.ID, edit, PutOptions{IfVersion: ver(r1.Event.Version)})
		}()
	}
	wg.Wait()
	wins, conflicts := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			wins++
		case errors.Is(err, ErrVersionConflict):
			conflicts++
		default:
			t.Fatalf("unexpected error %v", err)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("wins=%d conflicts=%d", wins, conflicts)
	}
}

func TestFindLiveByUID(t *testing.T) {
	f := newFixture(t)
	r1, _ := f.put(f.cal.ID, gymImport(), PutOptions{})
	native := f.create(t, Input{Title: "Mine", Start: "2026-11-04T09:00:00", TZ: "UTC"})
	ctx := context.Background()
	if e, err := FindLiveByUID(ctx, f.db, f.user.ID, "gym@example.com"); err != nil || e.ID != r1.Event.ID {
		t.Fatalf("by ics uid: %+v %v", e, err)
	}
	if e, err := FindLiveByUID(ctx, f.db, f.user.ID, native.ID); err != nil || e.ID != native.ID {
		t.Fatalf("by own id: %+v %v", e, err)
	}
	if _, err := FindLiveByUID(ctx, f.db, f.user.ID, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown: %v", err)
	}
	other, _ := users.Create(ctx, f.db, "b@example.com", "x", "user")
	if _, err := FindLiveByUID(ctx, f.db, other.ID, "gym@example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another user's: %v", err)
	}
	Delete(ctx, f.db, f.actor(), r1.Event.ID, ScopeAll, "", nil)
	if _, err := FindLiveByUID(ctx, f.db, f.user.ID, "gym@example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted: %v", err)
	}
}
