package auth

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/qarasky/kore/api/internal/store"
	"github.com/qarasky/kore/api/internal/users"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func mkUser(t *testing.T, db *sql.DB, email, role string) users.User {
	t.Helper()
	u, err := users.Create(context.Background(), db, email, role, 0)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestEmailCaseInsensitive(t *testing.T) {
	db := testDB(t)
	mkUser(t, db, "Alice@Example.com", "user")
	if _, err := users.Create(context.Background(), db, "ALICE@example.com", "user", 0); err == nil {
		t.Fatal("duplicate email differing by case accepted")
	}
}

func TestSessionExpired(t *testing.T) {
	db := testDB(t)
	u := mkUser(t, db, "a@b.c", "user")
	ctx := context.Background()
	tok, err := NewSession(ctx, db, u.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	got, err := UserForToken(ctx, db, tok)
	if err != nil || got.ID != u.ID {
		t.Fatalf("valid token: %v %v", got, err)
	}
	var stored string
	db.QueryRow(`SELECT token_hash FROM sessions`).Scan(&stored)
	if stored == tok {
		t.Fatal("raw token stored")
	}
	old, _ := NewSession(ctx, db, u.ID, -time.Minute)
	if _, err := UserForToken(ctx, db, old); err == nil {
		t.Fatal("expired token accepted")
	}
	if _, err := UserForToken(ctx, db, "nope"); err == nil {
		t.Fatal("unknown token accepted")
	}
}

func TestLimiter(t *testing.T) {
	now := time.Unix(1000, 0)
	l := NewLimiterClock(5, time.Minute, func() time.Time { return now })
	for i := 0; i < 5; i++ {
		if !l.Attempt("k") {
			t.Fatalf("blocked early at %d", i)
		}
	}
	if l.Attempt("k") {
		t.Fatal("not blocked after 5 attempts")
	}
	if !l.Attempt("other") {
		t.Fatal("other key blocked")
	}
	now = now.Add(59 * time.Second)
	if l.Attempt("k") {
		t.Fatal("expired too early")
	}
	now = now.Add(2 * time.Second)
	if !l.Attempt("k") {
		t.Fatal("failures did not expire after window")
	}
	l.Reset("k")
	for i := 0; i < 5; i++ {
		if !l.Attempt("k") {
			t.Fatal("reset failed")
		}
	}
}
