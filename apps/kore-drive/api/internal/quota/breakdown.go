package quota

import (
	"context"
	"database/sql"
	"sort"
)

// CategoryUsage is the bytes and file count of one storage category.
type CategoryUsage struct {
	Key   string `json:"key"`
	Bytes int64  `json:"bytes"`
	Count int64  `json:"count"`
}

// LargeFile is one of a user's largest live files.
type LargeFile struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Size     int64   `json:"size"`
	Space    string  `json:"space"` // "personal" or "shared"
	ParentID *string `json:"parent_id"`
}

// Breakdown is a user's storage use split up for display.
type Breakdown struct {
	UsedBytes      int64           `json:"used_bytes"`
	QuotaBytes     int64           `json:"quota_bytes"`
	UploadingBytes int64           `json:"uploading_bytes"`
	TrashBytes     int64           `json:"trash_bytes"`
	Categories     []CategoryUsage `json:"categories"`
	Largest        []LargeFile     `json:"largest"`
}

// LargestCount is how many files Breakdown.Largest lists.
const LargestCount = 10

// GetBreakdown splits userID's usage exactly as Used counts it (files they
// uploaded, in any space, trashed included, plus open uploads): categories
// sum to UsedBytes - UploadingBytes. Files are grouped by extension in SQL
// (one grouped query) and the few groups mapped to categories here.
// TrashBytes is the part in the trash; Largest lists their biggest live
// files they can still open (own personal space or shared). The queries
// are separate statements, so a concurrent change can make them disagree
// by that change; nothing here is used for enforcement.
func GetBreakdown(ctx context.Context, db *sql.DB, userID string) (Breakdown, error) {
	b := Breakdown{Categories: []CategoryUsage{}, Largest: []LargeFile{}}
	var files int64
	if err := db.QueryRowContext(ctx, `SELECT
		(SELECT quota_bytes FROM users WHERE id=?1),
		COALESCE((SELECT SUM(size) FROM nodes WHERE uploader=?1 AND is_dir=0),0),
		COALESCE((SELECT SUM(size) FROM uploads WHERE user_id=?1),0),
		COALESCE((SELECT SUM(size) FROM nodes WHERE uploader=?1 AND is_dir=0
			AND (trashed_at IS NOT NULL OR trash_root IS NOT NULL)),0)`, userID).
		Scan(&b.QuotaBytes, &files, &b.UploadingBytes, &b.TrashBytes); err != nil {
		return b, err
	}
	b.UsedBytes = files + b.UploadingBytes

	byCat := map[string]*CategoryUsage{}
	rows, err := db.QueryContext(ctx, `SELECT `+extSQL("name")+` AS ext, SUM(size), COUNT(*)
		FROM nodes WHERE uploader=? AND is_dir=0 GROUP BY ext`, userID)
	if err != nil {
		return b, err
	}
	for rows.Next() {
		var ext string
		var bytes, count int64
		if err := rows.Scan(&ext, &bytes, &count); err != nil {
			rows.Close()
			return b, err
		}
		key := CategoryOfExt(ext)
		c := byCat[key]
		if c == nil {
			c = &CategoryUsage{Key: key}
			byCat[key] = c
		}
		c.Bytes += bytes
		c.Count += count
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return b, err
	}
	for _, c := range byCat {
		b.Categories = append(b.Categories, *c)
	}
	sort.Slice(b.Categories, func(i, j int) bool {
		x, y := b.Categories[i], b.Categories[j]
		if x.Bytes != y.Bytes {
			return x.Bytes > y.Bytes
		}
		return x.Key < y.Key
	})

	rows, err = db.QueryContext(ctx, `SELECT id,name,size,space_owner IS NULL,parent_id FROM nodes
		WHERE uploader=?1 AND is_dir=0 AND (space_owner IS NULL OR space_owner=?1)
		AND trashed_at IS NULL AND trash_root IS NULL
		ORDER BY size DESC, id LIMIT ?2`, userID, LargestCount)
	if err != nil {
		return b, err
	}
	defer rows.Close()
	for rows.Next() {
		var f LargeFile
		var shared bool
		var parent sql.NullString
		if err := rows.Scan(&f.ID, &f.Name, &f.Size, &shared, &parent); err != nil {
			return b, err
		}
		f.Space = "personal"
		if shared {
			f.Space = "shared"
		}
		if parent.Valid {
			f.ParentID = &parent.String
		}
		b.Largest = append(b.Largest, f)
	}
	return b, rows.Err()
}
