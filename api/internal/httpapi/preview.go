package httpapi

import (
	"bytes"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/nodes"
	"github.com/artchsh/kore/api/internal/volume"
)

const (
	previewMax = 512 << 10
	sniffLen   = 8 << 10
)

var textExts = map[string]bool{}
var textNames = map[string]bool{}

func init() {
	for _, e := range strings.Fields(`txt md markdown json yaml yml toml xml csv tsv log ini cfg conf env sh bash zsh fish go rs js jsx ts tsx mjs cjs py rb java kt c h cpp hpp cs php swift sql css scss html htm vue svelte lua pl r tex rst properties gradle dockerfile makefile`) {
		textExts[e] = true
	}
	for _, n := range []string{"Dockerfile", "Makefile", "README", "LICENSE", ".gitignore", ".env"} {
		textNames[n] = true
	}
}

func isTextName(name string) bool {
	if textNames[name] {
		return true
	}
	ext := strings.ToLower(path.Ext(name))
	if ext == "" {
		return false
	}
	return textExts[ext[1:]]
}

// validUTF8AllowTrunc reports whether b is valid UTF-8, tolerating an
// incomplete final rune (the sniff window may cut one in half).
func validUTF8AllowTrunc(b []byte) bool {
	if utf8.Valid(b) {
		return true
	}
	for i := 1; i < utf8.UTFMax && i <= len(b); i++ {
		if utf8.RuneStart(b[len(b)-i]) {
			if !utf8.FullRune(b[len(b)-i:]) {
				return utf8.Valid(b[:len(b)-i])
			}
			return false
		}
	}
	return false
}

func (s *server) registerPreview(mux *http.ServeMux) {
	mux.Handle("GET /api/nodes/{id}/preview", auth.RequireUser(http.HandlerFunc(s.preview)))
	mux.Handle("GET /api/search", auth.RequireUser(http.HandlerFunc(s.search)))
}

func (s *server) preview(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	n, err := nodes.Get(r.Context(), s.db, me, r.PathValue("id"))
	if err != nil {
		nodeErr(w, err)
		return
	}
	if n.IsDir {
		errJSON(w, 400, "is_directory")
		return
	}
	if n.BlobID == nil {
		errJSON(w, 404, "not_found")
		return
	}
	if !isTextName(n.Name) {
		errJSON(w, 415, "not_text")
		return
	}
	p, err := volume.BlobPath(s.dataDir, *n.BlobID)
	if err != nil {
		log.Printf("preview: node %s: %v", n.ID, err)
		errJSON(w, 500, "internal")
		return
	}
	f, err := os.Open(p)
	if err != nil {
		log.Printf("preview: node %s blob: %v", n.ID, err)
		if errors.Is(err, os.ErrNotExist) {
			errJSON(w, 404, "not_found")
		} else {
			errJSON(w, 500, "internal")
		}
		return
	}
	defer f.Close()
	// One extra byte tells us whether the file is larger than the window.
	buf, err := io.ReadAll(io.LimitReader(f, previewMax+1))
	if err != nil {
		log.Printf("preview: node %s read: %v", n.ID, err)
		errJSON(w, 500, "internal")
		return
	}
	truncated := len(buf) > previewMax
	if truncated {
		buf = buf[:previewMax]
		// Cut back to a rune boundary (at most UTFMax-1 bytes).
		for i := 0; i < utf8.UTFMax && len(buf) > 0; i++ {
			if r, size := utf8.DecodeLastRune(buf); r == utf8.RuneError && size <= 1 {
				buf = buf[:len(buf)-1]
				continue
			}
			break
		}
	}
	head := buf
	if len(head) > sniffLen {
		head = head[:sniffLen]
	}
	if bytes.IndexByte(head, 0) >= 0 || !validUTF8AllowTrunc(head) {
		errJSON(w, 415, "not_text")
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/plain; charset=utf-8")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, no-store")
	if truncated {
		h.Set("X-Truncated", "true")
	}
	w.WriteHeader(200)
	w.Write(buf)
}

type searchJSON struct {
	nodeJSON
	Path []string `json:"path"`
}

func (s *server) search(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	limit := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		l, err := strconv.Atoi(v)
		if err != nil || l < 1 {
			errJSON(w, 400, "bad_limit")
			return
		}
		limit = l
	}
	hits, err := nodes.SearchHits(r.Context(), s.db, me, r.URL.Query().Get("q"), limit)
	switch {
	case errors.Is(err, nodes.ErrEmptyQuery):
		errJSON(w, 400, "empty_query")
		return
	case errors.Is(err, nodes.ErrQueryTooLong):
		errJSON(w, 400, "query_too_long")
		return
	case err != nil:
		log.Printf("search: %v", err)
		errJSON(w, 500, "internal")
		return
	}
	out := make([]searchJSON, len(hits))
	for i, h := range hits {
		out[i] = searchJSON{toJSON(h.Node), h.Path}
	}
	writeJSON(w, 200, out)
}
