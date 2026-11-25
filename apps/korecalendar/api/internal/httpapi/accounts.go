package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/qarasky/korecalendar/api/internal/auth"
	"github.com/qarasky/korecalendar/api/internal/users"
)

const (
	sessionTTL   = 30 * 24 * time.Hour
	maxBodyBytes = 1 << 20
)

// decode reads a JSON body into v, answering 400 invalid_json itself.
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err := dec.Decode(v); err != nil {
		errJSON(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return false
	}
	return true
}

func rateLimited(w http.ResponseWriter, retry time.Duration) {
	sec := int(retry.Seconds())
	w.Header().Set("Retry-After", strconv.Itoa(sec))
	writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": map[string]any{
		"code": "rate_limited", "message": "too many attempts, try again later", "retryAfterSec": sec}})
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	tok := auth.RawToken(r)
	endSession := ""
	if s.sso != nil {
		// A Kore ID session also ends the single sign-on session (RP-initiated
		// logout): the client is told where to send the browser.
		endSession = s.sso.Provider.EndSessionURL(r.Context(), auth.SessionIDToken(r.Context(), s.db, tok), s.publicURL+"/login")
	}
	auth.DeleteSession(r.Context(), s.db, tok)
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r)})
	if endSession != "" {
		writeJSON(w, http.StatusOK, map[string]string{"end_session_url": endSession})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	u, err := users.Get(r.Context(), s.db, p.UserID)
	if err != nil {
		errJSON(w, http.StatusUnauthorized, "unauthorized", "authentication required")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *server) handlePatchMe(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var in struct {
		Timezone *string `json:"timezone"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Timezone != nil {
		if _, err := time.LoadLocation(*in.Timezone); err != nil || *in.Timezone == "" || *in.Timezone == "Local" {
			errJSON(w, http.StatusUnprocessableEntity, "validation_error", "timezone must be an IANA zone such as Europe/Berlin")
			return
		}
		if err := users.SetTimezone(r.Context(), s.db, p.UserID, *in.Timezone); err != nil {
			errJSON(w, http.StatusInternalServerError, "internal", "could not save the timezone")
			return
		}
	}
	s.handleMe(w, r)
}

// handleAdminListUsers lists every account for the administrator's user page
// (roles and whether Kore ID is linked; no passwords anywhere).
func (s *server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	list, err := users.List(r.Context(), s.db)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not read the users")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleAdminPatchUser changes a user's role.
func (s *server) handleAdminPatchUser(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Role *string `json:"role"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Role == nil || (*in.Role != "user" && *in.Role != "admin") {
		errJSON(w, http.StatusUnprocessableEntity, "validation_error", "role must be user or admin")
		return
	}
	id := r.PathValue("id")
	switch err := users.SetRole(r.Context(), s.db, id, *in.Role); {
	case errors.Is(err, users.ErrNotFound):
		errJSON(w, http.StatusNotFound, "not_found", "not found")
		return
	case err != nil:
		errJSON(w, http.StatusInternalServerError, "internal", "could not change the role")
		return
	}
	u, err := users.Get(r.Context(), s.db, id)
	if err != nil {
		errJSON(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	writeJSON(w, http.StatusOK, u)
}
