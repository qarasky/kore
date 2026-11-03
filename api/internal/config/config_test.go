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

func TestLoadFromEnvironmentWithoutFile(t *testing.T) {
	t.Setenv("KORE_PORT", "9090")
	t.Setenv("KORE_BIND", "0.0.0.0")
	t.Setenv("KORE_DATA_DIR", "/data")
	t.Setenv("KORE_ADMIN_EMAIL", "root@x.y")
	t.Setenv("KORE_ADMIN_PASSWORD", "long-enough-pw")
	c, err := Load(filepath.Join(t.TempDir(), "absent.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if c.Port != 9090 || c.Bind != "0.0.0.0" || c.DataDir != "/data" || c.AdminEmail != "root@x.y" || c.AdminPassword != "long-enough-pw" {
		t.Fatalf("got %+v", c)
	}
}

func TestLoadEnvironmentOverridesFile(t *testing.T) {
	t.Setenv("KORE_ADMIN_PASSWORD", "from-env")
	c, err := Load(write(t, required))
	if err != nil {
		t.Fatal(err)
	}
	if c.AdminPassword != "from-env" || c.AdminEmail != "a@b.c" {
		t.Fatalf("got %+v", c)
	}
}

func TestLoadMissingFileAndNoEnvFails(t *testing.T) {
	if _, err := Load(filepath.Join(t.TempDir(), "absent.toml")); err == nil {
		t.Fatal("expected error")
	}
}

func TestLoadInvalidPortEnvFails(t *testing.T) {
	t.Setenv("KORE_PORT", "eighty")
	if _, err := Load(write(t, required)); err == nil {
		t.Fatal("expected error")
	}
}

func TestSSODefaultsKeepPasswordLogin(t *testing.T) {
	c, err := Load(write(t, required))
	if err != nil {
		t.Fatal(err)
	}
	if !c.LocalLoginEnabled() || c.OIDC.Enabled() {
		t.Fatalf("got %+v", c)
	}
}

func TestSSOFromEnvironment(t *testing.T) {
	t.Setenv("KORE_OIDC_ISSUER", "https://id.example.com/")
	t.Setenv("KORE_OIDC_CLIENT_SECRET", "s3cret")
	t.Setenv("KORE_PUBLIC_URL", "https://kore.example.com/")
	t.Setenv("KORE_LOCAL_LOGIN", "false")
	t.Setenv("KORE_OIDC_LINK_BY_EMAIL", "true")
	t.Setenv("KORE_OIDC_AUTO_PROVISION", "false")
	c, err := Load(write(t, required))
	if err != nil {
		t.Fatal(err)
	}
	if c.OIDC.Issuer != "https://id.example.com" || c.PublicURL != "https://kore.example.com" || c.OIDC.ClientID != "kore" ||
		c.OIDC.ClientSecret != "s3cret" || c.LocalLoginEnabled() || !c.OIDC.LinkByEmail || c.OIDC.AutoProvisionEnabled() {
		t.Fatalf("got %+v", c)
	}
}

func TestSSOFromFile(t *testing.T) {
	c, err := Load(write(t, required+"public_url = \"http://localhost:3000\"\n[oidc]\nissuer = \"http://localhost:4000\"\nclient_id = \"kore\"\n"))
	if err != nil {
		t.Fatal(err)
	}
	if !c.OIDC.Enabled() || !c.LocalLoginEnabled() || !c.OIDC.AutoProvisionEnabled() || c.OIDC.LinkByEmail {
		t.Fatalf("got %+v", c)
	}
}

func TestSSOMisconfigurationFails(t *testing.T) {
	for name, body := range map[string]string{
		"issuer without public_url":   required + "[oidc]\nissuer = \"https://id.example.com\"\n",
		"relative issuer":             required + "public_url = \"https://k.example.com\"\n[oidc]\nissuer = \"id.example.com\"\n",
		"local_login off without sso": required + "local_login = false\n",
	} {
		if _, err := Load(write(t, body)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	t.Setenv("KORE_LOCAL_LOGIN", "maybe")
	if _, err := Load(write(t, required)); err == nil {
		t.Error("bad KORE_LOCAL_LOGIN accepted")
	}
}
