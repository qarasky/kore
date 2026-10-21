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

	"github.com/artchsh/kore/api/internal/users"
	"golang.org/x/text/unicode/norm"
)

var (
	// ErrNotFound is returned for missing, trashed or inaccessible nodes
	// (inaccessible deliberately looks identical to missing).
	ErrNotFound    = errors.New("node not found")
	ErrNameTaken   = errors.New("name taken")
	ErrInvalidName = errors.New("invalid name")
	ErrInvalidMove = errors.New("cannot move a folder into itself or its descendant")
	ErrNotDir      = errors.New("parent is not a folder")
)

const maxNameBytes = 255

// ValidateName reports whether name (after NFC normalization) is acceptable.
func ValidateName(name string) error {
	_, err := normalizeName(name)
	return err
}

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

const cols = `id,space_owner,uploader,parent_id,name,is_dir,size,blob_id,mime,created_at,updated_at`

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

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
	n, err := scan(q.QueryRowContext(ctx, `SELECT `+cols+` FROM nodes WHERE id=? AND trashed_at IS NULL`, id))
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

func sameSpace(a, b Space) bool {
	if a.Owner == nil || b.Owner == nil {
		return a.Owner == nil && b.Owner == nil
	}
	return *a.Owner == *b.Owner
}

func isUnique(err error) bool { return err != nil && strings.Contains(err.Error(), "UNIQUE") }

// CreateFolder creates a folder; a live name collision yields ErrNameTaken.
func CreateFolder(ctx context.Context, db *sql.DB, actor users.User, sp Space, parentID *string, name string) (Node, error) {
	name, err := normalizeName(name)
	if err != nil {
		return Node{}, err
	}
	if err := checkParent(ctx, db, actor, sp, parentID); err != nil {
		return Node{}, err
	}
	now := time.Now().Unix()
	n := Node{ID: users.NewID(), SpaceOwner: sp.Owner, Uploader: actor.ID, ParentID: parentID,
		Name: name, IsDir: true, CreatedAt: now, UpdatedAt: now}
	_, err = db.ExecContext(ctx,
		`INSERT INTO nodes(id,space_owner,uploader,parent_id,name,is_dir,size,mime,created_at,updated_at) VALUES(?,?,?,?,?,1,0,'',?,?)`,
		n.ID, n.SpaceOwner, n.Uploader, n.ParentID, n.Name, now, now)
	if isUnique(err) {
		return Node{}, ErrNameTaken
	}
	return n, err
}

// List returns the live children of parentID (nil = space root): folders
// first, then by natural, case-insensitive name order.
func List(ctx context.Context, db *sql.DB, actor users.User, sp Space, parentID *string) ([]Node, error) {
	if err := checkParent(ctx, db, actor, sp, parentID); err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT `+cols+` FROM nodes
		WHERE COALESCE(space_owner,'')=COALESCE(?,'') AND COALESCE(parent_id,'')=COALESCE(?,'') AND trashed_at IS NULL`,
		sp.Owner, parentID)
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

// Rename changes a node's name; a collision yields ErrNameTaken.
func Rename(ctx context.Context, db *sql.DB, actor users.User, id, newName string) (Node, error) {
	newName, err := normalizeName(newName)
	if err != nil {
		return Node{}, err
	}
	n, err := get(ctx, db, actor, id)
	if err != nil {
		return Node{}, err
	}
	now := time.Now().Unix()
	_, err = db.ExecContext(ctx, `UPDATE nodes SET name=?,updated_at=? WHERE id=?`, newName, now, id)
	if isUnique(err) {
		return Node{}, ErrNameTaken
	}
	if err != nil {
		return Node{}, err
	}
	n.Name, n.UpdatedAt = newName, now
	return n, nil
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
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Node{}, err
	}
	defer tx.Rollback()
	n, err := get(ctx, tx, actor, id)
	if err != nil {
		return Node{}, err
	}
	dest := SpaceOf(n)
	if newParent != nil {
		p, err := get(ctx, tx, actor, *newParent)
		if err != nil {
			return Node{}, err
		}
		dest = SpaceOf(p)
	} else if sp != nil {
		dest = *sp
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
	now := time.Now().Unix()
	_, err = tx.ExecContext(ctx, `UPDATE nodes SET parent_id=?,space_owner=?,updated_at=? WHERE id=?`,
		newParent, dest.Owner, now, id)
	if isUnique(err) {
		return Node{}, ErrNameTaken
	}
	if err != nil {
		return Node{}, err
	}
	if !sameSpace(SpaceOf(n), dest) {
		if _, err := tx.ExecContext(ctx, `WITH RECURSIVE d(id) AS (
			SELECT id FROM nodes WHERE parent_id=?
			UNION ALL SELECT n.id FROM nodes n JOIN d ON n.parent_id=d.id)
			UPDATE nodes SET space_owner=? WHERE id IN (SELECT id FROM d)`, id, dest.Owner); err != nil {
			if isUnique(err) {
				return Node{}, ErrNameTaken
			}
			return Node{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Node{}, err
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
		WHERE n.trashed_at IS NULL ORDER BY a.depth DESC`, id)
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
func UniqueName(ctx context.Context, db *sql.DB, sp Space, parent *string, name string) (string, error) {
	stem, ext := name, ""
	if i := strings.LastIndex(name, "."); i > 0 {
		stem, ext = name[:i], name[i:]
	}
	for n := 0; ; n++ {
		cand := name
		if n > 0 {
			cand = fmt.Sprintf("%s (%d)%s", stem, n, ext)
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
