package events

import (
	"context"
	"reflect"
	"testing"
)

func (f fixture) importEvent(t *testing.T, im Imported) (ImportResult, error) {
	return Import(context.Background(), f.db, f.actor(), "", im)
}

func gymImport() Imported {
	return Imported{UID: "gym@example.com",
		Input:     Input{Title: "Gym", Start: "2026-11-04T16:00:00", End: "2026-11-04T17:00:00", TZ: "Europe/Berlin", RRule: "FREQ=WEEKLY;BYDAY=WE,FR", Reminders: []Reminder{{MinutesBefore: 30}}},
		Exdates:   []string{"2026-11-06T16:00:00", "2026-11-05T16:00:00"}, // the second is not an occurrence
		Overrides: []Override{{Key: "2026-11-11T16:00:00", Title: str("Gym (late)"), Start: str("2026-11-11T18:00:00")}, {Key: "2026-11-12T16:00:00", Title: str("ghost")}}}
}

func TestImportCreatesThenUpdatesBySameUID(t *testing.T) {
	f := newFixture(t)
	r1, err := f.importEvent(t, gymImport())
	if err != nil || !r1.Created {
		t.Fatalf("%+v %v", r1, err)
	}
	if r1.Event.ICSUID != "gym@example.com" || !reflect.DeepEqual(r1.Event.Exdates, []string{"2026-11-06T16:00:00"}) ||
		!reflect.DeepEqual(r1.SkippedOverrides, []string{"2026-11-12T16:00:00"}) {
		t.Fatalf("result %+v", r1)
	}
	again := gymImport()
	again.Input.Title = "Gym v2"
	again.Overrides = nil
	r2, err := f.importEvent(t, again)
	if err != nil || r2.Created || r2.Event.ID != r1.Event.ID || r2.Event.Title != "Gym v2" || r2.Event.Version != 2 {
		t.Fatalf("%+v %v", r2, err)
	}
	var events, overrides int
	f.db.QueryRow(`SELECT count(*) FROM events`).Scan(&events)
	f.db.QueryRow(`SELECT count(*) FROM event_overrides`).Scan(&overrides)
	if events != 1 || overrides != 0 {
		t.Fatalf("events=%d overrides=%d (a re-import replaces the old overrides)", events, overrides)
	}
}

func TestImportMatchesNativeEventByItsOwnID(t *testing.T) {
	f := newFixture(t)
	native := f.create(t, Input{Title: "Mine", Start: "2026-11-04T09:00:00", TZ: "UTC"})
	r, err := f.importEvent(t, Imported{UID: native.ID, Input: Input{Title: "Mine, edited elsewhere", Start: "2026-11-04T09:00:00", End: "2026-11-04T10:00:00", TZ: "UTC"}})
	if err != nil || r.Created || r.Event.ID != native.ID || r.Event.Title != "Mine, edited elsewhere" {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestImportRestoresASoftDeletedMatch(t *testing.T) {
	f := newFixture(t)
	r1, _ := f.importEvent(t, gymImport())
	Delete(context.Background(), f.db, f.actor(), r1.Event.ID, ScopeAll, "", nil)
	r2, err := f.importEvent(t, gymImport())
	if err != nil || r2.Created || r2.Event.DeletedAt != nil {
		t.Fatalf("%+v %v", r2, err)
	}
}

func TestImportValidatesLikeCreate(t *testing.T) {
	f := newFixture(t)
	bad := gymImport()
	bad.Input.RRule = "FREQ=HOURLY"
	if _, err := f.importEvent(t, bad); err == nil {
		t.Fatal("unsupported rule imported")
	}
	bad = gymImport()
	bad.Input.Title = ""
	if _, err := f.importEvent(t, bad); err == nil {
		t.Fatal("blank title imported")
	}
}

func TestImportIntoOtherUsersCalendarIsNotFound(t *testing.T) {
	f := newFixture(t)
	if _, err := Import(context.Background(), f.db, f.actor(), "not-my-calendar", gymImport()); err != ErrNotFound {
		t.Fatalf("got %v", err)
	}
}
