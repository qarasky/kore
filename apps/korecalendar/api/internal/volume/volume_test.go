package volume

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInitWritesMarkerAndCheckRefusesWithout(t *testing.T) {
	dir := t.TempDir()
	if err := Check(dir); err == nil || !strings.Contains(err.Error(), "korecalendar init") {
		t.Fatalf("Check on empty dir = %v, want error mentioning `korecalendar init`", err)
	}
	if err := Init(dir); err != nil {
		t.Fatal(err)
	}
	if err := Check(dir); err != nil {
		t.Fatalf("Check after Init: %v", err)
	}
}

func TestInitRefusesWhenParentMissing(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "not-mounted", "data")
	if err := Init(dir); err == nil {
		t.Fatal("Init created a data dir whose parent does not exist")
	}
}

func TestInitCreatesDirWhenParentExists(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	if err := Init(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".korecal-volume")); err != nil {
		t.Fatal(err)
	}
}
