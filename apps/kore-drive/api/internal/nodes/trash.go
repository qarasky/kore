package nodes

import (
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/artchsh/kore/api/internal/users"
	"github.com/artchsh/kore/api/internal/volume"
)

// Trash model: Trash sets trashed_at on the node itself and trash_root=<id>
// on every live descendant (descendants keep trashed_at NULL). Only trash
// roots (trashed_at set, trash_root NULL) are listed, restored and purged.
// A descendant that was already trashed on its own is its own root and is
// left untouched. Quota keeps counting trashed files until they are purged.

// TrashedNode is a trash root with its trashing time.
type TrashedNode struct {
	Node
	TrashedAt int64
}

const rootSQL = `trashed_at IS NOT NULL AND trash_root IS NULL`

// Trash moves a live node (and its subtree) to the trash.
func Trash(ctx context.Context, db *sql.DB, actor users.User, id string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := get(ctx, tx, actor, id); err != nil {
		return err
	}
	now := time.Now().Unix()
	if _, err := tx.ExecContext(ctx, `UPDATE nodes SET trashed_at=?,updated_at=? WHERE id=?`, now, now, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `WITH RECURSIVE d(id) AS (
		SELECT id FROM nodes WHERE parent_id=?1 AND trashed_at IS NULL
		UNION ALL SELECT n.id FROM nodes n JOIN d ON n.parent_id=d.id WHERE n.trashed_at IS NULL)
		UPDATE nodes SET trash_root=?1 WHERE id IN (SELECT id FROM d)`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// getRoot returns a trash root the actor may access, else ErrNotFound.
func getRoot(ctx context.Context, q queryer, actor users.User, id string) (Node, error) {
	n, err := scan(q.QueryRowContext(ctx, `SELECT `+cols+` FROM nodes WHERE id=? AND `+rootSQL, id))
	if errors.Is(err, sql.ErrNoRows) {
		return n, ErrNotFound
	}
	if err != nil {
		return n, err
	}
	if !Can(actor, n) {
		return n, ErrNotFound
	}
	return n, nil
}

// ListTrash returns the trash roots of sp, newest first.
func ListTrash(ctx context.Context, db *sql.DB, actor users.User, sp Space) ([]TrashedNode, error) {
	if !CanSpace(actor, sp) {
		return nil, ErrNotFound
	}
	rows, err := db.QueryContext(ctx, `SELECT `+prefixed("n", cols)+emailCol+`,n.trashed_at FROM nodes n`+emailJoin+`
		WHERE COALESCE(n.space_owner,'')=COALESCE(?,'') AND `+prefixedWhere("n", rootSQL)+` ORDER BY n.trashed_at DESC, n.id`, sp.Owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TrashedNode{}
	for rows.Next() {
		var ta int64
		n, err := scanEmail(rows, &ta)
		if err != nil {
			return nil, err
		}
		out = append(out, TrashedNode{n, ta})
	}
	return out, rows.Err()
}

// Restore returns a trash root to its original parent, or to the space root
// if that parent is gone or itself trashed. A name collision picks a unique
// name. No quota check is involved (the bytes were never released).
func Restore(ctx context.Context, db *sql.DB, actor users.User, id string) (Node, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Node{}, err
	}
	defer tx.Rollback()
	n, err := getRoot(ctx, tx, actor, id)
	if err != nil {
		return Node{}, err
	}
	parent := n.ParentID
	if parent != nil {
		var isDir int
		err := tx.QueryRowContext(ctx, `SELECT is_dir FROM nodes WHERE id=? AND `+liveSQL, *parent).Scan(&isDir)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && isDir == 0) {
			parent = nil
		} else if err != nil {
			return Node{}, err
		}
	}
	name, err := UniqueName(ctx, tx, SpaceOf(n), parent, n.Name)
	if err != nil {
		return Node{}, err
	}
	now := time.Now().Unix()
	if _, err := tx.ExecContext(ctx, `UPDATE nodes SET trashed_at=NULL,parent_id=?,name=?,updated_at=? WHERE id=?`,
		parent, name, now, id); err != nil {
		if isUnique(err) {
			return Node{}, ErrNameTaken
		}
		return Node{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE nodes SET trash_root=NULL WHERE trash_root=?`, id); err != nil {
		return Node{}, err
	}
	if err := tx.Commit(); err != nil {
		return Node{}, err
	}
	n.ParentID, n.Name, n.UpdatedAt = parent, name, now
	return n, nil
}

// purgeWhere deletes rows (and, after commit, blobs) for every node matching
// rootCond (a condition on trash roots, with args) plus their subtrees.
func purgeWhere(ctx context.Context, db *sql.DB, dataDir string, check func(q queryer) error, rootCond string, args ...any) (int, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if check != nil {
		if err := check(tx); err != nil {
			return 0, err
		}
	}
	var roots int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM nodes WHERE `+rootSQL+` AND `+rootCond, args...).Scan(&roots); err != nil {
		return 0, err
	}
	if roots == 0 {
		return 0, nil
	}
	sel := `(SELECT id FROM nodes WHERE ` + rootSQL + ` AND ` + rootCond + `)`
	blobs, err := blobIDs(ctx, tx, `id IN `+sel+` OR trash_root IN `+sel, append(args, args...)...)
	if err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM nodes WHERE id IN `+sel+` OR trash_root IN `+sel, append(args, args...)...); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	RemoveBlobs(dataDir, blobs)
	return roots, nil
}

// blobIDs returns the blob ids of the nodes matching cond.
func blobIDs(ctx context.Context, tx *sql.Tx, cond string, args ...any) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT blob_id FROM nodes WHERE blob_id IS NOT NULL AND (`+cond+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var blobs []string
	for rows.Next() {
		var b string
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		blobs = append(blobs, b)
	}
	return blobs, rows.Err()
}

// RemoveBlobs deletes blob files. Call it only after the transaction that
// deleted the referencing rows has committed: files go only once the rows are
// durably gone, and a crash in between leaves orphan blobs that
// SweepOrphanBlobs reclaims.
func RemoveBlobs(dataDir string, blobs []string) {
	for _, b := range blobs {
		if p, err := volume.BlobPath(dataDir, b); err == nil {
			os.Remove(p)
		}
	}
}

// PurgeSpaceTx deletes every node of owner's personal space, live and
// trashed, inside tx, and returns the blob ids to pass to RemoveBlobs after
// the transaction commits. There is no access check: the caller (an admin
// deleting the account) has already authorized it.
func PurgeSpaceTx(ctx context.Context, tx *sql.Tx, owner string) ([]string, error) {
	blobs, err := blobIDs(ctx, tx, `space_owner=?`, owner)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM nodes WHERE space_owner=?`, owner); err != nil {
		return nil, err
	}
	return blobs, nil
}

// PurgeNode permanently deletes a trash root, its subtree and their blobs.
func PurgeNode(ctx context.Context, db *sql.DB, dataDir string, actor users.User, id string) error {
	n, err := purgeWhere(ctx, db, dataDir, func(q queryer) error {
		_, err := getRoot(ctx, q, actor, id)
		return err
	}, `id=?`, id)
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}

// EmptyTrash permanently deletes everything in the trash of sp.
func EmptyTrash(ctx context.Context, db *sql.DB, dataDir string, actor users.User, sp Space) error {
	if !CanSpace(actor, sp) {
		return ErrNotFound
	}
	_, err := purgeWhere(ctx, db, dataDir, nil, `COALESCE(space_owner,'')=COALESCE(?,'')`, sp.Owner)
	return err
}

// PurgeExpired permanently deletes trash roots trashed more than
// retentionDays ago and returns how many roots were purged. A retention
// below one day is treated as "keep forever" (a no-op).
func PurgeExpired(ctx context.Context, db *sql.DB, dataDir string, retentionDays int) (int, error) {
	if retentionDays < 1 {
		return 0, nil
	}
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour).Unix()
	return purgeWhere(ctx, db, dataDir, nil, `trashed_at < ?`, cutoff)
}

const orphanGrace = time.Hour

// SweepOrphanBlobs removes blob files that no node references and that are
// older than an hour (crash leftovers from purge). tmp/uploads is never
// touched; blobs of in-flight upload completions are skipped.
func SweepOrphanBlobs(ctx context.Context, db *sql.DB, dataDir string) (int, error) {
	root := filepath.Join(dataDir, "blobs")
	removed := 0
	cutoff := time.Now().Add(-orphanGrace)
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		if d.IsDir() {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		id := d.Name()
		if p, perr := volume.BlobPath(dataDir, id); perr != nil || p != path {
			return nil // not a blob we own
		}
		info, err := d.Info()
		if err != nil || info.ModTime().After(cutoff) {
			return nil
		}
		// Check uploads first, then nodes: Complete deletes the upload row
		// and inserts the node in one tx, so this order cannot miss it.
		var x int
		err = db.QueryRowContext(ctx, `SELECT 1 FROM uploads WHERE id=?`, id).Scan(&x)
		if err == nil {
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		err = db.QueryRowContext(ctx, `SELECT 1 FROM nodes WHERE blob_id=?`, id).Scan(&x)
		if err == nil {
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if os.Remove(path) == nil {
			removed++
		}
		return nil
	})
	return removed, err
}
