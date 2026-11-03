package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOIDCDefaultsToOffAndPasswordsOn(t *testing.T) {
	c, err := Load(write(t, "data_dir = \"/d\"\n"))
	if err != nil {
		t.Fatal(err)
	}
	if c.OIDC.Enabled() || !c.PasswordLogin {
		t.Fatalf("%+v", c)
	}
}

func TestOIDCFromFileAndEnv(t *testing.T) {
	t.Setenv("KORECAL_OIDC_CLIENT_SECRET", "from-env")
	t.Setenv("KORECAL_OIDC_ADMIN_SUBS", "a, b")
	t.Setenv("KORECAL_OIDC_EXTRA_AUDIENCES", "korecalendar-android")
	t.Setenv("KORECAL_OIDC_OWNER_EMAIL", "  Ada@Example.COM ")
	t.Setenv("KORECAL_PASSWORD_LOGIN", "false")
	c, err := Load(write(t, "data_dir = \"/d\"\npublic_url = \"https://cal.example.com\"\n[oidc]\nissuer = \"https://id.example.com\"\n"))
	if err != nil {
		t.Fatal(err)
	}
	o := c.OIDC
	if !o.Enabled() || o.ClientID != "korecalendar" || o.ClientSecret != "from-env" || o.LinkByEmail != "verified" || !o.AutoProvision ||
		len(o.AdminSubs) != 2 || o.AdminSubs[1] != "b" || o.ExtraAudiences[0] != "korecalendar-android" || c.PasswordLogin || o.Name != "Kore ID" ||
		o.OwnerEmail != "ada@example.com" {
		t.Fatalf("%+v", c)
	}
	if got := c.OIDCRedirectURL(); got != "https://cal.example.com/api/auth/oidc/callback" {
		t.Fatal(got)
	}
	if got := c.OIDCBackchannelLogoutURL(); got != "https://cal.example.com/api/auth/oidc/backchannel-logout" {
		t.Fatal(got)
	}
	if o.Apps["korecalendar"] != "https://cal.example.com/" || len(o.Apps) != 1 {
		t.Fatalf("apps %v", o.Apps)
	}
}

func TestOIDCLinkByEmailModes(t *testing.T) {
	for _, mode := range []string{"off", "verified", "trusted"} {
		t.Setenv("KORECAL_OIDC_LINK_BY_EMAIL", mode)
		c, err := Load(write(t, "data_dir = \"/d\"\npublic_url = \"https://c.example\"\n[oidc]\nissuer = \"https://id.example.com\"\n"))
		if err != nil || c.OIDC.LinkByEmail != mode {
			t.Fatalf("%s: %+v %v", mode, c.OIDC, err)
		}
	}
}

func TestKoreApps(t *testing.T) {
	base := "data_dir = \"/d\"\npublic_url = \"https://cal.example\"\n[oidc]\nissuer = \"https://id.example.com\"\n"
	c, err := Load(write(t, base+"apps = { kore = \"https://files.example\", korecalendar = \"https://other.example/\" }\n"))
	if err != nil || c.OIDC.Apps["kore"] != "https://files.example" || c.OIDC.Apps["korecalendar"] != "https://other.example/" {
		t.Fatalf("%+v %v", c.OIDC.Apps, err)
	}
	t.Setenv("KORECAL_KORE_APPS", "koremind=https://mind.example, flatline=http://mon.example:3004")
	c, err = Load(write(t, base))
	if err != nil || c.OIDC.Apps["koremind"] != "https://mind.example" || c.OIDC.Apps["flatline"] != "http://mon.example:3004" ||
		c.OIDC.Apps["korecalendar"] != "https://cal.example/" {
		t.Fatalf("%+v %v", c.OIDC.Apps, err)
	}
	for _, bad := range []string{"other=https://x.example", "kore=files.example", "kore=javascript:alert(1)", "kore"} {
		t.Setenv("KORECAL_KORE_APPS", bad)
		if _, err := Load(write(t, base)); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestOIDCOwnerEmailFromFile(t *testing.T) {
	c, err := Load(write(t, "data_dir = \"/d\"\npublic_url = \"https://c.example\"\n[oidc]\nissuer = \"https://id.example.com\"\nowner_email = \"  Owner@Example.com \"\n"))
	if err != nil || c.OIDC.OwnerEmail != "owner@example.com" {
		t.Fatalf("%+v %v", c.OIDC, err)
	}
}

func TestOIDCSecretFile(t *testing.T) {
	f := filepath.Join(t.TempDir(), "secret")
	os.WriteFile(f, []byte("  filesecret\n"), 0o600)
	t.Setenv("KORECAL_OIDC_CLIENT_SECRET_FILE", f)
	c, err := Load(write(t, "data_dir = \"/d\"\npublic_url = \"https://c.example\"\n[oidc]\nissuer = \"https://id.example.com\"\n"))
	if err != nil || c.OIDC.ClientSecret != "filesecret" {
		t.Fatalf("%+v %v", c.OIDC, err)
	}
}

func TestOIDCValidation(t *testing.T) {
	base := "data_dir = \"/d\"\n"
	for name, body := range map[string]string{
		"oidc without public_url":    base + "[oidc]\nissuer = \"https://id.example.com\"\n",
		"public_url with a path":     base + "public_url = \"https://c.example/cal\"\n[oidc]\nissuer = \"https://id.example.com\"\n",
		"bad link_by_email":          base + "public_url = \"https://c.example\"\n[oidc]\nissuer = \"https://id.example.com\"\nlink_by_email = \"yes\"\n",
		"bad owner_email":            base + "public_url = \"https://c.example\"\n[oidc]\nissuer = \"https://id.example.com\"\nowner_email = \"not an address\"\n",
		"passwords off, no provider": base + "password_login = false\n",
	} {
		if _, err := Load(write(t, body)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	t.Setenv("KORECAL_PASSWORD_LOGIN", "maybe")
	if _, err := Load(write(t, base)); err == nil {
		t.Error("bad KORECAL_PASSWORD_LOGIN accepted")
	}
}
