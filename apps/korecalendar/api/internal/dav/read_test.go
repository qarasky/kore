package dav_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-webdav"
	"github.com/emersion/go-webdav/caldav"
	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

func client(t *testing.T, srv *httptest.Server, a account) *caldav.Client {
	t.Helper()
	c, err := caldav.NewClient(webdav.HTTPClientWithBasicAuth(nil, a.email, a.token), srv.URL+"/dav/")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

type cal struct{ ID, Name string }

func calendarsOf(t *testing.T, srv *httptest.Server, a account) []cal {
	t.Helper()
	var out []cal
	testsrv.Do(t, srv, a.session, "GET", "/api/calendars", nil).Decode(t, &out)
	return out
}

func makeEvent(t *testing.T, srv *httptest.Server, a account, body map[string]any) string {
	t.Helper()
	r := testsrv.Do(t, srv, a.session, "POST", "/api/events", body)
	if r.Status != 201 {
		t.Fatalf("create event: %d %s", r.Status, r.Body)
	}
	var e struct{ ID string }
	r.Decode(t, &e)
	return e.ID
}

const allprop = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>`

func calPath(a account, calID string) string { return "/dav/" + a.id + "/calendars/" + calID + "/" }

var allEvents = &caldav.CalendarQuery{CompFilter: caldav.CompFilter{Name: "VCALENDAR", Comps: []caldav.CompFilter{{Name: "VEVENT"}}}}

func rangeQuery(from, to string) *caldav.CalendarQuery {
	f, _ := time.Parse(time.RFC3339, from)
	e, _ := time.Parse(time.RFC3339, to)
	return &caldav.CalendarQuery{CompFilter: caldav.CompFilter{Name: "VCALENDAR", Comps: []caldav.CompFilter{{Name: "VEVENT", Start: f, End: e}}}}
}

func titles(t *testing.T, objs []caldav.CalendarObject) []string {
	t.Helper()
	var out []string
	for _, o := range objs {
		for _, c := range o.Data.Children {
			if c.Name == "VEVENT" && c.Props.Get("RECURRENCE-ID") == nil {
				s, _ := c.Props.Text("SUMMARY")
				out = append(out, s)
			}
		}
	}
	return out
}

func TestDiscoveryFindsPrincipalHomeSetAndCalendars(t *testing.T) {
	srv, a, _ := two(t)
	ctx := context.Background()
	work := testsrv.Do(t, srv, a.session, "POST", "/api/calendars", map[string]string{"name": "Work", "color": "#7b6cf0"})
	var w cal
	work.Decode(t, &w)
	c := client(t, srv, a)
	principal, err := c.FindCurrentUserPrincipal(ctx)
	if err != nil || principal != "/dav/"+a.id+"/" {
		t.Fatalf("principal %q %v", principal, err)
	}
	home, err := c.FindCalendarHomeSet(ctx, principal)
	if err != nil || home != "/dav/"+a.id+"/calendars/" {
		t.Fatalf("home %q %v", home, err)
	}
	cals, err := c.FindCalendars(ctx, home)
	if err != nil || len(cals) != 2 {
		t.Fatalf("%+v %v", cals, err)
	}
	names := map[string]caldav.Calendar{}
	for _, x := range cals {
		names[x.Name] = x
		if len(x.SupportedComponentSet) != 1 || x.SupportedComponentSet[0] != "VEVENT" {
			t.Errorf("%s supports %v", x.Name, x.SupportedComponentSet)
		}
	}
	if names["Work"].Path != calPath(a, w.ID) {
		t.Fatalf("work path %q", names["Work"].Path)
	}
	testsrv.Do(t, srv, a.session, "DELETE", "/api/calendars/"+w.ID, nil)
	cals, _ = c.FindCalendars(ctx, home)
	if len(cals) != 1 || cals[0].Name == "Work" {
		t.Fatalf("a deleted calendar is still listed: %+v", cals)
	}
}

func TestListingGivesEachSeriesOnceWithAnETagThatChangesOnEdit(t *testing.T) {
	srv, a, _ := two(t)
	ctx := context.Background()
	c1 := calendarsOf(t, srv, a)[0]
	gym := makeEvent(t, srv, a, map[string]any{"title": "Gym", "start": "2026-11-04T16:00:00", "end": "2026-11-04T17:00:00", "tz": "Europe/Berlin", "rrule": "FREQ=WEEKLY;BYDAY=WE"})
	makeEvent(t, srv, a, map[string]any{"title": "Dentist", "start": "2026-11-05T10:00:00", "end": "2026-11-05T11:00:00", "tz": "Europe/Berlin"})
	cl := client(t, srv, a)
	etags := func() map[string]string {
		objs, err := cl.QueryCalendar(ctx, calPath(a, c1.ID), allEvents)
		if err != nil || len(objs) != 2 {
			t.Fatalf("%d objects, %v", len(objs), err)
		}
		m := map[string]string{}
		for _, o := range objs {
			if o.ETag == "" {
				t.Fatalf("%s has no ETag", o.Path)
			}
			m[o.Path] = o.ETag
		}
		return m
	}
	before := etags()
	testsrv.Do(t, srv, a.session, "PATCH", "/api/events/"+gym, map[string]any{"title": "Gym 2"})
	after := etags()
	changed := 0
	for p, e := range before {
		if after[p] != e {
			changed++
			if !strings.HasSuffix(p, "/"+gym+".ics") {
				t.Errorf("the wrong resource changed: %s", p)
			}
		}
	}
	if changed != 1 {
		t.Fatalf("%d ETags changed", changed)
	}
	// a single-occurrence edit also changes the series' ETag
	e2 := after[calPath(a, c1.ID)+gym+".ics"]
	testsrv.Do(t, srv, a.session, "PATCH", "/api/events/"+gym+"?scope=this&occurrence=2026-11-11T16:00:00", map[string]any{"title": "Special"})
	if etags()[calPath(a, c1.ID)+gym+".ics"] == e2 {
		t.Fatal("an occurrence edit did not change the ETag")
	}
}

func TestGetReturnsExdateAndRecurrenceIDFromRESTEdits(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	id := makeEvent(t, srv, a, map[string]any{"title": "Gym", "start": "2026-11-04T16:00:00", "end": "2026-11-04T17:00:00", "tz": "Europe/Berlin", "rrule": "FREQ=WEEKLY;BYDAY=WE,FR"})
	testsrv.Do(t, srv, a.session, "DELETE", "/api/events/"+id+"?scope=this&occurrence=2026-11-06T16:00:00", nil)
	testsrv.Do(t, srv, a.session, "PATCH", "/api/events/"+id+"?scope=this&occurrence=2026-11-11T16:00:00", map[string]any{"start": "2026-11-11T18:00:00", "title": "Gym (late)"})
	obj, err := client(t, srv, a).GetCalendarObject(context.Background(), calPath(a, c1.ID)+id+".ics")
	if err != nil {
		t.Fatal(err)
	}
	var master, override *ical.Component
	for _, c := range obj.Data.Children {
		if c.Name != "VEVENT" {
			continue
		}
		if c.Props.Get("RECURRENCE-ID") != nil {
			override = c
		} else {
			master = c
		}
	}
	if master == nil || override == nil {
		t.Fatalf("master=%v override=%v", master != nil, override != nil)
	}
	if uid, _ := master.Props.Text("UID"); uid != id {
		t.Errorf("UID %q, want the event id", uid)
	}
	if rr := master.Props.Get("RRULE"); rr == nil || !strings.Contains(rr.Value, "FREQ=WEEKLY") {
		t.Errorf("RRULE %+v", rr)
	}
	if ex := master.Props.Get("EXDATE"); ex == nil || ex.Value != "20261106T160000" || ex.Params.Get("TZID") != "Europe/Berlin" {
		t.Errorf("EXDATE %+v", ex)
	}
	if s, _ := override.Props.Text("SUMMARY"); s != "Gym (late)" {
		t.Errorf("override summary %q", s)
	}
	if d := override.Props.Get("DTSTART"); d == nil || d.Value != "20261111T180000" {
		t.Errorf("override DTSTART %+v", d)
	}
	if r := override.Props.Get("RECURRENCE-ID"); r == nil || r.Value != "20261111T160000" {
		t.Errorf("RECURRENCE-ID %+v", r)
	}
}

func TestTimeRangeAcrossDSTReturnsTheRightSeries(t *testing.T) {
	srv, a, _ := two(t)
	ctx := context.Background()
	c1 := calendarsOf(t, srv, a)[0]
	// Sundays 09:00 in New York; the clocks go back on Sunday 1 Nov 2026.
	id := makeEvent(t, srv, a, map[string]any{"title": "Sunday run", "start": "2026-10-25T09:00:00", "end": "2026-10-25T10:00:00", "tz": "America/New_York", "rrule": "FREQ=WEEKLY;BYDAY=SU"})
	makeEvent(t, srv, a, map[string]any{"title": "Elsewhere", "start": "2026-12-01T09:00:00", "end": "2026-12-01T10:00:00", "tz": "UTC"})
	cl := client(t, srv, a)
	q := func(from, to string) []string {
		objs, err := cl.QueryCalendar(ctx, calPath(a, c1.ID), rangeQuery(from, to))
		if err != nil {
			t.Fatal(err)
		}
		return titles(t, objs)
	}
	// 09:00 EST on 1 Nov is 14:00Z; with the old (EDT) offset it would be 13:00Z.
	if got := q("2026-11-01T14:00:00Z", "2026-11-01T14:30:00Z"); len(got) != 1 || got[0] != "Sunday run" {
		t.Fatalf("after the change: %v", got)
	}
	if got := q("2026-11-01T13:00:00Z", "2026-11-01T13:30:00Z"); len(got) != 0 {
		t.Fatalf("the pre-change offset must not match: %v", got)
	}
	if got := q("2026-10-26T00:00:00Z", "2026-10-31T00:00:00Z"); len(got) != 0 {
		t.Fatalf("a range between occurrences: %v", got)
	}
	// an excluded occurrence no longer matches
	testsrv.Do(t, srv, a.session, "DELETE", "/api/events/"+id+"?scope=this&occurrence=2026-11-08T09:00:00", nil)
	if got := q("2026-11-08T14:00:00Z", "2026-11-08T14:30:00Z"); len(got) != 0 {
		t.Fatalf("an excluded occurrence matched: %v", got)
	}
	if got := q("2026-11-15T14:00:00Z", "2026-11-15T14:30:00Z"); len(got) != 1 {
		t.Fatalf("the next one is missing: %v", got)
	}
	// a very wide range still answers (it may return more than strictly matches)
	objs, err := cl.QueryCalendar(ctx, calPath(a, c1.ID), rangeQuery("1970-01-01T00:00:00Z", "2100-01-01T00:00:00Z"))
	if err != nil || len(objs) != 2 {
		t.Fatalf("wide range: %d %v", len(objs), err)
	}
}

func TestAllDayEventKeepsItsDates(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	id := makeEvent(t, srv, a, map[string]any{"title": "Holiday", "start": "2026-12-24", "end": "2026-12-26", "all_day": true, "tz": "Europe/Berlin"})
	obj, err := client(t, srv, a).GetCalendarObject(context.Background(), calPath(a, c1.ID)+id+".ics")
	if err != nil {
		t.Fatal(err)
	}
	ev := obj.Data.Children[0]
	s, e := ev.Props.Get("DTSTART"), ev.Props.Get("DTEND")
	if s == nil || s.Value != "20261224" || s.Params.Get("VALUE") != "DATE" || e == nil || e.Value != "20261226" {
		t.Fatalf("DTSTART %+v DTEND %+v", s, e)
	}
}

func TestMultigetReturnsOnlyTheCallersOwnResources(t *testing.T) {
	srv, a, b := two(t)
	ctx := context.Background()
	ac := calendarsOf(t, srv, a)[0]
	bc := calendarsOf(t, srv, b)[0]
	e1 := makeEvent(t, srv, a, map[string]any{"title": "Mine 1", "start": "2026-11-04T09:00:00", "end": "2026-11-04T10:00:00", "tz": "UTC"})
	e2 := makeEvent(t, srv, a, map[string]any{"title": "Mine 2", "start": "2026-11-05T09:00:00", "end": "2026-11-05T10:00:00", "tz": "UTC"})
	bev := testsrv.Do(t, srv, b.session, "POST", "/api/events", map[string]any{"title": "Secret of Bea", "start": "2026-11-04T09:00:00", "end": "2026-11-04T10:00:00", "tz": "UTC"})
	var be struct{ ID string }
	bev.Decode(t, &be)
	req := caldav.CalendarCompRequest{AllProps: true, AllComps: true}
	objs, err := client(t, srv, a).MultiGetCalendar(ctx, calPath(a, ac.ID), &caldav.CalendarMultiGet{
		Paths: []string{calPath(a, ac.ID) + e1 + ".ics", calPath(a, ac.ID) + e2 + ".ics"}, CompRequest: req,
	})
	if err != nil || len(titles(t, objs)) != 2 {
		t.Fatalf("own resources: %v %v", titles(t, objs), err)
	}
	// An href outside the caller's tree is not found (the library answers the whole report 404); no data comes back.
	objs, err = client(t, srv, a).MultiGetCalendar(ctx, calPath(a, ac.ID), &caldav.CalendarMultiGet{
		Paths: []string{calPath(a, ac.ID) + e1 + ".ics", calPath(b, bc.ID) + be.ID + ".ics"}, CompRequest: req,
	})
	if err == nil {
		t.Fatalf("expected a 404, got %v", titles(t, objs))
	}
	for _, s := range titles(t, objs) {
		if strings.Contains(s, "Bea") {
			t.Fatalf("another user's event leaked: %v", s)
		}
	}
}

func TestOtherCalendarsAndUsersAre404(t *testing.T) {
	srv, a, b := two(t)
	ac := calendarsOf(t, srv, a)[0]
	bc := calendarsOf(t, srv, b)[0]
	work := testsrv.Do(t, srv, a.session, "POST", "/api/calendars", map[string]string{"name": "Work", "color": "#7b6cf0"})
	var w cal
	work.Decode(t, &w)
	mine := makeEvent(t, srv, a, map[string]any{"title": "Mine", "start": "2026-11-04T09:00:00", "end": "2026-11-04T10:00:00", "tz": "UTC", "calendar_id": ac.ID})
	for name, path := range map[string]string{
		"B's calendar under my principal":     "/dav/" + a.id + "/calendars/" + bc.ID + "/",
		"my event named in my other calendar": calPath(a, w.ID) + mine + ".ics",
		"a name that does not exist":          calPath(a, ac.ID) + "nope.ics",
		"a name without .ics":                 calPath(a, ac.ID) + mine,
	} {
		for _, m := range []string{"GET", "PROPFIND"} {
			r := raw(t, srv, a.email, a.token, m, path, allprop, "Depth", "0")
			if r.status != 404 {
				t.Errorf("%s %s: %d, want 404", m, name, r.status)
			}
		}
	}
	// a soft-deleted calendar is gone
	testsrv.Do(t, srv, a.session, "DELETE", "/api/calendars/"+w.ID, nil)
	if r := raw(t, srv, a.email, a.token, "PROPFIND", calPath(a, w.ID), allprop, "Depth", "0"); r.status != 404 {
		t.Errorf("deleted calendar: %d", r.status)
	}
}

func TestSoftDeletedEventIsNeitherListedNorServed(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	id := makeEvent(t, srv, a, map[string]any{"title": "Gone", "start": "2026-11-04T09:00:00", "end": "2026-11-04T10:00:00", "tz": "UTC"})
	testsrv.Do(t, srv, a.session, "DELETE", "/api/events/"+id, nil)
	objs, err := client(t, srv, a).QueryCalendar(context.Background(), calPath(a, c1.ID), allEvents)
	if err != nil || len(objs) != 0 {
		t.Fatalf("%d objects %v", len(objs), err)
	}
	if r := raw(t, srv, a.email, a.token, "GET", calPath(a, c1.ID)+id+".ics", ""); r.status != 404 {
		t.Fatalf("GET of a deleted event: %d", r.status)
	}
}

func TestDepthInfinityIsAnsweredOrRefusedCleanly(t *testing.T) {
	srv, a, _ := two(t)
	makeEvent(t, srv, a, map[string]any{"title": "x", "start": "2026-11-04T09:00:00", "end": "2026-11-04T10:00:00", "tz": "UTC"})
	body := `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>`
	r := raw(t, srv, a.email, a.token, "PROPFIND", "/dav/"+a.id+"/calendars/", body, "Depth", "infinity")
	if r.status >= 500 {
		t.Fatalf("got %d", r.status)
	}
}

func TestWrongContentTypeAndUnknownReportAreClientErrors(t *testing.T) {
	srv, a, _ := two(t)
	c1 := calendarsOf(t, srv, a)[0]
	r := raw(t, srv, a.email, a.token, "REPORT", calPath(a, c1.ID), `<?xml version="1.0"?><d:sync-collection xmlns:d="DAV:"/>`)
	if r.status < 400 || r.status >= 500 {
		t.Fatalf("unknown REPORT: %d", r.status)
	}
	r = raw(t, srv, a.email, a.token, "PROPFIND", calPath(a, c1.ID), "not xml at all", "Depth", "0")
	if r.status < 400 || r.status >= 500 {
		t.Fatalf("garbage PROPFIND body: %d", r.status)
	}
}
