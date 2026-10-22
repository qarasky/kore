package transfer

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func TestEncodeThumb(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 400, 200))
	for x := 0; x < 400; x++ {
		for y := 0; y < 200; y++ {
			src.Set(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 7, A: 255})
		}
	}
	var pb, jb bytes.Buffer
	if err := png.Encode(&pb, src); err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(&jb, src, nil); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name  string
		data  []byte
		ctype string
	}{{"png", pb.Bytes(), "image/png"}, {"jpeg", jb.Bytes(), "image/jpeg"}} {
		out, ctype, err := encodeThumb(bytes.NewReader(c.data))
		if err != nil || ctype != c.ctype {
			t.Fatalf("%s: %v %q", c.name, err, ctype)
		}
		img, _, err := image.Decode(bytes.NewReader(out))
		if err != nil {
			t.Fatal(err)
		}
		if b := img.Bounds(); b.Dx() != thumbSize || b.Dy() != thumbSize/2 {
			t.Errorf("%s: scaled to %v, want %dx%d", c.name, b, thumbSize, thumbSize/2)
		}
	}
	// A small image is not enlarged.
	small := image.NewNRGBA(image.Rect(0, 0, 10, 20))
	var sb bytes.Buffer
	_ = png.Encode(&sb, small)
	out, _, err := encodeThumb(bytes.NewReader(sb.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if img, _, _ := image.Decode(bytes.NewReader(out)); img.Bounds().Dx() != 10 || img.Bounds().Dy() != 20 {
		t.Errorf("small image resized to %v", img.Bounds())
	}
	if _, _, err := encodeThumb(bytes.NewReader([]byte("not an image"))); err == nil {
		t.Error("garbage decoded")
	}
}
