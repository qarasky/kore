package ics

import (
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/events"
)

func parseFile(t *testing.T, name, defaultTZ string) ([]ParsedEvent, []Issue, []Issue) {
	t.Helper()
	f, err := os.Open("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	items, errs, warns, err := Parse(f, defaultTZ)
	if err != nil {
		t.Fatal(err)
	}
	return items, errs, warns
}

func TestParseGoogleFixture(t *testing.T) {
	items, errs, _ := parseFile(t, "google.ics", "UTC")
	if len(errs) != 0 || len(items) != 2 {
		t.Fatalf("items=%d errs=%v", len(items), errs)
	}
	g := items[0]
	want := events.Input{Title: "Team sync", Notes: "Monthly sync\nBring slides, please", Location: "Room 4",
		Start: "2026-01-13T10:00:00", End: "2026-01-13T11:00:00", TZ: "Europe/Berlin", RRule: "FREQ=MONTHLY;BYDAY=2TU",
		Reminders: []events.Reminder{{MinutesBefore: 30}}}
	if g.UID != "abc123@google.com" || !reflect.DeepEqual(g.Input, want) {
		t.Fatalf("master\n got  %+v\n want %+v", g.Input, want)
	}
	if !reflect.DeepEqual(g.Exdates, []string{"2026-03-10T10:00:00"}) {
		t.Fatalf("exdates %v", g.Exdates)
	}
	if len(g.Overrides) != 1 {
		t.Fatalf("overrides %+v", g.Overrides)
	}
	o := g.Overrides[0]
	if o.Key != "2026-02-10T10:00:00" || o.Title == nil || *o.Title != "Team sync (moved)" ||
		o.Start == nil || *o.Start != "2026-02-10T14:00:00" || o.End != nil /* 15:00 is just start + the series' hour */ || o.Notes != nil || o.Location != nil {
		t.Fatalf("override %+v", o)
	}
	h := items[1]
	if h.UID != "holiday@google.com" || !h.Input.AllDay || h.Input.Start != "2026-12-24" || h.Input.End != "2026-12-27" || h.Input.Title != "Christmas break" {
		t.Fatalf("all-day %+v", h)
	}
}

func TestParseProtonFixture(t *testing.T) {
	items, errs, warns := parseFile(t, "proton.ics", "Asia/Almaty")
	if len(errs) != 0 || len(items) != 3 {
		t.Fatalf("items=%d errs=%v", len(items), errs)
	}
	gym := items[0].Input
	if gym.TZ != "UTC" || gym.Start != "2026-11-04T16:00:00" || gym.End != "2026-11-04T17:30:00" ||
		gym.RRule != "FREQ=WEEKLY;BYDAY=WE,FR;COUNT=10" || !reflect.DeepEqual(gym.Reminders, []events.Reminder{{MinutesBefore: 1440}, {MinutesBefore: 90}}) {
		t.Fatalf("gym %+v", gym)
	}
	floating := items[1].Input
	if floating.TZ != "Asia/Almaty" || floating.Start != "2026-11-05T09:00:00" || floating.Location != "Phone" {
		t.Fatalf("floating %+v", floating)
	}
	lunch := items[2]
	// 18:00Z is 13:00 in New York (EST); Nov 13 17:00Z is Nov 13 12:00 local, the Friday-week occurrence
	if lunch.Input.TZ != "America/New_York" || lunch.Input.Start != "2026-11-06T12:00:00" || lunch.Input.End != "2026-11-06T13:00:00" ||
		!reflect.DeepEqual(lunch.Exdates, []string{"2026-11-13T12:00:00"}) {
		t.Fatalf("lunch %+v exdates %v", lunch.Input, lunch.Exdates)
	}
	_ = warns
}

func TestUnsupportedRuleReportedPerEventOthersImported(t *testing.T) {
	items, errs, _ := parseFile(t, "unsupported.ics", "UTC")
	if len(items) != 1 || items[0].UID != "fine@example.com" {
		t.Fatalf("items %+v", items)
	}
	if len(errs) != 3 {
		t.Fatalf("errors %+v", errs)
	}
	byUID := map[string]Issue{}
	for _, e := range errs {
		byUID[e.UID] = e
	}
	if byUID["hourly@example.com"].Index != 0 || !strings.Contains(byUID["hourly@example.com"].Reason, "daily, weekly, monthly and yearly") ||
		byUID["nostart@example.com"].Index != 2 || !strings.Contains(byUID["nostart@example.com"].Reason, "DTSTART") ||
		byUID["byweek@example.com"].Index != 3 {
		t.Fatalf("errors by uid %+v", byUID)
	}
}

func TestParseRejectsGarbage(t *testing.T) {
	if _, _, _, err := Parse(strings.NewReader("this is not a calendar"), "UTC"); err == nil {
		t.Fatal("garbage accepted")
	}
}

func TestParseUnknownTimeZoneFallsBackWithWarning(t *testing.T) {
	src := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\nBEGIN:VEVENT\r\nUID:a@b\r\nDTSTAMP:20260101T000000Z\r\nDTSTART;TZID=Romance Standard Time:20261104T090000\r\nDTEND;TZID=Romance Standard Time:20261104T100000\r\nSUMMARY:Win\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
	items, errs, warns, err := Parse(strings.NewReader(src), "Europe/Berlin")
	if err != nil || len(errs) != 0 || len(items) != 1 || items[0].Input.TZ != "Europe/Berlin" || len(warns) == 0 {
		t.Fatalf("items=%+v errs=%v warns=%v err=%v", items, errs, warns, err)
	}
}

func TestExportThenParsePreservesEverything(t *testing.T) {
	late, five := "Gym (late)", []events.Reminder{{MinutesBefore: 5}}
	start, end, notes := "2026-11-06T18:00:00", "2026-11-06T19:30:00", "bring; towel, water\nand shoes"
	evs := []events.Event{
		{ID: "ev1", Title: "Gym, \"leg day\"; heavy", Notes: "Leg day\nsecond line, with comma; and semicolon", Location: "Home",
			Start: "2026-11-04T16:00:00", End: "2026-11-04T17:00:00", TZ: "Europe/Berlin", RRule: "FREQ=WEEKLY;BYDAY=WE,FR",
			RDates: []string{"2026-11-10T16:00:00"}, Exdates: []string{"2026-11-13T16:00:00"}, Reminders: []events.Reminder{{MinutesBefore: 30}, {MinutesBefore: 0}},
			Version: 3, UpdatedAt: 1700000000},
		{ID: "ev2", Title: "Holiday", Start: "2026-12-24", End: "2026-12-27", AllDay: true, TZ: "UTC", Version: 1, UpdatedAt: 1700000000},
		{ID: "ev3", ICSUID: "imported@example.com", Title: "Lunch", Start: "2026-11-06T12:00:00", End: "2026-11-06T13:00:00", TZ: "UTC", Version: 1, UpdatedAt: 1700000000},
	}
	overrides := map[string][]events.Override{"ev1": {{Key: "2026-11-06T16:00:00", Title: &late, Notes: &notes, Start: &start, End: &end, Reminders: &five}}}
	data, err := Export(evs, overrides)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, "BEGIN:VCALENDAR") || !strings.Contains(text, "UID:imported@example.com") || !strings.Contains(text, "RECURRENCE-ID;TZID=Europe/Berlin:20261106T160000") {
		t.Fatalf("export looks wrong:\n%s", text)
	}
	items, errs, _, err := Parse(strings.NewReader(text), "UTC")
	if err != nil || len(errs) != 0 || len(items) != 3 {
		t.Fatalf("parse: %d items, errs %v, err %v\n%s", len(items), errs, err, text)
	}
	gym := items[0]
	if gym.UID != "ev1" || gym.Input.Title != evs[0].Title || gym.Input.Notes != evs[0].Notes || gym.Input.Location != "Home" ||
		gym.Input.Start != evs[0].Start || gym.Input.End != evs[0].End || gym.Input.TZ != "Europe/Berlin" || gym.Input.RRule != evs[0].RRule ||
		!reflect.DeepEqual(gym.Input.RDates, evs[0].RDates) || !reflect.DeepEqual(gym.Exdates, evs[0].Exdates) ||
		!reflect.DeepEqual(gym.Input.Reminders, evs[0].Reminders) {
		t.Fatalf("gym lost something:\n got  %+v exdates %v\n want %+v", gym.Input, gym.Exdates, evs[0])
	}
	if len(gym.Overrides) != 1 {
		t.Fatalf("overrides %+v", gym.Overrides)
	}
	o := gym.Overrides[0]
	if o.Key != "2026-11-06T16:00:00" || *o.Title != late || *o.Notes != notes || *o.Start != start || *o.End != end || o.Reminders == nil || (*o.Reminders)[0].MinutesBefore != 5 {
		t.Fatalf("override %+v", o)
	}
	if h := items[1]; !h.Input.AllDay || h.Input.Start != "2026-12-24" || h.Input.End != "2026-12-27" {
		t.Fatalf("holiday %+v", h.Input)
	}
	if items[2].UID != "imported@example.com" {
		t.Fatalf("uid %q", items[2].UID)
	}
}
