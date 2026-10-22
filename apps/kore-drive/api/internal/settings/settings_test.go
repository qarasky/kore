package settings

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/artchsh/kore/api/internal/store"
)

func TestDefaultsAndSet(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	if TrashRetentionDays(ctx, db) != 30 || MaxFileBytes(ctx, db) != 0 || DefaultQuotaBytes(ctx, db) != 50<<30 {
		t.Fatal("bad defaults")
	}
	if _, ok := Get(ctx, db, "nope"); ok {
		t.Fatal("unexpected")
	}
	Set(ctx, db, KeyTrashRetentionDays, "7")
	Set(ctx, db, KeyTrashRetentionDays, "9")
	Set(ctx, db, KeyMaxFileBytes, "100")
	Set(ctx, db, KeyDefaultQuotaBytes, "garbage")
	if TrashRetentionDays(ctx, db) != 9 || MaxFileBytes(ctx, db) != 100 || DefaultQuotaBytes(ctx, db) != 50<<30 {
		t.Fatal("bad values")
	}
}

func TestShareSettings(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	if !ShareLinksEnabled(ctx, db) || ShareDefaultExpiryDays(ctx, db) != 7 {
		t.Fatal("bad share defaults")
	}
	Set(ctx, db, KeyShareLinksEnabled, "0")
	Set(ctx, db, KeyShareDefaultExpiryDays, "0")
	if ShareLinksEnabled(ctx, db) || ShareDefaultExpiryDays(ctx, db) != 0 {
		t.Fatal("bad share values")
	}
	a, err := ShareSecret(ctx, db)
	if err != nil || len(a) != 32 {
		t.Fatalf("secret %x %v", a, err)
	}
	b, _ := ShareSecret(ctx, db)
	if string(a) != string(b) {
		t.Fatal("secret not stable")
	}
}
