package transfer

import (
	"archive/zip"
	"database/sql"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/qarasky/kore/api/internal/nodes"
	"github.com/qarasky/kore/api/internal/users"
	"github.com/qarasky/kore/api/internal/volume"
)

// MaxZipIDs caps the number of ids in one zip request.
const MaxZipIDs = 1000

var storedExt = map[string]bool{
	".zip": true, ".gz": true, ".tgz": true, ".bz2": true, ".xz": true, ".7z": true, ".rar": true, ".zst": true,
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true, ".heic": true, ".avif": true,
	".mp4": true, ".mkv": true, ".webm": true, ".mov": true, ".avi": true, ".m4v": true,
	".mp3": true, ".aac": true, ".m4a": true, ".ogg": true, ".opus": true, ".flac": true,
	".pdf": true, ".docx": true, ".xlsx": true, ".pptx": true, ".jar": true, ".apk": true,
}

func methodFor(name string) uint16 {
	if storedExt[strings.ToLower(path.Ext(name))] {
		return zip.Store
	}
	return zip.Deflate
}

// sanitizeName makes a single node name safe as one zip path component.
func sanitizeName(name string) string {
	name = strings.ReplaceAll(name, "\x00", "")
	name = strings.NewReplacer("/", "_", "\\", "_").Replace(name)
	if strings.Trim(name, ".") == "" && name != "" {
		name = strings.ReplaceAll(name, ".", "_")
	}
	if strings.TrimSpace(name) == "" {
		return "_"
	}
	return name
}

// uniqueIn returns name, or name with " (n)" before the extension, so that it
// is not in used; the result is added to used.
func uniqueIn(used map[string]bool, name string, isDir bool) string {
	cand := name
	ext := ""
	base := name
	if !isDir {
		ext = path.Ext(name)
		if ext == name {
			ext = ""
		}
		base = strings.TrimSuffix(name, ext)
	}
	for i := 1; used[cand]; i++ {
		cand = base + " (" + strconv.Itoa(i) + ")" + ext
	}
	used[cand] = true
	return cand
}

type entry struct {
	name string // full zip path; dirs end with "/"
	node nodes.Node
}

func collect(r *http.Request, db *sql.DB, parentPath string, dir nodes.Node, out *[]entry) error {
	kids, err := nodes.LiveChildren(r.Context(), db, dir.ID)
	if err != nil {
		return err
	}
	used := map[string]bool{}
	for _, k := range kids {
		name := uniqueIn(used, sanitizeName(k.Name), k.IsDir)
		if k.IsDir {
			p := parentPath + name + "/"
			*out = append(*out, entry{p, k})
			if err := collect(r, db, p, k, out); err != nil {
				return err
			}
		} else {
			*out = append(*out, entry{parentPath + name, k})
		}
	}
	return nil
}

// Zip streams the selected nodes (folders recursively) as a zip archive.
// If any id is inaccessible or missing the whole request is 404. If a blob
// goes missing mid-stream the response is aborted (http.ErrAbortHandler) so
// the client sees a failed download rather than a silently incomplete zip.
func Zip(w http.ResponseWriter, r *http.Request, db *sql.DB, dataDir string, actor users.User, ids []string) {
	if len(ids) == 0 {
		writeErr(w, 400, "no_ids")
		return
	}
	if len(ids) > MaxZipIDs {
		writeErr(w, 400, "too_many_ids")
		return
	}
	// Phase 1: resolve everything from the DB; nothing is streamed yet.
	seen := map[string]bool{}
	var tops []nodes.Node
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		n, err := nodes.Get(r.Context(), db, actor, id)
		if errors.Is(err, nodes.ErrNotFound) {
			writeErr(w, 404, "not_found")
			return
		}
		if err != nil {
			log.Printf("zip: lookup %s: %v", id, err)
			writeErr(w, 500, "internal")
			return
		}
		tops = append(tops, n)
	}
	ServeZip(w, r, db, dataDir, tops)
}

// ServeZip streams already-authorized nodes (folders recursively, trashed
// descendants excluded) as a zip archive named after a single top folder.
func ServeZip(w http.ResponseWriter, r *http.Request, db *sql.DB, dataDir string, tops []nodes.Node) {
	var entries []entry
	used := map[string]bool{}
	for _, n := range tops {
		name := uniqueIn(used, sanitizeName(n.Name), n.IsDir)
		if n.IsDir {
			p := name + "/"
			entries = append(entries, entry{p, n})
			if err := collect(r, db, p, n, &entries); err != nil {
				log.Printf("zip: collect %s: %v", n.ID, err)
				writeErr(w, 500, "internal")
				return
			}
		} else {
			entries = append(entries, entry{name, n})
		}
	}
	zipName := "kore-download.zip"
	if len(tops) == 1 && tops[0].IsDir {
		zipName = sanitizeName(tops[0].Name) + ".zip"
	}

	// Phase 2: stream; no DB access from here on.
	h := w.Header()
	h.Set("Content-Type", "application/zip")
	setDownloadHeaders(w, zipName)
	zw := zip.NewWriter(w)
	abort := func(format string, args ...any) {
		log.Printf(format, args...)
		panic(http.ErrAbortHandler)
	}
	for _, e := range entries {
		hdr := &zip.FileHeader{Name: e.name, Modified: time.Unix(e.node.UpdatedAt, 0)}
		if e.node.IsDir {
			hdr.Method = zip.Store
			if _, err := zw.CreateHeader(hdr); err != nil {
				abort("zip: write dir %q: %v", e.name, err)
			}
			continue
		}
		if e.node.BlobID == nil {
			abort("zip: node %s has no blob", e.node.ID)
		}
		p, err := volume.BlobPath(dataDir, *e.node.BlobID)
		if err != nil {
			abort("zip: node %s: %v", e.node.ID, err)
		}
		f, err := os.Open(p)
		if err != nil {
			abort("zip: node %s blob unreadable: %v", e.node.ID, err)
		}
		hdr.Method = methodFor(e.name)
		fw, err := zw.CreateHeader(hdr)
		if err == nil {
			_, err = io.Copy(fw, f)
		}
		f.Close()
		if err != nil {
			abort("zip: streaming %q: %v", e.name, err)
		}
	}
	if err := zw.Close(); err != nil {
		abort("zip: close: %v", err)
	}
}
