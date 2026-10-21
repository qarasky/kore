// Package settings stores instance-wide key/value settings.
package settings

import (
	"context"
	"database/sql"
	"strconv"
)

// Setting keys.
const (
	KeyTrashRetentionDays = "trash_retention_days"
	KeyMaxFileBytes       = "max_file_bytes"
	KeyDefaultQuotaBytes  = "default_quota_bytes"
)

// Defaults.
const (
	DefaultTrashRetentionDays       = 30
	DefaultMaxFileBytes       int64 = 0
	DefaultDefaultQuotaBytes  int64 = 50 << 30
)

// Get returns the stored value for key.
func Get(ctx context.Context, db *sql.DB, key string) (string, bool) {
	var v string
	if err := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key=?`, key).Scan(&v); err != nil {
		return "", false
	}
	return v, true
}

// Set stores value under key.
func Set(ctx context.Context, db *sql.DB, key, value string) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

func getInt(ctx context.Context, db *sql.DB, key string, def int64) int64 {
	v, ok := Get(ctx, db, key)
	if !ok {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n < 0 {
		return def
	}
	return n
}

// TrashRetentionDays is how long trashed items are kept (default 30).
func TrashRetentionDays(ctx context.Context, db *sql.DB) int {
	return int(getInt(ctx, db, KeyTrashRetentionDays, DefaultTrashRetentionDays))
}

// MaxFileBytes is the per-file size limit; 0 means unlimited.
func MaxFileBytes(ctx context.Context, db *sql.DB) int64 {
	return getInt(ctx, db, KeyMaxFileBytes, DefaultMaxFileBytes)
}

// DefaultQuotaBytes is the quota given to new users (default 50 GiB).
func DefaultQuotaBytes(ctx context.Context, db *sql.DB) int64 {
	return getInt(ctx, db, KeyDefaultQuotaBytes, DefaultDefaultQuotaBytes)
}
