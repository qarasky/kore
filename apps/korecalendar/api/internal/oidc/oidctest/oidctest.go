// Package oidctest is a fake Kore ID for tests: discovery, JWKS, an /authorize
// that signs the "browser" in as User at once, and /token. Not for production.
package oidctest

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Server is a running fake provider.
type Server struct {
	*httptest.Server
	ClientID string
	Secret   string
	Kid      string

	mu    sync.Mutex
	priv  ed25519.PrivateKey
	codes map[string]code
	// User is who the next authorize request signs in. Set Sub, Email, etc.
	User map[string]any
	// Sid is the Kore ID session id put in the tokens the next sign-in gets
	// (empty: no sid claim).
	Sid string
	// JWKSHits counts fetches of the key set.
	JWKSHits int
}

type code struct {
	nonce, challenge, redirect string
}

// New starts the provider for client id/secret.
func New(t *testing.T, clientID, secret string) *Server {
	t.Helper()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	s := &Server{ClientID: clientID, Secret: secret, Kid: "key-1", priv: priv, codes: map[string]code{},
		User: map[string]any{"sub": "11111111-1111-4111-8111-111111111111", "email": "ada@example.com", "email_verified": true, "name": "Ada"}, Sid: "sid-1"}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"issuer": s.URL, "authorization_endpoint": s.URL + "/authorize", "token_endpoint": s.URL + "/token",
			"jwks_uri": s.URL + "/.well-known/jwks.json", "end_session_endpoint": s.URL + "/logout"})
	})
	mux.HandleFunc("/.well-known/jwks.json", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.JWKSHits++
		kid := s.Kid
		s.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "OKP", "crv": "Ed25519", "use": "sig", "alg": "EdDSA", "kid": kid,
			"x": base64.RawURLEncoding.EncodeToString(s.public())}}})
	})
	mux.HandleFunc("/authorize", s.authorize)
	mux.HandleFunc("/token", s.token)
	s.Server = httptest.NewServer(mux)
	t.Cleanup(s.Close)
	return s
}

func (s *Server) public() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.priv.Public().(ed25519.PublicKey)
}

// Rotate replaces the signing key (new kid); old tokens stop verifying.
func (s *Server) Rotate() {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	s.mu.Lock()
	s.priv, s.Kid = priv, s.Kid+"x"
	s.mu.Unlock()
}

// Mint signs a token with the given claims (header typ "JWT"); iss, iat and
// exp default sensibly. A nil claim value removes the claim.
func (s *Server) Mint(claims map[string]any) string {
	return s.MintWith(claims, "EdDSA", "")
}

// MintWith is Mint with an explicit alg ("EdDSA" or "HS256") and kid override.
func (s *Server) MintWith(claims map[string]any, alg, kid string) string {
	return s.MintTyp(claims, alg, kid, "JWT")
}

// MintTyp is MintWith with an explicit header typ ("" leaves it out).
func (s *Server) MintTyp(claims map[string]any, alg, kid, typ string) string {
	c := jwt.MapClaims{"iss": s.URL, "iat": time.Now().Unix(), "exp": time.Now().Add(10 * time.Minute).Unix()}
	for k, v := range claims {
		if v == nil {
			delete(c, k)
			continue
		}
		c[k] = v
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if kid == "" {
		kid = s.Kid
	}
	var tok *jwt.Token
	var key any
	if alg == "HS256" {
		tok, key = jwt.NewWithClaims(jwt.SigningMethodHS256, c), []byte(s.priv.Public().(ed25519.PublicKey))
	} else {
		tok, key = jwt.NewWithClaims(jwt.SigningMethodEdDSA, c), s.priv
	}
	tok.Header["kid"] = kid
	if typ == "" {
		delete(tok.Header, "typ")
	} else {
		tok.Header["typ"] = typ
	}
	out, err := tok.SignedString(key)
	if err != nil {
		panic(err)
	}
	return out
}

// IDToken is an id token for User as the client would receive it (Kore ID:
// typ JWT, azp, sid, no scope).
func (s *Server) IDToken(nonce string) string {
	c := map[string]any{"aud": s.ClientID, "azp": s.ClientID, "auth_time": time.Now().Unix()}
	for k, v := range s.User {
		c[k] = v
	}
	if s.Sid != "" {
		c["sid"] = s.Sid
	}
	if nonce != "" {
		c["nonce"] = nonce
	}
	return s.Mint(c)
}

// AccessToken is a Kore ID access token for User and client aud (RFC 9068:
// header typ at+jwt, client_id, scope, jti, sid).
func (s *Server) AccessToken(aud string) string {
	c := map[string]any{"aud": aud, "client_id": aud, "scope": "openid profile email", "jti": randomID()}
	for _, k := range []string{"sub", "email", "email_verified"} {
		if v, ok := s.User[k]; ok {
			c[k] = v
		}
	}
	if s.Sid != "" {
		c["sid"] = s.Sid
	}
	return s.MintTyp(c, "EdDSA", "", "at+jwt")
}

// LogoutToken is a back-channel logout token for this client (typ logout+jwt,
// exp +2 min, fresh jti, the back-channel event) for sid and sub; empty values
// are left out. extra overrides or (nil) removes claims.
func (s *Server) LogoutToken(sid, sub string, extra map[string]any) string {
	c := map[string]any{"aud": s.ClientID, "jti": randomID(), "exp": time.Now().Add(2 * time.Minute).Unix(),
		"events": map[string]any{"http://schemas.openid.net/event/backchannel-logout": map[string]any{}}}
	if sid != "" {
		c["sid"] = sid
	}
	if sub != "" {
		c["sub"] = sub
	}
	typ := "logout+jwt"
	for k, v := range extra {
		if k == "typ" { // header, not a claim
			typ, _ = v.(string)
			continue
		}
		c[k] = v
	}
	return s.MintTyp(c, "EdDSA", "", typ)
}

func randomID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("client_id") != s.ClientID || q.Get("response_type") != "code" || q.Get("code_challenge_method") != "S256" ||
		q.Get("code_challenge") == "" || q.Get("state") == "" || q.Get("nonce") == "" {
		http.Error(w, "bad authorize request", http.StatusBadRequest)
		return
	}
	b := make([]byte, 12)
	rand.Read(b)
	c := base64.RawURLEncoding.EncodeToString(b)
	s.mu.Lock()
	s.codes[c] = code{nonce: q.Get("nonce"), challenge: q.Get("code_challenge"), redirect: q.Get("redirect_uri")}
	s.mu.Unlock()
	u, _ := url.Parse(q.Get("redirect_uri"))
	v := u.Query()
	v.Set("code", c)
	v.Set("state", q.Get("state"))
	v.Set("iss", s.URL)
	u.RawQuery = v.Encode()
	http.Redirect(w, r, u.String(), http.StatusFound)
}

func (s *Server) token(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fail := func(status int, e string) {
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"error": e})
	}
	r.ParseForm()
	id, sec, ok := r.BasicAuth()
	if s.Secret != "" && (!ok || id != s.ClientID || sec != s.Secret) {
		fail(401, "invalid_client")
		return
	}
	s.mu.Lock()
	c, found := s.codes[r.Form.Get("code")]
	delete(s.codes, r.Form.Get("code"))
	s.mu.Unlock()
	sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
	if !found || c.redirect != r.Form.Get("redirect_uri") || base64.RawURLEncoding.EncodeToString(sum[:]) != c.challenge {
		fail(400, "invalid_grant")
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"token_type": "Bearer", "id_token": s.IDToken(c.nonce), "access_token": s.AccessToken(s.ClientID), "expires_in": 600})
}
