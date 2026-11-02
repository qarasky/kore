package httpapi_test

import (
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testsrv"
)

func TestSetupStatusTrueOnFreshInstall(t *testing.T) {
	srv, _ := testsrv.New(t)
	r := testsrv.Do(t, srv, "", "GET", "/api/setup", nil)
	if r.Status != 200 || string(r.Body) != "{\"setup_required\":true}\n" {
		t.Fatalf("%d %q", r.Status, r.Body)
	}
}

func TestSetupStatusFalseAfterSetup(t *testing.T) {
	srv, _ := testsrv.New(t)
	testsrv.Login(t, srv)
	r := testsrv.Do(t, srv, "", "GET", "/api/setup", nil)
	if r.Status != 200 || string(r.Body) != "{\"setup_required\":false}\n" {
		t.Fatalf("%d %q", r.Status, r.Body)
	}
}
