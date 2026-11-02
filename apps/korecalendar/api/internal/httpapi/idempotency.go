package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"time"

	"github.com/qarasky/korecalendar/api/internal/auth"
)

const idempotencyTTL = 24 * time.Hour

// idempotent makes a POST handler safe to retry. With an Idempotency-Key
// header, the same key and body replays the first response; the same key with
// a different body is 409 idempotency_conflict. Keys are per user and kept for
// 24 hours. Server errors and requests still in flight do not complete a key.
func (s *server) idempotent(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Idempotency-Key")
		if key == "" {
			h(w, r)
			return
		}
		if len(key) > 200 {
			errJSON(w, http.StatusBadRequest, "validation_error", "Idempotency-Key is too long")
			return
		}
		p, _ := auth.FromContext(r.Context())
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
		if err != nil {
			errJSON(w, http.StatusBadRequest, "invalid_json", "request body could not be read")
			return
		}
		sum := sha256.Sum256(body)
		sha := hex.EncodeToString(sum[:])
		now := time.Now().Unix()
		s.db.ExecContext(r.Context(), `DELETE FROM idempotency_keys WHERE created_at<?`, now-int64(idempotencyTTL.Seconds()))
		res, err := s.db.ExecContext(r.Context(), `INSERT OR IGNORE INTO idempotency_keys(user_id,key,body_sha,created_at) VALUES(?,?,?,?)`, p.UserID, key, sha, now)
		if err != nil {
			errJSON(w, http.StatusInternalServerError, "internal", "idempotency check failed")
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			var prevSha, resp string
			var status int
			if err := s.db.QueryRowContext(r.Context(), `SELECT body_sha,status,response FROM idempotency_keys WHERE user_id=? AND key=?`, p.UserID, key).
				Scan(&prevSha, &status, &resp); err != nil {
				errJSON(w, http.StatusInternalServerError, "internal", "idempotency check failed")
				return
			}
			if prevSha != sha {
				errJSON(w, http.StatusConflict, "idempotency_conflict", "this Idempotency-Key was already used with a different request")
				return
			}
			if status == 0 {
				errJSON(w, http.StatusConflict, "idempotency_conflict", "a request with this Idempotency-Key is still in progress")
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Idempotent-Replayed", "true")
			w.WriteHeader(status)
			io.WriteString(w, resp)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		rec := httptest.NewRecorder()
		h(rec, r)
		out := rec.Result()
		respBody, _ := io.ReadAll(out.Body)
		if out.StatusCode >= 500 || out.StatusCode >= 400 {
			// A failed request does not consume the key, so a corrected retry works.
			s.db.ExecContext(r.Context(), `DELETE FROM idempotency_keys WHERE user_id=? AND key=?`, p.UserID, key)
		} else {
			s.db.ExecContext(r.Context(), `UPDATE idempotency_keys SET status=?, response=? WHERE user_id=? AND key=?`, out.StatusCode, string(respBody), p.UserID, key)
		}
		for k, v := range out.Header {
			w.Header()[k] = v
		}
		w.WriteHeader(out.StatusCode)
		w.Write(respBody)
	}
}
