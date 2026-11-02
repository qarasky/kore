package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/qarasky/korecalendar/api/internal/auth"
	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/users"
)

const (
	sessionTTL   = 30 * 24 * time.Hour
	minPwLen     = 8
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

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

// validCreds checks email and password shape, answering 422 itself.
func validCreds(w http.ResponseWriter, c credentials) bool {
	if !strings.Contains(c.Email, "@") || len(c.Email) > 254 {
		errJSON(w, http.StatusUnprocessableEntity, "validation_error", "email is not valid")
		return false
	}
	if utf8.RuneCountInString(c.Password) < minPwLen {
		errJSON(w, http.StatusUnprocessableEntity, "validation_error", "password must be at least 8 characters")
		return false
	}
	return true
}

func (s *server) startSession(w http.ResponseWriter, r *http.Request, u users.User, status int) {
	tok, err := auth.NewSession(r.Context(), s.db, u.ID, sessionTTL)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not create a session")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName, Value: tok, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r), MaxAge: int(sessionTTL.Seconds())})
	writeJSON(w, status, map[string]any{"token": tok, "user": u})
}

func busy(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "2")
	errJSON(w, http.StatusServiceUnavailable, "busy", "the server is busy, try again shortly")
}

// handleSetupStatus tells the sign-in page whether to offer first-run setup.
func (s *server) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	n, err := users.Count(r.Context(), s.db)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not read the setup state")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"setup_required": n == 0})
}

func (s *server) handleSetup(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if !decode(w, r, &c) || !validCreds(w, c) {
		return
	}
	hash, err := auth.HashPassword(c.Password)
	if errors.Is(err, auth.ErrBusy) {
		busy(w)
		return
	} else if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not hash the password")
		return
	}
	u, err := users.CreateFirstAdmin(r.Context(), s.db, c.Email, hash)
	switch {
	case errors.Is(err, users.ErrSetupClosed):
		errJSON(w, http.StatusConflict, "setup_closed", "an account already exists; sign in instead")
		return
	case err != nil:
		errJSON(w, http.StatusInternalServerError, "internal", "could not create the account")
		return
	}
	if _, err := calendars.CreateDefault(r.Context(), s.db, u.ID); err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not create the default calendar")
		return
	}
	s.startSession(w, r, u, http.StatusCreated)
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if !decode(w, r, &c) {
		return
	}
	ip := limitKey(r)
	emailKey := strings.ToLower(c.Email) + "|" + ip
	if !s.limiter.Attempt(emailKey) || !s.ipLimit.Attempt(ip) {
		rateLimited(w, 15*time.Minute)
		return
	}
	u, err := auth.Authenticate(r.Context(), s.db, c.Email, c.Password)
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials):
		errJSON(w, http.StatusUnauthorized, "bad_credentials", "invalid email or password")
		return
	case errors.Is(err, auth.ErrBusy):
		busy(w)
		return
	case err != nil:
		errJSON(w, http.StatusInternalServerError, "internal", "could not sign in")
		return
	}
	s.limiter.Reset(emailKey)
	s.ipLimit.Forgive(ip)
	s.startSession(w, r, u, http.StatusOK)
}

func rateLimited(w http.ResponseWriter, retry time.Duration) {
	sec := int(retry.Seconds())
	w.Header().Set("Retry-After", strconv.Itoa(sec))
	writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": map[string]any{
		"code": "rate_limited", "message": "too many attempts, try again later", "retryAfterSec": sec}})
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	auth.DeleteSession(r.Context(), s.db, auth.RawToken(r))
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r)})
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

func (s *server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if !decode(w, r, &c) || !validCreds(w, c) {
		return
	}
	if c.Role == "" {
		c.Role = "user"
	}
	if c.Role != "user" && c.Role != "admin" {
		errJSON(w, http.StatusUnprocessableEntity, "validation_error", "role must be user or admin")
		return
	}
	hash, err := auth.HashPassword(c.Password)
	if errors.Is(err, auth.ErrBusy) {
		busy(w)
		return
	} else if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not hash the password")
		return
	}
	u, err := users.Create(r.Context(), s.db, c.Email, hash, c.Role)
	switch {
	case errors.Is(err, users.ErrEmailTaken):
		errJSON(w, http.StatusConflict, "email_taken", "that email is already registered")
		return
	case err != nil:
		errJSON(w, http.StatusInternalServerError, "internal", "could not create the user")
		return
	}
	if _, err := calendars.CreateDefault(r.Context(), s.db, u.ID); err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not create the default calendar")
		return
	}
	writeJSON(w, http.StatusCreated, u)
}
