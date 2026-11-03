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

const required = "data_dir = \"/tmp/kore\"\npublic_url = \"https://k.example.com\"\n[oidc]\nissuer = \"https://id.example.com\"\n"

func TestLoadDefaults(t *testing.T) {
	c, err := Load(write(t, required))
	if err != nil {
		t.Fatal(err)
	}
	if c.Bind != "127.0.0.1" || c.Port != 8080 {
		t.Fatalf("got %+v", c)
	}
	if c.DataDir != "/tmp/kore" || c.OIDC.Issuer != "https://id.example.com" || c.OIDC.ClientID != "kore" {
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
	if _, err := Load(write(t, "public_url = \"https://k.example.com\"\n[oidc]\nissuer = \"https://id.example.com\"\n")); err == nil {
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
	t.Setenv("KORE_PUBLIC_URL", "https://k.example.com")
	t.Setenv("KORE_OIDC_ISSUER", "https://id.example.com")
	t.Setenv("KORE_OIDC_OWNER_EMAIL", "root@x.y")
	c, err := Load(filepath.Join(t.TempDir(), "absent.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if c.Port != 9090 || c.Bind != "0.0.0.0" || c.DataDir != "/data" || c.OIDC.Issuer != "https://id.example.com" ||
		c.OIDC.OwnerEmail != "root@x.y" {
		t.Fatalf("got %+v", c)
	}
}

func TestLoadEnvironmentOverridesFile(t *testing.T) {
	t.Setenv("KORE_OIDC_OWNER_EMAIL", "from-env@x.y")
	c, err := Load(write(t, required))
	if err != nil {
		t.Fatal(err)
	}
	if c.OIDC.OwnerEmail != "from-env@x.y" || c.OIDC.Issuer != "https://id.example.com" {
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

func TestKoreIDIsRequired(t *testing.T) {
	for name, body := range map[string]string{
		"no oidc":         "data_dir = \"/tmp/kore\"\n",
		"issuer empty":    "data_dir = \"/tmp/kore\"\npublic_url = \"https://k.example.com\"\n",
		"local_login key": "data_dir = \"/tmp/kore\"\nlocal_login = true\n",
	} {
		if _, err := Load(write(t, body)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestSSOFromEnvironment(t *testing.T) {
	t.Setenv("KORE_OIDC_ISSUER", "https://id.example.com/")
	t.Setenv("KORE_OIDC_CLIENT_SECRET", "s3cret")
	t.Setenv("KORE_PUBLIC_URL", "https://kore.example.com/")
	t.Setenv("KORE_OIDC_LINK_BY_EMAIL", "false")
	t.Setenv("KORE_OIDC_AUTO_PROVISION", "false")
	t.Setenv("KORE_OIDC_OWNER_EMAIL", "  Owner@Example.COM ")
	c, err := Load(write(t, "data_dir = \"/tmp/kore\"\n"))
	if err != nil {
		t.Fatal(err)
	}
	if c.OIDC.Issuer != "https://id.example.com" || c.PublicURL != "https://kore.example.com" || c.OIDC.ClientID != "kore" ||
		c.OIDC.ClientSecret != "s3cret" || c.OIDC.LinkByEmailEnabled() || c.OIDC.AutoProvisionEnabled() ||
		c.OIDC.OwnerEmail != "owner@example.com" || !c.FirstUserSSO() {
		t.Fatalf("got %+v", c)
	}
}

func TestSSOFromFile(t *testing.T) {
	c, err := Load(write(t, "data_dir = \"/tmp/kore\"\npublic_url = \"http://localhost:3000\"\n[oidc]\nissuer = \"http://localhost:4000\"\nclient_id = \"kore\"\nowner_email = \"  Owner@Example.com \"\n"))
	if err != nil {
		t.Fatal(err)
	}
	if !c.OIDC.Enabled() || !c.OIDC.AutoProvisionEnabled() || !c.OIDC.LinkByEmailEnabled() ||
		c.OIDC.OwnerEmail != "owner@example.com" || !c.FirstUserSSO() {
		t.Fatalf("got %+v", c)
	}
}

func TestFirstAdminFromKoreID(t *testing.T) {
	c, err := Load(write(t, "data_dir = \"/d\"\npublic_url = \"https://k.example.com\"\n[oidc]\nissuer = \"https://id.example.com\"\nowner_email = \"owner@example.com\"\n"))
	if err != nil {
		t.Fatal(err)
	}
	if !c.FirstUserSSO() {
		t.Fatalf("got %+v", c)
	}
	// A fresh install without an owner email still loads: existing accounts can
	// sign in, and the API explains the missing first admin on the login page.
	if _, err := Load(write(t, "data_dir = \"/d\"\npublic_url = \"https://k.example.com\"\n[oidc]\nissuer = \"https://id.example.com\"\n")); err != nil {
		t.Fatal(err)
	}
}

func TestLinkByEmailFromFile(t *testing.T) {
	c, err := Load(write(t, required+"link_by_email = false\n"))
	if err != nil {
		t.Fatal(err)
	}
	if c.OIDC.LinkByEmailEnabled() {
		t.Fatal("link_by_email = false ignored")
	}
	t.Setenv("KORE_OIDC_LINK_BY_EMAIL", "sometimes")
	if _, err := Load(write(t, required)); err == nil {
		t.Error("bad KORE_OIDC_LINK_BY_EMAIL accepted")
	}
}

func TestSSOMisconfigurationFails(t *testing.T) {
	for name, body := range map[string]string{
		"issuer without public_url": "data_dir = \"/tmp/kore\"\n[oidc]\nissuer = \"https://id.example.com\"\n",
		"relative issuer":           "data_dir = \"/tmp/kore\"\npublic_url = \"https://k.example.com\"\n[oidc]\nissuer = \"id.example.com\"\n",
		"bad owner_email":           "data_dir = \"/tmp/kore\"\npublic_url = \"https://k.example.com\"\n[oidc]\nissuer = \"https://id.example.com\"\nowner_email = \"not an address\"\n",
	} {
		if _, err := Load(write(t, body)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	t.Setenv("KORE_OIDC_AUTO_PROVISION", "maybe")
	if _, err := Load(write(t, required)); err == nil {
		t.Error("bad KORE_OIDC_AUTO_PROVISION accepted")
	}
}

func TestSSOAppURLs(t *testing.T) {
	sso := "data_dir = \"/tmp/kore\"\npublic_url = \"https://files.example.com\"\n[oidc]\nissuer = \"https://id.example.com\"\n"
	c, err := Load(write(t, sso+"apps = { koremind = \"https://mind.example.com/\" }\n"))
	if err != nil {
		t.Fatal(err)
	}
	if c.OIDC.Apps["koremind"] != "https://mind.example.com" {
		t.Fatalf("got %v", c.OIDC.Apps)
	}
	t.Setenv("KORE_APP_URLS", "korecalendar=https://cal.example.com, flatline=https://up.example.com")
	if c, err = Load(write(t, sso)); err != nil {
		t.Fatal(err)
	}
	if len(c.OIDC.Apps) != 2 || c.OIDC.Apps["flatline"] != "https://up.example.com" {
		t.Fatalf("got %v", c.OIDC.Apps)
	}
	for _, bad := range []string{"nope=https://x.example.com", "koremind=ftp://x", "koremind"} {
		t.Setenv("KORE_APP_URLS", bad)
		if _, err := Load(write(t, sso)); err == nil {
			t.Fatalf("%q: want error", bad)
		}
	}
}
