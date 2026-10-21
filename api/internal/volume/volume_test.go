package volume

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestCheckFailsWithoutMarker(t *testing.T) {
	err := Check(t.TempDir())
	if err == nil || !strings.Contains(err.Error(), ".kore-volume") {
		t.Fatalf("want error naming marker, got %v", err)
	}
}

func TestCheckPassesAfterInit(t *testing.T) {
	d := t.TempDir()
	if err := Init(d); err != nil {
		t.Fatal(err)
	}
	if err := Check(d); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"blobs", filepath.Join("tmp", "uploads")} {
		if st, err := os.Stat(filepath.Join(d, p)); err != nil || !st.IsDir() {
			t.Fatalf("missing dir %s", p)
		}
	}
	if err := Init(d); err != nil {
		t.Fatalf("init not idempotent: %v", err)
	}
}

func TestCheckRejectsMarkerDirectory(t *testing.T) {
	d := t.TempDir()
	if err := os.Mkdir(filepath.Join(d, ".kore-volume"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := Check(d); err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("marker directory accepted: %v", err)
	}
	if err := Init(d); err == nil {
		t.Fatal("init accepted a marker directory")
	}
}

func TestInitCreatesDataDirOnlyUnderExistingParent(t *testing.T) {
	parent := t.TempDir()
	d := filepath.Join(parent, "kore")
	if err := Init(d); err != nil {
		t.Fatalf("init with existing parent: %v", err)
	}
	if err := Check(d); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(parent, "not-mounted", "kore")
	err := Init(missing)
	if err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("want parent-missing error, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(parent, "not-mounted")); !os.IsNotExist(err) {
		t.Fatalf("init created the missing parent: %v", err)
	}
	f := filepath.Join(parent, "file")
	os.WriteFile(f, nil, 0o644)
	if err := Init(f); err == nil {
		t.Fatal("init accepted a regular file as data dir")
	}
}

func TestBlobPathShardsByPrefix(t *testing.T) {
	id := NewBlobID()
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(id) {
		t.Fatalf("bad id %q", id)
	}
	p, err := BlobPath("/data", id)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join("/data", "blobs", id[:2], id); p != want {
		t.Fatalf("got %s want %s", p, want)
	}
}

func TestBlobPathRejectsNonUUID(t *testing.T) {
	for _, id := range []string{"", "../x", "../../ETC/PASSWD", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA/../x", "abc", "00000000-0000-1000-8000-000000000000"} {
		if _, err := BlobPath("/data", id); err == nil {
			t.Errorf("id %q accepted", id)
		}
	}
}
