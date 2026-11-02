package reminders

import (
	"context"
	"reflect"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/events"
)

func daily(title string, rs ...events.Reminder) events.Input {
	return events.Input{Title: title, Start: "2026-11-04T09:00:00", End: "2026-11-04T10:00:00", TZ: "UTC", RRule: "FREQ=DAILY", Reminders: rs}
}

func dueKeys(ds []Due) []string {
	out := []string{}
	for _, d := range ds {
		out = append(out, d.Key+"/"+itoa(d.MinutesBefore))
	}
	return out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for ; n > 0; n /= 10 {
		s = string(rune('0'+n%10)) + s
	}
	return s
}

func TestDueRespectsOffsetAndExclusion(t *testing.T) {
	f := newFixture(t)
	e := f.create(t, daily("Standup", events.Reminder{MinutesBefore: 30}))
	if _, err := events.Delete(context.Background(), f.db, f.actor(), e.ID, events.ScopeThis, "2026-11-05T09:00:00", nil); err != nil {
		t.Fatal(err)
	}
	got, err := ComputeDue(context.Background(), f.db, at("2026-11-04T08:00:00Z"), at("2026-11-07T00:00:00Z"))
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"2026-11-04T09:00:00/30", "2026-11-06T09:00:00/30"}; !reflect.DeepEqual(dueKeys(got), want) {
		t.Fatalf("due %v, want %v", dueKeys(got), want)
	}
	if !got[0].FireAt.Equal(at("2026-11-04T08:30:00Z")) || !got[0].StartUTC.Equal(at("2026-11-04T09:00:00Z")) ||
		got[0].Title != "Standup" || got[0].UserID != f.user.ID || got[0].EventID != e.ID {
		t.Fatalf("first due = %+v", got[0])
	}
}

func TestFireWindowIsExclusiveInclusive(t *testing.T) {
	f := newFixture(t)
	f.create(t, events.Input{Title: "x", Start: "2026-11-04T09:00:00", TZ: "UTC", Reminders: []events.Reminder{{MinutesBefore: 30}}})
	// fires exactly at 08:30:00Z: in (08:00, 08:30], out of (08:30, 09:00]
	in, _ := ComputeDue(context.Background(), f.db, at("2026-11-04T08:00:00Z"), at("2026-11-04T08:30:00Z"))
	out, _ := ComputeDue(context.Background(), f.db, at("2026-11-04T08:30:00Z"), at("2026-11-04T09:00:00Z"))
	if len(in) != 1 || len(out) != 0 {
		t.Fatalf("in=%d out=%d", len(in), len(out))
	}
}

func TestOverrideReminderReplacesSeries(t *testing.T) {
	f := newFixture(t)
	e := f.create(t, daily("Standup", events.Reminder{MinutesBefore: 30}))
	five := []events.Reminder{{MinutesBefore: 5}}
	if _, err := events.Update(context.Background(), f.db, f.actor(), e.ID, events.Patch{Reminders: &five}, events.ScopeThis, "2026-11-05T09:00:00", nil); err != nil {
		t.Fatal(err)
	}
	got, _ := ComputeDue(context.Background(), f.db, at("2026-11-04T08:00:00Z"), at("2026-11-06T00:00:00Z"))
	if want := []string{"2026-11-04T09:00:00/30", "2026-11-05T09:00:00/5"}; !reflect.DeepEqual(dueKeys(got), want) {
		t.Fatalf("due %v, want %v", dueKeys(got), want)
	}
}

func TestAllDayReminderCountsBackFromLocalMidnight(t *testing.T) {
	f := newFixture(t)
	f.create(t, events.Input{Title: "Holiday", Start: "2026-11-04", AllDay: true, TZ: "Europe/Berlin", Reminders: []events.Reminder{{MinutesBefore: 60}}})
	got, _ := ComputeDue(context.Background(), f.db, at("2026-11-03T00:00:00Z"), at("2026-11-05T00:00:00Z"))
	// Berlin midnight on Nov 4 is 23:00Z on Nov 3 (CET); an hour earlier is 22:00Z
	if len(got) != 1 || !got[0].FireAt.Equal(at("2026-11-03T22:00:00Z")) {
		t.Fatalf("got %+v", got)
	}
}

func TestSoftDeletedEventHasNoDue(t *testing.T) {
	f := newFixture(t)
	e := f.create(t, daily("Standup", events.Reminder{MinutesBefore: 30}))
	events.Delete(context.Background(), f.db, f.actor(), e.ID, events.ScopeAll, "", nil)
	got, _ := ComputeDue(context.Background(), f.db, at("2026-11-04T08:00:00Z"), at("2026-11-07T00:00:00Z"))
	if len(got) != 0 {
		t.Fatalf("due %v", dueKeys(got))
	}
}

func TestLongWindowHasNoDuplicatesOrGaps(t *testing.T) {
	f := newFixture(t)
	f.create(t, daily("Standup", events.Reminder{MinutesBefore: 0}))
	got, err := ComputeDue(context.Background(), f.db, at("2026-11-04T00:00:00Z"), at("2027-01-03T00:00:00Z")) // 60 days
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, d := range got {
		if seen[d.Key] {
			t.Fatalf("duplicate %s", d.Key)
		}
		seen[d.Key] = true
	}
	if len(got) != 60 {
		t.Fatalf("%d due, want 60", len(got))
	}
}

func TestEachUsersEventsAreIndependent(t *testing.T) {
	f := newFixture(t)
	f.create(t, daily("Mine", events.Reminder{MinutesBefore: 0}))
	got, _ := ComputeDue(context.Background(), f.db, at("2026-11-04T00:00:00Z"), at("2026-11-05T00:00:00Z"))
	if len(got) != 1 || got[0].UserID != f.user.ID {
		t.Fatalf("got %+v", got)
	}
}
