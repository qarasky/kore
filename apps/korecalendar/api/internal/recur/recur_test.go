package recur

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

func ts(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func expand(t *testing.T, s Series, from, to string, limit int) []Occurrence {
	t.Helper()
	occs, err := Expand(s, ts(t, from), ts(t, to), limit)
	if err != nil {
		t.Fatalf("Expand: %v", err)
	}
	return occs
}

func keys(occs []Occurrence) []string {
	out := []string{}
	for _, o := range occs {
		out = append(out, o.Key)
	}
	return out
}

func wantKeys(t *testing.T, got []Occurrence, want ...string) {
	t.Helper()
	if want == nil {
		want = []string{}
	}
	if !reflect.DeepEqual(keys(got), want) {
		t.Fatalf("keys\n got  %v\n want %v", keys(got), want)
	}
}

func TestWeeklyWedFri(t *testing.T) {
	s := Series{Start: "2026-11-04T16:00:00", End: "2026-11-04T17:00:00", TZ: "Europe/Berlin", RRule: "FREQ=WEEKLY;BYDAY=WE,FR"}
	got := expand(t, s, "2026-11-04T00:00:00Z", "2026-11-18T00:00:00Z", 100)
	wantKeys(t, got, "2026-11-04T16:00:00", "2026-11-06T16:00:00", "2026-11-11T16:00:00", "2026-11-13T16:00:00")
	if got[0].End != "2026-11-04T17:00:00" || !got[0].StartUTC.Equal(ts(t, "2026-11-04T15:00:00Z")) {
		t.Fatalf("first occurrence = %+v", got[0])
	}
}

func TestExdateSkipsOnlyThatOccurrence(t *testing.T) {
	s := Series{Start: "2026-11-03T09:00:00", End: "2026-11-03T10:00:00", TZ: "UTC", RRule: "FREQ=WEEKLY;BYDAY=TU,TH",
		Exdates: []string{"2026-11-05T09:00:00"}}
	wantKeys(t, expand(t, s, "2026-11-01T00:00:00Z", "2026-11-14T00:00:00Z", 100),
		"2026-11-03T09:00:00", "2026-11-10T09:00:00", "2026-11-12T09:00:00")
}

func TestDSTSpringForwardGap(t *testing.T) {
	s := Series{Start: "2026-03-07T02:30:00", End: "2026-03-07T03:30:00", TZ: "America/New_York", RRule: "FREQ=DAILY"}
	got := expand(t, s, "2026-03-07T00:00:00Z", "2026-03-10T00:00:00Z", 100)
	wantKeys(t, got, "2026-03-07T02:30:00", "2026-03-08T02:30:00", "2026-03-09T02:30:00")
	ny, _ := time.LoadLocation("America/New_York")
	// 02:30 does not exist on 3 March 8: RFC 5545 says use the offset before
	// the gap (EST), which lands at 03:30 EDT.
	if !got[1].StartUTC.Equal(ts(t, "2026-03-08T07:30:00Z")) || got[1].StartUTC.In(ny).Hour() != 3 {
		t.Fatalf("gap day start = %v", got[1].StartUTC)
	}
	if !got[2].StartUTC.Equal(ts(t, "2026-03-09T06:30:00Z")) {
		t.Fatalf("day after gap = %v, want 02:30 EDT", got[2].StartUTC)
	}
}

func TestDSTFallBackOverlap(t *testing.T) {
	s := Series{Start: "2026-10-31T01:30:00", End: "2026-10-31T02:30:00", TZ: "America/New_York", RRule: "FREQ=DAILY"}
	got := expand(t, s, "2026-10-31T00:00:00Z", "2026-11-03T00:00:00Z", 100)
	wantKeys(t, got, "2026-10-31T01:30:00", "2026-11-01T01:30:00", "2026-11-02T01:30:00")
	if !got[1].StartUTC.Equal(ts(t, "2026-11-01T05:30:00Z")) { // first 01:30, EDT
		t.Fatalf("overlap day start = %v, want the first 01:30 (EDT)", got[1].StartUTC)
	}
	if !got[2].StartUTC.Equal(ts(t, "2026-11-02T06:30:00Z")) {
		t.Fatalf("day after = %v", got[2].StartUTC)
	}
}

func TestStaysAtNineAcrossDST(t *testing.T) {
	s := Series{Start: "2026-10-24T09:00:00", End: "2026-10-24T09:30:00", TZ: "Europe/Berlin", RRule: "FREQ=DAILY"}
	got := expand(t, s, "2026-10-24T00:00:00Z", "2026-10-27T00:00:00Z", 100)
	want := []string{"2026-10-24T07:00:00Z", "2026-10-25T08:00:00Z", "2026-10-26T08:00:00Z"}
	for i, w := range want {
		if !got[i].StartUTC.Equal(ts(t, w)) {
			t.Errorf("occurrence %d StartUTC = %v, want %s", i, got[i].StartUTC, w)
		}
	}
}

func TestMonthlyDay31SkipsShortMonths(t *testing.T) {
	s := Series{Start: "2026-01-31T10:00:00", End: "2026-01-31T11:00:00", TZ: "UTC", RRule: "FREQ=MONTHLY;BYMONTHDAY=31"}
	wantKeys(t, expand(t, s, "2026-01-01T00:00:00Z", "2026-07-01T00:00:00Z", 100),
		"2026-01-31T10:00:00", "2026-03-31T10:00:00", "2026-05-31T10:00:00")
}

func TestSecondTuesday(t *testing.T) {
	s := Series{Start: "2026-01-13T09:00:00", End: "2026-01-13T10:00:00", TZ: "UTC", RRule: "FREQ=MONTHLY;BYDAY=2TU"}
	wantKeys(t, expand(t, s, "2026-01-01T00:00:00Z", "2026-05-01T00:00:00Z", 100),
		"2026-01-13T09:00:00", "2026-02-10T09:00:00", "2026-03-10T09:00:00", "2026-04-14T09:00:00")
}

func TestLastWeekday(t *testing.T) {
	s := Series{Start: "2026-01-30T17:00:00", End: "2026-01-30T18:00:00", TZ: "UTC", RRule: "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1"}
	wantKeys(t, expand(t, s, "2026-01-01T00:00:00Z", "2026-05-01T00:00:00Z", 100),
		"2026-01-30T17:00:00", "2026-02-27T17:00:00", "2026-03-31T17:00:00", "2026-04-30T17:00:00")
}

func TestYearlyByMonthSkipsNonLeapYears(t *testing.T) {
	s := Series{Start: "2024-02-29T08:00:00", End: "2024-02-29T09:00:00", TZ: "UTC", RRule: "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29"}
	wantKeys(t, expand(t, s, "2024-01-01T00:00:00Z", "2033-01-01T00:00:00Z", 100),
		"2024-02-29T08:00:00", "2028-02-29T08:00:00", "2032-02-29T08:00:00")
}

func TestCount(t *testing.T) {
	s := Series{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "UTC", RRule: "FREQ=DAILY;COUNT=3"}
	wantKeys(t, expand(t, s, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z", 100),
		"2026-11-02T09:00:00", "2026-11-03T09:00:00", "2026-11-04T09:00:00")
}

func TestUntilIsAnInstant(t *testing.T) {
	// 23:30 JST is 14:30Z; UNTIL 15:00Z on Nov 3 keeps Nov 3 and drops Nov 4.
	s := Series{Start: "2026-11-02T23:30:00", End: "2026-11-03T00:30:00", TZ: "Asia/Tokyo", RRule: "FREQ=DAILY;UNTIL=20261103T150000Z"}
	wantKeys(t, expand(t, s, "2026-11-01T00:00:00Z", "2026-11-10T00:00:00Z", 100),
		"2026-11-02T23:30:00", "2026-11-03T23:30:00")
}

func TestAllDayEventsAreDates(t *testing.T) {
	s := Series{Start: "2026-11-02", End: "2026-11-03", AllDay: true, TZ: "America/New_York", RRule: "FREQ=WEEKLY"}
	got := expand(t, s, "2026-11-01T00:00:00Z", "2026-11-20T00:00:00Z", 100)
	wantKeys(t, got, "2026-11-02", "2026-11-09", "2026-11-16")
	if got[0].Start != "2026-11-02" || got[0].End != "2026-11-03" ||
		!got[0].StartUTC.Equal(ts(t, "2026-11-02T00:00:00Z")) || !got[0].EndUTC.Equal(ts(t, "2026-11-03T00:00:00Z")) {
		t.Fatalf("all-day occurrence = %+v", got[0])
	}
}

func TestRDateAddsOccurrence(t *testing.T) {
	s := Series{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "UTC", RDates: []string{"2026-11-10T09:00:00"}}
	wantKeys(t, expand(t, s, "2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z", 100), "2026-11-02T09:00:00", "2026-11-10T09:00:00")
}

func TestSingleEventInAndOutOfRange(t *testing.T) {
	s := Series{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "UTC"}
	wantKeys(t, expand(t, s, "2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z", 10), "2026-11-02T09:00:00")
	wantKeys(t, expand(t, s, "2026-11-03T00:00:00Z", "2026-11-04T00:00:00Z", 10))
}

func TestMultiDayEventOverlappingRangeIsIncluded(t *testing.T) {
	s := Series{Start: "2026-11-02T20:00:00", End: "2026-11-04T10:00:00", TZ: "UTC"}
	wantKeys(t, expand(t, s, "2026-11-03T00:00:00Z", "2026-11-04T00:00:00Z", 10), "2026-11-02T20:00:00")
	w := Series{Start: "2026-11-02T20:00:00", End: "2026-11-04T10:00:00", TZ: "UTC", RRule: "FREQ=WEEKLY"}
	wantKeys(t, expand(t, w, "2026-11-10T00:00:00Z", "2026-11-11T00:00:00Z", 10), "2026-11-09T20:00:00")
}

func TestValidateRuleRejects(t *testing.T) {
	for _, bad := range []string{"FREQ=HOURLY", "FREQ=SECONDLY", "FREQ=MINUTELY", "FREQ=DAILY;BYHOUR=9",
		"FREQ=YEARLY;BYWEEKNO=1", "FREQ=DAILY;COUNT=3;UNTIL=20261231T000000Z", "garbage", "", "FREQ=WEEKLY;BYDAY=XX"} {
		if err := ValidateRule(bad); !errors.Is(err, ErrUnsupportedRule) {
			t.Errorf("ValidateRule(%q) = %v, want ErrUnsupportedRule", bad, err)
		}
	}
	for _, ok := range []string{"FREQ=WEEKLY;BYDAY=WE,FR", "FREQ=MONTHLY;BYDAY=2TU", "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
		"FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29", "FREQ=WEEKLY;INTERVAL=2;WKST=SU;COUNT=5", "RRULE:FREQ=DAILY;UNTIL=20261231T235959Z", "FREQ=DAILY;UNTIL=20261231"} {
		if err := ValidateRule(ok); err != nil {
			t.Errorf("ValidateRule(%q) = %v, want nil", ok, err)
		}
	}
}

func TestUnboundedRuleIsBounded(t *testing.T) {
	s := Series{Start: "2026-01-01T09:00:00", End: "2026-01-01T10:00:00", TZ: "Europe/Berlin", RRule: "FREQ=DAILY"}
	if _, err := Expand(s, ts(t, "2026-01-01T00:00:00Z"), ts(t, "2046-01-01T00:00:00Z"), 500); !errors.Is(err, ErrTooManyOccurrences) {
		t.Fatalf("20-year range: %v, want ErrTooManyOccurrences", err)
	}
	start := time.Now()
	got := expand(t, s, "2026-02-01T00:00:00Z", "2026-03-03T00:00:00Z", 500)
	if len(got) != 30 || time.Since(start) > 50*time.Millisecond {
		t.Fatalf("30-day range: %d items in %v", len(got), time.Since(start))
	}
}

func TestInvalidSeriesRejected(t *testing.T) {
	for _, s := range []Series{
		{Start: "nope", End: "2026-11-02T10:00:00", TZ: "UTC"},
		{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "Mars/Base"},
		{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "UTC", RRule: "FREQ=HOURLY"},
	} {
		if _, err := Expand(s, time.Now(), time.Now().Add(time.Hour), 10); err == nil {
			t.Errorf("Expand(%+v) succeeded", s)
		}
	}
}

func keysIn(t *testing.T, s Series, from, to string) []string {
	t.Helper()
	return keys(expand(t, s, from, to, 1000))
}

func TestSplitAtWeekly(t *testing.T) {
	s := Series{Start: "2026-11-04T16:00:00", End: "2026-11-04T17:00:00", TZ: "Europe/Berlin", RRule: "FREQ=WEEKLY"}
	before, after, err := SplitAt(s, "2026-11-18T16:00:00")
	if err != nil {
		t.Fatal(err)
	}
	from, to := "2026-11-01T00:00:00Z", "2026-12-10T00:00:00Z"
	wantKeys(t, expand(t, before, from, to, 100), "2026-11-04T16:00:00", "2026-11-11T16:00:00")
	wantKeys(t, expand(t, after, from, to, 100), "2026-11-18T16:00:00", "2026-11-25T16:00:00", "2026-12-02T16:00:00", "2026-12-09T16:00:00")
	if after.Start != "2026-11-18T16:00:00" || after.End != "2026-11-18T17:00:00" || after.TZ != "Europe/Berlin" {
		t.Fatalf("after = %+v", after)
	}
}

func TestSplitAtCountSplitsTheCount(t *testing.T) {
	s := Series{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "UTC", RRule: "FREQ=DAILY;COUNT=10"}
	before, after, err := SplitAt(s, "2026-11-04T09:00:00")
	if err != nil {
		t.Fatal(err)
	}
	from, to := "2026-10-01T00:00:00Z", "2027-01-01T00:00:00Z"
	if b, a := len(expand(t, before, from, to, 100)), len(expand(t, after, from, to, 100)); b != 2 || a != 8 {
		t.Fatalf("counts before/after = %d/%d, want 2/8", b, a)
	}
	if !strings.Contains(before.RRule, "COUNT=2") || !strings.Contains(after.RRule, "COUNT=8") {
		t.Fatalf("rules %q / %q", before.RRule, after.RRule)
	}
}

func TestSplitAtPartitionsExdatesAndRDates(t *testing.T) {
	s := Series{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "UTC", RRule: "FREQ=DAILY",
		Exdates: []string{"2026-11-03T09:00:00", "2026-11-06T09:00:00"}, RDates: []string{"2026-11-03T18:00:00", "2026-11-07T18:00:00"}}
	before, after, err := SplitAt(s, "2026-11-05T09:00:00")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before.Exdates, []string{"2026-11-03T09:00:00"}) || !reflect.DeepEqual(after.Exdates, []string{"2026-11-06T09:00:00"}) ||
		!reflect.DeepEqual(before.RDates, []string{"2026-11-03T18:00:00"}) || !reflect.DeepEqual(after.RDates, []string{"2026-11-07T18:00:00"}) {
		t.Fatalf("before=%+v after=%+v", before, after)
	}
	// The union of both halves equals the original series.
	from, to := "2026-11-01T00:00:00Z", "2026-11-10T00:00:00Z"
	got := append(keysIn(t, before, from, to), keysIn(t, after, from, to)...)
	if want := keysIn(t, s, from, to); !reflect.DeepEqual(got, want) {
		t.Fatalf("union\n got  %v\n want %v", got, want)
	}
}

func TestSplitAtFirstOccurrenceHasEmptyBefore(t *testing.T) {
	s := Series{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "UTC", RRule: "FREQ=DAILY"}
	before, after, err := SplitAt(s, "2026-11-02T09:00:00")
	if err != nil {
		t.Fatal(err)
	}
	if before.Start != "" || !reflect.DeepEqual(after, s) {
		t.Fatalf("before=%+v after=%+v", before, after)
	}
}

func TestSplitAtAllDay(t *testing.T) {
	s := Series{Start: "2026-11-02", End: "2026-11-03", AllDay: true, TZ: "UTC", RRule: "FREQ=DAILY"}
	before, after, err := SplitAt(s, "2026-11-05")
	if err != nil {
		t.Fatal(err)
	}
	from, to := "2026-11-01T00:00:00Z", "2026-11-08T00:00:00Z"
	wantKeys(t, expand(t, before, from, to, 100), "2026-11-02", "2026-11-03", "2026-11-04")
	wantKeys(t, expand(t, after, from, to, 100), "2026-11-05", "2026-11-06", "2026-11-07")
}

func TestSplitAtRejectsNonOccurrence(t *testing.T) {
	s := Series{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "UTC", RRule: "FREQ=WEEKLY"}
	if _, _, err := SplitAt(s, "2026-11-03T09:00:00"); !errors.Is(err, ErrNotAnOccurrence) {
		t.Fatalf("got %v, want ErrNotAnOccurrence", err)
	}
	single := Series{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "UTC"}
	if _, _, err := SplitAt(single, "2026-11-02T09:00:00"); !errors.Is(err, ErrNotRecurring) {
		t.Fatalf("got %v, want ErrNotRecurring", err)
	}
}

func TestSeriesValidate(t *testing.T) {
	ok := Series{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "Europe/Berlin", RRule: "FREQ=DAILY"}
	if err := ok.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []Series{
		{Start: "2026-11-02T11:00:00", End: "2026-11-02T10:00:00", TZ: "UTC"},
		{Start: "2026-11-02", End: "2026-11-03", TZ: "UTC"}, // date without AllDay
		{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "Nope/Nope"},
		{Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00", TZ: "UTC", RRule: "FREQ=HOURLY"},
	} {
		if err := bad.Validate(); err == nil {
			t.Errorf("Validate(%+v) = nil", bad)
		}
	}
}

func TestHasOccurrence(t *testing.T) {
	s := Series{Start: "2026-11-04T16:00:00", End: "2026-11-04T17:00:00", TZ: "Europe/Berlin", RRule: "FREQ=WEEKLY;BYDAY=WE,FR;UNTIL=20261120T000000Z",
		Exdates: []string{"2026-11-06T16:00:00"}}
	for key, want := range map[string]bool{
		"2026-11-04T16:00:00": true, // first
		"2026-11-06T16:00:00": true, // excluded occurrences are still occurrences
		"2026-11-13T16:00:00": true,
		"2026-11-05T16:00:00": false, // a Thursday
		"2026-11-04T17:00:00": false, // wrong time of day
		"2026-11-18T16:00:00": true,
		"2026-11-25T16:00:00": false, // after UNTIL
		"garbage":             false,
	} {
		if got := s.HasOccurrence(key); got != want {
			t.Errorf("HasOccurrence(%q) = %v, want %v", key, got, want)
		}
	}
}
