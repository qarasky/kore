package transfer

import (
	"bytes"
	"database/sql"
	"image"
	_ "image/gif" // registers the decoder
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"net/http"
	"time"

	_ "golang.org/x/image/bmp" // registers the decoder
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // registers the decoder

	"github.com/qarasky/kore/api/internal/nodes"
	"github.com/qarasky/kore/api/internal/users"
)

const (
	// thumbSize is the longest side of a thumbnail in pixels (shown at ~22px,
	// so this stays sharp on high-DPI screens).
	thumbSize = 96
	// thumbMaxPixels refuses to decode huge images (a decoded RGBA image costs
	// 4 bytes per pixel); the row keeps its icon instead.
	thumbMaxPixels = 64 << 20
	thumbMaxJobs   = 4
)

// thumbJobs bounds how many images are decoded at once, so a folder full of
// photos cannot exhaust memory or CPU.
var thumbJobs = make(chan struct{}, thumbMaxJobs)

// thumbFamilies are the image families Go can decode (AVIF cannot, and SVG is
// never served): anything else is 415 and the web keeps the icon.
var thumbFamilies = map[string]bool{"png": true, "jpeg": true, "gif": true, "webp": true, "bmp": true}

// Thumb serves a small preview image of an image file (ServeThumb).
func Thumb(w http.ResponseWriter, r *http.Request, db *sql.DB, dataDir string, actor users.User, id string) {
	if n, ok := lookupFile(w, r, db, actor, id, "thumb"); ok {
		ServeThumb(w, r, dataDir, n)
	}
}

// ServeThumb is Thumb for an already-authorized node. The extension must be
// allowlisted and the magic bytes must agree (as for View). The result is a
// downscaled JPEG (for JPEG sources) or PNG, safe to cache in the browser:
// a node's blob never changes, and a new upload is a new node or blob.
func ServeThumb(w http.ResponseWriter, r *http.Request, dataDir string, n nodes.Node) {
	f, ok := openBlob(w, dataDir, n, "thumb")
	if !ok {
		return
	}
	defer f.Close()
	head := make([]byte, viewSniffLen)
	k, _ := io.ReadFull(f, head)
	head = head[:k]
	if viewType(n.Name, head) == "" || !thumbFamilies[sniffFamily(head)] {
		writeErr(w, 415, "not_previewable")
		return
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		log.Printf("thumb: node %s seek: %v", n.ID, err)
		writeErr(w, 500, "internal")
		return
	}
	select {
	case thumbJobs <- struct{}{}:
		defer func() { <-thumbJobs }()
	case <-r.Context().Done():
		return
	}
	data, ctype, err := encodeThumb(f)
	if err != nil {
		writeErr(w, 415, "not_previewable")
		return
	}
	h := w.Header()
	h.Set("Content-Type", ctype)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", imageCSP)
	h.Set("Cache-Control", "private, max-age=86400")
	http.ServeContent(&jsonErrorWriter{ResponseWriter: w}, r, "", time.Unix(n.UpdatedAt, 0), bytes.NewReader(data))
}

// encodeThumb decodes an image and returns it scaled to fit thumbSize, with
// its Content-Type.
func encodeThumb(rs io.ReadSeeker) ([]byte, string, error) {
	cfg, format, err := image.DecodeConfig(rs)
	if err != nil {
		return nil, "", err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > thumbMaxPixels {
		return nil, "", image.ErrFormat
	}
	if _, err := rs.Seek(0, io.SeekStart); err != nil {
		return nil, "", err
	}
	src, _, err := image.Decode(rs)
	if err != nil {
		return nil, "", err
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w > thumbSize || h > thumbSize {
		if w >= h {
			h = max(1, h*thumbSize/w)
			w = thumbSize
		} else {
			w = max(1, w*thumbSize/h)
			h = thumbSize
		}
	}
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.BiLinear.Scale(dst, dst.Bounds(), src, b, draw.Over, nil)
	var buf bytes.Buffer
	if format == "jpeg" {
		if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 80}); err != nil {
			return nil, "", err
		}
		return buf.Bytes(), "image/jpeg", nil
	}
	if err := png.Encode(&buf, dst); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), "image/png", nil
}
