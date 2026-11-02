package auth

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testutil"
	"github.com/qarasky/korecalendar/api/internal/users"
)

func TestTokenShownOnceAndHashedAtRest(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()
	u, _ := users.Create(ctx, db, "a@example.com", "x", "admin")
	id, secret, err := CreateToken(ctx, db, u.ID, "claude")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(secret, "kcal_") || id == "" {
		t.Fatalf("id=%q secret=%q", id, secret)
	}
	var n int
	db.QueryRow(`SELECT count(*) FROM tokens WHERE token_hash=?`, secret).Scan(&n)
	if n != 0 {
		t.Fatal("raw token stored")
	}
	list, err := ListTokens(ctx, db, u.ID)
	if err != nil || len(list) != 1 || list[0].Name != "claude" || list[0].ID != id {
		t.Fatalf("list = %+v, %v", list, err)
	}
}

func TestRevokeOtherUsersTokenIsNotFound(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()
	a, _ := users.Create(ctx, db, "a@example.com", "x", "admin")
	b, _ := users.Create(ctx, db, "b@example.com", "x", "user")
	id, _, _ := CreateToken(ctx, db, a.ID, "t")
	if err := RevokeToken(ctx, db, b.ID, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v, want ErrNotFound", err)
	}
	if err := RevokeToken(ctx, db, a.ID, id); err != nil {
		t.Fatal(err)
	}
}
