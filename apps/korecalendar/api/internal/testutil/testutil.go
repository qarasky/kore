// Package testutil holds helpers shared by tests across packages.
package testutil

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/store"
)

// NewDB opens a fresh, migrated SQLite database in a temp dir.
func NewDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}
