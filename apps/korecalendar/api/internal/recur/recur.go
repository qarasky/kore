// Package recur expands RFC 5545 recurrence rules into occurrences, validates
// the supported rule subset, and splits a series for "this and following"
// edits. It is pure: no database, no clock.
//
// Times are local wall-clock strings in the series' IANA zone, so a 9:00
// event stays at 9:00 across DST changes. An occurrence is identified by its
// nominal wall-time start (its Key), the RFC's RECURRENCE-ID.
package recur

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	_ "time/tzdata" // zone data for minimal container images

	"github.com/teambition/rrule-go"
)

const (
	wallLayout = "2006-01-02T15:04:05"
	dateLayout = "2006-01-02"
)

// Errors returned by this package.
var (
	ErrUnsupportedRule    = errors.New("unsupported recurrence rule")
	ErrTooManyOccurrences = errors.New("too many occurrences in range")
	ErrInvalidSeries      = errors.New("invalid series")
	ErrNotAnOccurrence    = errors.New("key is not an occurrence of the series")
	ErrNotRecurring       = errors.New("series does not recur")
)

// Series is an event with its recurrence data.
type Series struct {
	Start, End string // wall time "2026-11-04T16:00:00", or date "2026-11-04" when AllDay (End exclusive)
	TZ         string // IANA zone; "" means UTC
	AllDay     bool
	RRule      string   // "" for a single event, e.g. "FREQ=WEEKLY;BYDAY=WE,FR;UNTIL=20261231T235959Z"
	RDates     []string // extra occurrence starts, same format as Start
	Exdates    []string // occurrence keys to skip
}

// Occurrence is one instance of a series.
type Occurrence struct {
	Key, Start, End  string // Key == Start: the nominal wall-time start
	StartUTC, EndUTC time.Time
}

type compiled struct {
	loc     *time.Location
	allDay  bool
	start   time.Time // floating wall time (labelled UTC)
	dur     time.Duration
	rule    *rrule.RRule
	opt     rrule.ROption
	until   time.Time // instant; zero when unbounded
	rdates  []time.Time
	exdates map[string]bool
}

func stripPrefix(rule string) string {
	rule = strings.TrimSpace(rule)
	if len(rule) >= 6 && strings.EqualFold(rule[:6], "RRULE:") {
		rule = rule[6:]
	}
	return rule
}

func unsupported(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrUnsupportedRule, fmt.Sprintf(format, a...))
}

// parseRule parses and checks a rule against the supported subset.
func parseRule(rule string) (rrule.ROption, error) {
	rule = stripPrefix(rule)
	if rule == "" {
		return rrule.ROption{}, unsupported("empty rule")
	}
	opt, err := rrule.StrToROptionInLocation(rule, time.UTC)
	if err != nil {
		return rrule.ROption{}, unsupported("%v", err)
	}
	switch opt.Freq {
	case rrule.DAILY, rrule.WEEKLY, rrule.MONTHLY, rrule.YEARLY:
	default:
		return rrule.ROption{}, unsupported("only daily, weekly, monthly and yearly repeats are supported")
	}
	if len(opt.Byhour) > 0 || len(opt.Byminute) > 0 || len(opt.Bysecond) > 0 {
		return rrule.ROption{}, unsupported("BYHOUR, BYMINUTE and BYSECOND are not supported")
	}
	if len(opt.Byweekno) > 0 || len(opt.Byyearday) > 0 || len(opt.Byeaster) > 0 {
		return rrule.ROption{}, unsupported("BYWEEKNO, BYYEARDAY and BYEASTER are not supported")
	}
	if opt.Count > 0 && !opt.Until.IsZero() {
		return rrule.ROption{}, unsupported("COUNT and UNTIL cannot both be set")
	}
	return *opt, nil
}

// ValidateRule reports whether rule is in the supported subset; errors wrap
// ErrUnsupportedRule.
func ValidateRule(rule string) error {
	_, err := parseRule(rule)
	return err
}

func parseWall(s string, allDay bool) (time.Time, error) {
	layout := wallLayout
	if allDay {
		layout = dateLayout
	}
	t, err := time.ParseInLocation(layout, s, time.UTC)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: %q is not %s", ErrInvalidSeries, s, layout)
	}
	return t, nil
}

func formatWall(t time.Time, allDay bool) string {
	if allDay {
		return t.Format(dateLayout)
	}
	return t.Format(wallLayout)
}

func ruleUntilIsDateOnly(rule string) bool {
	for _, p := range strings.Split(stripPrefix(rule), ";") {
		if k, v, ok := strings.Cut(p, "="); ok && strings.EqualFold(k, "UNTIL") {
			return !strings.ContainsAny(v, "Tt")
		}
	}
	return false
}

func (s Series) compile() (*compiled, error) {
	c := &compiled{allDay: s.AllDay, exdates: map[string]bool{}}
	tz := s.TZ
	if tz == "" {
		tz = "UTC"
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, fmt.Errorf("%w: unknown time zone %q", ErrInvalidSeries, s.TZ)
	}
	c.loc = loc
	if c.start, err = parseWall(s.Start, s.AllDay); err != nil {
		return nil, err
	}
	switch {
	case s.End != "":
		end, err := parseWall(s.End, s.AllDay)
		if err != nil {
			return nil, err
		}
		if c.dur = end.Sub(c.start); c.dur < 0 {
			return nil, fmt.Errorf("%w: end is before start", ErrInvalidSeries)
		}
	case s.AllDay:
		c.dur = 24 * time.Hour
	}
	for _, r := range s.RDates {
		w, err := parseWall(r, s.AllDay)
		if err != nil {
			return nil, err
		}
		c.rdates = append(c.rdates, w)
	}
	for _, e := range s.Exdates {
		c.exdates[e] = true
	}
	if s.RRule != "" {
		if c.opt, err = parseRule(s.RRule); err != nil {
			return nil, err
		}
		if !c.opt.Until.IsZero() {
			c.until = c.opt.Until
			if !s.AllDay && ruleUntilIsDateOnly(s.RRule) {
				c.until = c.instant(c.opt.Until.Add(24*time.Hour - time.Second))
			}
			c.opt.Until = time.Time{}
		}
		c.opt.Dtstart = c.start
		if c.rule, err = rrule.NewRRule(c.opt); err != nil {
			return nil, unsupported("%v", err)
		}
	}
	return c, nil
}

// instant maps a floating wall time into the series' zone. A wall time that
// does not exist (DST gap) uses the offset before the gap, as RFC 5545 says
// (02:30 becomes 03:30 after a spring-forward); an ambiguous one (DST
// overlap) means its first occurrence. Go's time.Date guarantees neither.
func (c *compiled) instant(w time.Time) time.Time {
	if c.allDay || c.loc == time.UTC {
		return w
	}
	_, o1 := w.Add(-24 * time.Hour).In(c.loc).Zone()
	_, o2 := w.Add(24 * time.Hour).In(c.loc).Zone()
	c1 := w.Add(-time.Duration(o1) * time.Second)
	if o1 == o2 {
		return c1
	}
	c2 := w.Add(-time.Duration(o2) * time.Second)
	ok1, ok2 := sameWall(c1.In(c.loc), w), sameWall(c2.In(c.loc), w)
	switch {
	case ok1 && ok2:
		if c2.Before(c1) {
			return c2
		}
		return c1
	case ok2:
		return c2
	default: // valid with the earlier offset, or in a gap (offset before the gap)
		return c1
	}
}

func sameWall(a, b time.Time) bool {
	return a.Year() == b.Year() && a.Month() == b.Month() && a.Day() == b.Day() &&
		a.Hour() == b.Hour() && a.Minute() == b.Minute() && a.Second() == b.Second()
}

// walls returns the floating start times in [after, before] from the rule,
// the series start and the extra dates, sorted and de-duplicated.
func (c *compiled) walls(after, before time.Time) []time.Time {
	seen := map[time.Time]bool{}
	var out []time.Time
	add := func(t time.Time) {
		if !t.Before(after) && !t.After(before) && !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	add(c.start)
	for _, r := range c.rdates {
		add(r)
	}
	if c.rule != nil {
		for _, t := range c.rule.Between(after, before, true) {
			add(t)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Before(out[j]) })
	return out
}

func (c *compiled) occurrence(w time.Time) Occurrence {
	end := w.Add(c.dur)
	return Occurrence{Key: formatWall(w, c.allDay), Start: formatWall(w, c.allDay), End: formatWall(end, c.allDay),
		StartUTC: c.instant(w), EndUTC: c.instant(end)}
}

// Expand returns the occurrences overlapping [from, to), sorted by start. It
// fails with ErrTooManyOccurrences when there are more than limit.
func Expand(s Series, from, to time.Time, limit int) ([]Occurrence, error) {
	c, err := s.compile()
	if err != nil {
		return nil, err
	}
	from, to = from.UTC(), to.UTC()
	// Floating wall times differ from real instants by at most one zone
	// offset; widen the search and filter on instants afterwards.
	walls := c.walls(from.Add(-48*time.Hour-c.dur), to.Add(48*time.Hour))
	out := []Occurrence{}
	for _, w := range walls {
		o := c.occurrence(w)
		if c.exdates[o.Key] {
			continue
		}
		if !c.until.IsZero() && o.StartUTC.After(c.until) {
			continue
		}
		overlaps := o.StartUTC.Before(to) && o.EndUTC.After(from)
		if o.EndUTC.Equal(o.StartUTC) { // zero-length: a point in time
			overlaps = !o.StartUTC.Before(from) && o.StartUTC.Before(to)
		}
		if !overlaps {
			continue
		}
		if len(out) >= limit {
			return nil, ErrTooManyOccurrences
		}
		out = append(out, o)
	}
	return out, nil
}

// ruleWith rewrites rule without the dropped parts and with the added ones.
func ruleWith(rule string, drop []string, add ...string) string {
	var parts []string
outer:
	for _, p := range strings.Split(stripPrefix(rule), ";") {
		k, _, _ := strings.Cut(p, "=")
		for _, d := range drop {
			if strings.EqualFold(k, d) {
				continue outer
			}
		}
		parts = append(parts, p)
	}
	return strings.Join(append(parts, add...), ";")
}

// SplitAt cuts a recurring series at the occurrence key for "this and
// following" edits. before keeps the occurrences before key and after starts
// at key. If key is the first occurrence there is nothing before: before is
// the zero Series and after is s unchanged.
func SplitAt(s Series, key string) (before, after Series, err error) {
	if s.RRule == "" && len(s.RDates) == 0 {
		return Series{}, Series{}, ErrNotRecurring
	}
	c, err := s.compile()
	if err != nil {
		return Series{}, Series{}, err
	}
	kw, err := parseWall(key, s.AllDay)
	if err != nil {
		return Series{}, Series{}, err
	}
	found := false
	for _, w := range c.walls(c.start, kw) {
		if w.Equal(kw) {
			found = true
		}
	}
	if !found {
		return Series{}, Series{}, ErrNotAnOccurrence
	}
	if kw.Equal(c.start) {
		return Series{}, s, nil
	}

	before = s
	after = Series{Start: key, End: formatWall(kw.Add(c.dur), s.AllDay), TZ: s.TZ, AllDay: s.AllDay, RRule: s.RRule}
	if s.RRule != "" {
		switch {
		case c.opt.Count > 0:
			n := len(c.rule.Between(c.start, kw.Add(-time.Second), true))
			before.RRule = ruleWith(s.RRule, []string{"COUNT"}, fmt.Sprintf("COUNT=%d", n))
			after.RRule = ruleWith(s.RRule, []string{"COUNT"}, fmt.Sprintf("COUNT=%d", max(1, c.opt.Count-n)))
		case s.AllDay:
			before.RRule = ruleWith(s.RRule, []string{"UNTIL"}, "UNTIL="+kw.AddDate(0, 0, -1).Format("20060102"))
		default:
			before.RRule = ruleWith(s.RRule, []string{"UNTIL"}, "UNTIL="+c.instant(kw).Add(-time.Second).Format("20060102T150405Z"))
		}
	}
	before.RDates, after.RDates = partition(s.RDates, key)
	before.Exdates, after.Exdates = partition(s.Exdates, key)
	return before, after, nil
}

// partition splits fixed-width ISO strings (which sort chronologically) into
// those before key and those at or after it.
func partition(in []string, key string) (lo, hi []string) {
	for _, v := range in {
		if v < key {
			lo = append(lo, v)
		} else {
			hi = append(hi, v)
		}
	}
	return lo, hi
}

// Validate reports whether the series is well formed: parseable times, a
// known zone, end not before start, and a supported rule.
func (s Series) Validate() error {
	_, err := s.compile()
	return err
}

// HasOccurrence reports whether key is an occurrence of the series, ignoring
// exclusions (an excluded occurrence is still an occurrence).
func (s Series) HasOccurrence(key string) bool {
	c, err := s.compile()
	if err != nil {
		return false
	}
	kw, err := parseWall(key, s.AllDay)
	if err != nil || formatWall(kw, s.AllDay) != key {
		return false
	}
	if !c.until.IsZero() && c.instant(kw).After(c.until) {
		return false
	}
	for _, w := range c.walls(kw, kw) {
		if w.Equal(kw) {
			return true
		}
	}
	return false
}
