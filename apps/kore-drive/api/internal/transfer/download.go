// Package transfer implements streaming downloads: single files with Range
// support and on-the-fly zip archives. No DB handle is held while file bytes
// are streamed, and no temporary files are written.
package transfer

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/qarasky/kore/api/internal/nodes"
	"github.com/qarasky/kore/api/internal/users"
	"github.com/qarasky/kore/api/internal/volume"
)

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// contentDisposition builds an attachment header with an ASCII fallback and
// an RFC 5987 filename* parameter.
func contentDisposition(name string) string { return disposition("attachment", name) }

// disposition builds a Content-Disposition header of the given type
// ("attachment" or "inline") with an ASCII fallback filename and an RFC 5987
// filename* parameter.
func disposition(kind, name string) string {
	var fb strings.Builder
	for _, r := range name {
		if r < 0x20 || r > 0x7e || r == '"' || r == '\\' || r == '%' {
			fb.WriteByte('_')
		} else {
			fb.WriteRune(r)
		}
	}
	var enc strings.Builder
	for _, c := range []byte(name) {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9',
			strings.IndexByte("!#$&+-.^_`|~", c) >= 0:
			enc.WriteByte(c)
		default:
			fmt.Fprintf(&enc, "%%%02X", c)
		}
	}
	return kind + `; filename="` + fb.String() + `"; filename*=UTF-8''` + enc.String()
}

func setDownloadHeaders(w http.ResponseWriter, name string) {
	h := w.Header()
	h.Set("Content-Disposition", contentDisposition(name))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, no-store")
}

// Download serves a single file node (with Range support). The node lookup
// is done and finished before any bytes are streamed.
func Download(w http.ResponseWriter, r *http.Request, db *sql.DB, dataDir string, actor users.User, id string) {
	if n, ok := lookupFile(w, r, db, actor, id, "download"); ok {
		ServeDownload(w, r, dataDir, n)
	}
}

// ServeDownload streams an already-authorized file node as an attachment
// (with Range support). Callers must have checked access to n.
func ServeDownload(w http.ResponseWriter, r *http.Request, dataDir string, n nodes.Node) {
	f, ok := openBlob(w, dataDir, n, "download")
	if !ok {
		return
	}
	defer f.Close()
	h := w.Header()
	h.Set("Content-Type", "application/octet-stream")
	setDownloadHeaders(w, n.Name)
	http.ServeContent(&jsonErrorWriter{ResponseWriter: w}, r, n.Name, time.Unix(n.UpdatedAt, 0), f)
}

// lookupFile looks up a live node the actor may access; on failure it has
// written the JSON error and returns ok=false.
func lookupFile(w http.ResponseWriter, r *http.Request, db *sql.DB, actor users.User, id, tag string) (nodes.Node, bool) {
	n, err := nodes.Get(r.Context(), db, actor, id)
	if errors.Is(err, nodes.ErrNotFound) {
		writeErr(w, 404, "not_found")
		return n, false
	}
	if err != nil {
		log.Printf("%s: lookup %s: %v", tag, id, err)
		writeErr(w, 500, "internal")
		return n, false
	}
	return n, true
}

// openBlob opens the blob of an already-authorized file node; on failure
// (a folder, a missing blob) it has written the JSON error and returns
// ok=false.
func openBlob(w http.ResponseWriter, dataDir string, n nodes.Node, tag string) (*os.File, bool) {
	if n.IsDir {
		writeErr(w, 400, "is_directory")
		return nil, false
	}
	if n.BlobID == nil {
		writeErr(w, 404, "not_found")
		return nil, false
	}
	p, err := volume.BlobPath(dataDir, *n.BlobID)
	if err != nil {
		log.Printf("%s: node %s: %v", tag, n.ID, err)
		writeErr(w, 500, "internal")
		return nil, false
	}
	f, err := os.Open(p)
	if err != nil {
		log.Printf("%s: node %s blob missing: %v", tag, n.ID, err)
		if errors.Is(err, os.ErrNotExist) {
			writeErr(w, 404, "not_found")
		} else {
			writeErr(w, 500, "internal")
		}
		return nil, false
	}
	return f, true
}
