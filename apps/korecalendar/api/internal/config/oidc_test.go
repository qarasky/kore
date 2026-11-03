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
	t.Setenv("KORECAL_PASSWORD_LOGIN", "false")
	c, err := Load(write(t, "data_dir = \"/d\"\npublic_url = \"https://cal.example.com\"\n[oidc]\nissuer = \"https://id.example.com\"\n"))
	if err != nil {
		t.Fatal(err)
	}
	o := c.OIDC
	if !o.Enabled() || o.ClientID != "korecalendar" || o.ClientSecret != "from-env" || o.LinkByEmail != "off" || !o.AutoProvision ||
		len(o.AdminSubs) != 2 || o.AdminSubs[1] != "b" || o.ExtraAudiences[0] != "korecalendar-android" || c.PasswordLogin || o.Name != "Kore ID" {
		t.Fatalf("%+v", c)
	}
	if got := c.OIDCRedirectURL(); got != "https://cal.example.com/api/auth/oidc/callback" {
		t.Fatal(got)
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
