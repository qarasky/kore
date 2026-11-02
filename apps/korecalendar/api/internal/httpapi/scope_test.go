package httpapi_test

import (
	"fmt"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

const (
	k1104 = "2026-11-04T16:00:00" // Wednesday: first occurrence of weekly()
	k1106 = "2026-11-06T16:00:00"
	k1111 = "2026-11-11T16:00:00"
	k1113 = "2026-11-13T16:00:00"
	k1118 = "2026-11-18T16:00:00"
	k1120 = "2026-11-20T16:00:00"
	k1125 = "2026-11-25T16:00:00"
)

type editResp struct {
	event
	Created   *event   `json:"created"`
	Dropped   []string `json:"dropped_overrides"`
	DeletedAt *int64   `json:"deleted_at"`
}

func edit(t *testing.T, srv *httptest.Server, tok, method, id, query string, body any, hdr ...string) (testsrv.Resp, editResp) {
	t.Helper()
	r := testsrv.Do(t, srv, tok, method, "/api/events/"+id+query, body, hdr...)
	var out editResp
	if len(r.Body) > 0 && r.Status < 300 {
		r.Decode(t, &out)
	}
	return r, out
}

func occs(t *testing.T, srv *httptest.Server, tok, from, to string) []occurrence {
	t.Helper()
	r := testsrv.Do(t, srv, tok, "GET", fmt.Sprintf("/api/occurrences?from=%s&to=%s", from, to), nil)
	if r.Status != 200 {
		t.Fatalf("occurrences: %d %s", r.Status, r.Body)
	}
	var out []occurrence
	r.Decode(t, &out)
	return out
}

func keysOf(os []occurrence) []string {
	out := []string{}
	for _, o := range os {
		out = append(out, o.Key)
	}
	return out
}

func occKeys(t *testing.T, srv *httptest.Server, tok, from, to string) []string {
	return keysOf(occs(t, srv, tok, from, to))
}

const nov = "from=2026-11-04T00:00:00Z&to=2026-11-14T00:00:00Z"

func TestDeleteThisAddsExdateOnly(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	r, got := edit(t, srv, tok, "DELETE", e.ID, "?scope=this&occurrence="+k1106, nil)
	if r.Status != 200 || !reflect.DeepEqual(got.Exdates, []string{k1106}) || got.DeletedAt != nil || got.Version != 2 {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	if keys := occKeys(t, srv, tok, "2026-11-04T00:00:00Z", "2026-11-14T00:00:00Z"); !reflect.DeepEqual(keys, []string{k1104, k1111, k1113}) {
		t.Fatalf("keys %v", keys)
	}
	if r, _ := edit(t, srv, tok, "DELETE", e.ID, "?scope=this&occurrence="+k1106, nil); r.Status != 200 {
		t.Fatalf("deleting the same occurrence twice: %d %s", r.Status, r.Body)
	}
}

func TestPatchThisCreatesOverride(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	r, _ := edit(t, srv, tok, "PATCH", e.ID, "?scope=this&occurrence="+k1106, map[string]any{"start": "2026-11-06T18:00:00", "title": "Gym (late)"})
	if r.Status != 200 {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	got := occs(t, srv, tok, "2026-11-04T00:00:00Z", "2026-11-14T00:00:00Z")
	if len(got) != 4 {
		t.Fatalf("%d occurrences", len(got))
	}
	o := got[1]
	if o.Key != k1106 || !o.IsOverride || o.Start != "2026-11-06T18:00:00" || o.End != "2026-11-06T19:00:00" || o.Title != "Gym (late)" {
		t.Fatalf("override = %+v", o)
	}
	if got[0].IsOverride || got[0].Title != "Gym" || got[2].IsOverride {
		t.Fatalf("others changed: %+v", got)
	}
	// editing the same occurrence again merges into the override
	edit(t, srv, tok, "PATCH", e.ID, "?scope=this&occurrence="+k1106, map[string]any{"notes": "bring towel"})
	again := occs(t, srv, tok, "2026-11-06T00:00:00Z", "2026-11-07T00:00:00Z")
	if len(again) != 1 || again[0].Title != "Gym (late)" || again[0].Start != "2026-11-06T18:00:00" {
		t.Fatalf("second edit lost the first: %+v", again)
	}
}

func TestPatchThisValidation(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	for name, c := range map[string]struct {
		query string
		body  map[string]any
		code  string
		want  int
	}{
		"no occurrence":     {"?scope=this", map[string]any{"title": "x"}, "validation_error", 422},
		"not an occurrence": {"?scope=this&occurrence=2026-11-05T16:00:00", map[string]any{"title": "x"}, "not_found", 404},
		"rrule on one":      {"?scope=this&occurrence=" + k1106, map[string]any{"rrule": "FREQ=DAILY"}, "validation_error", 422},
		"tz on one":         {"?scope=this&occurrence=" + k1106, map[string]any{"tz": "UTC"}, "validation_error", 422},
		"end before start":  {"?scope=this&occurrence=" + k1106, map[string]any{"start": "2026-11-06T18:00:00", "end": "2026-11-06T17:00:00"}, "validation_error", 422},
		"bad scope":         {"?scope=sometimes", map[string]any{"title": "x"}, "validation_error", 422},
	} {
		r, _ := edit(t, srv, tok, "PATCH", e.ID, c.query, c.body)
		if r.Status != c.want || r.ErrorCode() != c.code {
			t.Errorf("%s: %d %s", name, r.Status, r.Body)
		}
	}
}

func TestScopeThisOnSingleEventRejected(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, map[string]any{"title": "Once", "start": "2026-11-04T09:00:00", "tz": "UTC"})
	for _, scope := range []string{"this", "following"} {
		r, _ := edit(t, srv, tok, "PATCH", e.ID, "?scope="+scope+"&occurrence=2026-11-04T09:00:00", map[string]any{"title": "x"})
		if r.Status != 422 || r.ErrorCode() != "validation_error" {
			t.Errorf("PATCH scope=%s: %d %s", scope, r.Status, r.Body)
		}
		r, _ = edit(t, srv, tok, "DELETE", e.ID, "?scope="+scope+"&occurrence=2026-11-04T09:00:00", nil)
		if r.Status != 422 {
			t.Errorf("DELETE scope=%s: %d %s", scope, r.Status, r.Body)
		}
	}
}

func TestFollowingSplitsSeries(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	r, got := edit(t, srv, tok, "PATCH", e.ID, "?scope=following&occurrence="+k1118, map[string]any{"title": "Gym v2"})
	if r.Status != 200 || got.Created == nil || got.Created.ID == e.ID || got.Created.Title != "Gym v2" || got.Created.Start != k1118 || got.Title != "Gym" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	if !strings.Contains(got.RRule, "UNTIL=") {
		t.Fatalf("old series was not ended: %q", got.RRule)
	}
	all := occs(t, srv, tok, "2026-11-04T00:00:00Z", "2026-12-04T00:00:00Z")
	var titles []string
	for _, o := range all {
		titles = append(titles, o.Key[5:10]+" "+o.Title)
	}
	want := []string{"11-04 Gym", "11-06 Gym", "11-11 Gym", "11-13 Gym", "11-18 Gym v2", "11-20 Gym v2", "11-25 Gym v2", "11-27 Gym v2", "12-02 Gym v2"}
	if !reflect.DeepEqual(titles, want) {
		t.Fatalf("\n got %v\nwant %v", titles, want)
	}
}

func TestFollowingMovesExdatesAndOverridesToNewSeries(t *testing.T) {
	srv, db := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	edit(t, srv, tok, "DELETE", e.ID, "?scope=this&occurrence="+k1106, nil)
	edit(t, srv, tok, "DELETE", e.ID, "?scope=this&occurrence="+k1120, nil)
	edit(t, srv, tok, "PATCH", e.ID, "?scope=this&occurrence="+k1125, map[string]any{"title": "Special"})
	r, got := edit(t, srv, tok, "PATCH", e.ID, "?scope=following&occurrence="+k1118, map[string]any{"location": "Park"})
	if r.Status != 200 || got.Created == nil {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	if !reflect.DeepEqual(got.Exdates, []string{k1106}) || !reflect.DeepEqual(got.Created.Exdates, []string{k1120}) {
		t.Fatalf("exdates old=%v new=%v", got.Exdates, got.Created.Exdates)
	}
	var movedTo string
	db.QueryRow(`SELECT event_id FROM event_overrides WHERE key=?`, k1125).Scan(&movedTo)
	if movedTo != got.Created.ID {
		t.Fatalf("override stayed on %q, want the new series %q", movedTo, got.Created.ID)
	}
	titles := map[string]string{}
	for _, o := range occs(t, srv, tok, "2026-11-04T00:00:00Z", "2026-12-04T00:00:00Z") {
		titles[o.Key] = o.Title
	}
	if titles[k1125] != "Special" || titles[k1104] != "Gym" || titles[k1118] != "Gym" {
		t.Fatalf("titles %v", titles)
	}
	if _, has := titles[k1106]; has {
		t.Fatal("excluded occurrence came back")
	}
	if _, has := titles[k1120]; has {
		t.Fatal("excluded occurrence came back after the split")
	}
}

func TestFollowingOnFirstOccurrenceEqualsAll(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	r, got := edit(t, srv, tok, "PATCH", e.ID, "?scope=following&occurrence="+k1104, map[string]any{"title": "Renamed"})
	if r.Status != 200 || got.Created != nil || got.ID != e.ID || got.Title != "Renamed" || strings.Contains(got.RRule, "UNTIL") {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}

func TestDeleteFollowing(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	r, got := edit(t, srv, tok, "DELETE", e.ID, "?scope=following&occurrence="+k1118, nil)
	if r.Status != 200 || got.DeletedAt != nil || !strings.Contains(got.RRule, "UNTIL=") {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	keys := occKeys(t, srv, tok, "2026-11-04T00:00:00Z", "2026-12-20T00:00:00Z")
	if !reflect.DeepEqual(keys, []string{k1104, k1106, k1111, k1113}) {
		t.Fatalf("keys %v", keys)
	}
	// deleting from the first occurrence deletes everything
	r, got = edit(t, srv, tok, "DELETE", e.ID, "?scope=following&occurrence="+k1104, nil)
	if r.Status != 200 || got.DeletedAt == nil {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}

func TestDeleteAllThenRestore(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	r, deleted := edit(t, srv, tok, "DELETE", e.ID, "", nil)
	if r.Status != 200 || deleted.DeletedAt == nil || deleted.Version != 2 {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	if g := testsrv.Do(t, srv, tok, "GET", "/api/events/"+e.ID, nil); g.Status != 404 {
		t.Fatalf("deleted event readable: %d", g.Status)
	}
	if got := occKeys(t, srv, tok, "2026-11-04T00:00:00Z", "2026-11-14T00:00:00Z"); len(got) != 0 {
		t.Fatalf("deleted event has occurrences: %v", got)
	}
	r, restored := edit(t, srv, tok, "POST", e.ID+"/restore", "", nil)
	if r.Status != 200 || restored.DeletedAt != nil || restored.Version != 3 || restored.Title != "Gym" || restored.RRule != e.RRule {
		t.Fatalf("restore: %d %s", r.Status, r.Body)
	}
	if got := occKeys(t, srv, tok, "2026-11-04T00:00:00Z", "2026-11-14T00:00:00Z"); len(got) != 4 {
		t.Fatalf("restored occurrences: %v", got)
	}
}

func TestRestoreAfter30DaysNotFound(t *testing.T) {
	srv, db := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	edit(t, srv, tok, "DELETE", e.ID, "", nil)
	db.Exec(`UPDATE events SET deleted_at = strftime('%s','now') - 31*86400 WHERE id=?`, e.ID)
	r, _ := edit(t, srv, tok, "POST", e.ID+"/restore", "", nil)
	if r.Status != 404 || r.ErrorCode() != "not_found" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}

func TestIfMatchMismatchIs412(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	r, got := edit(t, srv, tok, "PATCH", e.ID, "", map[string]any{"title": "A"}, "If-Match", `"1"`)
	if r.Status != 200 || got.Version != 2 || r.Header.Get("ETag") != `"2"` {
		t.Fatalf("first: %d %s", r.Status, r.Body)
	}
	r, _ = edit(t, srv, tok, "PATCH", e.ID, "", map[string]any{"title": "B"}, "If-Match", `"1"`)
	if r.Status != 412 || r.ErrorCode() != "version_conflict" {
		t.Fatalf("stale PATCH: %d %s", r.Status, r.Body)
	}
	r, _ = edit(t, srv, tok, "DELETE", e.ID, "", nil, "If-Match", `"1"`)
	if r.Status != 412 {
		t.Fatalf("stale DELETE: %d %s", r.Status, r.Body)
	}
	if g := testsrv.Do(t, srv, tok, "GET", "/api/events/"+e.ID, nil); g.Status != 200 {
		t.Fatalf("stale delete went through: %d", g.Status)
	}
	if r, _ := edit(t, srv, tok, "PATCH", e.ID, "", map[string]any{"title": "C"}, "If-Match", "garbage"); r.Status != 400 || r.ErrorCode() != "validation_error" {
		t.Fatalf("garbage If-Match: %d %s", r.Status, r.Body)
	}
}

func TestPatchWithoutIfMatchSucceeds(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	edit(t, srv, tok, "PATCH", e.ID, "", map[string]any{"title": "A"})
	r, got := edit(t, srv, tok, "PATCH", e.ID, "", map[string]any{"title": "B"})
	if r.Status != 200 || got.Title != "B" || got.Version != 3 {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}

func TestPatchAllMovesStartKeepingDuration(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	_, got := edit(t, srv, tok, "PATCH", e.ID, "", map[string]any{"start": "2026-11-04T17:30:00"})
	if got.Start != "2026-11-04T17:30:00" || got.End != "2026-11-04T18:30:00" {
		t.Fatalf("start/end = %s / %s", got.Start, got.End)
	}
}

func TestPatchAllValidatesTheResult(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	for name, c := range map[string]struct {
		body map[string]any
		code string
	}{
		"hourly":    {map[string]any{"rrule": "FREQ=HOURLY"}, "unsupported_rrule"},
		"bad tz":    {map[string]any{"tz": "Mars/Base"}, "validation_error"},
		"blank":     {map[string]any{"title": " "}, "validation_error"},
		"reminders": {map[string]any{"reminders": []reminder{{99999}}}, "validation_error"},
	} {
		if r, _ := edit(t, srv, tok, "PATCH", e.ID, "", c.body); r.Status != 422 || r.ErrorCode() != c.code {
			t.Errorf("%s: %d %s", name, r.Status, r.Body)
		}
	}
	// a rejected edit changes nothing
	if g := testsrv.Do(t, srv, tok, "GET", "/api/events/"+e.ID, nil); g.Header.Get("ETag") != `"1"` {
		t.Fatalf("rejected edit bumped the version: %s", g.Header.Get("ETag"))
	}
}

func TestAllEditDropsOrphanedOverridesAndReports(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	edit(t, srv, tok, "PATCH", e.ID, "?scope=this&occurrence="+k1106, map[string]any{"title": "Special"})
	edit(t, srv, tok, "DELETE", e.ID, "?scope=this&occurrence="+k1113, nil)
	// title-only edits keep overrides and exclusions
	if _, got := edit(t, srv, tok, "PATCH", e.ID, "", map[string]any{"notes": "x"}); len(got.Dropped) != 0 || len(got.Exdates) != 1 {
		t.Fatalf("title-only edit dropped things: %+v", got)
	}
	// moving the time of day orphans both
	r, got := edit(t, srv, tok, "PATCH", e.ID, "", map[string]any{"start": "2026-11-04T17:00:00"})
	if r.Status != 200 || !reflect.DeepEqual(got.Dropped, []string{k1106}) || len(got.Exdates) != 0 {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	for _, o := range occs(t, srv, tok, "2026-11-04T00:00:00Z", "2026-11-14T00:00:00Z") {
		if o.IsOverride || o.Title != "Gym" {
			t.Fatalf("stale override survived: %+v", o)
		}
	}
}

func TestMakingAnEventNonRecurringClearsOverrides(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	edit(t, srv, tok, "PATCH", e.ID, "?scope=this&occurrence="+k1106, map[string]any{"title": "Special"})
	r, got := edit(t, srv, tok, "PATCH", e.ID, "", map[string]any{"rrule": ""})
	if r.Status != 200 || got.RRule != "" || !reflect.DeepEqual(got.Dropped, []string{k1106}) {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	if keys := occKeys(t, srv, tok, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"); !reflect.DeepEqual(keys, []string{k1104}) {
		t.Fatalf("keys %v", keys)
	}
}

func TestOtherUsersEventIs404ForEdit(t *testing.T) {
	srv, _ := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	other := testsrv.AddUser(t, srv, admin, "u@example.com")
	e := mkEvent(t, srv, admin, weekly("Private"))
	del := testsrv.Do(t, srv, admin, "DELETE", "/api/events/"+e.ID, nil)
	if del.Status != 200 {
		t.Fatal(del.Status)
	}
	for _, c := range [][2]string{{"PATCH", ""}, {"DELETE", ""}, {"POST", "/restore"}} {
		r := testsrv.Do(t, srv, other, c[0], "/api/events/"+e.ID+c[1], map[string]any{"title": "x"})
		if r.Status != 404 || r.ErrorCode() != "not_found" {
			t.Errorf("%s%s: %d %s", c[0], c[1], r.Status, r.Body)
		}
	}
}

func TestChangesRowWrittenPerMutation(t *testing.T) {
	srv, db := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	e := mkEvent(t, srv, tok, weekly("Gym"))
	edit(t, srv, tok, "PATCH", e.ID, "", map[string]any{"title": "A"})
	edit(t, srv, tok, "DELETE", e.ID, "?scope=this&occurrence="+k1106, nil)
	_, split := edit(t, srv, tok, "PATCH", e.ID, "?scope=following&occurrence="+k1118, map[string]any{"title": "B"})
	edit(t, srv, tok, "DELETE", e.ID, "", nil)
	edit(t, srv, tok, "POST", e.ID+"/restore", "", nil)
	count := func(id, kind string) (n int) {
		db.QueryRow(`SELECT count(*) FROM changes WHERE event_id=? AND kind=?`, id, kind).Scan(&n)
		return
	}
	// create, patch, delete-this, split, restore = 5 upserts; one delete
	if up, del := count(e.ID, "upsert"), count(e.ID, "delete"); up != 5 || del != 1 {
		t.Fatalf("original: upserts %d deletes %d", up, del)
	}
	if up := count(split.Created.ID, "upsert"); up != 1 {
		t.Fatalf("new series upserts %d", up)
	}
}
