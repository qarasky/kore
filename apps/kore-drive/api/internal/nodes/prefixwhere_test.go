package nodes

import "testing"

// prefixedWhere rewrites by plain substring replacement, so it is only safe
// for the fixed fragments it is used with. If liveSQL, rootSQL or
// childrenWhere change (a new column, or a column name containing another),
// this test fails and the rewrite must be re-checked.
func TestPrefixedWhere(t *testing.T) {
	cases := map[string]string{
		liveSQL:       `n.trashed_at IS NULL AND n.trash_root IS NULL`,
		rootSQL:       `n.trashed_at IS NOT NULL AND n.trash_root IS NULL`,
		childrenWhere: `COALESCE(n.space_owner,'')=COALESCE(?1,'') AND COALESCE(n.parent_id,'')=COALESCE(?2,'') AND n.trashed_at IS NULL AND n.trash_root IS NULL`,
	}
	for in, want := range cases {
		if got := prefixedWhere("n", in); got != want {
			t.Errorf("prefixedWhere(%q)\n got %q\nwant %q", in, got, want)
		}
	}
}
