package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/qarasky/korecalendar/api/internal/auth"
)

func (s *server) handleListTokens(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	list, err := auth.ListTokens(r.Context(), s.db, p.UserID)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not list tokens")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *server) handleCreateToken(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var in struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &in) {
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || utf8.RuneCountInString(name) > 100 {
		errJSON(w, http.StatusUnprocessableEntity, "validation_error", "name must be 1-100 characters")
		return
	}
	id, secret, err := auth.CreateToken(r.Context(), s.db, p.UserID, name)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not create the token")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id, "name": name, "token": secret})
}

func (s *server) handleRevokeToken(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if err := auth.RevokeToken(r.Context(), s.db, p.UserID, r.PathValue("id")); err != nil {
		if errors.Is(err, auth.ErrNotFound) {
			errJSON(w, http.StatusNotFound, "not_found", "token not found")
			return
		}
		errJSON(w, http.StatusInternalServerError, "internal", "could not revoke the token")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
