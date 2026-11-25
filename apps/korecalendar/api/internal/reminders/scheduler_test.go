package reminders

import (
	"context"
	"testing"
	"time"

	"github.com/qarasky/korecalendar/api/internal/events"
)

// A single event at 09:00Z with a 30-minute reminder: fires at 08:30Z.
func oneShot(t *testing.T, f fixture) events.Event {
	return f.create(t, events.Input{Title: "Dentist", Start: "2026-11-04T09:00:00", TZ: "UTC", Reminders: []events.Reminder{{MinutesBefore: 30}}})
}

func tick(t *testing.T, s *Scheduler) {
	t.Helper()
	if err := s.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestFirstTickOnlySetsTheCursor(t *testing.T) {
	f := newFixture(t)
	oneShot(t, f)
	ch := &fakeChannel{}
	clk := &clock{}
	clk.set("2026-11-04T08:45:00Z") // the reminder (08:30) is already in the past
	tick(t, NewScheduler(f.db, []Channel{ch}, clk.now))
	if ch.count() != 0 {
		t.Fatalf("sent %d reminders from before the first run", ch.count())
	}
}

func TestSchedulerSendsOnce(t *testing.T) {
	f := newFixture(t)
	oneShot(t, f)
	ch := &fakeChannel{}
	clk := &clock{}
	clk.set("2026-11-04T08:00:00Z")
	s := NewScheduler(f.db, []Channel{ch}, clk.now)
	tick(t, s)
	clk.set("2026-11-04T08:31:00Z")
	tick(t, s)
	tick(t, s)
	clk.add(time.Minute)
	tick(t, s)
	if ch.count() != 1 {
		t.Fatalf("sent %d, want 1", ch.count())
	}
	d := ch.sent[0]
	if d.Title != "Dentist" || d.MinutesBefore != 30 || !d.StartUTC.Equal(at("2026-11-04T09:00:00Z")) {
		t.Fatalf("sent %+v", d)
	}
}

func TestRestartDoesNotResend(t *testing.T) {
	f := newFixture(t)
	oneShot(t, f)
	ch := &fakeChannel{}
	clk := &clock{}
	clk.set("2026-11-04T08:00:00Z")
	tick(t, NewScheduler(f.db, []Channel{ch}, clk.now))
	clk.set("2026-11-04T08:31:00Z")
	tick(t, NewScheduler(f.db, []Channel{ch}, clk.now))
	if ch.count() != 1 {
		t.Fatalf("before restart: %d sends", ch.count())
	}
	// Restart: a new scheduler on the same database.
	clk.set("2026-11-04T08:32:00Z")
	tick(t, NewScheduler(f.db, []Channel{ch}, clk.now))
	// Even with the cursor wound back, the delivery log stops a repeat.
	f.db.Exec(`UPDATE settings SET value='0' WHERE key='reminders.cursor'`)
	tick(t, NewScheduler(f.db, []Channel{ch}, clk.now))
	if ch.count() != 1 {
		t.Fatalf("after restart: %d sends, want 1", ch.count())
	}
}

func TestRestartCatchesUpWithinTenMinutes(t *testing.T) {
	f := newFixture(t)
	f.create(t, events.Input{Title: "Missed-but-recent", Start: "2026-11-04T09:15:00", TZ: "UTC", Reminders: []events.Reminder{{MinutesBefore: 0}}})
	f.create(t, events.Input{Title: "Too-old", Start: "2026-11-04T09:05:00", TZ: "UTC", Reminders: []events.Reminder{{MinutesBefore: 0}}})
	ch := &fakeChannel{}
	clk := &clock{}
	clk.set("2026-11-04T09:00:00Z")
	tick(t, NewScheduler(f.db, []Channel{ch}, clk.now)) // last run before the server went down
	clk.set("2026-11-04T09:20:00Z")                     // comes back 20 minutes later
	tick(t, NewScheduler(f.db, []Channel{ch}, clk.now))
	if ch.count() != 1 || ch.sent[0].Title != "Missed-but-recent" {
		t.Fatalf("sent %+v", ch.sent)
	}
}

func TestPendingRetriedAfterCrash(t *testing.T) {
	f := newFixture(t)
	e := oneShot(t, f)
	ch := &fakeChannel{}
	clk := &clock{}
	clk.set("2026-11-04T08:00:00Z")
	s := NewScheduler(f.db, []Channel{ch}, clk.now)
	tick(t, s)
	// simulate: the row was claimed, then the process died before Send finished
	payload := `{"UserID":"` + f.user.ID + `","EventID":"` + e.ID + `","Key":"2026-11-04T09:00:00","Title":"Dentist","Start":"2026-11-04T09:00:00","StartUTC":"2026-11-04T09:00:00Z","FireAt":"2026-11-04T08:30:00Z","MinutesBefore":30}`
	if _, err := f.db.Exec(`INSERT INTO reminder_deliveries(user_id,event_id,key,minutes_before,channel,state,attempts,fire_at,payload) VALUES(?,?,?,?,?,'pending',0,?,?)`,
		f.user.ID, e.ID, "2026-11-04T09:00:00", 30, "fake", at("2026-11-04T08:30:00Z").Unix(), payload); err != nil {
		t.Fatal(err)
	}
	clk.set("2026-11-04T08:31:00Z")
	tick(t, NewScheduler(f.db, []Channel{ch}, clk.now))
	tick(t, NewScheduler(f.db, []Channel{ch}, clk.now))
	if ch.count() != 1 {
		t.Fatalf("sent %d, want exactly 1", ch.count())
	}
}

func TestFailingChannelGivesUpAfterThreeAttempts(t *testing.T) {
	f := newFixture(t)
	oneShot(t, f)
	ch := &fakeChannel{fail: 100}
	clk := &clock{}
	clk.set("2026-11-04T08:00:00Z")
	s := NewScheduler(f.db, []Channel{ch}, clk.now)
	tick(t, s)
	clk.set("2026-11-04T08:31:00Z")
	for i := 0; i < 6; i++ {
		tick(t, s)
		clk.add(30 * time.Second)
	}
	if ch.count() != 3 {
		t.Fatalf("attempted %d times, want 3", ch.count())
	}
}

func TestRecoveringChannelDeliversOnRetry(t *testing.T) {
	f := newFixture(t)
	oneShot(t, f)
	ch := &fakeChannel{fail: 1}
	clk := &clock{}
	clk.set("2026-11-04T08:00:00Z")
	s := NewScheduler(f.db, []Channel{ch}, clk.now)
	tick(t, s)
	clk.set("2026-11-04T08:31:00Z")
	tick(t, s) // fails
	clk.add(30 * time.Second)
	tick(t, s) // succeeds
	clk.add(30 * time.Second)
	tick(t, s) // nothing left
	if ch.count() != 2 {
		t.Fatalf("attempts %d, want 2", ch.count())
	}
}

func TestChannelsAreIndependent(t *testing.T) {
	f := newFixture(t)
	oneShot(t, f)
	good, bad := &fakeChannel{name: "good"}, &fakeChannel{name: "bad", fail: 100}
	clk := &clock{}
	clk.set("2026-11-04T08:00:00Z")
	s := NewScheduler(f.db, []Channel{good, bad}, clk.now)
	tick(t, s)
	clk.set("2026-11-04T08:31:00Z")
	for i := 0; i < 4; i++ {
		tick(t, s)
		clk.add(30 * time.Second)
	}
	if good.count() != 1 || bad.count() != 3 {
		t.Fatalf("good=%d bad=%d", good.count(), bad.count())
	}
}

func TestSoftDeletedEventSendsNothing(t *testing.T) {
	f := newFixture(t)
	e := oneShot(t, f)
	ch := &fakeChannel{}
	clk := &clock{}
	clk.set("2026-11-04T08:00:00Z")
	s := NewScheduler(f.db, []Channel{ch}, clk.now)
	tick(t, s)
	events.Delete(context.Background(), f.db, f.actor(), e.ID, events.ScopeAll, "", nil)
	clk.set("2026-11-04T08:31:00Z")
	tick(t, s)
	if ch.count() != 0 {
		t.Fatalf("sent %d for a deleted event", ch.count())
	}
}

func TestOldDeliveryRowsArePurged(t *testing.T) {
	f := newFixture(t)
	oneShot(t, f)
	clk := &clock{}
	clk.set("2026-11-04T08:00:00Z")
	s := NewScheduler(f.db, []Channel{&fakeChannel{}}, clk.now)
	tick(t, s)
	clk.set("2026-11-04T08:31:00Z")
	tick(t, s)
	var n int
	f.db.QueryRow(`SELECT count(*) FROM reminder_deliveries`).Scan(&n)
	if n != 1 {
		t.Fatalf("rows %d", n)
	}
	clk.set("2026-11-20T00:00:00Z")
	tick(t, s)
	f.db.QueryRow(`SELECT count(*) FROM reminder_deliveries`).Scan(&n)
	if n != 0 {
		t.Fatalf("old rows kept: %d", n)
	}
}
