package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/nodes"
	"github.com/artchsh/kore/api/internal/quota"
)

func (s *server) registerNodes(mux *http.ServeMux) {
	mux.Handle("GET /api/nodes", auth.RequireUser(http.HandlerFunc(s.listNodes)))
	mux.Handle("POST /api/nodes", auth.RequireUser(http.HandlerFunc(s.createNode)))
	mux.Handle("PATCH /api/nodes/{id}", auth.RequireUser(http.HandlerFunc(s.patchNode)))
	mux.Handle("GET /api/nodes/{id}/path", auth.RequireUser(http.HandlerFunc(s.nodePath)))
}

type nodeJSON struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	IsDir     bool    `json:"is_dir"`
	Size      int64   `json:"size"`
	Mime      string  `json:"mime"`
	ParentID  *string `json:"parent_id"`
	Space     string  `json:"space"`
	UpdatedAt int64   `json:"updated_at"`
}

func toJSON(n nodes.Node) nodeJSON {
	sp := "shared"
	if n.SpaceOwner != nil {
		sp = "personal"
	}
	return nodeJSON{n.ID, n.Name, n.IsDir, n.Size, n.Mime, n.ParentID, sp, n.UpdatedAt}
}

func nodeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, nodes.ErrNotFound):
		errJSON(w, 404, "not_found")
	case errors.Is(err, nodes.ErrNameTaken):
		errJSON(w, 409, "name_taken")
	case errors.Is(err, nodes.ErrInvalidName):
		errJSON(w, 400, "invalid_name")
	case errors.Is(err, nodes.ErrInvalidMove):
		errJSON(w, 400, "invalid_move")
	case errors.Is(err, nodes.ErrSpaceMismatch):
		errJSON(w, 400, "space_mismatch")
	case errors.Is(err, nodes.ErrNotDir):
		errJSON(w, 400, "not_a_folder")
	case errors.Is(err, quota.ErrExceeded):
		errJSON(w, 507, "quota_exceeded")
	default:
		errJSON(w, 500, "internal")
	}
}

// spaceFor maps a space name to a Space for the actor; ok=false if invalid.
func spaceFor(name, userID string) (nodes.Space, bool) {
	switch name {
	case "personal":
		return nodes.Personal(userID), true
	case "shared":
		return nodes.Space{}, true
	}
	return nodes.Space{}, false
}

func (s *server) listNodes(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	q := r.URL.Query()
	sp, ok := spaceFor(q.Get("space"), me.ID)
	if !ok {
		errJSON(w, 400, "invalid_space")
		return
	}
	var parent *string
	if p := q.Get("parent"); p != "" {
		parent = &p
	}
	list, err := nodes.List(r.Context(), s.db, me, sp, parent)
	if err != nil {
		nodeErr(w, err)
		return
	}
	out := make([]nodeJSON, len(list))
	for i, n := range list {
		out[i] = toJSON(n)
	}
	writeJSON(w, 200, out)
}

func (s *server) createNode(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	var in struct {
		Space    string  `json:"space"`
		ParentID *string `json:"parent_id"`
		Name     string  `json:"name"`
	}
	if !decode(w, r, &in) {
		return
	}
	sp, ok := spaceFor(in.Space, me.ID)
	if !ok {
		errJSON(w, 400, "invalid_space")
		return
	}
	if in.ParentID != nil && *in.ParentID == "" {
		in.ParentID = nil
	}
	n, err := nodes.CreateFolder(r.Context(), s.db, me, sp, in.ParentID, in.Name)
	if err != nil {
		nodeErr(w, err)
		return
	}
	writeJSON(w, 201, toJSON(n))
}

func (s *server) patchNode(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	id := r.PathValue("id")
	var in struct {
		Name     *string         `json:"name"`
		ParentID json.RawMessage `json:"parent_id"` // absent = unchanged, null = root
		Space    *string         `json:"space"`     // destination space for root moves
	}
	if !decode(w, r, &in) {
		return
	}
	var mv *nodes.MoveTarget
	if in.ParentID != nil || in.Space != nil {
		mv = &nodes.MoveTarget{ParentSet: in.ParentID != nil}
		if in.ParentID != nil && string(in.ParentID) != "null" {
			var p string
			if err := json.Unmarshal(in.ParentID, &p); err != nil {
				errJSON(w, 400, "bad_request")
				return
			}
			if p != "" {
				mv.Parent = &p
			}
		}
		if in.Space != nil {
			sp, ok := spaceFor(*in.Space, me.ID)
			if !ok {
				errJSON(w, 400, "invalid_space")
				return
			}
			mv.Space = &sp
		}
	}
	if in.Name == nil && mv == nil {
		errJSON(w, 400, "bad_request")
		return
	}
	n, err := nodes.Update(r.Context(), s.db, me, id, in.Name, mv)
	if err != nil {
		nodeErr(w, err)
		return
	}
	writeJSON(w, 200, toJSON(n))
}

func (s *server) nodePath(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	p, err := nodes.Path(r.Context(), s.db, me, r.PathValue("id"))
	if err != nil {
		nodeErr(w, err)
		return
	}
	out := make([]nodeJSON, len(p))
	for i, n := range p {
		out[i] = toJSON(n)
	}
	writeJSON(w, 200, out)
}
