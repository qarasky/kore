package transfer

import (
	"bytes"
	"testing"
)

var (
	pngMagic  = []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}
	jpegMagic = []byte{0xff, 0xd8, 0xff, 0xe0}
)

func avif(major, compat string) []byte {
	b := []byte{0, 0, 0, 0x1c, 'f', 't', 'y', 'p'}
	b = append(b, major...)
	b = append(b, 0, 0, 0, 0)
	b = append(b, "mif1"+compat+"miaf"...)
	return b
}

func TestSniffViewType(t *testing.T) {
	pdfLate := append(bytes.Repeat([]byte(" "), 500), "%PDF-1.7"...)
	pdfTooLate := append(bytes.Repeat([]byte(" "), 1100), "%PDF-1.7"...)
	cases := []struct {
		name string
		head []byte
		want string // content type, "" = refused
	}{
		{"a.png", append(pngMagic, 1, 2, 3), "image/png"},
		{"A.PNG", pngMagic, "image/png"},
		{"a.png", pngMagic[:7], ""},
		{"a.jpg", jpegMagic, "image/jpeg"},
		{"a.jpeg", jpegMagic, "image/jpeg"},
		{"a.jpg", pngMagic, ""}, // family mismatch
		{"a.png", jpegMagic, ""},
		{"a.gif", []byte("GIF87a...."), "image/gif"},
		{"a.gif", []byte("GIF89a<script>alert(1)</script>"), "image/gif"}, // polyglot: still only ever an image
		{"a.gif", []byte("GIF90a"), ""},
		{"a.webp", []byte("RIFF\x10\x00\x00\x00WEBPVP8 "), "image/webp"},
		{"a.webp", []byte("RIFF\x10\x00\x00\x00WAVEfmt "), ""},
		{"a.avif", avif("avif", ""), "image/avif"},
		{"a.avif", avif("avis", ""), "image/avif"},
		{"a.avif", avif("mif1", "avif"), "image/avif"}, // compatible brand
		{"a.avif", avif("heic", "heix"), ""},
		{"a.bmp", []byte("BM\x00\x00"), "image/bmp"},
		{"a.pdf", []byte("%PDF-1.4\n"), "application/pdf"},
		{"a.pdf", pdfLate, "application/pdf"},
		{"a.pdf", pdfTooLate, ""},
		{"a.pdf", []byte("<html><script>alert(1)</script></html>"), ""},
		{"a.png", []byte("<html><script>alert(1)</script></html>"), ""},
		{"a.svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), ""},
		{"a.svg", pngMagic, ""}, // SVG is never previewable, whatever the bytes
		{"a.html", []byte("%PDF-1.4"), ""},
		{"noext", pngMagic, ""},
		{"a.png", nil, ""},
	}
	for _, c := range cases {
		if got := viewType(c.name, c.head); got != c.want {
			t.Errorf("%s %q: got %q want %q", c.name, c.head[:min(len(c.head), 12)], got, c.want)
		}
	}
}
