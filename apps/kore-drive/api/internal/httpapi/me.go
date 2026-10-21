package httpapi

import (
	"net/http"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/quota"
)

func (s *server) registerMe(mux *http.ServeMux) {
	mux.Handle("GET /api/me/usage", auth.RequireUser(http.HandlerFunc(s.myUsage)))
}

// myUsage reports the caller's storage use (as counted by quota.Used: files
// they uploaded, trashed included, plus open uploads) against their quota.
func (s *server) myUsage(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	used, err := quota.Used(r.Context(), s.db, me.ID)
	if err != nil {
		errJSON(w, 500, "internal")
		return
	}
	writeJSON(w, 200, map[string]int64{"used_bytes": used, "quota_bytes": me.QuotaBytes})
}
