package users

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/qarasky/kore/api/internal/store"
)

func TestCreateAndLookup(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	u, err := Create(ctx, db, "A@B.c", "user", 10)
	if err != nil {
		t.Fatal(err)
	}
	got, err := GetByEmail(ctx, db, "a@b.C")
	if err != nil || got.ID != u.ID || got.QuotaBytes != 10 {
		t.Fatalf("%v %v", got, err)
	}
	var legacy string
	if err := db.QueryRow(`SELECT pw_hash FROM users WHERE id=?`, u.ID).Scan(&legacy); err != nil || legacy != "" {
		t.Fatalf("legacy password column: %q %v", legacy, err)
	}
	if _, err := Create(ctx, db, "a@b.c", "user", 0); err != ErrExists {
		t.Fatalf("dup: %v", err)
	}
	if _, err := Create(ctx, db, "x@y.z", "root", 0); err != ErrRole {
		t.Fatalf("role: %v", err)
	}
	if _, err := GetByEmail(ctx, db, "no@y.z"); err != ErrNotFound {
		t.Fatalf("%v", err)
	}
}
