package auth

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/artchsh/kore/api/internal/config"
	"github.com/artchsh/kore/api/internal/store"
	"github.com/artchsh/kore/api/internal/users"
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

func mkUser(t *testing.T, db *sql.DB, email, pw, role string) users.User {
	t.Helper()
	h, err := HashPassword(pw)
	if err != nil {
		t.Fatal(err)
	}
	u, err := users.Create(context.Background(), db, email, h, role, 0)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestVerifyPassword(t *testing.T) {
	h, err := HashPassword("hunter2")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(h, "hunter2") {
		t.Fatal("right password rejected")
	}
	if VerifyPassword(h, "hunter3") {
		t.Fatal("wrong password accepted")
	}
	if VerifyPassword("garbage", "x") {
		t.Fatal("garbage hash accepted")
	}
}

func TestHashesDiffer(t *testing.T) {
	a, _ := HashPassword("same")
	b, _ := HashPassword("same")
	if a == b {
		t.Fatal("hashes identical")
	}
}

func TestAuthenticateWrongPasswordGeneric(t *testing.T) {
	db := testDB(t)
	mkUser(t, db, "a@b.c", "pw-correct", "user")
	ctx := context.Background()
	_, e1 := Authenticate(ctx, db, "a@b.c", "bad")
	_, e2 := Authenticate(ctx, db, "nobody@b.c", "bad")
	if e1 == nil || e2 == nil || e1.Error() != e2.Error() || e1 != e2 {
		t.Fatalf("errors differ: %v / %v", e1, e2)
	}
	u, err := Authenticate(ctx, db, "a@b.c", "pw-correct")
	if err != nil || u.Email != "a@b.c" {
		t.Fatalf("good login: %v %v", u, err)
	}
}

func TestEmailCaseInsensitive(t *testing.T) {
	db := testDB(t)
	mkUser(t, db, "Alice@Example.com", "pw", "user")
	if _, err := Authenticate(context.Background(), db, "alice@EXAMPLE.com", "pw"); err != nil {
		t.Fatal(err)
	}
	h, _ := HashPassword("x")
	if _, err := users.Create(context.Background(), db, "ALICE@example.com", h, "user", 0); err == nil {
		t.Fatal("duplicate email differing by case accepted")
	}
}

func TestSessionExpired(t *testing.T) {
	db := testDB(t)
	u := mkUser(t, db, "a@b.c", "pw", "user")
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

func TestBootstrapOnlyWhenEmpty(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	cfg := config.Config{AdminEmail: "root@x.y", AdminPassword: "s3cret-pass"}
	if err := Bootstrap(ctx, db, cfg); err != nil {
		t.Fatal(err)
	}
	u, err := Authenticate(ctx, db, "root@x.y", "s3cret-pass")
	if err != nil || u.Role != "admin" {
		t.Fatalf("%v %v", u, err)
	}
	cfg.AdminEmail = "other@x.y"
	if err := Bootstrap(ctx, db, cfg); err != nil {
		t.Fatal(err)
	}
	n, _ := users.Count(ctx, db)
	if n != 1 {
		t.Fatalf("users=%d", n)
	}
}

func TestBootstrapRefusesPlaceholder(t *testing.T) {
	db := testDB(t)
	err := Bootstrap(context.Background(), db, config.Config{AdminEmail: "root@x.y", AdminPassword: "change-me"})
	if err == nil {
		t.Fatal("placeholder password accepted")
	}
	if n, _ := users.Count(context.Background(), db); n != 0 {
		t.Fatal("user created")
	}
	// Non-empty DB: placeholder is irrelevant.
	mkUser(t, db, "a@b.c", "pw", "admin")
	if err := Bootstrap(context.Background(), db, config.Config{AdminEmail: "r@x.y", AdminPassword: "change-me"}); err != nil {
		t.Fatal(err)
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
