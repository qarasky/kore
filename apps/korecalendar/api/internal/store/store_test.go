package store

import (
	"path/filepath"
	"testing"
)

func TestOpenAppliesMigrationsOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "k.db")
	for i := 0; i < 2; i++ {
		db, err := Open(path)
		if err != nil {
			t.Fatalf("open #%d: %v", i, err)
		}
		db.Close()
	}
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var files, applied int
	entries, _ := migrationsFS.ReadDir("migrations")
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".sql" {
			files++
		}
	}
	if err := db.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if files == 0 || applied != files {
		t.Fatalf("migration files=%d applied rows=%d, want equal and > 0", files, applied)
	}
}

func TestForeignKeysOn(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var on int
	if err := db.QueryRow(`PRAGMA foreign_keys`).Scan(&on); err != nil || on != 1 {
		t.Fatalf("foreign_keys = %d, err %v; want 1", on, err)
	}
}
