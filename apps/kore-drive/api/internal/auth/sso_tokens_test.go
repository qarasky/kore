package auth

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"
)

func rawTokens(t *testing.T, db *sql.DB, tok string) (idTok, refresh string) {
	t.Helper()
	if err := db.QueryRow(`SELECT id_token,refresh_token FROM sessions WHERE token_hash=?`, hashToken(tok)).Scan(&idTok, &refresh); err != nil {
		t.Fatal(err)
	}
	return
}

func TestSSOTokensAreNotStoredInClear(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	u := mkUser(t, db, "alice@example.com", "user")
	tok, err := NewSSOSession(ctx, db, u.ID, time.Hour, "id-token-AAAA", "refresh-token-BBBB", "sid1")
	if err != nil {
		t.Fatal(err)
	}
	id, rt := rawTokens(t, db, tok)
	if strings.Contains(id, "AAAA") || strings.Contains(rt, "BBBB") {
		t.Fatalf("tokens stored in clear: %q %q", id, rt)
	}
	ss, err := SSOSessionFor(ctx, db, tok)
	if err != nil || ss.IDToken != "id-token-AAAA" || ss.RefreshToken != "refresh-token-BBBB" {
		t.Fatalf("read back %+v, %v", ss, err)
	}

	if err := SetSSOTokens(ctx, db, tok, "", "refresh-token-CCCC", time.Now()); err != nil {
		t.Fatal(err)
	}
	id, rt = rawTokens(t, db, tok)
	if strings.Contains(rt, "CCCC") {
		t.Fatalf("rotated refresh token stored in clear: %q", rt)
	}
	ss, err = SSOSessionFor(ctx, db, tok)
	if err != nil || ss.IDToken != "id-token-AAAA" || ss.RefreshToken != "refresh-token-CCCC" {
		t.Fatalf("after rotation %+v, %v", ss, err)
	}
}

func TestSSOTokensOfAnotherSessionDoNotDecrypt(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	u := mkUser(t, db, "alice@example.com", "user")
	a, _ := NewSSOSession(ctx, db, u.ID, time.Hour, "id-a", "rt-a", "")
	b, _ := NewSSOSession(ctx, db, u.ID, time.Hour, "id-b", "rt-b", "")
	// Copying one session's ciphertext onto another row must not yield usable tokens.
	if _, err := db.Exec(`UPDATE sessions SET refresh_token=(SELECT refresh_token FROM sessions WHERE token_hash=?) WHERE token_hash=?`, hashToken(a), hashToken(b)); err != nil {
		t.Fatal(err)
	}
	if ss, err := SSOSessionFor(ctx, db, b); err == nil && ss.RefreshToken != "" {
		t.Fatalf("moved ciphertext decrypted to %q", ss.RefreshToken)
	}
}

func TestLegacyClearTokensStillRead(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	u := mkUser(t, db, "alice@example.com", "user")
	tok, _ := NewSSOSession(ctx, db, u.ID, time.Hour, "", "", "")
	if _, err := db.Exec(`UPDATE sessions SET id_token='old-id', refresh_token='old-rt' WHERE token_hash=?`, hashToken(tok)); err != nil {
		t.Fatal(err)
	}
	ss, err := SSOSessionFor(ctx, db, tok)
	if err != nil || ss.IDToken != "old-id" || ss.RefreshToken != "old-rt" {
		t.Fatalf("legacy row %+v, %v", ss, err)
	}
}
