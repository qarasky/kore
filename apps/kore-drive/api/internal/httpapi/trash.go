package httpapi

import (
	"net/http"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/nodes"
)

func (s *server) registerTrash(mux *http.ServeMux) {
	mux.Handle("DELETE /api/nodes/{id}", auth.RequireUser(http.HandlerFunc(s.trashNode)))
	mux.Handle("POST /api/nodes/{id}/restore", auth.RequireUser(http.HandlerFunc(s.restoreNode)))
	mux.Handle("GET /api/trash", auth.RequireUser(http.HandlerFunc(s.listTrash)))
	mux.Handle("DELETE /api/trash", auth.RequireUser(http.HandlerFunc(s.emptyTrash)))
	mux.Handle("DELETE /api/trash/{id}", auth.RequireUser(http.HandlerFunc(s.purgeNode)))
}

type trashedJSON struct {
	nodeJSON
	TrashedAt int64 `json:"trashed_at"`
}

func (s *server) trashNode(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	if err := nodes.Trash(r.Context(), s.db, me, r.PathValue("id")); err != nil {
		nodeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) restoreNode(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	n, err := nodes.Restore(r.Context(), s.db, me, r.PathValue("id"))
	if err != nil {
		nodeErr(w, err)
		return
	}
	writeJSON(w, 200, toJSON(n))
}

func (s *server) listTrash(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	sp, ok := spaceFor(r.URL.Query().Get("space"), me.ID)
	if !ok {
		errJSON(w, 400, "invalid_space")
		return
	}
	list, err := nodes.ListTrash(r.Context(), s.db, me, sp)
	if err != nil {
		nodeErr(w, err)
		return
	}
	out := make([]trashedJSON, len(list))
	for i, n := range list {
		out[i] = trashedJSON{toJSON(n.Node), n.TrashedAt}
	}
	writeJSON(w, 200, out)
}

func (s *server) purgeNode(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	if err := nodes.PurgeNode(r.Context(), s.db, s.dataDir, me, r.PathValue("id")); err != nil {
		nodeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) emptyTrash(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	sp, ok := spaceFor(r.URL.Query().Get("space"), me.ID)
	if !ok {
		errJSON(w, 400, "invalid_space")
		return
	}
	if err := nodes.EmptyTrash(r.Context(), s.db, s.dataDir, me, sp); err != nil {
		nodeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
