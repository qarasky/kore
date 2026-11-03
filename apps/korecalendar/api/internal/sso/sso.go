// Package sso maps Kore ID identities to local users: lookup by subject,
// optional linking by email, auto-provisioning, and bearer-token principals.
package sso

import (
	"context"
	"database/sql"
	"errors"
	"net/mail"
	"slices"
	"strings"
	"time"

	"github.com/qarasky/korecalendar/api/internal/auth"
	"github.com/qarasky/korecalendar/api/internal/calendars"
	"github.com/qarasky/korecalendar/api/internal/config"
	"github.com/qarasky/korecalendar/api/internal/oidc"
	"github.com/qarasky/korecalendar/api/internal/users"
)

// Errors a login can end with; the HTTP layer maps them to messages.
var (
	ErrNoEmail      = errors.New("the identity provider sent no email address")
	ErrNoAccount    = errors.New("no local account for this identity and auto-provisioning is off")
	ErrNoAdmin      = errors.New("this calendar has no administrator yet")
	ErrEmailInUse   = errors.New("a local account with this email exists and is not linked")
	ErrAlreadyLinks = errors.New("the local account is already linked to another identity")
)

// Service resolves identities for one provider.
type Service struct {
	DB       *sql.DB
	Provider *oidc.Provider
	Cfg      config.OIDC
}

func (s *Service) roleFor(sub string) string {
	if slices.Contains(s.Cfg.AdminSubs, sub) {
		return "admin"
	}
	return "user"
}

func (s *Service) mayLinkByEmail(c oidc.Claims) bool {
	switch s.Cfg.LinkByEmail {
	case "trusted":
		return true
	case "verified":
		return c.EmailVerified
	}
	return false
}

// Resolve returns the local user for verified claims, creating or linking one
// as configured. The subject is the identity; the email is only used to link
// or create, never to look a user up once linked.
func (s *Service) Resolve(ctx context.Context, c oidc.Claims) (users.User, error) {
	if c.Subject == "" {
		return users.User{}, errors.New("no subject")
	}
	u, err := users.GetBySub(ctx, s.DB, c.Subject)
	if err == nil {
		// Administrators named in config are promoted; nothing demotes.
		if u.Role != "admin" && s.roleFor(c.Subject) == "admin" {
			if err := users.SetRole(ctx, s.DB, u.ID, "admin"); err != nil {
				return users.User{}, err
			}
			u.Role = "admin"
		}
		return u, nil
	}
	if !errors.Is(err, users.ErrNotFound) {
		return users.User{}, err
	}

	email := strings.ToLower(strings.TrimSpace(c.Email))
	if a, perr := mail.ParseAddress(email); email == "" || perr != nil || a.Address != email || len(email) > 254 {
		return users.User{}, ErrNoEmail
	}

	if existing, sub, err := users.GetLinkByEmail(ctx, s.DB, email); err == nil {
		if sub != "" {
			return users.User{}, ErrAlreadyLinks
		}
		if !s.mayLinkByEmail(c) {
			return users.User{}, ErrEmailInUse
		}
		if err := users.LinkSub(ctx, s.DB, existing.ID, c.Subject); err != nil {
			return users.User{}, err
		}
		if s.roleFor(c.Subject) == "admin" && existing.Role != "admin" {
			_ = users.SetRole(ctx, s.DB, existing.ID, "admin")
			existing.Role = "admin"
		}
		return existing, nil
	} else if !errors.Is(err, users.ErrNotFound) {
		return users.User{}, err
	}

	if !s.Cfg.AutoProvision {
		return users.User{}, ErrNoAccount
	}
	role := s.roleFor(c.Subject)
	if n, err := users.Count(ctx, s.DB); err != nil {
		return users.User{}, err
	} else if n == 0 && role != "admin" {
		// Never let whoever signs in first on a fresh install become (or
		// pre-empt) the administrator: that is admin_subs, or the explicitly
		// configured owner email (with a verified claim).
		if s.Cfg.OwnerEmail == "" || !c.EmailVerified || !strings.EqualFold(email, s.Cfg.OwnerEmail) {
			return users.User{}, ErrNoAdmin
		}
		role = "admin"
	}
	u, err = users.CreateOIDC(ctx, s.DB, email, c.Subject, role)
	switch {
	case errors.Is(err, users.ErrSubTaken): // lost a race with a parallel login
		return users.GetBySub(ctx, s.DB, c.Subject)
	case errors.Is(err, users.ErrEmailTaken):
		return users.User{}, ErrEmailInUse
	case err != nil:
		return users.User{}, err
	}
	if _, err := calendars.CreateDefault(ctx, s.DB, u.ID); err != nil {
		return users.User{}, err
	}
	return u, nil
}

// Bearer authenticates "Authorization: Bearer <Kore ID access token>". The
// principal is a session-class one (Via "session"): the token is the user's own
// signed-in identity (the Android app uses it once to mint its own kcal_ token).
func (s *Service) Bearer(ctx context.Context, tok string) (auth.Principal, bool) {
	if !oidc.IsJWT(tok) {
		return auth.Principal{}, false
	}
	c, err := s.Provider.VerifyAccessToken(ctx, tok)
	if err != nil {
		return auth.Principal{}, false
	}
	// A token from a Kore ID session that has been logged out stays valid at
	// Kore ID's side until it expires; refuse it here already.
	if c.Sid != "" && s.sidEnded(ctx, c.Sid) {
		return auth.Principal{}, false
	}
	u, err := s.Resolve(ctx, c)
	if err != nil {
		return auth.Principal{}, false
	}
	return auth.Principal{UserID: u.ID, Role: u.Role, Via: "session"}, true
}

// ErrLogoutReplayed is returned for a logout token whose jti was already used.
var ErrLogoutReplayed = errors.New("logout token was already used")

// endedSidTTL is how long an ended Kore ID session id is remembered, so that
// access tokens minted in it (10 minutes) are refused: comfortably longer.
const endedSidTTL = time.Hour

func (s *Service) sidEnded(ctx context.Context, sid string) bool {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM oidc_ended_sids WHERE sid=? AND expires_at>?`, sid, time.Now().Unix()).Scan(&n)
	return err != nil || n > 0 // fail closed
}

// BackchannelLogout handles a verified logout token: it records the jti
// (refusing one already seen, until the token expires), then ends every local
// session from that Kore ID session (sid), or every session of that user (sub)
// when the token names no sid. Access tokens (kcal_) are not sessions and stay.
// It returns how many sessions ended.
func (s *Service) BackchannelLogout(ctx context.Context, c oidc.LogoutClaims) (int64, error) {
	now := time.Now()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM oidc_logout_jti WHERE expires_at<?`, now.Unix()); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM oidc_ended_sids WHERE expires_at<?`, now.Unix()); err != nil {
		return 0, err
	}
	// Keep the jti at least until the token expires (plus the verifier's leeway).
	res, err := tx.ExecContext(ctx, `INSERT INTO oidc_logout_jti(jti,expires_at) VALUES(?,?) ON CONFLICT(jti) DO NOTHING`,
		c.JTI, c.Expires.Add(time.Minute).Unix())
	if err != nil {
		return 0, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return 0, ErrLogoutReplayed
	}
	var del sql.Result
	if c.Sid != "" {
		if _, err := tx.ExecContext(ctx, `INSERT INTO oidc_ended_sids(sid,expires_at) VALUES(?,?)
			ON CONFLICT(sid) DO UPDATE SET expires_at=excluded.expires_at`, c.Sid, now.Add(endedSidTTL).Unix()); err != nil {
			return 0, err
		}
		del, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE oidc_sid=?`, c.Sid)
	} else {
		del, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE oidc_sub=?)`, c.Subject)
	}
	if err != nil {
		return 0, err
	}
	n, _ := del.RowsAffected()
	return n, tx.Commit()
}
