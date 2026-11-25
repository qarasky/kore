package version

import "testing"

func TestStringDefaultsToDev(t *testing.T) {
	if got := String(); got != "dev" {
		t.Fatalf("String() = %q, want dev for an unstamped build", got)
	}
}

func TestStringShowsStampedVersionAndShortCommit(t *testing.T) {
	oldV, oldC := Version, Commit
	t.Cleanup(func() { Version, Commit = oldV, oldC })
	Version, Commit = "1.2.3", "0123456789abcdef"
	if got, want := String(), "1.2.3 (0123456)"; got != want {
		t.Fatalf("String() = %q, want %q", got, want)
	}
}
