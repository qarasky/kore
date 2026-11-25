package dav_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

const ics = "text/calendar; charset=utf-8"

// body builds an iCalendar file from lines.
func body(lines ...string) string {
	return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n" + strings.Join(lines, "\r\n") + "\r\nEND:VCALENDAR\r\n"
}

func vevent(uid, summary, start, end string, extra ...string) string {
	l := []string{"BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:20260101T000000Z", "DTSTART;TZID=Europe/Berlin:" + start, "DTEND;TZID=Europe/Berlin:" + end, "SUMMARY:" + summary}
	l = append(l, extra...)
	l = append(l, "END:VEVENT")
	return strings.Join(l, "\r\n")
}

func put(t *testing.T, srv *httptest.Server, a account, calID, uid, content string, hdr ...string) resp {
	t.Helper()
	hdr = append([]string{"Content-Type", ics}, hdr...)
	return raw(t, srv, a.email, a.token, "PUT", calPath(a, calID)+uid+".ics", content, hdr...)
}

type occ struct {
	EventID    string `json:"event_id"`
	CalendarID string `json:"calendar_id"`
	Title      string `json:"title"`
	Start      string `json:"start"`
	IsOverride bool   `json:"is_override"`
}

func occurrences(t *testing.T, srv *httptest.Server, a account) []occ {
	t.Helper()
	var out []occ
	testsrv.Do(t, srv, a.session, "GET", "/api/occurrences?from=2026-11-01T00:00:00Z&to=2026-12-15T00:00:00Z", nil).Decode(t, &out)
	return out
}

type fullEvent struct {
	ID         string `json:"id"`
	CalendarID string `json:"calendar_id"`
	Title      string `json:"title"`
	ICSUID     string `json:"ics_uid"`
	CreatedBy  string `json:"created_by"`
	UpdatedBy  string `json:"updated_by"`
	Reminders  []struct {
		MinutesBefore int `json:"minutes_before"`
	} `json:"reminders"`
}

func event(t *testing.T, srv *httptest.Server, a account, id string) fullEvent {
	t.Helper()
	var e fullEvent
	r := testsrv.Do(t, srv, a.session, "GET", "/api/events/"+id, nil)
	if r.Status != 200 {
		t.Fatalf("event %s: %d", id, r.Status)
	}
	r.Decode(t, &e)
	return e
}

func count(t *testing.T, srv *httptest.Server, a account, calID string) int {
	t.Helper()
	objs, err := client(t, srv, a).QueryCalendar(context.Background(), calPath(a, calID), allEvents)
	if err != nil {
		t.Fatal(err)
	}
	return len(objs)
}

func TestPutCreatesAndTheWebAppSeesIt(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	r := put(t, srv, a, c1.ID, "ABC-1", body(vevent("ABC-1", "Planning", "20261104T160000", "20261104T170000", "DESCRIPTION:Bring notes", "LOCATION:Room 4")))
	if r.status != 201 {
		t.Fatalf("%d %s", r.status, r.body)
	}
	if r.hdr.Get("ETag") != "" {
		t.Errorf("a PUT must not return an ETag (the client re-reads): %q", r.hdr.Get("ETag"))
	}
	occs := occurrences(t, srv, a)
	if len(occs) != 1 || occs[0].Title != "Planning" || occs[0].CalendarID != c1.ID {
		t.Fatalf("%+v", occs)
	}
	e := event(t, srv, a, occs[0].EventID)
	if e.ICSUID != "ABC-1" || e.CreatedBy != "agent" || e.UpdatedBy != "agent" {
		t.Fatalf("%+v (created_by/updated_by must be the token's name)", e)
	}
}

func TestPutRecurringWithExdateAndOverrideRoundTripsBothWays(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	file := body(
		vevent("gym-1", "Gym", "20261104T160000", "20261104T170000", "RRULE:FREQ=WEEKLY;BYDAY=WE,FR", "EXDATE;TZID=Europe/Berlin:20261106T160000"),
		strings.Join([]string{"BEGIN:VEVENT", "UID:gym-1", "DTSTAMP:20260101T000000Z", "RECURRENCE-ID;TZID=Europe/Berlin:20261111T160000",
			"DTSTART;TZID=Europe/Berlin:20261111T180000", "DTEND;TZID=Europe/Berlin:20261111T190000", "SUMMARY:Gym (late)", "END:VEVENT"}, "\r\n"),
	)
	if r := put(t, srv, a, c1.ID, "gym-1", file); r.status != 201 {
		t.Fatalf("%d %s", r.status, r.body)
	}
	var excluded, late bool
	for _, o := range occurrences(t, srv, a) {
		if strings.HasPrefix(o.Start, "2026-11-06") {
			excluded = true
		}
		if o.IsOverride && o.Title == "Gym (late)" && o.Start == "2026-11-11T18:00:00" {
			late = true
		}
	}
	if excluded || !late {
		t.Fatalf("excluded date present=%v, override present=%v", excluded, late)
	}
	obj, err := client(t, srv, a).GetCalendarObject(context.Background(), calPath(a, c1.ID)+"gym-1.ics")
	if err != nil {
		t.Fatal(err)
	}
	var sawEx, sawOv bool
	for _, c := range obj.Data.Children {
		if ex := c.Props.Get("EXDATE"); ex != nil && ex.Value == "20261106T160000" {
			sawEx = true
		}
		if r := c.Props.Get("RECURRENCE-ID"); r != nil && r.Value == "20261111T160000" {
			sawOv = true
		}
	}
	if !sawEx || !sawOv {
		t.Fatalf("read back: EXDATE=%v RECURRENCE-ID=%v", sawEx, sawOv)
	}
}

func TestPutUpdateWithIfMatchAndStaleIfMatchIs412ChangingNothing(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	put(t, srv, a, c1.ID, "u-1", body(vevent("u-1", "First", "20261104T160000", "20261104T170000")))
	tag := raw(t, srv, a.email, a.token, "GET", calPath(a, c1.ID)+"u-1.ics", "").hdr.Get("ETag")
	if tag == "" {
		t.Fatal("GET returned no ETag")
	}
	id := occurrences(t, srv, a)[0].EventID
	if r := put(t, srv, a, c1.ID, "u-1", body(vevent("u-1", "Second", "20261104T160000", "20261104T170000")), "If-Match", tag); r.status != 201 {
		t.Fatalf("matching If-Match: %d %s", r.status, r.body)
	}
	if e := event(t, srv, a, id); e.Title != "Second" || e.ID != id {
		t.Fatalf("%+v", e)
	}
	r := put(t, srv, a, c1.ID, "u-1", body(vevent("u-1", "Third", "20261104T160000", "20261104T170000")), "If-Match", tag)
	if r.status != 412 {
		t.Fatalf("stale If-Match: %d", r.status)
	}
	if e := event(t, srv, a, id); e.Title != "Second" {
		t.Fatalf("a refused PUT changed the event: %+v", e)
	}
	if r := put(t, srv, a, c1.ID, "missing", body(vevent("missing", "x", "20261104T160000", "20261104T170000")), "If-Match", `"nope-1"`); r.status != 412 {
		t.Fatalf("If-Match on a resource that does not exist: %d", r.status)
	}
}

func TestPutIfNoneMatchStar(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	f := body(vevent("n-1", "New", "20261104T160000", "20261104T170000"))
	if r := put(t, srv, a, c1.ID, "n-1", f, "If-None-Match", "*"); r.status != 201 {
		t.Fatalf("new: %d %s", r.status, r.body)
	}
	if r := put(t, srv, a, c1.ID, "n-1", f, "If-None-Match", "*"); r.status != 412 {
		t.Fatalf("existing: %d", r.status)
	}
}

func TestPutRefusalsAreCleanAndChangeNothing(t *testing.T) {
	srv, a, b := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	bc := calendarsOf(t, srv, b)[0]
	work := testsrv.Do(t, srv, a.session, "POST", "/api/calendars", map[string]string{"name": "Work", "color": "#7b6cf0"})
	var w cal
	work.Decode(t, &w)
	put(t, srv, a, c1.ID, "taken", body(vevent("taken", "Mine", "20261104T160000", "20261104T170000")))
	gone := testsrv.Do(t, srv, a.session, "POST", "/api/calendars", map[string]string{"name": "Gone", "color": "#4fb286"})
	var g cal
	gone.Decode(t, &g)
	testsrv.Do(t, srv, a.session, "DELETE", "/api/calendars/"+g.ID, nil)

	good := body(vevent("x-1", "X", "20261105T160000", "20261105T170000"))
	cases := []struct {
		name           string
		cal, uid, data string
		ctype          string
		min, max       int
		want           string
	}{
		{"VTODO", c1.ID, "t-1", body("BEGIN:VTODO", "UID:t-1", "DTSTAMP:20260101T000000Z", "SUMMARY:todo", "END:VTODO"), ics, 400, 499, "supported-calendar-component"},
		{"name is not the UID", c1.ID, "other-name", good, ics, 400, 499, "valid-calendar-object-resource"},
		{"hourly rule", c1.ID, "h-1", body(vevent("h-1", "H", "20261105T160000", "20261105T170000", "RRULE:FREQ=HOURLY;COUNT=3")), ics, 400, 499, "valid-calendar-object-resource"},
		{"no DTSTART", c1.ID, "n-1", body("BEGIN:VEVENT", "UID:n-1", "DTSTAMP:20260101T000000Z", "SUMMARY:no start", "END:VEVENT"), ics, 400, 499, "valid-calendar-object-resource"},
		{"garbage", c1.ID, "g-1", "this is not a calendar", ics, 400, 400, ""},
		{"wrong content type", c1.ID, "x-1", good, "text/plain", 400, 400, ""},
		{"UID lives in another calendar", w.ID, "taken", body(vevent("taken", "Mine", "20261104T160000", "20261104T170000")), ics, 400, 499, "no-uid-conflict"},
		{"another user's calendar", bc.ID, "x-1", good, ics, 404, 404, ""},
		{"a deleted calendar", g.ID, "x-1", good, ics, 404, 404, ""},
	}
	before := count(t, srv, a, c1.ID) + count(t, srv, a, w.ID)
	for _, c := range cases {
		r := raw(t, srv, a.email, a.token, "PUT", calPath(a, c.cal)+c.uid+".ics", c.data, "Content-Type", c.ctype)
		if r.status < c.min || r.status > c.max {
			t.Errorf("%s: %d %s", c.name, r.status, r.body)
		}
		if c.want != "" && !strings.Contains(r.body, c.want) {
			t.Errorf("%s: body lacks %q: %s", c.name, c.want, r.body)
		}
	}
	if after := count(t, srv, a, c1.ID) + count(t, srv, a, w.ID); after != before {
		t.Fatalf("refused PUTs changed the calendars: %d -> %d", before, after)
	}
	if n := len(occurrences(t, srv, b)); n != 0 {
		t.Fatalf("a PUT leaked into another user's data: %d", n)
	}
}

func TestPutWithoutAlarmsClearsRemindersSetInTheWebApp(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	id := makeEvent(t, srv, a, map[string]any{"title": "Call", "start": "2026-11-04T16:00:00", "end": "2026-11-04T17:00:00", "tz": "Europe/Berlin", "reminders": []map[string]int{{"minutes_before": 30}}})
	if n := len(event(t, srv, a, id).Reminders); n != 1 {
		t.Fatalf("setup: %d reminders", n)
	}
	if r := put(t, srv, a, c1.ID, id, body(vevent(id, "Call", "20261104T160000", "20261104T170000"))); r.status != 201 {
		t.Fatalf("%d %s", r.status, r.body)
	}
	e := event(t, srv, a, id)
	if len(e.Reminders) != 0 || e.UpdatedBy != "agent" {
		t.Fatalf("%+v", e)
	}
}

func TestDeleteThenPutIntoAnotherCalendarMovesTheEvent(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	work := testsrv.Do(t, srv, a.session, "POST", "/api/calendars", map[string]string{"name": "Work", "color": "#7b6cf0"})
	var w cal
	work.Decode(t, &w)
	f := body(vevent("mv-1", "Move me", "20261104T160000", "20261104T170000"))
	put(t, srv, a, c1.ID, "mv-1", f)
	oldID := occurrences(t, srv, a)[0].EventID
	if r := raw(t, srv, a.email, a.token, "DELETE", calPath(a, c1.ID)+"mv-1.ics", ""); r.status != 204 {
		t.Fatalf("delete: %d", r.status)
	}
	if r := put(t, srv, a, w.ID, "mv-1", f, "If-None-Match", "*"); r.status != 201 {
		t.Fatalf("put into the other calendar: %d %s", r.status, r.body)
	}
	occs := occurrences(t, srv, a)
	if len(occs) != 1 || occs[0].CalendarID != w.ID || occs[0].EventID == oldID {
		t.Fatalf("%+v", occs)
	}
	if r := testsrv.Do(t, srv, a.session, "POST", "/api/events/"+oldID+"/restore", nil); r.Status != 200 {
		t.Fatalf("restore: %d %s", r.Status, r.Body)
	}
	old := event(t, srv, a, oldID)
	if old.CalendarID != c1.ID || old.ICSUID != "" {
		t.Fatalf("restored event: %+v", old)
	}
}

func TestPutOntoADeletedUIDDoesNotRestoreIt(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	f := body(vevent("d-1", "Again", "20261104T160000", "20261104T170000"))
	put(t, srv, a, c1.ID, "d-1", f)
	id1 := occurrences(t, srv, a)[0].EventID
	raw(t, srv, a.email, a.token, "DELETE", calPath(a, c1.ID)+"d-1.ics", "")
	put(t, srv, a, c1.ID, "d-1", f)
	occs := occurrences(t, srv, a)
	if len(occs) != 1 || occs[0].EventID == id1 {
		t.Fatalf("the deleted event came back: %+v", occs)
	}
	if r := testsrv.Do(t, srv, a.session, "GET", "/api/events/"+id1, nil); r.Status != 404 {
		t.Fatalf("the deleted event should stay deleted: %d", r.Status)
	}
}

func TestDeleteSoftDeletesAndHonoursIfMatch(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	put(t, srv, a, c1.ID, "x-1", body(vevent("x-1", "X", "20261104T160000", "20261104T170000")))
	id := occurrences(t, srv, a)[0].EventID
	tag := raw(t, srv, a.email, a.token, "GET", calPath(a, c1.ID)+"x-1.ics", "").hdr.Get("ETag")
	put(t, srv, a, c1.ID, "x-1", body(vevent("x-1", "X2", "20261104T160000", "20261104T170000"))) // makes tag stale
	if r := raw(t, srv, a.email, a.token, "DELETE", calPath(a, c1.ID)+"x-1.ics", "", "If-Match", tag); r.status != 412 {
		t.Fatalf("stale If-Match: %d", r.status)
	}
	if e := event(t, srv, a, id); e.Title != "X2" {
		t.Fatal("a refused DELETE changed the event")
	}
	if r := raw(t, srv, a.email, a.token, "DELETE", calPath(a, c1.ID)+"x-1.ics", ""); r.status != 204 {
		t.Fatalf("delete: %d", r.status)
	}
	if r := testsrv.Do(t, srv, a.session, "POST", "/api/events/"+id+"/restore", nil); r.Status != 200 {
		t.Fatalf("a CalDAV delete must be restorable: %d", r.Status)
	}
	if r := raw(t, srv, a.email, a.token, "DELETE", calPath(a, c1.ID)+"unknown.ics", ""); r.status != 404 {
		t.Fatalf("unknown resource: %d", r.status)
	}
}

func TestCalendarCreationAndPropertyChangesAreRefused(t *testing.T) {
	srv, a, _ := two(t)
	home := "/dav/" + a.id + "/calendars/"
	mk := `<?xml version="1.0"?><c:mkcalendar xmlns:c="urn:ietf:params:xml:ns:caldav"/>`
	mkcol := `<?xml version="1.0"?><d:mkcol xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop></d:set></d:mkcol>`
	if r := raw(t, srv, a.email, a.token, "MKCOL", home+"newcal/", mkcol); r.status != 403 || !strings.Contains(r.body, "web app") {
		t.Errorf("MKCOL: %d %s", r.status, r.body)
	}
	if r := raw(t, srv, a.email, a.token, "MKCALENDAR", home+"newcal/", mk); r.status < 400 || r.status == 500 {
		t.Errorf("MKCALENDAR: %d", r.status)
	}
	c1 := calendarsOf(t, srv, a)[0]
	pp := `<?xml version="1.0"?><d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:displayname>x</d:displayname></d:prop></d:set></d:propertyupdate>`
	if r := raw(t, srv, a.email, a.token, "PROPPATCH", calPath(a, c1.ID), pp); r.status != 501 && r.status != 403 {
		t.Errorf("PROPPATCH: %d", r.status)
	}
}

func TestConcurrentDeletesWithTheSameETagNeverError(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	put(t, srv, a, c1.ID, "r-1", body(vevent("r-1", "Race", "20261104T160000", "20261104T170000")))
	tag := raw(t, srv, a.email, a.token, "GET", calPath(a, c1.ID)+"r-1.ics", "").hdr.Get("ETag")
	var wg sync.WaitGroup
	got := make([]int, 2)
	for i := range got {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got[i] = raw(t, srv, a.email, a.token, "DELETE", calPath(a, c1.ID)+"r-1.ics", "", "If-Match", tag).status
		}()
	}
	wg.Wait()
	ok := 0
	for _, s := range got {
		switch s {
		case 204:
			ok++
		case 404, 412:
		default:
			t.Fatalf("statuses %v", got)
		}
	}
	if ok != 1 {
		t.Fatalf("statuses %v: exactly one delete should win", got)
	}
}

func TestAnotherUsersWritesAre404(t *testing.T) {
	srv, a, b := two(t)
	bc := calendarsOf(t, srv, b)[0]
	f := body(vevent("w-1", "W", "20261104T160000", "20261104T170000"))
	if r := raw(t, srv, a.email, a.token, "PUT", "/dav/"+b.id+"/calendars/"+bc.ID+"/w-1.ics", f, "Content-Type", ics); r.status != 404 {
		t.Fatalf("PUT: %d", r.status)
	}
	put(t, srv, b, bc.ID, "w-1", f)
	if r := raw(t, srv, a.email, a.token, "DELETE", "/dav/"+b.id+"/calendars/"+bc.ID+"/w-1.ics", ""); r.status != 404 {
		t.Fatalf("DELETE: %d", r.status)
	}
	if n := count(t, srv, b, bc.ID); n != 1 {
		t.Fatalf("Bea's event is gone: %d", n)
	}
}
