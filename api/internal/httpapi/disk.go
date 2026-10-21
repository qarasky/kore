package httpapi

import (
	"log"
	"net/http"

	"github.com/artchsh/kore/api/internal/disk"
)

type diskJSON struct {
	TotalBytes uint64 `json:"total_bytes"`
	UsedBytes  uint64 `json:"used_bytes"`
	FreeBytes  uint64 `json:"free_bytes"`
	// KoreUsedBytes is the sum of every user's quota usage (usedSQL, as in
	// /api/admin/usage), not a walk of the blob directory.
	KoreUsedBytes       int64  `json:"kore_used_bytes"`
	QuotaAllocatedBytes int64  `json:"quota_allocated_bytes"`
	FSPathLabel         string `json:"fs_path_label"`
}

// adminDisk reports the filesystem holding the data directory (see
// disk.Usage for what used/free mean) next to Kore's own accounting.
func (s *server) adminDisk(w http.ResponseWriter, r *http.Request) {
	u, err := disk.Stat(s.dataDir)
	if err != nil {
		log.Printf("admin disk: statfs: %v", err)
		errJSON(w, 500, "internal")
		return
	}
	out := diskJSON{TotalBytes: u.Total, UsedBytes: u.Used, FreeBytes: u.Free, FSPathLabel: disk.Label(s.dataDir)}
	if err := s.db.QueryRowContext(r.Context(), `SELECT COALESCE(SUM(`+usedSQL+`),0), COALESCE(SUM(u.quota_bytes),0) FROM users u`).
		Scan(&out.KoreUsedBytes, &out.QuotaAllocatedBytes); err != nil {
		log.Printf("admin disk: usage: %v", err)
		errJSON(w, 500, "internal")
		return
	}
	writeJSON(w, 200, out)
}
