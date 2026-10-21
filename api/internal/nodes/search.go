package nodes

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/artchsh/kore/api/internal/users"
	"golang.org/x/text/unicode/norm"
)

var (
	ErrEmptyQuery   = errors.New("empty query")
	ErrQueryTooLong = errors.New("query too long")
)

const (
	DefaultSearchLimit = 50
	MaxSearchLimit     = 200
	MaxQueryRunes      = 200
)

// Hit is a search result with the folder-name breadcrumb of its parents.
type Hit struct {
	Node
	Path []string
}

func fold(s string) string { return strings.ToLower(norm.NFC.String(s)) }

// Search returns matching nodes; see SearchHits.
func Search(ctx context.Context, db *sql.DB, actor users.User, q string, limit int) ([]Node, error) {
	hits, err := SearchHits(ctx, db, actor, q, limit)
	if err != nil {
		return nil, err
	}
	out := make([]Node, len(hits))
	for i, h := range hits {
		out[i] = h.Node
	}
	return out, nil
}

// SearchHits finds live nodes whose name contains q (case-insensitive,
// Unicode-aware) in the actor's personal space and the shared space. Folding
// is done in Go; rows are streamed and scanning stops at limit matches
// (default 50, max 200). Results are folders first, then natural name order.
func SearchHits(ctx context.Context, db *sql.DB, actor users.User, q string, limit int) ([]Hit, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return nil, ErrEmptyQuery
	}
	if utf8.RuneCountInString(q) > MaxQueryRunes {
		return nil, ErrQueryTooLong
	}
	if limit <= 0 {
		limit = DefaultSearchLimit
	}
	if limit > MaxSearchLimit {
		limit = MaxSearchLimit
	}
	needle := fold(q)

	// Stream candidates and release the rows before any further query.
	matches, err := func() ([]Node, error) {
		rows, err := db.QueryContext(ctx, `SELECT `+prefixed("n", cols)+emailCol+` FROM nodes n`+emailJoin+`
			WHERE (n.space_owner IS NULL OR n.space_owner=?) AND `+prefixedWhere("n", liveSQL)+`
			ORDER BY n.is_dir DESC, n.name`, actor.ID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Node
		for len(out) < limit && rows.Next() {
			n, err := scanEmail(rows)
			if err != nil {
				return nil, err
			}
			if strings.Contains(fold(n.Name), needle) {
				out = append(out, n)
			}
		}
		return out, rows.Err()
	}()
	if err != nil {
		return nil, err
	}
	sort.SliceStable(matches, func(i, j int) bool {
		a, b := matches[i], matches[j]
		if a.IsDir != b.IsDir {
			return a.IsDir
		}
		if c := naturalCompare(a.Name, b.Name); c != 0 {
			return c < 0
		}
		return a.Name < b.Name
	})
	hits := make([]Hit, len(matches))
	for i, n := range matches {
		hits[i] = Hit{Node: n, Path: []string{}}
	}
	if err := fillPaths(ctx, db, hits); err != nil {
		return nil, err
	}
	return hits, nil
}

// fillPaths sets each hit's Path with one recursive query over its ancestors.
func fillPaths(ctx context.Context, db *sql.DB, hits []Hit) error {
	var args []any
	var ph []string
	idx := map[string][]int{}
	for i, h := range hits {
		if h.ParentID == nil {
			continue
		}
		if _, ok := idx[h.ID]; !ok {
			ph = append(ph, "?")
			args = append(args, h.ID)
		}
		idx[h.ID] = append(idx[h.ID], i)
	}
	if len(args) == 0 {
		return nil
	}
	rows, err := db.QueryContext(ctx, `WITH RECURSIVE a(root,id,name,parent_id,depth) AS (
		SELECT id,id,name,parent_id,0 FROM nodes WHERE id IN (`+strings.Join(ph, ",")+`)
		UNION ALL SELECT a.root,n.id,n.name,n.parent_id,a.depth+1 FROM nodes n JOIN a ON n.id=a.parent_id)
		SELECT root,name FROM a WHERE depth>0 ORDER BY root, depth DESC`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var root, name string
		if err := rows.Scan(&root, &name); err != nil {
			return err
		}
		for _, i := range idx[root] {
			hits[i].Path = append(hits[i].Path, name)
		}
	}
	return rows.Err()
}
