package config

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "kore.toml")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

const required = "data_dir = \"/tmp/kore\"\nadmin_email = \"a@b.c\"\nadmin_password = \"pw\"\n"

func TestLoadDefaults(t *testing.T) {
	c, err := Load(write(t, required))
	if err != nil {
		t.Fatal(err)
	}
	if c.Bind != "127.0.0.1" || c.Port != 8080 {
		t.Fatalf("got %+v", c)
	}
	if c.DataDir != "/tmp/kore" || c.AdminEmail != "a@b.c" || c.AdminPassword != "pw" {
		t.Fatalf("got %+v", c)
	}
}

func TestLoadBindAllInterfaces(t *testing.T) {
	c, err := Load(write(t, "bind = \"0.0.0.0\"\n"+required))
	if err != nil {
		t.Fatal(err)
	}
	if c.Bind != "0.0.0.0" {
		t.Fatalf("got %q", c.Bind)
	}
}

func TestLoadMissingDataDirFails(t *testing.T) {
	if _, err := Load(write(t, "admin_email = \"a@b.c\"\nadmin_password = \"pw\"\n")); err == nil {
		t.Fatal("expected error")
	}
}

func TestLoadInvalidBindFails(t *testing.T) {
	if _, err := Load(write(t, "bind = \"nonsense\"\n"+required)); err == nil {
		t.Fatal("expected error")
	}
}
