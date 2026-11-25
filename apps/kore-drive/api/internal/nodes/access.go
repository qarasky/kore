// Package nodes implements the file/folder tree: validation, listing,
// rename, move and access rules.
package nodes

import "github.com/qarasky/kore/api/internal/users"

// Node is a file or folder row.
type Node struct {
	ID         string
	SpaceOwner *string // nil = shared space
	Uploader   string
	ParentID   *string
	Name       string
	IsDir      bool
	Size       int64
	BlobID     *string
	Mime       string
	CreatedAt  int64
	UpdatedAt  int64
	// UploaderEmail is the uploader's email, filled only by the listing
	// queries (List, SearchHits, ListTrash) and only for shared-space nodes.
	UploaderEmail string
}

// Space identifies a top-level space. Owner nil is the shared space.
type Space struct{ Owner *string }

// SpaceOf returns the space a node lives in.
func SpaceOf(n Node) Space { return Space{Owner: n.SpaceOwner} }

// Personal returns the personal space of the given user.
func Personal(userID string) Space { return Space{Owner: &userID} }

// CanSpace reports whether actor may access the space. Admins get no
// special access to other users' personal spaces.
func CanSpace(actor users.User, sp Space) bool {
	return sp.Owner == nil || *sp.Owner == actor.ID
}

// Can reports whether actor may access the node.
func Can(actor users.User, n Node) bool { return CanSpace(actor, SpaceOf(n)) }
