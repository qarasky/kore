package events

import (
	"context"
	"database/sql"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/testutil"
	"github.com/qarasky/korecalendar/api/internal/users"
)

type fixture struct {
	db   *sql.DB
	user users.User
	cal  calendars.Calendar
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	db := testutil.NewDB(t)
	ctx := context.Background()
	u, err := users.Create(ctx, db, "a@example.com", "admin")
	if err != nil {
		t.Fatal(err)
	}
	c, err := calendars.CreateDefault(ctx, db, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	return fixture{db: db, user: u, cal: c}
}

func (f fixture) actor() Actor { return Actor{UserID: f.user.ID, Label: "user"} }

func (f fixture) create(t *testing.T, in Input) Event {
	t.Helper()
	e, err := Create(context.Background(), f.db, f.actor(), in)
	if err != nil {
		t.Fatalf("Create(%+v): %v", in, err)
	}
	return e
}

func (f fixture) exdate(t *testing.T, id, key string) {
	t.Helper()
	if _, err := f.db.Exec(`INSERT INTO event_exdates(event_id,key) VALUES(?,?)`, id, key); err != nil {
		t.Fatal(err)
	}
}

func (f fixture) override(t *testing.T, id string, o Override) {
	t.Helper()
	if err := upsertOverride(context.Background(), f.db, id, o); err != nil {
		t.Fatal(err)
	}
}

func str(s string) *string { return &s }

func rng(from, to string) OccQuery {
	f, _ := time.Parse(time.RFC3339, from)
	t, _ := time.Parse(time.RFC3339, to)
	return OccQuery{From: f, To: t}
}

func (f fixture) occ(t *testing.T, q OccQuery) []Occurrence {
	t.Helper()
	got, err := Occurrences(context.Background(), f.db, f.user.ID, q)
	if err != nil {
		t.Fatalf("Occurrences: %v", err)
	}
	return got
}

func keysOf(os []Occurrence) []string {
	out := []string{}
	for _, o := range os {
		out = append(out, o.Key)
	}
	return out
}

func gymSeries() Input {
	return Input{Title: "Gym", Start: "2026-11-04T16:00:00", End: "2026-11-04T17:00:00", TZ: "Europe/Berlin",
		RRule: "FREQ=WEEKLY;BYDAY=WE,TH,FR", Reminders: []Reminder{{30}}}
}

func TestRecurringExpandedWithExclusionAndOverride(t *testing.T) {
	f := newFixture(t)
	e := f.create(t, gymSeries())
	f.exdate(t, e.ID, "2026-11-05T16:00:00")
	f.override(t, e.ID, Override{Key: "2026-11-06T16:00:00", Title: str("Gym (late)"), Start: str("2026-11-06T18:00:00"), End: str("2026-11-06T19:00:00")})
	got := f.occ(t, rng("2026-11-04T00:00:00Z", "2026-11-08T00:00:00Z"))
	if want := []string{"2026-11-04T16:00:00", "2026-11-06T16:00:00"}; !reflect.DeepEqual(keysOf(got), want) {
		t.Fatalf("keys %v, want %v", keysOf(got), want)
	}
	o := got[1]
	if !o.IsOverride || !o.IsRecurring || o.Title != "Gym (late)" || o.Start != "2026-11-06T18:00:00" || o.EventID != e.ID ||
		o.StartUTC.Format(time.RFC3339) != "2026-11-06T17:00:00Z" {
		t.Fatalf("override occurrence = %+v", o)
	}
	if got[0].IsOverride || got[0].Title != "Gym" || len(got[0].Reminders) != 1 {
		t.Fatalf("plain occurrence = %+v", got[0])
	}
}

func TestOverrideMovedOutOfRangeFollowsNewTime(t *testing.T) {
	f := newFixture(t)
	e := f.create(t, gymSeries())
	f.override(t, e.ID, Override{Key: "2026-11-06T16:00:00", Start: str("2026-11-20T18:00:00"), End: str("2026-11-20T19:00:00")})
	if got := f.occ(t, rng("2026-11-06T00:00:00Z", "2026-11-07T00:00:00Z")); len(got) != 0 {
		t.Fatalf("moved occurrence still at its old place: %v", keysOf(got))
	}
	got := f.occ(t, rng("2026-11-20T00:00:00Z", "2026-11-21T00:00:00Z"))
	var found *Occurrence
	for i := range got {
		if got[i].Key == "2026-11-06T16:00:00" {
			found = &got[i]
		}
	}
	if found == nil || found.Start != "2026-11-20T18:00:00" {
		t.Fatalf("moved occurrence not found at its new time: %+v", got)
	}
}

func TestOverrideWithoutEndKeepsDuration(t *testing.T) {
	f := newFixture(t)
	e := f.create(t, gymSeries())
	f.override(t, e.ID, Override{Key: "2026-11-06T16:00:00", Start: str("2026-11-06T18:00:00")})
	got := f.occ(t, rng("2026-11-06T00:00:00Z", "2026-11-07T00:00:00Z"))
	if len(got) != 1 || got[0].End != "2026-11-06T19:00:00" {
		t.Fatalf("got %+v", got)
	}
}

func TestOverrideRemindersReplaceSeriesReminders(t *testing.T) {
	f := newFixture(t)
	e := f.create(t, gymSeries())
	none := []Reminder{}
	f.override(t, e.ID, Override{Key: "2026-11-06T16:00:00", Reminders: &none})
	f.override(t, e.ID, Override{Key: "2026-11-04T16:00:00", Reminders: &[]Reminder{{5}, {60}}})
	got := f.occ(t, rng("2026-11-04T00:00:00Z", "2026-11-08T00:00:00Z"))
	byKey := map[string][]Reminder{}
	for _, o := range got {
		byKey[o.Key] = o.Reminders
	}
	if len(byKey["2026-11-06T16:00:00"]) != 0 || len(byKey["2026-11-04T16:00:00"]) != 2 || len(byKey["2026-11-05T16:00:00"]) != 1 {
		t.Fatalf("reminders by key = %v", byKey)
	}
}

func TestCancelledOverrideAndExdateWinOverOverride(t *testing.T) {
	f := newFixture(t)
	e := f.create(t, gymSeries())
	f.override(t, e.ID, Override{Key: "2026-11-04T16:00:00", Cancelled: true})
	f.exdate(t, e.ID, "2026-11-05T16:00:00")
	f.override(t, e.ID, Override{Key: "2026-11-05T16:00:00", Title: str("ghost")})
	got := f.occ(t, rng("2026-11-04T00:00:00Z", "2026-11-06T00:00:00Z"))
	if len(got) != 0 {
		t.Fatalf("expected nothing, got %v", keysOf(got))
	}
}

func TestRangeTooLargeAndInvalidRange(t *testing.T) {
	f := newFixture(t)
	f.create(t, gymSeries())
	if _, err := Occurrences(context.Background(), f.db, f.user.ID, rng("2026-01-01T00:00:00Z", "2027-03-01T00:00:00Z")); !errors.Is(err, ErrRangeTooLarge) {
		t.Fatalf("426-day range: %v, want ErrRangeTooLarge", err)
	}
	if _, err := Occurrences(context.Background(), f.db, f.user.ID, rng("2026-05-01T00:00:00Z", "2026-05-01T00:00:00Z")); !errors.Is(err, ErrValidation) {
		t.Fatalf("empty range: %v, want ErrValidation", err)
	}
}

func TestUnboundedRuleWithinRangeIsBounded(t *testing.T) {
	f := newFixture(t)
	f.create(t, Input{Title: "Daily", Start: "2026-01-01T09:00:00", TZ: "UTC", RRule: "FREQ=DAILY"})
	start := time.Now()
	got := f.occ(t, rng("2026-02-01T00:00:00Z", "2027-03-05T00:00:00Z")) // 397 days
	if len(got) != 397 || time.Since(start) > time.Second {
		t.Fatalf("%d occurrences in %v", len(got), time.Since(start))
	}
	q := rng("2026-02-01T00:00:00Z", "2026-06-01T00:00:00Z")
	q.Limit = 10
	if _, err := Occurrences(context.Background(), f.db, f.user.ID, q); !errors.Is(err, ErrRangeTooLarge) {
		t.Fatalf("limit 10: %v, want ErrRangeTooLarge", err)
	}
}

func TestSearchMatchesTitleNotesAndLocation(t *testing.T) {
	f := newFixture(t)
	f.create(t, Input{Title: "Dentist", Start: "2026-11-04T09:00:00", TZ: "UTC"})
	f.create(t, Input{Title: "Call", Notes: "ask about the DENTAL plan", Start: "2026-11-04T11:00:00", TZ: "UTC"})
	f.create(t, Input{Title: "Lunch", Location: "Dental Cafe", Start: "2026-11-04T13:00:00", TZ: "UTC"})
	f.create(t, Input{Title: "Other", Start: "2026-11-04T15:00:00", TZ: "UTC"})
	q := rng("2026-11-04T00:00:00Z", "2026-11-05T00:00:00Z")
	q.Text = "dent"
	if got := f.occ(t, q); len(got) != 3 {
		t.Fatalf("search 'dent' found %v", keysOf(got))
	}
}

func TestSoftDeletedEventsHidden(t *testing.T) {
	f := newFixture(t)
	e := f.create(t, Input{Title: "Gone", Start: "2026-11-04T09:00:00", TZ: "UTC"})
	f.db.Exec(`UPDATE events SET deleted_at=1 WHERE id=?`, e.ID)
	if got := f.occ(t, rng("2026-11-04T00:00:00Z", "2026-11-05T00:00:00Z")); len(got) != 0 {
		t.Fatalf("deleted event listed: %v", keysOf(got))
	}
}

func TestCalendarFilter(t *testing.T) {
	f := newFixture(t)
	work, _ := calendars.Create(context.Background(), f.db, f.user.ID, "Work", "#7b6cf0")
	f.create(t, Input{Title: "Home", Start: "2026-11-04T09:00:00", TZ: "UTC"})
	f.create(t, Input{CalendarID: work.ID, Title: "Office", Start: "2026-11-04T10:00:00", TZ: "UTC"})
	q := rng("2026-11-04T00:00:00Z", "2026-11-05T00:00:00Z")
	q.CalendarIDs = []string{work.ID}
	got := f.occ(t, q)
	if len(got) != 1 || got[0].Title != "Office" || got[0].CalendarID != work.ID {
		t.Fatalf("got %+v", got)
	}
}

func TestOnlyOwnEventsReturned(t *testing.T) {
	f := newFixture(t)
	f.create(t, Input{Title: "Mine", Start: "2026-11-04T09:00:00", TZ: "UTC"})
	other, _ := users.Create(context.Background(), f.db, "b@example.com", "user")
	got, err := Occurrences(context.Background(), f.db, other.ID, rng("2026-11-04T00:00:00Z", "2026-11-05T00:00:00Z"))
	if err != nil || len(got) != 0 {
		t.Fatalf("other user sees %v, %v", keysOf(got), err)
	}
}

func TestOccurrencesSortedByStart(t *testing.T) {
	f := newFixture(t)
	f.create(t, Input{Title: "Late", Start: "2026-11-04T15:00:00", TZ: "UTC"})
	f.create(t, Input{Title: "Early", Start: "2026-11-04T08:00:00", TZ: "UTC"})
	got := f.occ(t, rng("2026-11-04T00:00:00Z", "2026-11-05T00:00:00Z"))
	if len(got) != 2 || got[0].Title != "Early" {
		t.Fatalf("got %+v", got)
	}
}
