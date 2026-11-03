// Package oidc is a small OpenID Connect relying-party client for Kore ID:
// discovery, authorization-code + PKCE (S256), token and refresh requests,
// and verification of EdDSA-signed JWTs against the provider's JWKS. It has
// no dependencies beyond the standard library.
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
	Sub, Email, Name, Nonce, Scope string
	Expires                        time.Time
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

// Verify checks signature (EdDSA only), issuer, audience (the client id),
// expiry and not-before of a JWT and returns its claims. The caller checks
// the nonce (id tokens) or scope (access tokens).
func (p *Provider) Verify(ctx context.Context, token string) (Claims, error) {
	fail := func(why string) (Claims, error) { return Claims{}, fmt.Errorf("%w: %s", ErrToken, why) }
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return fail("malformed")
	}
	dec := func(s string, v any) error {
		b, err := base64.RawURLEncoding.DecodeString(s)
		if err != nil {
			return err
		}
		return json.Unmarshal(b, v)
	}
	var hdr struct{ Alg, Kid string }
	if dec(parts[0], &hdr) != nil || hdr.Alg != "EdDSA" || hdr.Kid == "" {
		return fail("unsupported header")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return fail("malformed signature")
	}
	key, err := p.key(ctx, hdr.Kid)
	if err != nil {
		return Claims{}, err
	}
	if !ed25519.Verify(key, []byte(parts[0]+"."+parts[1]), sig) {
		return fail("bad signature")
	}
	var c struct {
		Iss   string          `json:"iss"`
		Aud   json.RawMessage `json:"aud"`
		Sub   string          `json:"sub"`
		Exp   float64         `json:"exp"`
		Nbf   float64         `json:"nbf"`
		Nonce string          `json:"nonce"`
		Email string          `json:"email"`
		Name  string          `json:"name"`
		Scope string          `json:"scope"`
	}
	if dec(parts[1], &c) != nil {
		return fail("malformed claims")
	}
	if c.Iss != p.cfg.Issuer {
		return fail("wrong issuer")
	}
	var aud []string
	var one string
	if json.Unmarshal(c.Aud, &one) == nil {
		aud = []string{one}
	} else if json.Unmarshal(c.Aud, &aud) != nil {
		return fail("malformed audience")
	}
	okAud := false
	for _, a := range aud {
		okAud = okAud || a == p.cfg.ClientID
	}
	if !okAud {
		return fail("wrong audience")
	}
	now := p.now()
	exp := time.Unix(int64(c.Exp), 0)
	if c.Exp == 0 || now.After(exp.Add(leeway)) {
		return fail("expired")
	}
	if c.Nbf != 0 && now.Add(leeway).Before(time.Unix(int64(c.Nbf), 0)) {
		return fail("not yet valid")
	}
	if c.Sub == "" {
		return fail("missing sub")
	}
	return Claims{Sub: c.Sub, Email: c.Email, Name: c.Name, Nonce: c.Nonce, Scope: c.Scope, Expires: exp}, nil
}

// Issuer is the configured issuer URL (no trailing slash).
func (p *Provider) Issuer() string { return p.cfg.Issuer }
