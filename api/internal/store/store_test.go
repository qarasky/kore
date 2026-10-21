package store

import (
	"path/filepath"
	"testing"
)

func TestOpenAppliesMigrationsTwice(t *testing.T) {
	p := filepath.Join(t.TempDir(), "k.db")
	db, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM users`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	var fk int
	db.QueryRow(`PRAGMA foreign_keys`).Scan(&fk)
	if fk != 1 {
		t.Fatalf("foreign_keys=%d", fk)
	}
	for _, idx := range []string{"nodes_uploader", "nodes_blob"} {
		var x int
		if err := db.QueryRow(`SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`, idx).Scan(&x); err != nil {
			t.Fatalf("index %s: %v", idx, err)
		}
	}
}

func TestUniqueNameInFolder(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO users(id,email,pw_hash,role,quota_bytes,created_at) VALUES('u1','a@b.c','x','user',0,0),('u2','d@e.f','x','user',0,0)`); err != nil {
		t.Fatal(err)
	}
	ins := func(id string, owner, parent any, name string, trashed any) error {
		_, err := db.Exec(`INSERT INTO nodes(id,space_owner,uploader,parent_id,name,is_dir,size,mime,trashed_at,created_at,updated_at) VALUES(?,?,'u1',?,?,0,0,'',?,0,0)`, id, owner, parent, name, trashed)
		return err
	}
	cases := []struct {
		name          string
		owner, parent any
	}{
		{"shared root", nil, nil},
		{"personal root", "u1", nil},
		{"shared subfolder", nil, "p1"},
	}
	for i, c := range cases {
		id := string(rune('a' + i*3))
		if err := ins(id+"1", c.owner, c.parent, "f.txt", nil); err != nil {
			t.Fatalf("%s first: %v", c.name, err)
		}
		if err := ins(id+"2", c.owner, c.parent, "f.txt", nil); err == nil {
			t.Fatalf("%s: duplicate live name accepted", c.name)
		}
		if err := ins(id+"3", c.owner, c.parent, "f.txt", 123); err != nil {
			t.Fatalf("%s: trashed duplicate rejected: %v", c.name, err)
		}
	}
	// different space same name is fine
	if err := ins("z1", "u2", nil, "f.txt", nil); err != nil {
		t.Fatal(err)
	}
}
