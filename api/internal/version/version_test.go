package version

import "testing"

func TestString(t *testing.T) {
	if got := String(); got != "dev" {
		t.Fatalf("unstamped build: %q", got)
	}
	defer func(v, c string) { Version, Commit = v, c }(Version, Commit)
	Version, Commit = "1.2.3", "0123456789abcdef"
	if got := String(); got != "1.2.3 (0123456)" {
		t.Fatalf("got %q", got)
	}
	Commit = "abc"
	if got := String(); got != "1.2.3" {
		t.Fatalf("short commit: %q", got)
	}
}
