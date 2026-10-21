package quota

import (
	"context"
	"testing"
)

func TestCategoryOf(t *testing.T) {
	cases := []struct{ name, want string }{
		{"photo.jpg", "images"},
		{"PHOTO.JPEG", "images"},
		{"scan.Png", "images"},
		{"clip.MP4", "video"},
		{"movie.mkv", "video"},
		{"song.flac", "audio"},
		{"voice.m4a", "audio"},
		{"report.pdf", "documents"},
		{"Budget.XLSX", "documents"},
		{"notes.md", "documents"},
		{"data.csv", "documents"},
		{"slides.pptx", "documents"},
		{"backup.zip", "archives"},
		{"site.tar.gz", "archives"}, // double extension: the last one counts
		{"disk.iso", "archives"},
		{"installer.dmg", "archives"},
		{"main.go", "code"},
		{"app.tsx", "code"},
		{"config.yaml", "code"},
		{"page.html", "code"},
		{"report.final.PDF", "documents"},
		{"noext", "other"},
		{"Makefile", "other"},
		{"trailing.", "other"},
		{".env", "code"},     // a dotfile's name after the dot is its extension
		{".bashrc", "other"}, // ...which may be unknown
		{".tar.gz", "archives"},
		{"weird.ЖПГ", "other"},
		{"", "other"},
		{"a.unknownext", "other"},
	}
	for _, c := range cases {
		if got := CategoryOf(c.name); got != c.want {
			t.Errorf("CategoryOf(%q) = %q, want %q", c.name, got, c.want)
		}
	}
}

// The SQL extension expression must agree with ExtOf, since Breakdown
// groups by it in SQL and maps the result in Go.
func TestExtSQLMatchesExtOf(t *testing.T) {
	d := setup(t, 100)
	for _, name := range []string{"photo.jpg", "PHOTO.JPEG", "site.tar.gz", "noext", "trailing.", ".env", ".tar.gz", "weird.ЖПГ", "a.b.c.d", "...", "x.Y", "файл.txt", "a b.mp3"} {
		var got string
		if err := d.QueryRowContext(context.Background(), `SELECT `+extSQL("?1"), name).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if want := ExtOf(name); got != want {
			t.Errorf("%q: sql %q, go %q", name, got, want)
		}
	}
}
