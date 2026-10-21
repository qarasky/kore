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

	"github.com/artchsh/kore/api/internal/nodes"
	"github.com/artchsh/kore/api/internal/users"
	"github.com/artchsh/kore/api/internal/volume"
)

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// contentDisposition builds an attachment header with an ASCII fallback and
// an RFC 5987 filename* parameter.
func contentDisposition(name string) string {
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
	return `attachment; filename="` + fb.String() + `"; filename*=UTF-8''` + enc.String()
}

func setDownloadHeaders(w http.ResponseWriter, name string) {
	h := w.Header()
	h.Set("Content-Disposition", contentDisposition(name))
	h.Set("X-Content-Type-Options", "nosniff")
}

// Download serves a single file node (with Range support). The node lookup
// is done and finished before any bytes are streamed.
func Download(w http.ResponseWriter, r *http.Request, db *sql.DB, dataDir string, actor users.User, id string) {
	n, err := nodes.Get(r.Context(), db, actor, id)
	if errors.Is(err, nodes.ErrNotFound) {
		writeErr(w, 404, "not_found")
		return
	}
	if err != nil {
		log.Printf("download: lookup %s: %v", id, err)
		writeErr(w, 500, "internal")
		return
	}
	if n.IsDir {
		writeErr(w, 400, "is_directory")
		return
	}
	if n.BlobID == nil {
		writeErr(w, 404, "not_found")
		return
	}
	p, err := volume.BlobPath(dataDir, *n.BlobID)
	if err != nil {
		log.Printf("download: node %s: %v", n.ID, err)
		writeErr(w, 500, "internal")
		return
	}
	f, err := os.Open(p)
	if err != nil {
		log.Printf("download: node %s blob missing: %v", n.ID, err)
		if errors.Is(err, os.ErrNotExist) {
			writeErr(w, 404, "not_found")
		} else {
			writeErr(w, 500, "internal")
		}
		return
	}
	defer f.Close()
	h := w.Header()
	h.Set("Content-Type", "application/octet-stream")
	setDownloadHeaders(w, n.Name)
	http.ServeContent(w, r, n.Name, time.Unix(n.UpdatedAt, 0), f)
}
