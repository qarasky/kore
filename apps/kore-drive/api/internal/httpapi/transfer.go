package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/transfer"
)

func (s *server) registerTransfer(mux *http.ServeMux) {
	mux.Handle("GET /api/nodes/{id}/download", auth.RequireUser(http.HandlerFunc(s.download)))
	mux.Handle("POST /api/download/zip", auth.RequireUser(http.HandlerFunc(s.downloadZip)))
}

func (s *server) download(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	transfer.Download(w, r, s.db, s.dataDir, me, r.PathValue("id"))
}

func (s *server) downloadZip(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	var in struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
		errJSON(w, 400, "bad_request")
		return
	}
	transfer.Zip(w, r, s.db, s.dataDir, me, in.IDs)
}
