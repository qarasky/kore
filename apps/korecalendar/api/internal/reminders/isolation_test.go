package reminders

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/events"
	"github.com/qarasky/korecalendar/api/internal/users"
)

// addBrokenUser adds a second user with a reminder on an event that has more
// than events.MaxOccurrences extra dates in one week (written straight to the
// table, as data from before the write-time cap could be). Returns the user id.
func addBrokenUser(t *testing.T, f fixture) string {
	t.Helper()
	ctx := context.Background()
	b, err := users.Create(ctx, f.db, "b@example.com", "user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := calendars.CreateDefault(ctx, f.db, b.ID); err != nil {
		t.Fatal(err)
	}
	bad, err := events.Create(ctx, f.db, events.Actor{UserID: b.ID, Label: "user"}, events.Input{
		Title: "flood", Start: "2026-11-04T09:00:00", End: "2026-11-04T09:01:00", TZ: "UTC",
		RDates: []string{"2026-11-05T09:00:00"}, Reminders: []events.Reminder{{MinutesBefore: 5}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < events.MaxOccurrences+10; i++ {
		if _, err := f.db.Exec(`INSERT INTO event_rdates(event_id,start_local) VALUES(?,?)`, bad.ID,
			fmt.Sprintf("2026-11-05T%02d:%02d:%02d", i/3600%24, i/60%60, i%60)); err != nil {
			t.Fatal(err)
		}
	}

	return b.ID
}

// A calendar that cannot be expanded (here: more than events.MaxOccurrences
// extra dates in one week, written before the write-time cap existed) must not
// stop everyone else's reminders.
func TestOneUsersBrokenCalendarDoesNotStopOthersReminders(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t)
	f.create(t, daily("Standup", events.Reminder{MinutesBefore: 30}))

	bID := addBrokenUser(t, f)

	got, err := ComputeDue(ctx, f.db, at("2026-11-04T08:00:00Z"), at("2026-11-04T09:00:00Z"))
	var partial *PartialError
	if !errors.As(err, &partial) {
		t.Fatalf("want a PartialError naming the broken user, got %v", err)
	}
	if len(partial.Users) != 1 || partial.Users[0] != bID {
		t.Fatalf("skipped users = %v, want [%s]", partial.Users, bID)
	}
	if len(got) != 1 || got[0].Title != "Standup" {
		t.Fatalf("the other user's reminder must still fire, got %v", dueKeys(got))
	}
}

func TestSchedulerDeliversDespiteABrokenCalendar(t *testing.T) {
	f := newFixture(t)
	oneShot(t, f)
	addBrokenUser(t, f)
	ch := &fakeChannel{}
	clk := &clock{}
	clk.set("2026-11-04T08:00:00Z")
	s := NewScheduler(f.db, []Channel{ch}, clk.now)
	tick(t, s)
	clk.set("2026-11-04T08:31:00Z")
	tick(t, s)
	if ch.count() != 1 {
		t.Fatalf("sent %d, want the other user's one reminder", ch.count())
	}
}
