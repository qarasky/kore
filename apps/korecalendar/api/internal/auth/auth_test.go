package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/qarasky/korecalendar/api/internal/testutil"
	"github.com/qarasky/korecalendar/api/internal/users"
)

func TestHashAndVerify(t *testing.T) {
	h, err := HashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if ok, _ := VerifyPassword(h, "correct horse"); !ok {
		t.Fatal("right password rejected")
	}
	if ok, _ := VerifyPassword(h, "wrong horse"); ok {
		t.Fatal("wrong password accepted")
	}
	if ok, err := VerifyPassword("garbage", "x"); ok || err != nil {
		t.Fatalf("malformed hash: %v %v", ok, err)
	}
}

func TestSessionRoundTripAndExpiry(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()
	h, _ := HashPassword("long enough pw")
	u, err := users.Create(ctx, db, "a@example.com", h, "admin")
	if err != nil {
		t.Fatal(err)
	}
	tok, err := NewSession(ctx, db, u.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	got, err := UserForToken(ctx, db, tok)
	if err != nil || got.ID != u.ID {
		t.Fatalf("UserForToken = %+v, %v", got, err)
	}
	var raw int
	db.QueryRow(`SELECT count(*) FROM sessions WHERE token_hash=?`, tok).Scan(&raw)
	if raw != 0 {
		t.Fatal("raw session token stored")
	}
	expired, _ := NewSession(ctx, db, u.ID, -time.Minute)
	if _, err := UserForToken(ctx, db, expired); !errors.Is(err, users.ErrNotFound) {
		t.Fatalf("expired session: %v", err)
	}
	if err := DeleteSession(ctx, db, tok); err != nil {
		t.Fatal(err)
	}
	if _, err := UserForToken(ctx, db, tok); !errors.Is(err, users.ErrNotFound) {
		t.Fatalf("deleted session: %v", err)
	}
}

func TestAuthenticateUnknownEmailAndWrongPasswordIndistinguishable(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()
	h, _ := HashPassword("long enough pw")
	users.Create(ctx, db, "a@example.com", h, "user")
	_, e1 := Authenticate(ctx, db, "a@example.com", "nope nope nope")
	_, e2 := Authenticate(ctx, db, "x@example.com", "nope nope nope")
	if !errors.Is(e1, ErrInvalidCredentials) || !errors.Is(e2, ErrInvalidCredentials) {
		t.Fatalf("%v %v", e1, e2)
	}
}

func TestLimiterBlocksAfterMaxAndResets(t *testing.T) {
	l := NewLimiter(2, time.Minute)
	if !l.Attempt("k") || !l.Attempt("k") || l.Attempt("k") {
		t.Fatal("limiter did not stop at 2")
	}
	l.Reset("k")
	if !l.Attempt("k") {
		t.Fatal("reset did not clear")
	}
}
