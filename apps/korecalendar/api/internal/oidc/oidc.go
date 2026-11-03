// Package oidc is a small OpenID Connect relying party for Kore ID: discovery,
// the authorization-code flow with PKCE (S256), id-token verification against
// the provider's JWKS (EdDSA), and verification of Kore ID access tokens used
// as API bearer tokens.
package oidc

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Config configures a Provider.
type Config struct {
	Issuer       string   // e.g. https://id.kore.example (no trailing slash)
	ClientID     string   // "korecalendar"
	ClientSecret string   // empty for a public client
	RedirectURL  string   // <public_url>/api/auth/oidc/callback
	Scopes       []string // default: openid profile email
	// Audiences are the client ids whose access tokens the API accepts as
	// bearer tokens. ClientID is always included.
	Audiences []string
	HTTP      *http.Client
	Now       func() time.Time
}

// Claims are the verified claims the app cares about.
type Claims struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	Nonce         string
	Scope         string
	Sid           string // Kore ID browser session id (ties tokens to a sign-in for logout)
	ClientID      string // access tokens: the client the token was issued to
}

// LogoutClaims are the verified claims of a back-channel logout token. At least
// one of Subject and Sid is set.
type LogoutClaims struct {
	Subject string
	Sid     string
	JTI     string
	Expires time.Time
}

// BackchannelLogoutEvent is the member the events claim of a logout token must have.
const BackchannelLogoutEvent = "http://schemas.openid.net/event/backchannel-logout"

type metadata struct {
	Issuer        string `json:"issuer"`
	AuthEndpoint  string `json:"authorization_endpoint"`
	TokenEndpoint string `json:"token_endpoint"`
	JWKSURI       string `json:"jwks_uri"`
	EndSession    string `json:"end_session_endpoint"`
}

// Provider talks to one OpenID provider. Discovery and keys are fetched lazily
// and cached, so the API starts (and password login works) while Kore ID is down.
type Provider struct {
	cfg Config

	mu          sync.Mutex
	meta        *metadata
	metaAt      time.Time
	keys        map[string]ed25519.PublicKey
	keysAt      time.Time
	lastRefresh time.Time
}

const (
	metaTTL       = time.Hour
	keysTTL       = 10 * time.Minute
	minRefreshGap = 30 * time.Second
	leeway        = 30 * time.Second
	maxBody       = 1 << 20
)

// New validates cfg and returns a Provider. It does no network I/O.
func New(cfg Config) (*Provider, error) {
	cfg.Issuer = strings.TrimRight(cfg.Issuer, "/")
	u, err := url.Parse(cfg.Issuer)
	if err != nil || u.Host == "" || (u.Scheme != "https" && !(u.Scheme == "http" && isLoopback(u.Hostname()))) {
		return nil, fmt.Errorf("oidc issuer %q must be an https URL (http is allowed only for localhost)", cfg.Issuer)
	}
	if cfg.ClientID == "" {
		return nil, errors.New("oidc client_id is required")
	}
	if cfg.RedirectURL == "" {
		return nil, errors.New("oidc redirect_url is required")
	}
	if len(cfg.Scopes) == 0 {
		cfg.Scopes = []string{"openid", "profile", "email"}
	}
	hasOpenID := false
	for _, s := range cfg.Scopes {
		hasOpenID = hasOpenID || s == "openid"
	}
	if !hasOpenID {
		cfg.Scopes = append([]string{"openid"}, cfg.Scopes...)
	}
	cfg.Audiences = append([]string{cfg.ClientID}, cfg.Audiences...)
	if cfg.HTTP == nil {
		cfg.HTTP = &http.Client{Timeout: 10 * time.Second}
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Provider{cfg: cfg}, nil
}

func isLoopback(h string) bool { return h == "localhost" || h == "127.0.0.1" || h == "::1" }

// Issuer returns the configured issuer.
func (p *Provider) Issuer() string { return p.cfg.Issuer }

func (p *Provider) getJSON(ctx context.Context, u string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	res, err := p.cfg.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: status %d", u, res.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(res.Body, maxBody)).Decode(v)
}

func (p *Provider) metadata(ctx context.Context) (*metadata, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.meta != nil && p.cfg.Now().Sub(p.metaAt) < metaTTL {
		return p.meta, nil
	}
	var m metadata
	if err := p.getJSON(ctx, p.cfg.Issuer+"/.well-known/openid-configuration", &m); err != nil {
		if p.meta != nil {
			return p.meta, nil // stale beats down
		}
		return nil, fmt.Errorf("oidc discovery: %w", err)
	}
	// The discovery document must describe the issuer we were configured with
	// (OIDC Discovery 4.3), or a hostile redirect could swap the endpoints.
	if m.Issuer != p.cfg.Issuer {
		return nil, fmt.Errorf("oidc discovery: issuer %q does not match configured %q", m.Issuer, p.cfg.Issuer)
	}
	if m.AuthEndpoint == "" || m.TokenEndpoint == "" || m.JWKSURI == "" {
		return nil, errors.New("oidc discovery: authorization_endpoint, token_endpoint and jwks_uri are required")
	}
	p.meta, p.metaAt = &m, p.cfg.Now()
	return p.meta, nil
}

type jwk struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	Kid string `json:"kid"`
	X   string `json:"x"`
	Use string `json:"use"`
}

// refreshKeys loads the JWKS. Caller holds p.mu.
func (p *Provider) refreshKeys(ctx context.Context, m *metadata) error {
	var set struct {
		Keys []jwk `json:"keys"`
	}
	p.lastRefresh = p.cfg.Now()
	if err := p.getJSON(ctx, m.JWKSURI, &set); err != nil {
		return fmt.Errorf("oidc jwks: %w", err)
	}
	keys := map[string]ed25519.PublicKey{}
	for _, k := range set.Keys {
		if k.Kty != "OKP" || k.Crv != "Ed25519" || (k.Use != "" && k.Use != "sig") {
			continue
		}
		raw, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil || len(raw) != ed25519.PublicKeySize {
			continue
		}
		keys[k.Kid] = ed25519.PublicKey(raw)
	}
	p.keys, p.keysAt = keys, p.cfg.Now()
	return nil
}

func (p *Provider) key(ctx context.Context, kid string) (ed25519.PublicKey, error) {
	m, err := p.metadata(ctx)
	if err != nil {
		return nil, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.cfg.Now()
	stale := p.keys == nil || now.Sub(p.keysAt) > keysTTL
	if k, ok := p.keys[kid]; ok && !stale {
		return k, nil
	}
	// Unknown kid (rotation) or stale cache: refetch, but not more than once per
	// minRefreshGap, so garbage tokens cannot make us hammer the provider.
	if p.keys == nil || now.Sub(p.lastRefresh) >= minRefreshGap {
		if err := p.refreshKeys(ctx, m); err != nil {
			if k, ok := p.keys[kid]; ok {
				return k, nil
			}
			return nil, err
		}
	}
	if k, ok := p.keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("oidc: unknown signing key %q", kid)
}

// typOf returns the JWT header typ, lower-cased, without an "application/" prefix (RFC 7515 4.1.9).
func typOf(t *jwt.Token) string {
	s, _ := t.Header["typ"].(string)
	return strings.TrimPrefix(strings.ToLower(s), "application/")
}

// verify checks signature (EdDSA only), issuer, audience, expiry, a subject
// (unless optionalSub) and that the header typ passes typOK.
func (p *Provider) verify(ctx context.Context, raw string, audiences []string, typOK func(string) bool, optionalSub bool) (jwt.MapClaims, error) {
	claims := jwt.MapClaims{}
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"EdDSA"}),
		jwt.WithIssuer(p.cfg.Issuer),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(leeway),
		jwt.WithTimeFunc(p.cfg.Now),
	)
	tok, err := parser.ParseWithClaims(raw, claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return p.key(ctx, kid)
	})
	if err != nil {
		return nil, err
	}
	if typ := typOf(tok); !typOK(typ) {
		return nil, fmt.Errorf("unexpected token type %q", typ)
	}
	aud, err := claims.GetAudience()
	if err != nil || len(aud) == 0 {
		return nil, errors.New("token has no audience")
	}
	ok := false
	for _, a := range aud {
		for _, want := range audiences {
			ok = ok || a == want
		}
	}
	if !ok {
		return nil, errors.New("token audience is not this app")
	}
	if sub, _ := claims["sub"].(string); sub == "" && !optionalSub {
		return nil, errors.New("token has no subject")
	}
	return claims, nil
}

func toClaims(m jwt.MapClaims) Claims {
	str := func(k string) string { s, _ := m[k].(string); return s }
	ev, _ := m["email_verified"].(bool)
	return Claims{Subject: str("sub"), Email: str("email"), EmailVerified: ev, Name: str("name"), Nonce: str("nonce"), Scope: str("scope"),
		Sid: str("sid"), ClientID: str("client_id")}
}

// VerifyIDToken verifies an id token for this client and, when wantNonce is
// non-empty, that its nonce matches. Its header typ must be absent or "JWT", so
// an access or logout token is never taken for an id token.
func (p *Provider) VerifyIDToken(ctx context.Context, raw, wantNonce string) (Claims, error) {
	m, err := p.verify(ctx, raw, []string{p.cfg.ClientID}, func(t string) bool { return t == "" || t == "jwt" }, false)
	if err != nil {
		return Claims{}, err
	}
	c := toClaims(m)
	if wantNonce != "" && c.Nonce != wantNonce {
		return Claims{}, errors.New("id token nonce mismatch")
	}
	return c, nil
}

// VerifyAccessToken verifies a Kore ID access token presented as an API bearer
// token: header typ "at+jwt" (RFC 9068), so an id token (same key and issuer)
// is refused; audience one of the configured client ids; and, as a second
// guard, a scope claim (id tokens have none) and a client_id that matches.
func (p *Provider) VerifyAccessToken(ctx context.Context, raw string) (Claims, error) {
	m, err := p.verify(ctx, raw, p.cfg.Audiences, func(t string) bool { return t == "at+jwt" }, false)
	if err != nil {
		return Claims{}, err
	}
	c := toClaims(m)
	if c.Scope == "" {
		return Claims{}, errors.New("not an access token")
	}
	if c.ClientID != "" && !slices.Contains(p.cfg.Audiences, c.ClientID) {
		return Claims{}, errors.New("access token was issued to another client")
	}
	return c, nil
}

// VerifyLogoutToken verifies an OIDC Back-Channel Logout 1.0 logout token:
// signature against the JWKS, issuer, audience = this client only, header typ
// "logout+jwt", iat, exp and jti present, the back-channel logout event in
// `events`, no nonce, and a sid or sub. Replay (jti) is the caller's job.
func (p *Provider) VerifyLogoutToken(ctx context.Context, raw string) (LogoutClaims, error) {
	m, err := p.verify(ctx, raw, []string{p.cfg.ClientID}, func(t string) bool { return t == "logout+jwt" }, true)
	if err != nil {
		return LogoutClaims{}, err
	}
	if _, ok := m["iat"]; !ok {
		return LogoutClaims{}, errors.New("logout token has no iat")
	}
	exp, err := m.GetExpirationTime()
	if err != nil || exp == nil {
		return LogoutClaims{}, errors.New("logout token has no exp")
	}
	jti, _ := m["jti"].(string)
	if jti == "" {
		return LogoutClaims{}, errors.New("logout token has no jti")
	}
	events, _ := m["events"].(map[string]any)
	if _, ok := events[BackchannelLogoutEvent].(map[string]any); !ok {
		return LogoutClaims{}, errors.New("logout token has no back-channel logout event")
	}
	if _, ok := m["nonce"]; ok {
		return LogoutClaims{}, errors.New("logout token must not have a nonce")
	}
	sub, _ := m["sub"].(string)
	sid, _ := m["sid"].(string)
	if sub == "" && sid == "" {
		return LogoutClaims{}, errors.New("logout token has neither sid nor sub")
	}
	return LogoutClaims{Subject: sub, Sid: sid, JTI: jti, Expires: exp.Time}, nil
}

// IsJWT reports whether tok has the shape of a compact JWT.
func IsJWT(tok string) bool { return strings.Count(tok, ".") == 2 && strings.HasPrefix(tok, "eyJ") }

func randomURLSafe(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// Flow is the per-login secret state, kept server-side between redirect and callback.
type Flow struct {
	State    string
	Nonce    string
	Verifier string
	URL      string // where to send the browser
}

// Begin creates a new authorization request (PKCE S256, state, nonce).
func (p *Provider) Begin(ctx context.Context) (Flow, error) {
	m, err := p.metadata(ctx)
	if err != nil {
		return Flow{}, err
	}
	f := Flow{State: randomURLSafe(24), Nonce: randomURLSafe(24), Verifier: randomURLSafe(32)}
	sum := sha256.Sum256([]byte(f.Verifier))
	u, err := url.Parse(m.AuthEndpoint)
	if err != nil {
		return Flow{}, err
	}
	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", p.cfg.ClientID)
	q.Set("redirect_uri", p.cfg.RedirectURL)
	q.Set("scope", strings.Join(p.cfg.Scopes, " "))
	q.Set("state", f.State)
	q.Set("nonce", f.Nonce)
	q.Set("code_challenge", base64.RawURLEncoding.EncodeToString(sum[:]))
	q.Set("code_challenge_method", "S256")
	u.RawQuery = q.Encode()
	f.URL = u.String()
	return f, nil
}

// Exchange trades the authorization code for tokens, verifies the id token
// (signature, issuer, audience, expiry, nonce) and returns its claims and the
// raw id token (kept for RP-initiated logout).
func (p *Provider) Exchange(ctx context.Context, code, verifier, nonce string) (Claims, string, error) {
	m, err := p.metadata(ctx)
	if err != nil {
		return Claims{}, "", err
	}
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {p.cfg.RedirectURL},
		"code_verifier": {verifier},
	}
	if p.cfg.ClientSecret == "" {
		form.Set("client_id", p.cfg.ClientID) // public client
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return Claims{}, "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if p.cfg.ClientSecret != "" { // client_secret_basic, form-encoded per RFC 6749 2.3.1
		req.SetBasicAuth(url.QueryEscape(p.cfg.ClientID), url.QueryEscape(p.cfg.ClientSecret))
	}
	res, err := p.cfg.HTTP.Do(req)
	if err != nil {
		return Claims{}, "", fmt.Errorf("token request: %w", err)
	}
	defer res.Body.Close()
	var tok struct {
		IDToken string `json:"id_token"`
		Error   string `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxBody)).Decode(&tok); err != nil {
		return Claims{}, "", fmt.Errorf("token response: %w", err)
	}
	if res.StatusCode != http.StatusOK || tok.IDToken == "" {
		return Claims{}, "", fmt.Errorf("token endpoint refused the code (status %d, %q)", res.StatusCode, tok.Error)
	}
	if nonce == "" {
		return Claims{}, "", errors.New("missing nonce")
	}
	c, err := p.VerifyIDToken(ctx, tok.IDToken, nonce)
	if err != nil {
		return Claims{}, "", fmt.Errorf("id token: %w", err)
	}
	return c, tok.IDToken, nil
}

// EndSessionURL builds the RP-initiated logout URL, or "" when the provider has
// no end_session_endpoint or there is no id token to hint with.
func (p *Provider) EndSessionURL(ctx context.Context, idToken, postLogoutRedirect string) string {
	if idToken == "" {
		return ""
	}
	m, err := p.metadata(ctx)
	if err != nil || m.EndSession == "" {
		return ""
	}
	u, err := url.Parse(m.EndSession)
	if err != nil {
		return ""
	}
	q := u.Query()
	q.Set("id_token_hint", idToken)
	q.Set("post_logout_redirect_uri", postLogoutRedirect)
	u.RawQuery = q.Encode()
	return u.String()
}
