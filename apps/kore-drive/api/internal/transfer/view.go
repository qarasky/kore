package transfer

import (
	"bytes"
	"database/sql"
	"errors"
	"io"
	"log"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/artchsh/kore/api/internal/nodes"
	"github.com/artchsh/kore/api/internal/users"
)

// viewExts maps the extensions /view serves to their file family. Mirrored
// by VIEW_EXTS in web/lib/preview.ts (a web unit test reads this block).
// SVG is deliberately absent: it is a document that can run script.
var viewExts = map[string]string{
	"png":  "png",
	"jpg":  "jpeg",
	"jpeg": "jpeg",
	"gif":  "gif",
	"webp": "webp",
	"avif": "avif",
	"bmp":  "bmp",
	"pdf":  "pdf",
}

// viewContentType is the only Content-Type each family is served with.
var viewContentType = map[string]string{
	"png":  "image/png",
	"jpeg": "image/jpeg",
	"gif":  "image/gif",
	"webp": "image/webp",
	"avif": "image/avif",
	"bmp":  "image/bmp",
	"pdf":  "application/pdf",
}

// viewSniffLen is how much of a file the sniff reads (and how far in a PDF
// header may start, as PDF readers allow leading junk).
const viewSniffLen = 1024

// sniffFamily identifies a file family by its magic bytes ("" = unknown).
func sniffFamily(head []byte) string {
	switch {
	case bytes.HasPrefix(head, []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}):
		return "png"
	case bytes.HasPrefix(head, []byte{0xff, 0xd8, 0xff}):
		return "jpeg"
	case bytes.HasPrefix(head, []byte("GIF87a")), bytes.HasPrefix(head, []byte("GIF89a")):
		return "gif"
	case len(head) >= 12 && bytes.Equal(head[:4], []byte("RIFF")) && bytes.Equal(head[8:12], []byte("WEBP")):
		return "webp"
	case isAVIF(head):
		return "avif"
	case bytes.HasPrefix(head, []byte("BM")):
		return "bmp"
	case bytes.Contains(head[:min(len(head), viewSniffLen)], []byte("%PDF-")):
		return "pdf"
	}
	return ""
}

// isAVIF checks for an ISO-BMFF ftyp box whose major or a compatible brand
// is avif (still image) or avis (sequence).
func isAVIF(head []byte) bool {
	if len(head) < 16 || !bytes.Equal(head[4:8], []byte("ftyp")) {
		return false
	}
	size := int(head[0])<<24 | int(head[1])<<16 | int(head[2])<<8 | int(head[3])
	if size < 16 || size > len(head) {
		size = len(head)
	}
	brands := [][]byte{head[8:12]}
	for i := 16; i+4 <= size; i += 4 { // after major brand + minor version
		brands = append(brands, head[i:i+4])
	}
	for _, b := range brands {
		if string(b) == "avif" || string(b) == "avis" {
			return true
		}
	}
	return false
}

// viewType returns the Content-Type to serve name with, given its first
// bytes: only when the extension is allowlisted AND the bytes are that
// family. "" means not previewable.
func viewType(name string, head []byte) string {
	ext := strings.ToLower(path.Ext(name))
	if ext == "" {
		return ""
	}
	fam, ok := viewExts[ext[1:]]
	if !ok || sniffFamily(head) != fam {
		return ""
	}
	return viewContentType[fam]
}

const (
	// Opened directly, an image is an inert document: no loads, no script.
	imageCSP = "default-src 'none'; sandbox"
	// PDFs need the browser's built-in viewer. Tested in Chromium 156
	// (Playwright, new headless): its out-of-process viewer renders the PDF,
	// framed from our page and top-level, with every variant tried, even
	// with `sandbox`. `sandbox` is still left out on purpose: Firefox's
	// pdf.js runs as script in the document and refuses sandboxed documents
	// (falling back to a download), which would break the preview for
	// Firefox users (not verifiable in this environment). The response is
	// application/pdf with nosniff, so it can never be parsed as HTML;
	// default-src 'none' blocks every load, object-src 'self' lets engines
	// that embed the viewer as a plugin in this document load it from
	// here, and frame-ancestors 'self' lets only Kore's own pages frame it.
	pdfCSP = "default-src 'none'; object-src 'self'; frame-ancestors 'self'"
)

// View serves a file inline for the preview pane (a PDF opened top-level is
// sent as an attachment, see below): images (png, jpeg, gif,
// webp, avif, bmp) and PDF, with Range support. Access is checked like
// Download. The extension must be allowlisted and the magic bytes must
// agree; anything else is 415 not_previewable. Content-Type comes from the
// verified sniff, never from the stored mime.
func View(w http.ResponseWriter, r *http.Request, db *sql.DB, dataDir string, actor users.User, id string) {
	if n, ok := lookupFile(w, r, db, actor, id, "view"); ok {
		ServeView(w, r, dataDir, n)
	}
}

// ServeView is View for an already-authorized node.
func ServeView(w http.ResponseWriter, r *http.Request, dataDir string, n nodes.Node) {
	f, ok := openBlob(w, dataDir, n, "view")
	if !ok {
		return
	}
	defer f.Close()
	head := make([]byte, viewSniffLen)
	k, err := io.ReadFull(f, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		log.Printf("view: node %s read: %v", n.ID, err)
		writeErr(w, 500, "internal")
		return
	}
	ctype := viewType(n.Name, head[:k])
	if ctype == "" {
		writeErr(w, 415, "not_previewable")
		return
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		log.Printf("view: node %s seek: %v", n.ID, err)
		writeErr(w, 500, "internal")
		return
	}
	h := w.Header()
	h.Set("Content-Type", ctype)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, no-store")
	h.Set("Content-Disposition", disposition("inline", n.Name))
	if ctype == "application/pdf" {
		h.Set("Content-Security-Policy", pdfCSP)
		// A PDF opened as a top-level document (typed URL, link, "open
		// frame in new tab") downloads instead of rendering under our
		// origin outside the preview. Only "document" is treated so: the
		// preview's frame sends "iframe", embeds "embed"/"object", and
		// Firefox's pdf.js fetches ranges as "empty"; browsers that send no
		// Sec-Fetch-Dest keep inline.
		h.Add("Vary", "Sec-Fetch-Dest")
		if strings.EqualFold(r.Header.Get("Sec-Fetch-Dest"), "document") {
			h.Set("Content-Disposition", disposition("attachment", n.Name))
		}
	} else {
		h.Set("Content-Security-Policy", imageCSP)
	}
	http.ServeContent(&jsonErrorWriter{ResponseWriter: w}, r, n.Name, time.Unix(n.UpdatedAt, 0), f)
}
