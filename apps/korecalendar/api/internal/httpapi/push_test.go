package httpapi_test

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

func keys(t *testing.T) map[string]string {
	t.Helper()
	k, _ := ecdh.P256().GenerateKey(rand.Reader)
	a := make([]byte, 16)
	rand.Read(a)
	return map[string]string{"p256dh": base64.RawURLEncoding.EncodeToString(k.PublicKey().Bytes()), "auth": base64.RawURLEncoding.EncodeToString(a)}
}

func sub(endpoint string, k map[string]string) map[string]any {
	return map[string]any{"endpoint": endpoint, "keys": k}
}

func TestPushKeyIsStableAndNeedsAuth(t *testing.T) {
	srv, _ := testsrv.New(t)
	if r := testsrv.Do(t, srv, "", "GET", "/api/push/key", nil); r.Status != 401 {
		t.Fatalf("anonymous: %d", r.Status)
	}
	tok := testsrv.Login(t, srv)
	var a, b struct {
		PublicKey string `json:"publicKey"`
	}
	testsrv.Do(t, srv, tok, "GET", "/api/push/key", nil).Decode(t, &a)
	testsrv.Do(t, srv, tok, "GET", "/api/push/key", nil).Decode(t, &b)
	if len(a.PublicKey) < 80 || a.PublicKey != b.PublicKey {
		t.Fatalf("keys %q %q", a.PublicKey, b.PublicKey)
	}
}

func TestSubscribeIsIdempotentPerEndpoint(t *testing.T) {
	srv, db := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	r1 := testsrv.Do(t, srv, tok, "POST", "/api/push/subscriptions", sub("https://push.example.com/abc", keys(t)))
	r2 := testsrv.Do(t, srv, tok, "POST", "/api/push/subscriptions", sub("https://push.example.com/abc", keys(t)))
	var a, b struct{ ID string }
	r1.Decode(t, &a)
	r2.Decode(t, &b)
	var n int
	db.QueryRow(`SELECT count(*) FROM push_subscriptions`).Scan(&n)
	if r1.Status != 201 || r2.Status != 200 || a.ID == "" || a.ID != b.ID || n != 1 {
		t.Fatalf("%d %d ids %q %q rows %d", r1.Status, r2.Status, a.ID, b.ID, n)
	}
}

func TestSubscribeValidation(t *testing.T) {
	srv, _ := testsrv.New(t)
	tok := testsrv.Login(t, srv)
	for name, body := range map[string]map[string]any{
		"http endpoint": sub("http://push.example.com/abc", keys(t)),
		"bad keys":      sub("https://push.example.com/abc", map[string]string{"p256dh": "AAAA", "auth": "AAAA"}),
		"no endpoint":   sub("", keys(t)),
	} {
		if r := testsrv.Do(t, srv, tok, "POST", "/api/push/subscriptions", body); r.Status != 422 || r.ErrorCode() != "validation_error" {
			t.Errorf("%s: %d %s", name, r.Status, r.Body)
		}
	}
}

func TestUserCannotDeleteOthersSubscription(t *testing.T) {
	srv, _ := testsrv.New(t)
	admin := testsrv.Login(t, srv)
	other := testsrv.AddUser(t, srv, admin, "u@example.com")
	var s struct{ ID string }
	testsrv.Do(t, srv, admin, "POST", "/api/push/subscriptions", sub("https://push.example.com/abc", keys(t))).Decode(t, &s)
	if r := testsrv.Do(t, srv, other, "DELETE", "/api/push/subscriptions/"+s.ID, nil); r.Status != 404 || r.ErrorCode() != "not_found" {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	if r := testsrv.Do(t, srv, admin, "DELETE", "/api/push/subscriptions/"+s.ID, nil); r.Status != 204 {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
}
