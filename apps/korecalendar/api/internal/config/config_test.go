package config

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "c.toml")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoadDefaultsAndEnvOverride(t *testing.T) {
	t.Setenv("KORECAL_PORT", "9999")
	c, err := Load(write(t, "data_dir = \"/d\"\nport = 1234\n"))
	if err != nil {
		t.Fatal(err)
	}
	if c.Port != 9999 || c.Bind != "127.0.0.1" || c.DataDir != "/d" {
		t.Fatalf("got %+v", c)
	}
}

func TestLoadRequiresDataDirAndValidBind(t *testing.T) {
	if _, err := Load(write(t, "")); err == nil {
		t.Fatal("missing data_dir accepted")
	}
	if _, err := Load(write(t, "data_dir = \"/d\"\nbind = \"nope\"\n")); err == nil {
		t.Fatal("bad bind accepted")
	}
}
