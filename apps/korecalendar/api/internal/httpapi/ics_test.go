package httpapi_test

import (
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

type importResult struct {
	Imported int `json:"imported"`
	Created  int `json:"created"`
	Updated  int `json:"updated"`
	Errors   []struct {
		Index  int    `json:"index"`
		UID    string `json:"uid"`
		Reason string `json:"reason"`
	} `json:"errors"`
}

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("../ics/testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func importICS(t *testing.T, srv *httptest.Server, tok, query string, body []byte) (importResult, int) {
	t.Helper()
	r := testsrv.DoRaw(t, srv, tok, "POST", "/api/import"+query, "text/calendar", body)
	var out importResult
	if r.Status == 200 {
		r.Decode(t, &out)
	}
	return out, r.Status
}

func TestImportExportRoundTripAcrossAccounts(t *testing.T) {
	srv, _ := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	other := testsrv.AddUser(t, srv, admin, "u@example.com")
	gym := weekly("Gym, \"leg day\"; heavy")
	gym["notes"] = "line one\nline two, with comma; and semicolon"
	gym["reminders"] = []reminder{{30}, {0}}
	e := mkEvent(t, srv, admin, gym)
	mkEvent(t, srv, admin, map[string]any{"title": "Holiday", "start": "2026-12-24", "end": "2026-12-27", "all_day": true, "tz": "UTC"})
	edit(t, srv, admin, "DELETE", e.ID, "?scope=this&occurrence="+k1113, nil)
	edit(t, srv, admin, "PATCH", e.ID, "?scope=this&occurrence="+k1118, map[string]any{"title": "Special", "start": "2026-11-18T18:00:00"})

	exp := testsrv.Do(t, srv, admin, "GET", "/api/export", nil)
	if exp.Status != 200 || !strings.HasPrefix(exp.Header.Get("Content-Type"), "text/calendar") || !strings.Contains(string(exp.Body), "BEGIN:VCALENDAR") {
		t.Fatalf("export: %d %v", exp.Status, exp.Header)
	}
	res, status := importICS(t, srv, other, "", exp.Body)
	if status != 200 || res.Imported != 2 || res.Created != 2 || len(res.Errors) != 0 {
		t.Fatalf("import: %d %+v", status, res)
	}
	a := occs(t, srv, admin, "2026-11-01T00:00:00Z", "2027-12-01T00:00:00Z")
	b := occs(t, srv, other, "2026-11-01T00:00:00Z", "2027-12-01T00:00:00Z")
	type shape struct{ Title, Start, End, Key string }
	shapes := func(os []occurrence) []shape {
		out := []shape{}
		for _, o := range os {
			out = append(out, shape{o.Title, o.Start, o.End, o.Key})
		}
		return out
	}
	if len(a) < 100 || !reflect.DeepEqual(shapes(a), shapes(b)) {
		t.Fatalf("occurrences differ after the round trip (%d vs %d)\n a[:3]=%v\n b[:3]=%v", len(a), len(b), shapes(a)[:3], shapes(b)[:3])
	}
	for _, o := range b {
		if o.Key == k1113 {
			t.Fatal("excluded occurrence came back")
		}
	}
}

func TestReimportSameUIDUpdates(t *testing.T) {
	srv, db := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	src := fixture(t, "google.ics")
	first, _ := importICS(t, srv, tok, "", src)
	second, _ := importICS(t, srv, tok, "", src)
	var n int
	db.QueryRow(`SELECT count(*) FROM events`).Scan(&n)
	if first.Created != 2 || second.Created != 0 || second.Updated != 2 || n != 2 {
		t.Fatalf("first=%+v second=%+v rows=%d", first, second, n)
	}
	edited := strings.Replace(string(src), "SUMMARY:Team sync\n", "SUMMARY:Team sync v2\n", 1)
	importICS(t, srv, tok, "", []byte(edited))
	var title string
	db.QueryRow(`SELECT title FROM events WHERE ics_uid='abc123@google.com'`).Scan(&title)
	if title != "Team sync v2" {
		t.Fatalf("title %q", title)
	}
}

func TestImportReportsUnsupportedPerEvent(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	res, status := importICS(t, srv, tok, "", fixture(t, "unsupported.ics"))
	if status != 200 || res.Imported != 1 || len(res.Errors) != 3 {
		t.Fatalf("%d %+v", status, res)
	}
}

func TestImportRejectsGarbageAndOversize(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	r := testsrv.DoRaw(t, srv, tok, "POST", "/api/import", "text/calendar", []byte("not a calendar"))
	if r.Status != 422 || r.ErrorCode() != "validation_error" {
		t.Fatalf("garbage: %d %s", r.Status, r.Body)
	}
	big := []byte("BEGIN:VCALENDAR\r\n" + strings.Repeat("X-PAD:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\n", 5*1024*1024/40+10) + "END:VCALENDAR\r\n")
	r = testsrv.DoRaw(t, srv, tok, "POST", "/api/import", "text/calendar", big)
	if r.Status != 413 || r.ErrorCode() != "payload_too_large" {
		t.Fatalf("oversize: %d %.200s", r.Status, r.Body)
	}
}

func TestImportIntoOtherUsersCalendarIs404(t *testing.T) {
	srv, _ := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	other := testsrv.AddUser(t, srv, admin, "u@example.com")
	var c cal
	testsrv.Do(t, srv, admin, "POST", "/api/calendars", map[string]string{"name": "Mine", "color": "#112233"}).Decode(t, &c)
	r := testsrv.DoRaw(t, srv, other, "POST", "/api/import?calendar_id="+c.ID, "text/calendar", fixture(t, "google.ics"))
	if r.Status != 404 || r.ErrorCode() != "not_found" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	if r := testsrv.Do(t, srv, other, "GET", "/api/export?calendar_id="+c.ID, nil); r.Status != 404 {
		t.Fatalf("export of a foreign calendar: %d", r.Status)
	}
}

func TestExportFiltersByCalendarAndOwner(t *testing.T) {
	srv, _ := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	other := testsrv.AddUser(t, srv, admin, "u@example.com")
	var work cal
	testsrv.Do(t, srv, admin, "POST", "/api/calendars", map[string]string{"name": "Work", "color": "#7b6cf0"}).Decode(t, &work)
	mkEvent(t, srv, admin, weekly("Home thing"))
	body := weekly("Office thing")
	body["calendar_id"] = work.ID
	mkEvent(t, srv, admin, body)
	mkEvent(t, srv, other, weekly("Someone else"))
	all := string(testsrv.Do(t, srv, admin, "GET", "/api/export", nil).Body)
	onlyWork := string(testsrv.Do(t, srv, admin, "GET", "/api/export?calendar_id="+work.ID, nil).Body)
	if !strings.Contains(all, "Home thing") || !strings.Contains(all, "Office thing") || strings.Contains(all, "Someone else") {
		t.Fatalf("all:\n%s", all)
	}
	if strings.Contains(onlyWork, "Home thing") || !strings.Contains(onlyWork, "Office thing") {
		t.Fatalf("work only:\n%s", onlyWork)
	}
}

func TestImportDefaultsToFirstCalendarAndKeepsExistingOnes(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	var work cal
	testsrv.Do(t, srv, tok, "POST", "/api/calendars", map[string]string{"name": "Work", "color": "#7b6cf0"}).Decode(t, &work)
	importICS(t, srv, tok, "?calendar_id="+work.ID, fixture(t, "google.ics"))
	var list []cal
	testsrv.Do(t, srv, tok, "GET", "/api/calendars", nil).Decode(t, &list)
	// re-importing without a calendar updates in place: events stay in Work
	importICS(t, srv, tok, "", fixture(t, "google.ics"))
	got := occs(t, srv, tok, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")
	if len(got) == 0 {
		t.Fatal("no occurrences")
	}
	r := testsrv.Do(t, srv, tok, "GET", "/api/events/"+got[0].EventID, nil)
	var e event
	r.Decode(t, &e)
	if e.CalendarID != work.ID {
		t.Fatalf("event moved to %s, want it to stay in %s", e.CalendarID, work.ID)
	}
}

func TestSplittingAnImportedSeriesThisAndFollowing(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	importICS(t, srv, tok, "", fixture(t, "google.ics"))
	got := occs(t, srv, tok, "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z")
	var id string
	for _, o := range got {
		if o.Title == "Team sync" {
			id = o.EventID
		}
	}
	if id == "" {
		t.Fatalf("imported series not found in %+v", got)
	}
	r, res := edit(t, srv, tok, "PATCH", id, "?scope=following&occurrence=2026-04-14T10:00:00", map[string]any{"title": "Team sync v2"})
	if r.Status != 200 || res.Created == nil || res.Created.Title != "Team sync v2" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	titles := map[string]string{}
	for _, o := range occs(t, srv, tok, "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z") {
		titles[o.Key[:10]] = o.Title
	}
	if titles["2026-01-13"] != "Team sync" || titles["2026-04-14"] != "Team sync v2" || titles["2026-05-12"] != "Team sync v2" {
		t.Fatalf("titles %v", titles)
	}
}
