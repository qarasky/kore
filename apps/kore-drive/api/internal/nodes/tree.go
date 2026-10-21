package nodes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/artchsh/kore/api/internal/quota"
	"github.com/artchsh/kore/api/internal/users"
	"golang.org/x/text/unicode/norm"
)

var (
	// ErrNotFound is returned for missing, trashed or inaccessible nodes
	// (inaccessible deliberately looks identical to missing).
	ErrNotFound      = errors.New("node not found")
	ErrNameTaken     = errors.New("name taken")
	ErrInvalidName   = errors.New("invalid name")
	ErrInvalidMove   = errors.New("cannot move a folder into itself or its descendant")
	ErrNotDir        = errors.New("parent is not a folder")
	ErrSpaceMismatch = errors.New("space contradicts parent")
)

const maxNameBytes = 255

// ValidateName reports whether name (after NFC normalization) is acceptable.
func ValidateName(name string) error {
	_, err := normalizeName(name)
	return err
}

// NormalizeName returns the NFC-normalized name, or ErrInvalidName.
func NormalizeName(name string) (string, error) { return normalizeName(name) }

// normalizeName NFC-normalizes name and validates it.
func normalizeName(name string) (string, error) {
	name = norm.NFC.String(name)
	switch {
	case strings.TrimSpace(name) == "",
		len(name) > maxNameBytes,
		strings.ContainsAny(name, "/\x00"),
		name == ".", name == "..",
		!utf8.ValidString(name):
		return "", ErrInvalidName
	}
	return name, nil
}

// liveSQL selects live nodes. Descendants of a trashed folder keep
// trashed_at NULL but carry trash_root, so both must be NULL.
const liveSQL = `trashed_at IS NULL AND trash_root IS NULL`

const cols = `id,space_owner,uploader,parent_id,name,is_dir,size,blob_id,mime,created_at,updated_at`

// Queryer is satisfied by *sql.DB and *sql.Tx. Inside a transaction always
// pass the *sql.Tx (never the pool) to avoid self-deadlocking on the write lock.
type Queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type queryer = Queryer

type scanner interface{ Scan(...any) error }

func scan(r scanner) (Node, error) {
	var n Node
	var owner, parent, blob sql.NullString
	var dir int
	err := r.Scan(&n.ID, &owner, &n.Uploader, &parent, &n.Name, &dir, &n.Size, &blob, &n.Mime, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return n, err
	}
	n.IsDir = dir != 0
	if owner.Valid {
		n.SpaceOwner = &owner.String
	}
	if parent.Valid {
		n.ParentID = &parent.String
	}
	if blob.Valid {
		n.BlobID = &blob.String
	}
	return n, nil
}

// get returns a live node the actor may access, else ErrNotFound.
func get(ctx context.Context, q queryer, actor users.User, id string) (Node, error) {
	n, err := scan(q.QueryRowContext(ctx, `SELECT `+cols+` FROM nodes WHERE id=? AND `+liveSQL, id))
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

// checkParent verifies that parent (if any) is a live folder in sp.
func checkParent(ctx context.Context, q queryer, actor users.User, sp Space, parent *string) error {
	if !CanSpace(actor, sp) {
		return ErrNotFound
	}
	if parent == nil {
		return nil
	}
	p, err := get(ctx, q, actor, *parent)
	if err != nil {
		return err
	}
	if !sameSpace(SpaceOf(p), sp) {
		return ErrNotFound
	}
	if !p.IsDir {
		return ErrNotDir
	}
	return nil
}

// CheckParent verifies that actor may access sp and that parent (nil = space
// root) is a live folder in sp. Inaccessible spaces/parents are ErrNotFound;
// a non-folder parent is ErrNotDir.
func CheckParent(ctx context.Context, q Queryer, actor users.User, sp Space, parent *string) error {
	return checkParent(ctx, q, actor, sp, parent)
}

func sameSpace(a, b Space) bool {
	if a.Owner == nil || b.Owner == nil {
		return a.Owner == nil && b.Owner == nil
	}
	return *a.Owner == *b.Owner
}

func isUnique(err error) bool { return err != nil && strings.Contains(err.Error(), "UNIQUE") }

// createFolderHook, if set (tests only), runs between the parent check and
// the INSERT.
var createFolderHook func()

// CreateFolder creates a folder; a live name collision yields ErrNameTaken.
// The parent check and the INSERT share one transaction, so a concurrent
// Trash of the parent either sees the new child or makes the check fail.
func CreateFolder(ctx context.Context, db *sql.DB, actor users.User, sp Space, parentID *string, name string) (Node, error) {
	name, err := normalizeName(name)
	if err != nil {
		return Node{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Node{}, err
	}
	defer tx.Rollback()
	if err := checkParent(ctx, tx, actor, sp, parentID); err != nil {
		return Node{}, err
	}
	if createFolderHook != nil {
		createFolderHook()
	}
	now := time.Now().Unix()
	n := Node{ID: users.NewID(), SpaceOwner: sp.Owner, Uploader: actor.ID, ParentID: parentID,
		Name: name, IsDir: true, CreatedAt: now, UpdatedAt: now}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO nodes(id,space_owner,uploader,parent_id,name,is_dir,size,mime,created_at,updated_at) VALUES(?,?,?,?,?,1,0,'',?,?)`,
		n.ID, n.SpaceOwner, n.Uploader, n.ParentID, n.Name, now, now)
	if isUnique(err) {
		return Node{}, ErrNameTaken
	}
	if err != nil {
		return Node{}, err
	}
	if err := tx.Commit(); err != nil {
		return Node{}, err
	}
	return n, nil
}

// listSQL selects the live children of a space/parent (args: owner, parent;
// NULL = shared space / root). A folder's size is the total size of the live
// files below it: one recursive descent from all listed folders at once,
// walking nodes_parent and grouped by the listed folder it started from.
// Trashed nodes and everything under them are skipped (a trashed subtree is
// never descended into), and rows of another space are never counted.
var listSQL = `WITH RECURSIVE kids AS (
		SELECT ` + cols + ` FROM nodes
		WHERE space_owner IS ?1 AND parent_id IS ?2 AND ` + liveSQL + `),
	d(root,id,owner,is_dir,size) AS (
		SELECT id,id,space_owner,1,0 FROM kids WHERE is_dir=1
		UNION ALL
		SELECT d.root,n.id,n.space_owner,n.is_dir,n.size FROM nodes n JOIN d ON n.parent_id=d.id
		WHERE d.is_dir=1 AND n.space_owner IS d.owner AND n.trashed_at IS NULL AND n.trash_root IS NULL),
	totals(root,total) AS (SELECT root,SUM(size) FROM d WHERE is_dir=0 GROUP BY root)
	SELECT ` + strings.Replace(prefixed("k", cols), "k.size", "CASE WHEN k.is_dir=1 THEN COALESCE(t.total,0) ELSE k.size END", 1) + `
	FROM kids k LEFT JOIN totals t ON t.root=k.id`

// List returns the live children of parentID (nil = space root): folders
// first, then by natural, case-insensitive name order. A folder's Size is the
// total size of the live files anywhere below it.
func List(ctx context.Context, db *sql.DB, actor users.User, sp Space, parentID *string) ([]Node, error) {
	if err := checkParent(ctx, db, actor, sp, parentID); err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, listSQL, sp.Owner, parentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Node{}
	for rows.Next() {
		n, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.IsDir != b.IsDir {
			return a.IsDir
		}
		if c := naturalCompare(a.Name, b.Name); c != 0 {
			return c < 0
		}
		return a.Name < b.Name
	})
	return out, nil
}

// naturalCompare compares case-insensitively, treating digit runs as numbers.
func naturalCompare(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	i, j := 0, 0
	for i < len(ra) && j < len(rb) {
		if unicode.IsDigit(ra[i]) && unicode.IsDigit(rb[j]) {
			si := i
			for i < len(ra) && unicode.IsDigit(ra[i]) {
				i++
			}
			sj := j
			for j < len(rb) && unicode.IsDigit(rb[j]) {
				j++
			}
			da := strings.TrimLeft(string(ra[si:i]), "0")
			db := strings.TrimLeft(string(rb[sj:j]), "0")
			if len(da) != len(db) {
				if len(da) < len(db) {
					return -1
				}
				return 1
			}
			if c := strings.Compare(da, db); c != 0 {
				return c
			}
			continue
		}
		x, y := foldRune(ra[i]), foldRune(rb[j])
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
		i++
		j++
	}
	switch {
	case len(ra)-i < len(rb)-j:
		return -1
	case len(ra)-i > len(rb)-j:
		return 1
	}
	return 0
}

func foldRune(r rune) rune { return unicode.ToLower(unicode.ToUpper(r)) }

// MoveTarget describes a move. ParentSet reports whether a parent (possibly
// nil = root) was explicitly requested; Space optionally names the
// destination space.
type MoveTarget struct {
	Parent    *string
	ParentSet bool
	Space     *Space
}

// Update applies an optional rename and an optional move atomically: on any
// error the node is left untouched.
func Update(ctx context.Context, db *sql.DB, actor users.User, id string, name *string, move *MoveTarget) (Node, error) {
	var newName string
	if name != nil {
		var err error
		if newName, err = normalizeName(*name); err != nil {
			return Node{}, err
		}
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Node{}, err
	}
	defer tx.Rollback()
	n, err := get(ctx, tx, actor, id)
	if err != nil {
		return Node{}, err
	}
	if name != nil {
		now := time.Now().Unix()
		_, err := tx.ExecContext(ctx, `UPDATE nodes SET name=?,updated_at=? WHERE id=?`, newName, now, id)
		if isUnique(err) {
			return Node{}, ErrNameTaken
		}
		if err != nil {
			return Node{}, err
		}
		n.Name, n.UpdatedAt = newName, now
	}
	if move != nil {
		if n, err = moveTx(ctx, tx, actor, n, *move); err != nil {
			return Node{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Node{}, err
	}
	return n, nil
}

// Rename changes a node's name; a collision yields ErrNameTaken.
func Rename(ctx context.Context, db *sql.DB, actor users.User, id, newName string) (Node, error) {
	return Update(ctx, db, actor, id, &newName, nil)
}

// Move re-parents a node. A nil newParent means the root of the node's
// current space; otherwise the node joins the parent's space. Cross-space
// moves are possible only between the actor's personal space and the shared
// space (inaccessible spaces are ErrNotFound).
func Move(ctx context.Context, db *sql.DB, actor users.User, id string, newParent *string) (Node, error) {
	return MoveTo(ctx, db, actor, id, nil, newParent)
}

// MoveTo is Move with an explicit destination space for root moves. A nil sp
// derives the space from newParent (or the node's current space at root).
func MoveTo(ctx context.Context, db *sql.DB, actor users.User, id string, sp *Space, newParent *string) (Node, error) {
	return Update(ctx, db, actor, id, nil, &MoveTarget{Parent: newParent, ParentSet: true, Space: sp})
}

func moveTx(ctx context.Context, tx *sql.Tx, actor users.User, n Node, mv MoveTarget) (Node, error) {
	id, newParent := n.ID, mv.Parent
	dest := SpaceOf(n)
	switch {
	case newParent != nil:
		p, err := get(ctx, tx, actor, *newParent)
		if err != nil {
			return Node{}, err
		}
		dest = SpaceOf(p)
		if mv.Space != nil && !sameSpace(*mv.Space, dest) {
			return Node{}, ErrSpaceMismatch
		}
	case mv.Space != nil:
		if !mv.ParentSet && sameSpace(*mv.Space, dest) {
			return n, nil // space alone, unchanged: not a move
		}
		dest = *mv.Space
	}
	if err := checkParent(ctx, tx, actor, dest, newParent); err != nil {
		return Node{}, err
	}
	if newParent != nil {
		var hit int
		err := tx.QueryRowContext(ctx, `WITH RECURSIVE d(id) AS (
			SELECT id FROM nodes WHERE id=?
			UNION ALL SELECT n.id FROM nodes n JOIN d ON n.parent_id=d.id)
			SELECT 1 FROM d WHERE id=?`, id, *newParent).Scan(&hit)
		if err == nil {
			return Node{}, ErrInvalidMove
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return Node{}, err
		}
	}
	crossSpace := !sameSpace(SpaceOf(n), dest)
	if crossSpace && dest.Owner != nil {
		// Moving into a personal space hands the whole subtree to its owner:
		// charge them for the bytes they were not already paying for.
		var foreign int64
		if err := tx.QueryRowContext(ctx, `WITH RECURSIVE d(id) AS (
			SELECT id FROM nodes WHERE id=?
			UNION ALL SELECT n.id FROM nodes n JOIN d ON n.parent_id=d.id)
			SELECT COALESCE(SUM(size),0) FROM nodes
			WHERE id IN (SELECT id FROM d) AND is_dir=0 AND uploader<>?`, id, *dest.Owner).Scan(&foreign); err != nil {
			return Node{}, err
		}
		if foreign > 0 {
			if err := quota.Reserve(ctx, tx, *dest.Owner, foreign); err != nil {
				return Node{}, err
			}
		}
	}
	now := time.Now().Unix()
	_, err := tx.ExecContext(ctx, `UPDATE nodes SET parent_id=?,space_owner=?,updated_at=? WHERE id=?`,
		newParent, dest.Owner, now, id)
	if isUnique(err) {
		return Node{}, ErrNameTaken
	}
	if err != nil {
		return Node{}, err
	}
	if crossSpace {
		if _, err := tx.ExecContext(ctx, `WITH RECURSIVE d(id) AS (
			SELECT id FROM nodes WHERE parent_id=?
			UNION ALL SELECT n.id FROM nodes n JOIN d ON n.parent_id=d.id)
			UPDATE nodes SET space_owner=? WHERE id IN (SELECT id FROM d)`, id, dest.Owner); err != nil {
			return Node{}, err
		}
		if dest.Owner != nil {
			// Re-attribute every node of the subtree (folders too, so no
			// stale uploader is left in another user's personal space).
			if _, err := tx.ExecContext(ctx, `WITH RECURSIVE d(id) AS (
				SELECT id FROM nodes WHERE id=?
				UNION ALL SELECT n.id FROM nodes n JOIN d ON n.parent_id=d.id)
				UPDATE nodes SET uploader=? WHERE id IN (SELECT id FROM d)`, id, *dest.Owner); err != nil {
				return Node{}, err
			}
			n.Uploader = *dest.Owner
		}
	}
	n.ParentID, n.SpaceOwner, n.UpdatedAt = newParent, dest.Owner, now
	return n, nil
}

// Path returns the breadcrumb chain from the space root down to the node.
func Path(ctx context.Context, db *sql.DB, actor users.User, id string) ([]Node, error) {
	if _, err := get(ctx, db, actor, id); err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `WITH RECURSIVE a(id,parent_id,depth) AS (
		SELECT id,parent_id,0 FROM nodes WHERE id=?
		UNION ALL SELECT n.id,n.parent_id,a.depth+1 FROM nodes n JOIN a ON n.id=a.parent_id)
		SELECT `+prefixed("n", cols)+` FROM a JOIN nodes n ON n.id=a.id
		WHERE n.trashed_at IS NULL AND n.trash_root IS NULL ORDER BY a.depth DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Node{}
	for rows.Next() {
		n, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func prefixed(p, list string) string {
	parts := strings.Split(list, ",")
	for i := range parts {
		parts[i] = p + "." + parts[i]
	}
	return strings.Join(parts, ",")
}

// UniqueName returns name, or "stem (N).ext" for the smallest N>=1, such that
// no live sibling in sp/parent has that name.
// Pass the *sql.Tx when called inside a transaction.
func UniqueName(ctx context.Context, db Queryer, sp Space, parent *string, name string) (string, error) {
	name = norm.NFC.String(name)
	stem, ext := name, ""
	if i := strings.LastIndex(name, "."); i > 0 {
		stem, ext = name[:i], name[i:]
	}
	for n := 0; ; n++ {
		cand := name
		if n > 0 {
			suffix := fmt.Sprintf(" (%d)%s", n, ext)
			st := stem
			for len(st)+len(suffix) > maxNameBytes && st != "" {
				_, sz := utf8.DecodeLastRuneInString(st)
				st = st[:len(st)-sz]
			}
			cand = st + suffix
		}
		var x int
		err := db.QueryRowContext(ctx, `SELECT 1 FROM nodes WHERE COALESCE(space_owner,'')=COALESCE(?,'')
			AND COALESCE(parent_id,'')=COALESCE(?,'') AND name=? AND trashed_at IS NULL`, sp.Owner, parent, cand).Scan(&x)
		if errors.Is(err, sql.ErrNoRows) {
			return cand, nil
		}
		if err != nil {
			return "", err
		}
	}
}

// FileSpec describes a file node to create from a completed upload.
type FileSpec struct {
	Space  Space
	Parent *string
	Name   string // desired name; a unique variant is chosen if taken
	Size   int64
	BlobID string
	Mime   string
}

// CreateFileTx inserts a file node inside tx. It re-checks the parent with
// the actor's access rules and picks the final name with UniqueName in the
// same tx, so concurrent same-name creations all succeed.
func CreateFileTx(ctx context.Context, tx *sql.Tx, actor users.User, f FileSpec) (Node, error) {
	name, err := normalizeName(f.Name)
	if err != nil {
		return Node{}, err
	}
	if err := checkParent(ctx, tx, actor, f.Space, f.Parent); err != nil {
		return Node{}, err
	}
	if name, err = UniqueName(ctx, tx, f.Space, f.Parent, name); err != nil {
		return Node{}, err
	}
	now := time.Now().Unix()
	blob := f.BlobID
	n := Node{ID: users.NewID(), SpaceOwner: f.Space.Owner, Uploader: actor.ID, ParentID: f.Parent,
		Name: name, Size: f.Size, BlobID: &blob, Mime: f.Mime, CreatedAt: now, UpdatedAt: now}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO nodes(id,space_owner,uploader,parent_id,name,is_dir,size,blob_id,mime,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?,?,?)`,
		n.ID, n.SpaceOwner, n.Uploader, n.ParentID, n.Name, n.Size, blob, n.Mime, now, now)
	if isUnique(err) {
		return Node{}, ErrNameTaken
	}
	if err != nil {
		return Node{}, err
	}
	return n, nil
}

// Get returns a live node the actor may access, else ErrNotFound
// (inaccessible looks identical to missing).
func Get(ctx context.Context, q Queryer, actor users.User, id string) (Node, error) {
	return get(ctx, q, actor, id)
}

// LiveChildren returns the live (not trashed, not in a trashed subtree)
// children of folder parentID ordered by name. It performs no access check;
// callers must already have verified access to the parent. Rows are fully
// read and closed before returning.
func LiveChildren(ctx context.Context, q Queryer, parentID string) ([]Node, error) {
	rows, err := q.QueryContext(ctx, `SELECT `+cols+` FROM nodes WHERE parent_id=? AND `+liveSQL+` ORDER BY name`, parentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Node{}
	for rows.Next() {
		n, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
