package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/qarasky/korecalendar/api/internal/reminders"
	"github.com/qarasky/korecalendar/api/internal/testutil"
	"github.com/qarasky/korecalendar/api/internal/users"
)

type request struct {
	path string
	hdr  http.Header
	body []byte
}

// pushService stands in for a browser vendor's push endpoint.
type pushService struct {
	*httptest.Server
	mu     sync.Mutex
	status int
	reqs   []request
}

func newService(t *testing.T, status int) *pushService {
	t.Helper()
	p := &pushService{status: status}
	p.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		p.mu.Lock()
		p.reqs = append(p.reqs, request{path: r.URL.Path, hdr: r.Header.Clone(), body: b})
		st := p.status
		p.mu.Unlock()
		w.WriteHeader(st)
	}))
	t.Cleanup(p.Close)
	return p
}

func (p *pushService) requests() []request {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]request(nil), p.reqs...)
}

func subKeys(t *testing.T) (p256dh, auth string) {
	t.Helper()
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	a := make([]byte, 16)
	rand.Read(a)
	return base64.RawURLEncoding.EncodeToString(k.PublicKey().Bytes()), base64.RawURLEncoding.EncodeToString(a)
}

func addSub(t *testing.T, db *sql.DB, userID, endpoint string) string {
	t.Helper()
	// Inserted directly: Subscribe insists on https, the test push service is plain http on loopback.
	p, a := subKeys(t)
	id := users.NewID()
	if _, err := db.Exec(`INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?,0)`, id, userID, endpoint, p, a); err != nil {
		t.Fatal(err)
	}
	return id
}

func newUser(t *testing.T, db *sql.DB, email string) users.User {
	t.Helper()
	u, err := users.Create(context.Background(), db, email, "x", "user")
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func newChannel(t *testing.T, db *sql.DB) *Channel {
	t.Helper()
	c, err := New(db)
	if err != nil {
		t.Fatal(err)
	}
	c.Client = http.DefaultClient // the test push service is on loopback
	return c
}

func due(userID string) reminders.Due {
	return reminders.Due{UserID: userID, EventID: "ev1", Key: "2026-11-04T09:00:00", Title: "Dentist", Start: "2026-11-04T09:00:00",
		StartUTC: time.Date(2026, 11, 4, 9, 0, 0, 0, time.UTC), FireAt: time.Date(2026, 11, 4, 8, 30, 0, 0, time.UTC), MinutesBefore: 30}
}

func TestSendDeliversEncryptedPayloadToEveryDeviceOfUser(t *testing.T) {
	db := testutil.NewDB(t)
	a, b := newUser(t, db, "a@example.com"), newUser(t, db, "b@example.com")
	phone, laptop, others := newService(t, 201), newService(t, 201), newService(t, 201)
	addSub(t, db, a.ID, phone.URL+"/p")
	addSub(t, db, a.ID, laptop.URL+"/l")
	addSub(t, db, b.ID, others.URL+"/o")
	if err := newChannel(t, db).Send(context.Background(), a.ID, due(a.ID)); err != nil {
		t.Fatal(err)
	}
	if len(phone.requests()) != 1 || len(laptop.requests()) != 1 || len(others.requests()) != 0 {
		t.Fatalf("phone=%d laptop=%d other user=%d", len(phone.requests()), len(laptop.requests()), len(others.requests()))
	}
	r := phone.requests()[0]
	if r.hdr.Get("Content-Encoding") != "aes128gcm" || !strings.HasPrefix(r.hdr.Get("Authorization"), "vapid t=") || r.hdr.Get("TTL") == "" {
		t.Fatalf("headers %v", r.hdr)
	}
	if len(r.body) < 100 || strings.Contains(string(r.body), "Dentist") {
		t.Fatalf("payload is not encrypted: %d bytes", len(r.body))
	}
}

func TestGoneSubscriptionIsRemoved(t *testing.T) {
	for _, status := range []int{404, 410} {
		db := testutil.NewDB(t)
		u := newUser(t, db, "a@example.com")
		gone, alive := newService(t, status), newService(t, 201)
		addSub(t, db, u.ID, gone.URL+"/g")
		addSub(t, db, u.ID, alive.URL+"/a")
		if err := newChannel(t, db).Send(context.Background(), u.ID, due(u.ID)); err != nil {
			t.Fatalf("status %d: %v", status, err)
		}
		var n int
		db.QueryRow(`SELECT count(*) FROM push_subscriptions`).Scan(&n)
		if n != 1 {
			t.Fatalf("status %d: %d subscriptions left, want 1", status, n)
		}
	}
}

func TestServerErrorIsReportedWhenNothingGotThrough(t *testing.T) {
	db := testutil.NewDB(t)
	u := newUser(t, db, "a@example.com")
	down := newService(t, 500)
	addSub(t, db, u.ID, down.URL+"/d")
	if err := newChannel(t, db).Send(context.Background(), u.ID, due(u.ID)); err == nil {
		t.Fatal("a failed delivery was reported as success")
	}
	var n int
	db.QueryRow(`SELECT count(*) FROM push_subscriptions`).Scan(&n)
	if n != 1 {
		t.Fatal("subscription dropped on a server error")
	}
}

func TestPartialFailureCountsAsDelivered(t *testing.T) {
	db := testutil.NewDB(t)
	u := newUser(t, db, "a@example.com")
	addSub(t, db, u.ID, newService(t, 500).URL+"/d")
	addSub(t, db, u.ID, newService(t, 201).URL+"/u")
	if err := newChannel(t, db).Send(context.Background(), u.ID, due(u.ID)); err != nil {
		t.Fatalf("one device got it, but Send failed: %v", err)
	}
}

func TestSendWithNoSubscriptionsIsANoop(t *testing.T) {
	db := testutil.NewDB(t)
	u := newUser(t, db, "a@example.com")
	if err := newChannel(t, db).Send(context.Background(), u.ID, due(u.ID)); err != nil {
		t.Fatal(err)
	}
}

func TestSubscribeIsIdempotentPerEndpoint(t *testing.T) {
	db := testutil.NewDB(t)
	u := newUser(t, db, "a@example.com")
	p, a := subKeys(t)
	id1, created1, err := Subscribe(context.Background(), db, u.ID, "https://push.example.com/x", p, a)
	if err != nil || !created1 {
		t.Fatal(id1, created1, err)
	}
	p2, a2 := subKeys(t)
	id2, created2, err := Subscribe(context.Background(), db, u.ID, "https://push.example.com/x", p2, a2)
	if err != nil || created2 || id2 != id1 {
		t.Fatalf("id %s vs %s created=%v err=%v", id1, id2, created2, err)
	}
	var stored string
	db.QueryRow(`SELECT p256dh FROM push_subscriptions WHERE id=?`, id1).Scan(&stored)
	if stored != p2 {
		t.Fatal("re-subscribing did not refresh the keys")
	}
}

func TestSubscribeRejectsBadKeys(t *testing.T) {
	db := testutil.NewDB(t)
	u := newUser(t, db, "a@example.com")
	p, a := subKeys(t)
	for name, c := range map[string][3]string{
		"empty endpoint": {"", p, a}, "http endpoint": {"http://push.example.com/x", p, a},
		"short p256dh": {"https://push.example.com/x", "AAAA", a}, "short auth": {"https://push.example.com/x", p, "AAAA"},
		"not base64": {"https://push.example.com/x", "!!!", a},
	} {
		if _, _, err := Subscribe(context.Background(), db, u.ID, c[0], c[1], c[2]); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestUnsubscribeOtherUsersIsNotFound(t *testing.T) {
	db := testutil.NewDB(t)
	a, b := newUser(t, db, "a@example.com"), newUser(t, db, "b@example.com")
	id := addSub(t, db, a.ID, "https://push.example.com/x")
	if err := Unsubscribe(context.Background(), db, b.ID, id); err != ErrNotFound {
		t.Fatalf("got %v", err)
	}
	if err := Unsubscribe(context.Background(), db, a.ID, id); err != nil {
		t.Fatal(err)
	}
}

func TestVapidKeyStableAcrossRestart(t *testing.T) {
	db := testutil.NewDB(t)
	k1, err := PublicKey(context.Background(), db)
	if err != nil || k1 == "" {
		t.Fatal(k1, err)
	}
	c, err := New(db) // "restart"
	if err != nil {
		t.Fatal(err)
	}
	k2, _ := PublicKey(context.Background(), db)
	if k1 != k2 || c.publicKey != k1 {
		t.Fatalf("keys changed: %q %q %q", k1, k2, c.publicKey)
	}
}

func TestPayloadTextAndFields(t *testing.T) {
	d := due("u")
	var got map[string]string
	if err := json.Unmarshal(payload(d), &got); err != nil {
		t.Fatal(err)
	}
	if got["title"] != "Dentist" || got["body"] != "09:00 · in 30 min" || got["eventId"] != "ev1" || got["key"] != "2026-11-04T09:00:00" {
		t.Fatalf("payload %v", got)
	}
	for minutes, want := range map[int]string{0: "09:00 · starting now", 60: "09:00 · in 1 h", 90: "09:00 · in 1 h 30 min", 1440: "09:00 · in 1 day", 2880: "09:00 · in 2 days"} {
		d.MinutesBefore = minutes
		json.Unmarshal(payload(d), &got)
		if got["body"] != want {
			t.Errorf("%d min: %q, want %q", minutes, got["body"], want)
		}
	}
	d.Start, d.MinutesBefore = "2026-11-04", 1440
	json.Unmarshal(payload(d), &got)
	if got["body"] != "All day · in 1 day" {
		t.Errorf("all-day: %q", got["body"])
	}
}

func TestSafeClientRefusesPrivateAddresses(t *testing.T) {
	svc := newService(t, 201)
	if _, err := safeClient().Get(svc.URL); err == nil {
		t.Fatal("the production client reached a loopback address")
	}
	if len(svc.requests()) != 0 {
		t.Fatal("request got through")
	}
}
