// Package oidc is a small OpenID Connect relying-party client for Kore ID:
// discovery, authorization-code + PKCE (S256), token and refresh requests,
// and verification of EdDSA-signed JWTs (ID, access and back-channel logout
// tokens) against the provider's JWKS. It has no dependencies beyond the
// standard library.
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
	"strings"
	"sync"
	"time"
)

// Errors callers distinguish.
var (
	// ErrInvalidGrant means the provider rejected a code or refresh token for
	// good (expired, revoked, reused). Anything else from Refresh is transient.
	ErrInvalidGrant = errors.New("oidc: invalid_grant")
	// ErrToken is any token that fails verification.
	ErrToken = errors.New("oidc: invalid token")
)

// Config is what the relying party needs to know.
type Config struct {
	Issuer       string
	ClientID     string
	ClientSecret string // empty: public client
	RedirectURL  string
	HTTPClient   *http.Client // default: 10 s timeout
}

// Provider talks to one issuer. Discovery and the JWKS are fetched lazily and
// cached, so Kore starts even while Kore ID is down.
type Provider struct {
	cfg  Config
	http *http.Client
	now  func() time.Time

	mu        sync.Mutex
	meta      *metadata
	metaAt    time.Time
	keys      map[string]ed25519.PublicKey
	keysAt    time.Time
	lastFetch time.Time // last JWKS fetch, to rate-limit unknown-kid refreshes

	jtiMu sync.Mutex
	jtis  map[string]time.Time // logout token ids seen, until they expire
}

type metadata struct {
	Issuer     string   `json:"issuer"`
	AuthURL    string   `json:"authorization_endpoint"`
	TokenURL   string   `json:"token_endpoint"`
	JWKSURL    string   `json:"jwks_uri"`
	EndSession string   `json:"end_session_endpoint"`
	Revocation string   `json:"revocation_endpoint"`
	S256       []string `json:"code_challenge_methods_supported"`
}

const (
	metaTTL    = time.Hour
	jwksTTL    = 10 * time.Minute
	jwksMinGap = 30 * time.Second
	leeway     = 30 * time.Second
	maxBody    = 1 << 20
)

// New returns a Provider.
func New(cfg Config) *Provider {
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Second}
	}
	cfg.Issuer = strings.TrimRight(cfg.Issuer, "/")
	return &Provider{cfg: cfg, http: hc, now: time.Now}
}

// ClientID is the configured client id (the expected token audience).
func (p *Provider) ClientID() string { return p.cfg.ClientID }

func (p *Provider) getJSON(ctx context.Context, u string, out any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return err
	}
	res, err := p.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("GET %s: status %d", u, res.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(res.Body, maxBody)).Decode(out)
}

func (p *Provider) metadata(ctx context.Context) (*metadata, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.meta != nil && p.now().Sub(p.metaAt) < metaTTL {
		return p.meta, nil
	}
	var m metadata
	if err := p.getJSON(ctx, p.cfg.Issuer+"/.well-known/openid-configuration", &m); err != nil {
		if p.meta != nil {
			return p.meta, nil // keep serving the stale copy
		}
		return nil, fmt.Errorf("oidc discovery: %w", err)
	}
	if strings.TrimRight(m.Issuer, "/") != p.cfg.Issuer {
		return nil, fmt.Errorf("oidc discovery: issuer %q does not match configured %q", m.Issuer, p.cfg.Issuer)
	}
	if m.AuthURL == "" || m.TokenURL == "" || m.JWKSURL == "" {
		return nil, errors.New("oidc discovery: incomplete metadata")
	}
	ok := false
	for _, c := range m.S256 {
		ok = ok || c == "S256"
	}
	if !ok {
		return nil, errors.New("oidc discovery: provider does not advertise PKCE S256")
	}
	p.meta, p.metaAt = &m, p.now()
	return p.meta, nil
}

// Flow is the per-login secret material that must survive the redirect.
type Flow struct {
	State, Nonce, Verifier string
}

func random(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// NewFlow returns fresh state, nonce and PKCE verifier.
func NewFlow() Flow { return Flow{State: random(32), Nonce: random(24), Verifier: random(48)} }

// ChallengeS256 is the PKCE challenge for a verifier.
func ChallengeS256(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// AuthURL is where to send the browser.
func (p *Provider) AuthURL(ctx context.Context, f Flow, extra url.Values) (string, error) {
	m, err := p.metadata(ctx)
	if err != nil {
		return "", err
	}
	u, err := url.Parse(m.AuthURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", p.cfg.ClientID)
	q.Set("redirect_uri", p.cfg.RedirectURL)
	q.Set("scope", "openid profile email offline_access")
	q.Set("state", f.State)
	q.Set("nonce", f.Nonce)
	q.Set("code_challenge", ChallengeS256(f.Verifier))
	q.Set("code_challenge_method", "S256")
	for k, v := range extra {
		q[k] = v
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// Tokens is a token endpoint response.
type Tokens struct {
	AccessToken  string `json:"access_token"`
	IDToken      string `json:"id_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

func (p *Provider) tokenRequest(ctx context.Context, form url.Values) (Tokens, error) {
	m, err := p.metadata(ctx)
	if err != nil {
		return Tokens{}, err
	}
	form.Set("client_id", p.cfg.ClientID)
	if p.cfg.ClientSecret != "" {
		form.Set("client_secret", p.cfg.ClientSecret) // client_secret_post
	}
	req, err := http.NewRequestWithContext(ctx, "POST", m.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return Tokens{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := p.http.Do(req)
	if err != nil {
		return Tokens{}, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, maxBody))
	if res.StatusCode != 200 {
		var e struct {
			Error string `json:"error"`
		}
		json.Unmarshal(body, &e)
		if res.StatusCode == 400 && e.Error == "invalid_grant" {
			return Tokens{}, ErrInvalidGrant
		}
		return Tokens{}, fmt.Errorf("token endpoint: status %d error %q", res.StatusCode, e.Error)
	}
	var t Tokens
	if err := json.Unmarshal(body, &t); err != nil {
		return Tokens{}, fmt.Errorf("token endpoint: %w", err)
	}
	return t, nil
}

// Exchange trades an authorization code for tokens.
func (p *Provider) Exchange(ctx context.Context, code, verifier string) (Tokens, error) {
	return p.tokenRequest(ctx, url.Values{
		"grant_type": {"authorization_code"}, "code": {code},
		"redirect_uri": {p.cfg.RedirectURL}, "code_verifier": {verifier},
	})
}

// Refresh redeems a refresh token. ErrInvalidGrant is permanent; any other
// error is transient. Refresh tokens rotate: store the new one.
func (p *Provider) Refresh(ctx context.Context, refreshToken string) (Tokens, error) {
	return p.tokenRequest(ctx, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refreshToken}})
}

// EndSessionURL builds the RP-initiated logout URL, or "" when the provider
// has none.
func (p *Provider) EndSessionURL(ctx context.Context, idToken, postLogout, state string) string {
	m, err := p.metadata(ctx)
	if err != nil || m.EndSession == "" || idToken == "" {
		return ""
	}
	u, err := url.Parse(m.EndSession)
	if err != nil {
		return ""
	}
	q := u.Query()
	q.Set("id_token_hint", idToken)
	q.Set("post_logout_redirect_uri", postLogout)
	if state != "" {
		q.Set("state", state)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// Claims are the verified claims Kore cares about.
type Claims struct {
	Sub, Email, Name, Nonce, Scope, Sid string
	EmailVerified                       bool
	Expires                             time.Time
}

func (p *Provider) key(ctx context.Context, kid string) (ed25519.PublicKey, error) {
	m, err := p.metadata(ctx)
	if err != nil {
		return nil, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if k, ok := p.keys[kid]; ok && p.now().Sub(p.keysAt) < jwksTTL {
		return k, nil
	}
	// Unknown kid or stale set: refetch, but not more often than jwksMinGap
	// (a forged kid must not turn into a request flood to the provider).
	if p.keys != nil && p.now().Sub(p.lastFetch) < jwksMinGap {
		if k, ok := p.keys[kid]; ok {
			return k, nil
		}
		return nil, fmt.Errorf("%w: unknown key id", ErrToken)
	}
	p.lastFetch = p.now()
	var set struct {
		Keys []struct {
			Kty, Crv, Kid, X, Use, Alg string
		} `json:"keys"`
	}
	if err := p.getJSON(ctx, m.JWKSURL, &set); err != nil {
		if k, ok := p.keys[kid]; ok {
			return k, nil
		}
		return nil, fmt.Errorf("oidc jwks: %w", err)
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
	p.keys, p.keysAt = keys, p.now()
	if k, ok := keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("%w: unknown key id", ErrToken)
}

// Token types (the JWT header "typ"), compared case-insensitively and with an
// optional "application/" prefix (RFC 9068 section 2.1, RFC 8417).
const (
	TypAccess = "at+jwt"
	TypLogout = "logout+jwt"
)

// BackchannelLogoutEvent is the required key of a logout token's events claim.
const BackchannelLogoutEvent = "http://schemas.openid.net/event/backchannel-logout"

func normTyp(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	return strings.TrimPrefix(t, "application/")
}

// rawClaims is every claim any of the token kinds uses.
type rawClaims struct {
	Iss           string          `json:"iss"`
	Aud           json.RawMessage `json:"aud"`
	Sub           string          `json:"sub"`
	Exp           float64         `json:"exp"`
	Nbf           float64         `json:"nbf"`
	Iat           float64         `json:"iat"`
	Jti           string          `json:"jti"`
	Sid           string          `json:"sid"`
	Nonce         string          `json:"nonce"`
	Email         string          `json:"email"`
	EmailVerified bool            `json:"email_verified"`
	Name          string          `json:"name"`
	Scope         string          `json:"scope"`
	Events        json.RawMessage `json:"events"`
}

func fail(why string) error { return fmt.Errorf("%w: %s", ErrToken, why) }

// verifyJWT checks signature (EdDSA only), issuer, audience (the client id),
// expiry and not-before. It returns the header typ (normalised), the claims,
// and the set of claim names present.
func (p *Provider) verifyJWT(ctx context.Context, token string) (string, rawClaims, map[string]json.RawMessage, error) {
	var c rawClaims
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", c, nil, fail("malformed")
	}
	dec := func(s string, v any) error {
		b, err := base64.RawURLEncoding.DecodeString(s)
		if err != nil {
			return err
		}
		return json.Unmarshal(b, v)
	}
	var hdr struct{ Alg, Kid, Typ string }
	if dec(parts[0], &hdr) != nil || hdr.Alg != "EdDSA" || hdr.Kid == "" {
		return "", c, nil, fail("unsupported header")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return "", c, nil, fail("malformed signature")
	}
	key, err := p.key(ctx, hdr.Kid)
	if err != nil {
		return "", c, nil, err
	}
	if !ed25519.Verify(key, []byte(parts[0]+"."+parts[1]), sig) {
		return "", c, nil, fail("bad signature")
	}
	var present map[string]json.RawMessage
	if dec(parts[1], &c) != nil || dec(parts[1], &present) != nil {
		return "", c, nil, fail("malformed claims")
	}
	if c.Iss != p.cfg.Issuer {
		return "", c, nil, fail("wrong issuer")
	}
	var aud []string
	var one string
	if json.Unmarshal(c.Aud, &one) == nil {
		aud = []string{one}
	} else if json.Unmarshal(c.Aud, &aud) != nil {
		return "", c, nil, fail("malformed audience")
	}
	okAud := false
	for _, a := range aud {
		okAud = okAud || a == p.cfg.ClientID
	}
	if !okAud {
		return "", c, nil, fail("wrong audience")
	}
	now := p.now()
	if c.Exp == 0 || now.After(time.Unix(int64(c.Exp), 0).Add(leeway)) {
		return "", c, nil, fail("expired")
	}
	if c.Nbf != 0 && now.Add(leeway).Before(time.Unix(int64(c.Nbf), 0)) {
		return "", c, nil, fail("not yet valid")
	}
	return normTyp(hdr.Typ), c, present, nil
}

func (c rawClaims) public() Claims {
	return Claims{Sub: c.Sub, Email: c.Email, Name: c.Name, Nonce: c.Nonce, Scope: c.Scope, Sid: c.Sid,
		EmailVerified: c.EmailVerified, Expires: time.Unix(int64(c.Exp), 0)}
}

// Verify checks an ID token: signature, issuer, audience, expiry, not-before
// and sub. Access and logout tokens (by their typ) are refused. The caller
// checks the nonce.
func (p *Provider) Verify(ctx context.Context, token string) (Claims, error) {
	typ, c, _, err := p.verifyJWT(ctx, token)
	if err != nil {
		return Claims{}, err
	}
	if typ == TypAccess || typ == TypLogout {
		return Claims{}, fail("not an id token")
	}
	if c.Sub == "" {
		return Claims{}, fail("missing sub")
	}
	return c.public(), nil
}

// VerifyAccessToken checks a bearer access token: as Verify, but the header
// typ must be at+jwt (RFC 9068). An ID token is never accepted as a bearer.
func (p *Provider) VerifyAccessToken(ctx context.Context, token string) (Claims, error) {
	typ, c, _, err := p.verifyJWT(ctx, token)
	if err != nil {
		return Claims{}, err
	}
	if typ != TypAccess {
		return Claims{}, fail("not an access token")
	}
	if c.Sub == "" {
		return Claims{}, fail("missing sub")
	}
	return c.public(), nil
}

// LogoutClaims identify what a back-channel logout ends: the Kore ID session
// (Sid) or, without one, every session of the subject (Sub).
type LogoutClaims struct {
	Sid, Sub, Jti string
}

// VerifyLogoutToken checks an OIDC Back-Channel Logout token: signature,
// issuer, audience, typ logout+jwt, iat/exp/jti present, events claim with the
// back-channel logout event, no nonce, sid or sub present, and jti not seen
// before. Seen jtis are kept in memory until the token expires, so replay
// protection is per process (Kore runs a single API instance).
func (p *Provider) VerifyLogoutToken(ctx context.Context, token string) (LogoutClaims, error) {
	if token == "" {
		return LogoutClaims{}, fail("missing logout token")
	}
	typ, c, present, err := p.verifyJWT(ctx, token)
	if err != nil {
		return LogoutClaims{}, err
	}
	if typ != TypLogout {
		return LogoutClaims{}, fail("not a logout token")
	}
	for _, k := range []string{"iat", "exp", "jti"} {
		if _, ok := present[k]; !ok {
			return LogoutClaims{}, fail("missing " + k)
		}
	}
	if c.Jti == "" || c.Iat == 0 {
		return LogoutClaims{}, fail("missing iat or jti")
	}
	var events map[string]json.RawMessage
	if len(c.Events) == 0 || json.Unmarshal(c.Events, &events) != nil || events == nil {
		return LogoutClaims{}, fail("missing events")
	}
	if _, ok := events[BackchannelLogoutEvent]; !ok {
		return LogoutClaims{}, fail("missing back-channel logout event")
	}
	if _, ok := present["nonce"]; ok {
		return LogoutClaims{}, fail("nonce not allowed")
	}
	if c.Sid == "" && c.Sub == "" {
		return LogoutClaims{}, fail("sid or sub required")
	}
	if p.seenJTI(c.Jti, time.Unix(int64(c.Exp), 0).Add(leeway)) {
		return LogoutClaims{}, fail("replayed")
	}
	return LogoutClaims{Sid: c.Sid, Sub: c.Sub, Jti: c.Jti}, nil
}

// seenJTI reports whether jti was already used and otherwise records it until
// until. Expired entries are pruned on every call.
func (p *Provider) seenJTI(jti string, until time.Time) bool {
	p.jtiMu.Lock()
	defer p.jtiMu.Unlock()
	now := p.now()
	for k, exp := range p.jtis {
		if now.After(exp) {
			delete(p.jtis, k)
		}
	}
	if _, ok := p.jtis[jti]; ok {
		return true
	}
	if p.jtis == nil {
		p.jtis = map[string]time.Time{}
	}
	p.jtis[jti] = until
	return false
}

// ForgetLogoutJTI lets a logout token be delivered again (used when acting on
// it failed, so the provider's retry is not refused as a replay).
func (p *Provider) ForgetLogoutJTI(jti string) {
	p.jtiMu.Lock()
	defer p.jtiMu.Unlock()
	delete(p.jtis, jti)
}

// Issuer is the configured issuer URL (no trailing slash).
func (p *Provider) Issuer() string { return p.cfg.Issuer }
