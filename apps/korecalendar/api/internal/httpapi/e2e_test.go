package httpapi_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

// The flow an AI agent follows, start to finish, through the public API only.
func TestEndToEndAgentFlow(t *testing.T) {
	srv, db := testsrv.New(t)
	session := testsrv.Login(t, srv)

	var tok struct{ Token string }
	testsrv.Do(t, srv, session, "POST", "/api/tokens", map[string]string{"name": "claude"}).Decode(t, &tok)
	agent := tok.Token

	// create a weekly event with a reminder; a retry with the same key is harmless
	body := weekly("Gym")
	body["reminders"] = []reminder{{30}}
	first := mkEvent(t, srv, agent, body, "Idempotency-Key", "e2e-1")
	retry := testsrv.Do(t, srv, agent, "POST", "/api/events", body, "Idempotency-Key", "e2e-1")
	var again event
	retry.Decode(t, &again)
	var n int
	db.QueryRow(`SELECT count(*) FROM events`).Scan(&n)
	if again.ID != first.ID || n != 1 || first.CreatedBy != "claude" {
		t.Fatalf("retry created %d events, ids %q/%q, created_by %q", n, first.ID, again.ID, first.CreatedBy)
	}

	// skip one occurrence, move another, then list the fortnight
	edit(t, srv, agent, "DELETE", first.ID, "?scope=this&occurrence="+k1106, nil)
	edit(t, srv, agent, "PATCH", first.ID, "?scope=this&occurrence="+k1111, map[string]any{"start": "2026-11-11T18:00:00"})
	got := occs(t, srv, agent, "2026-11-02T00:00:00Z", "2026-11-16T00:00:00Z")
	if want := []string{k1104, k1111, k1113}; !reflect.DeepEqual(keysOf(got), want) {
		t.Fatalf("keys %v, want %v", keysOf(got), want)
	}
	if got[1].Start != "2026-11-11T18:00:00" || !got[1].IsOverride {
		t.Fatalf("moved occurrence: %+v", got[1])
	}

	// a browser registers for push
	var key struct {
		PublicKey string `json:"publicKey"`
	}
	testsrv.Do(t, srv, agent, "GET", "/api/push/key", nil).Decode(t, &key)
	if sub := testsrv.Do(t, srv, agent, "POST", "/api/push/subscriptions", sub("https://push.example.com/e2e", keys(t))); key.PublicKey == "" || sub.Status != 201 {
		t.Fatalf("push: key %q, subscribe %d %s", key.PublicKey, sub.Status, sub.Body)
	}

	// export, then import into another account: the same fortnight comes out
	exp := testsrv.Do(t, srv, agent, "GET", "/api/export", nil)
	if exp.Status != 200 || !strings.Contains(string(exp.Body), "EXDATE;TZID=Europe/Berlin:20261106T160000") {
		t.Fatalf("export: %d\n%s", exp.Status, exp.Body)
	}
	other := testsrv.AddUser(t, srv, session, "second@example.com")
	res, status := importICS(t, srv, other, "", exp.Body)
	if status != 200 || res.Created != 1 || len(res.Errors) != 0 {
		t.Fatalf("import: %d %+v", status, res)
	}
	copied := occs(t, srv, other, "2026-11-02T00:00:00Z", "2026-11-16T00:00:00Z")
	type shape struct{ Key, Start, End, Title string }
	shapes := func(os []occurrence) (out []shape) {
		for _, o := range os {
			out = append(out, shape{o.Key, o.Start, o.End, o.Title})
		}
		return
	}
	if !reflect.DeepEqual(shapes(got), shapes(copied)) {
		t.Fatalf("the second account sees different occurrences\n %v\n %v", shapes(got), shapes(copied))
	}

	// the agent can never see the second account's data, and a token cannot mint tokens
	if r := testsrv.Do(t, srv, agent, "GET", "/api/occurrences?from=2026-11-02T00:00:00Z&to=2026-11-16T00:00:00Z", nil); len(keysOf(occs(t, srv, agent, "2026-11-02T00:00:00Z", "2026-11-16T00:00:00Z"))) != 3 || r.Status != 200 {
		t.Fatal("agent's view changed")
	}
	if r := testsrv.Do(t, srv, agent, "POST", "/api/tokens", map[string]string{"name": "more"}); r.Status != 403 {
		t.Fatalf("token minted a token: %d", r.Status)
	}
}
