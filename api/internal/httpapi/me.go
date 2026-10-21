package httpapi

import (
	"net/http"

	"github.com/artchsh/kore/api/internal/auth"
	"github.com/artchsh/kore/api/internal/quota"
	"github.com/artchsh/kore/api/internal/settings"
)

func (s *server) registerMe(mux *http.ServeMux) {
	mux.Handle("GET /api/me/usage", auth.RequireUser(http.HandlerFunc(s.myUsage)))
	mux.Handle("GET /api/me/settings", auth.RequireUser(http.HandlerFunc(s.mySettings)))
}

// mySettings exposes the instance settings every user may see (the trash
// retention shown on the trash page); the full set stays admin-only.
func (s *server) mySettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]int{"trash_retention_days": settings.TrashRetentionDays(r.Context(), s.db)})
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
