package reminders

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/events"
	"github.com/qarasky/korecalendar/api/internal/testutil"
	"github.com/qarasky/korecalendar/api/internal/users"
)

type fixture struct {
	db   *sql.DB
	user users.User
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	db := testutil.NewDB(t)
	u, err := users.Create(context.Background(), db, "a@example.com", "admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := calendars.CreateDefault(context.Background(), db, u.ID); err != nil {
		t.Fatal(err)
	}
	return fixture{db: db, user: u}
}

func (f fixture) actor() events.Actor { return events.Actor{UserID: f.user.ID, Label: "user"} }

func (f fixture) create(t *testing.T, in events.Input) events.Event {
	t.Helper()
	e, err := events.Create(context.Background(), f.db, f.actor(), in)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func at(s string) time.Time {
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return v
}

type clock struct{ t time.Time }

func (c *clock) now() time.Time      { return c.t }
func (c *clock) set(s string)        { c.t = at(s) }
func (c *clock) add(d time.Duration) { c.t = c.t.Add(d) }

// fakeChannel records sends; fail makes the next n sends return an error.
type fakeChannel struct {
	name string
	mu   sync.Mutex
	sent []Due
	fail int
}

func (c *fakeChannel) Name() string {
	if c.name == "" {
		return "fake"
	}
	return c.name
}

func (c *fakeChannel) Send(_ context.Context, _ string, d Due) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sent = append(c.sent, d)
	if c.fail > 0 {
		c.fail--
		return errors.New("push service unavailable")
	}
	return nil
}

func (c *fakeChannel) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.sent)
}
