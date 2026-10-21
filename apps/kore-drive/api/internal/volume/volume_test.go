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
