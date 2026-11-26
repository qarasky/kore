package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

// Kore ID tokens kept with a session are sealed with a key derived from that
// session's own raw token. Only the browser holds the raw token (the database
// stores its SHA-256), so a copy of the database alone yields no usable
// refresh or id tokens, and no server-side key has to be kept anywhere.

const sealPrefix = "v1:"

var errUnseal = errors.New("stored Kore ID token does not decrypt for this session")

func sessionAEAD(tok string) (cipher.AEAD, error) {
	m := hmac.New(sha256.New, []byte(tok))
	m.Write([]byte("kore-drive/sso-tokens/v1"))
	block, err := aes.NewCipher(m.Sum(nil))
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// sealToken encrypts v for the session tok; the row's token hash is bound in
// as associated data. An empty value stays empty.
func sealToken(tok, v string) (string, error) {
	if v == "" {
		return "", nil
	}
	a, err := sessionAEAD(tok)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, a.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	out := a.Seal(nonce, nonce, []byte(v), []byte(hashToken(tok)))
	return sealPrefix + base64.RawStdEncoding.EncodeToString(out), nil
}

// openToken reverses sealToken. Values written before sealing existed (no
// prefix) are returned as they are; they get sealed on the next rotation.
func openToken(tok, stored string) (string, error) {
	if !strings.HasPrefix(stored, sealPrefix) {
		return stored, nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(stored[len(sealPrefix):])
	if err != nil {
		return "", errUnseal
	}
	a, err := sessionAEAD(tok)
	if err != nil {
		return "", err
	}
	if len(raw) < a.NonceSize() {
		return "", errUnseal
	}
	v, err := a.Open(nil, raw[:a.NonceSize()], raw[a.NonceSize():], []byte(hashToken(tok)))
	if err != nil {
		return "", errUnseal
	}
	return string(v), nil
}
