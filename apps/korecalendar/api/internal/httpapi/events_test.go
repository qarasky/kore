package httpapi_test

import (
	"reflect"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

func TestCreateAndGetRoundTrip(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	body := weekly("Gym")
	body["notes"] = "Leg day"
	body["location"] = "Home"
	body["reminders"] = []reminder{{30}, {0}}
	body["rdates"] = []string{"2026-11-10T16:00:00"}
	created := mkEvent(t, srv, tok, body)
	if created.ID == "" || created.Version != 1 || created.CalendarID == "" {
		t.Fatalf("created = %+v", created)
	}
	r := testsrv.Do(t, srv, tok, "GET", "/api/events/"+created.ID, nil)
	var got event
	r.Decode(t, &got)
	if r.Status != 200 || got.Title != "Gym" || got.Notes != "Leg day" || got.Location != "Home" ||
		got.Start != "2026-11-04T16:00:00" || got.End != "2026-11-04T17:00:00" || got.TZ != "Europe/Berlin" ||
		got.RRule != "FREQ=WEEKLY;BYDAY=WE,FR" || len(got.RDates) != 1 || len(got.Reminders) != 2 || got.Exdates == nil {
		t.Fatalf("round trip = %+v (%d)", got, r.Status)
	}
	if r.Header.Get("ETag") != `"1"` {
		t.Fatalf("ETag = %q", r.Header.Get("ETag"))
	}
}

func TestCreateDefaultsCalendarEndAndTimezone(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	testsrv.Do(t, srv, tok, "PATCH", "/api/me", map[string]string{"timezone": "Asia/Almaty"})
	e := mkEvent(t, srv, tok, map[string]any{"title": "Call", "start": "2026-11-04T09:00:00"})
	if e.TZ != "Asia/Almaty" || e.End != "2026-11-04T10:00:00" || e.CalendarID == "" {
		t.Fatalf("defaults = %+v", e)
	}
	d := mkEvent(t, srv, tok, map[string]any{"title": "Holiday", "start": "2026-12-25", "all_day": true})
	if d.End != "2026-12-26" {
		t.Fatalf("all-day end = %q", d.End)
	}
}

func TestEndBeforeStartRejected(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	r := testsrv.Do(t, srv, tok, "POST", "/api/events", map[string]any{"title": "x", "start": "2026-11-04T10:00:00", "end": "2026-11-04T09:00:00", "tz": "UTC"})
	if r.Status != 422 || r.ErrorCode() != "validation_error" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}

func TestEventValidation(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	for name, body := range map[string]map[string]any{
		"blank title":       {"title": "  ", "start": "2026-11-04T10:00:00"},
		"bad start":         {"title": "x", "start": "tomorrow"},
		"bad tz":            {"title": "x", "start": "2026-11-04T10:00:00", "tz": "Mars/Base"},
		"reminder too big":  {"title": "x", "start": "2026-11-04T10:00:00", "reminders": []reminder{{40321}}},
		"reminder negative": {"title": "x", "start": "2026-11-04T10:00:00", "reminders": []reminder{{-1}}},
	} {
		r := testsrv.Do(t, srv, tok, "POST", "/api/events", body)
		if r.Status != 422 || r.ErrorCode() != "validation_error" {
			t.Errorf("%s: %d %s", name, r.Status, r.Body)
		}
	}
	ok := testsrv.Do(t, srv, tok, "POST", "/api/events", map[string]any{"title": "x", "start": "2026-11-04T10:00:00", "reminders": []reminder{{40320}}})
	if ok.Status != 201 {
		t.Errorf("reminder at the 28-day limit: %d %s", ok.Status, ok.Body)
	}
}

func TestUnsupportedRRuleIs422WithCode(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	body := weekly("x")
	body["rrule"] = "FREQ=HOURLY"
	r := testsrv.Do(t, srv, tok, "POST", "/api/events", body)
	if r.Status != 422 || r.ErrorCode() != "unsupported_rrule" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}

func TestRetryWithSameIdempotencyKeyReturnsSameEvent(t *testing.T) {
	srv, db := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	a := mkEvent(t, srv, tok, weekly("Gym"), "Idempotency-Key", "abc-123")
	b := testsrv.Do(t, srv, tok, "POST", "/api/events", weekly("Gym"), "Idempotency-Key", "abc-123")
	if b.Status != 201 || b.Header.Get("Idempotent-Replayed") != "true" {
		t.Fatalf("replay: %d %v %s", b.Status, b.Header, b.Body)
	}
	var again event
	b.Decode(t, &again)
	var n int
	db.QueryRow(`SELECT count(*) FROM events`).Scan(&n)
	if again.ID != a.ID || n != 1 {
		t.Fatalf("ids %q vs %q, %d rows", a.ID, again.ID, n)
	}
}

func TestIdempotencyKeyDifferentBodyConflicts(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	mkEvent(t, srv, tok, weekly("Gym"), "Idempotency-Key", "k1")
	r := testsrv.Do(t, srv, tok, "POST", "/api/events", weekly("Different"), "Idempotency-Key", "k1")
	if r.Status != 409 || r.ErrorCode() != "idempotency_conflict" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}

func TestIdempotencyKeysAreScopedPerUser(t *testing.T) {
	srv, _ := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	other := testsrv.AddUser(t, srv, admin, "u@example.com")
	a := mkEvent(t, srv, admin, weekly("A"), "Idempotency-Key", "shared")
	b := mkEvent(t, srv, other, weekly("B"), "Idempotency-Key", "shared")
	if a.ID == b.ID {
		t.Fatal("idempotency key leaked across users")
	}
}

func TestFailedRequestsDoNotConsumeTheKey(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	bad := weekly("x")
	bad["rrule"] = "FREQ=HOURLY"
	if r := testsrv.Do(t, srv, tok, "POST", "/api/events", bad, "Idempotency-Key", "k"); r.Status != 422 {
		t.Fatalf("%d", r.Status)
	}
	mkEvent(t, srv, tok, weekly("fixed"), "Idempotency-Key", "k")
}

func TestOtherUsersEventIs404(t *testing.T) {
	srv, _ := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	other := testsrv.AddUser(t, srv, admin, "u@example.com")
	e := mkEvent(t, srv, admin, weekly("Private"))
	r := testsrv.Do(t, srv, other, "GET", "/api/events/"+e.ID, nil)
	if r.Status != 404 || r.ErrorCode() != "not_found" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	// ...and may not file an event into someone else's calendar
	body := weekly("sneaky")
	body["calendar_id"] = e.CalendarID
	if r := testsrv.Do(t, srv, other, "POST", "/api/events", body); r.Status != 404 {
		t.Fatalf("foreign calendar: %d %s", r.Status, r.Body)
	}
}

func TestAttributionRecordsTokenName(t *testing.T) {
	srv, _ := testsrv.New(t)
	session := testsrv.Login(t, srv)
	var c struct{ Token string }
	testsrv.Do(t, srv, session, "POST", "/api/tokens", map[string]string{"name": "claude"}).Decode(t, &c)
	byAgent := mkEvent(t, srv, c.Token, weekly("by agent"))
	byUser := mkEvent(t, srv, session, weekly("by user"))
	if byAgent.CreatedBy != "claude" || byAgent.UpdatedBy != "claude" || byUser.CreatedBy != "user" {
		t.Fatalf("agent=%+v user=%+v", byAgent, byUser)
	}
}

func TestDeleteNonEmptyCalendarNeedsForceAndCanBeUndone(t *testing.T) {
	srv, db := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	var work cal
	testsrv.Do(t, srv, tok, "POST", "/api/calendars", map[string]string{"name": "Work", "color": "#7b6cf0"}).Decode(t, &work)
	kept := mkEvent(t, srv, tok, map[string]any{"calendar_id": work.ID, "title": "Standup", "start": "2026-11-04T09:00:00", "tz": "UTC", "rrule": "FREQ=DAILY"})
	earlier := mkEvent(t, srv, tok, map[string]any{"calendar_id": work.ID, "title": "Deleted earlier", "start": "2026-11-04T10:00:00", "tz": "UTC"})
	testsrv.Do(t, srv, tok, "DELETE", "/api/events/"+earlier.ID, nil)

	// without force: refused, nothing changes
	r := testsrv.Do(t, srv, tok, "DELETE", "/api/calendars/"+work.ID, nil)
	if r.Status != 409 || r.ErrorCode() != "calendar_not_empty" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	// with force: the calendar and its events disappear, but only softly
	if r := testsrv.Do(t, srv, tok, "DELETE", "/api/calendars/"+work.ID+"?force=1", nil); r.Status != 204 {
		t.Fatalf("forced: %d %s", r.Status, r.Body)
	}
	var list []cal
	testsrv.Do(t, srv, tok, "GET", "/api/calendars", nil).Decode(t, &list)
	if len(list) != 1 || list[0].Name != "Personal" {
		t.Fatalf("calendars after delete: %+v", list)
	}
	if got := occKeys(t, srv, tok, "2026-11-04T00:00:00Z", "2026-11-06T00:00:00Z"); len(got) != 0 {
		t.Fatalf("deleted calendar's events still listed: %v", got)
	}
	if r := testsrv.Do(t, srv, tok, "GET", "/api/events/"+kept.ID, nil); r.Status != 404 {
		t.Fatalf("event of a deleted calendar readable: %d", r.Status)
	}
	var rows, deletes int
	db.QueryRow(`SELECT count(*) FROM events WHERE id=?`, kept.ID).Scan(&rows)
	db.QueryRow(`SELECT count(*) FROM changes WHERE kind='delete' AND event_id=?`, kept.ID).Scan(&deletes)
	if rows != 1 || deletes != 1 {
		t.Fatalf("event row kept=%d (want 1), delete changes=%d (want 1)", rows, deletes)
	}
	// nothing can be filed into, imported into or exported from it
	body := weekly("x")
	body["calendar_id"] = work.ID
	if r := testsrv.Do(t, srv, tok, "POST", "/api/events", body); r.Status != 404 {
		t.Fatalf("create in deleted calendar: %d", r.Status)
	}
	// ...but it can be restored, and brings back what it lost with it, not what was deleted earlier
	r = testsrv.Do(t, srv, tok, "POST", "/api/calendars/"+work.ID+"/restore", nil)
	var back cal
	r.Decode(t, &back)
	if r.Status != 200 || back.ID != work.ID || back.Name != "Work" {
		t.Fatalf("restore: %d %s", r.Status, r.Body)
	}
	if got := occKeys(t, srv, tok, "2026-11-04T00:00:00Z", "2026-11-06T00:00:00Z"); !reflect.DeepEqual(got, []string{"2026-11-04T09:00:00", "2026-11-05T09:00:00"}) {
		t.Fatalf("after restore: %v", got)
	}
	if r := testsrv.Do(t, srv, tok, "GET", "/api/events/"+earlier.ID, nil); r.Status != 404 {
		t.Fatalf("an event deleted before the calendar came back: %d", r.Status)
	}
	var cs changeSet
	testsrv.Do(t, srv, tok, "GET", "/api/changes?since=0", nil).Decode(t, &cs)
	live := false
	for _, e := range cs.Upserted {
		live = live || e.ID == kept.ID
	}
	if !live {
		t.Fatalf("restored event is not in the sync feed as an upsert: %+v", cs)
	}
}

func TestCalendarRestoreRules(t *testing.T) {
	srv, db := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	other := testsrv.AddUser(t, srv, admin, "u@example.com")
	var c cal
	testsrv.Do(t, srv, admin, "POST", "/api/calendars", map[string]string{"name": "Temp", "color": "#112233"}).Decode(t, &c)
	testsrv.Do(t, srv, admin, "DELETE", "/api/calendars/"+c.ID, nil)
	if r := testsrv.Do(t, srv, other, "POST", "/api/calendars/"+c.ID+"/restore", nil); r.Status != 404 || r.ErrorCode() != "not_found" {
		t.Fatalf("other user: %d %s", r.Status, r.Body)
	}
	db.Exec(`UPDATE calendars SET deleted_at = strftime('%s','now') - 31*86400 WHERE id=?`, c.ID)
	if r := testsrv.Do(t, srv, admin, "POST", "/api/calendars/"+c.ID+"/restore", nil); r.Status != 404 {
		t.Fatalf("after 31 days: %d", r.Status)
	}
}

func TestRestoringAnEventIntoADeletedCalendarIsRefused(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	var work cal
	testsrv.Do(t, srv, tok, "POST", "/api/calendars", map[string]string{"name": "Work", "color": "#7b6cf0"}).Decode(t, &work)
	e := mkEvent(t, srv, tok, map[string]any{"calendar_id": work.ID, "title": "x", "start": "2026-11-04T09:00:00", "tz": "UTC"})
	testsrv.Do(t, srv, tok, "DELETE", "/api/events/"+e.ID, nil)
	testsrv.Do(t, srv, tok, "DELETE", "/api/calendars/"+work.ID+"?force=1", nil)
	r := testsrv.Do(t, srv, tok, "POST", "/api/events/"+e.ID+"/restore", nil)
	if r.Status != 422 || r.ErrorCode() != "validation_error" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}

func TestCreateWritesAChange(t *testing.T) {
	srv, db := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("x"))
	var n int
	db.QueryRow(`SELECT count(*) FROM changes WHERE kind='upsert' AND event_id=?`, e.ID).Scan(&n)
	if n != 1 {
		t.Fatalf("upsert changes = %d", n)
	}
}

type occurrence struct {
	EventID    string `json:"event_id"`
	Key        string `json:"key"`
	Title      string `json:"title"`
	Start      string `json:"start"`
	End        string `json:"end"`
	StartUTC   string `json:"start_utc"`
	IsOverride bool   `json:"is_override"`
}

func TestOccurrencesEndpoint(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	mkEvent(t, srv, tok, weekly("Gym"))
	r := testsrv.Do(t, srv, tok, "GET", "/api/occurrences?from=2026-11-04T00:00:00Z&to=2026-11-18T00:00:00Z", nil)
	var got []occurrence
	r.Decode(t, &got)
	if r.Status != 200 || len(got) != 4 || got[0].Title != "Gym" || got[0].StartUTC != "2026-11-04T15:00:00Z" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	q := testsrv.Do(t, srv, tok, "GET", "/api/occurrences?from=2026-11-04T00:00:00Z&to=2026-11-18T00:00:00Z&q=nomatch", nil)
	var none []occurrence
	q.Decode(t, &none)
	if q.Status != 200 || len(none) != 0 || string(q.Body) == "null\n" {
		t.Fatalf("search: %d %s", q.Status, q.Body)
	}
}

func TestOccurrencesParamErrors(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	for path, wantStatus := range map[string]int{
		"/api/occurrences": 422,
		"/api/occurrences?from=yesterday&to=2026-11-18T00:00:00Z":            422,
		"/api/occurrences?from=2026-11-18T00:00:00Z&to=2026-11-04T00:00:00Z": 422,
	} {
		if r := testsrv.Do(t, srv, tok, "GET", path, nil); r.Status != wantStatus || r.ErrorCode() != "validation_error" {
			t.Errorf("%s: %d %s", path, r.Status, r.Body)
		}
	}
	r := testsrv.Do(t, srv, tok, "GET", "/api/occurrences?from=2026-01-01T00:00:00Z&to=2027-06-01T00:00:00Z", nil)
	if r.Status != 400 || r.ErrorCode() != "range_too_large" {
		t.Fatalf("big range: %d %s", r.Status, r.Body)
	}
	if r := testsrv.Do(t, srv, "", "GET", "/api/occurrences?from=2026-11-04T00:00:00Z&to=2026-11-05T00:00:00Z", nil); r.Status != 401 {
		t.Fatalf("anonymous: %d", r.Status)
	}
}

func TestTooManyOccurrencesAcrossEventsIsRangeTooLarge(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	for i := 0; i < 13; i++ { // 13 daily series x 399 days > 5000
		mkEvent(t, srv, tok, map[string]any{"title": "d", "start": "2026-01-01T09:00:00", "tz": "UTC", "rrule": "FREQ=DAILY"})
	}
	r := testsrv.Do(t, srv, tok, "GET", "/api/occurrences?from=2026-02-01T00:00:00Z&to=2027-03-06T00:00:00Z", nil)
	if r.Status != 400 || r.ErrorCode() != "range_too_large" {
		t.Fatalf("%d %.200s", r.Status, r.Body)
	}
}

type changeSet struct {
	Cursor   int64    `json:"cursor"`
	Upserted []event  `json:"upserted"`
	Deleted  []string `json:"deleted"`
	More     bool     `json:"more"`
}

func TestChangesEndpoint(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	a := mkEvent(t, srv, tok, weekly("A"))
	b := mkEvent(t, srv, tok, weekly("B"))
	var cs changeSet
	r := testsrv.Do(t, srv, tok, "GET", "/api/changes?since=0", nil)
	r.Decode(t, &cs)
	if r.Status != 200 || len(cs.Upserted) != 2 || cs.More || cs.Cursor == 0 {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	testsrv.Do(t, srv, tok, "DELETE", "/api/events/"+a.ID, nil)
	var next changeSet
	testsrv.Do(t, srv, tok, "GET", "/api/changes?since="+itoa(cs.Cursor), nil).Decode(t, &next)
	if len(next.Deleted) != 1 || next.Deleted[0] != a.ID || len(next.Upserted) != 0 || next.Cursor <= cs.Cursor {
		t.Fatalf("%+v", next)
	}
	var small changeSet
	testsrv.Do(t, srv, tok, "GET", "/api/changes?since=0&limit=1", nil).Decode(t, &small)
	if len(small.Upserted)+len(small.Deleted) != 1 || !small.More {
		t.Fatalf("limit=1: %+v", small)
	}
	_ = b
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for ; n > 0; n /= 10 {
		s = string(rune('0'+n%10)) + s
	}
	return s
}

func TestChangesParamErrors(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	for _, q := range []string{"since=-1", "since=abc", "since=0&limit=abc", "since=0&limit=-5"} {
		if r := testsrv.Do(t, srv, tok, "GET", "/api/changes?"+q, nil); r.Status != 422 || r.ErrorCode() != "validation_error" {
			t.Errorf("%s: %d %s", q, r.Status, r.Body)
		}
	}
	if r := testsrv.Do(t, srv, tok, "GET", "/api/changes", nil); r.Status != 200 {
		t.Errorf("defaults: %d", r.Status)
	}
	if r := testsrv.Do(t, srv, "", "GET", "/api/changes", nil); r.Status != 401 {
		t.Errorf("anonymous: %d", r.Status)
	}
}

func TestOccurrencesOfALocalDayDoNotIncludeTheNextDaysAllDayEvents(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	testsrv.Do(t, srv, tok, "PATCH", "/api/me", map[string]string{"timezone": "America/New_York"})
	mkEvent(t, srv, tok, map[string]any{"title": "Today's birthday", "start": "2026-11-04", "all_day": true})
	mkEvent(t, srv, tok, map[string]any{"title": "Tomorrow's birthday", "start": "2026-11-05", "all_day": true})
	// November 4 in New York is 05:00Z to 05:00Z
	got := occs(t, srv, tok, "2026-11-04T05:00:00Z", "2026-11-05T05:00:00Z")
	if len(got) != 1 || got[0].Title != "Today's birthday" || got[0].StartUTC != "2026-11-04T05:00:00Z" {
		t.Fatalf("got %+v", got)
	}
}
