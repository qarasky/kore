package httpapi

import (
	"encoding/json"
	"mime"
	"net/http"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/transfer"
)

func (s *server) registerTransfer(mux *http.ServeMux) {
	mux.Handle("GET /api/nodes/{id}/download", auth.RequireUser(http.HandlerFunc(s.download)))
	mux.Handle("GET /api/nodes/{id}/view", auth.RequireUser(http.HandlerFunc(s.view)))
	mux.Handle("POST /api/download/zip", auth.RequireUser(http.HandlerFunc(s.downloadZip)))
}

func (s *server) download(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	transfer.Download(w, r, s.db, s.dataDir, me, r.PathValue("id"))
}

// view serves an image or PDF inline for the preview pane (transfer.View).
func (s *server) view(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	transfer.View(w, r, s.db, s.dataDir, me, r.PathValue("id"))
}

// downloadZip takes {"ids":[...]} as JSON, or repeated ids=... form fields
// so the web UI can submit a plain HTML form and let the browser stream the
// archive to disk instead of buffering it in JavaScript. Cross-site form
// posts carry no session (the cookie is SameSite=Lax), and the response is a
// download the posting page cannot read.
func (s *server) downloadZip(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var ids []string
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt == "application/x-www-form-urlencoded" {
		if err := r.ParseForm(); err != nil {
			errJSON(w, 400, "bad_request")
			return
		}
		ids = r.PostForm["ids"]
	} else {
		var in struct {
			IDs []string `json:"ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			errJSON(w, 400, "bad_request")
			return
		}
		ids = in.IDs
	}
	transfer.Zip(w, r, s.db, s.dataDir, me, ids)
}
