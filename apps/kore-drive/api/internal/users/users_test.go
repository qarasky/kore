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
	u, err := Create(ctx, db, "A@B.c", "h", "user", 10)
	if err != nil {
		t.Fatal(err)
	}
	got, h, err := GetByEmail(ctx, db, "a@b.C")
	if err != nil || got.ID != u.ID || h != "h" || got.QuotaBytes != 10 {
		t.Fatalf("%v %q %v", got, h, err)
	}
	if _, err := Create(ctx, db, "a@b.c", "h", "user", 0); err != ErrExists {
		t.Fatalf("dup: %v", err)
	}
	if _, err := Create(ctx, db, "x@y.z", "h", "root", 0); err != ErrRole {
		t.Fatalf("role: %v", err)
	}
	if _, _, err := GetByEmail(ctx, db, "no@y.z"); err != ErrNotFound {
		t.Fatalf("%v", err)
	}
}
