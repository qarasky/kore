package disk

import (
	"strings"
	"testing"
)

func TestStatConsistent(t *testing.T) {
	u, err := Stat(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if u.Total == 0 || u.Free == 0 || u.Used == 0 {
		t.Fatalf("implausible: %+v", u)
	}
	if u.Used+u.Free > u.Total {
		t.Fatalf("used+free > total: %+v", u)
	}
	if _, err := Stat("/definitely/not/here"); err == nil {
		t.Fatal("missing path: no error")
	}
}

const mountinfo = `22 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw
25 22 9:0 / /mnt/mirror rw,relatime shared:5 - ext4 /dev/md0 rw
26 22 9:0 /kore /data rw,relatime - ext4 /dev/md0 rw
27 26 0:44 / /data/sub\040dir rw - tmpfs tmpfs rw
28 22 0:45 / /proc rw - proc proc rw
`

func TestMountLabel(t *testing.T) {
	cases := []struct{ path, want string }{
		{"/data/blobs/ab", "/data (/dev/md0, ext4)"},
		{"/data", "/data (/dev/md0, ext4)"},
		{"/database", "/ (/dev/sda1, ext4)"}, // a prefix of the name is not a parent
		{"/mnt/mirror/kore", "/mnt/mirror (/dev/md0, ext4)"},
		{"/data/sub dir/x", "/data/sub dir (tmpfs)"},
		{"/", "/ (/dev/sda1, ext4)"},
	}
	for _, c := range cases {
		if got := mountLabel(strings.NewReader(mountinfo), c.path); got != c.want {
			t.Errorf("%s: got %q want %q", c.path, got, c.want)
		}
	}
	if got := mountLabel(strings.NewReader("garbage\n\n1 2 3\n"), "/data"); got != "" {
		t.Errorf("garbage: %q", got)
	}
}

func TestUsageFrom(t *testing.T) {
	// Frsize (fragment size) is the block unit when set; Bsize otherwise.
	if got := blockUnit(1024, 4096); got != 1024 {
		t.Fatalf("frsize: %d", got)
	}
	if got := blockUnit(0, 4096); got != 4096 {
		t.Fatalf("fallback: %d", got)
	}
	if got := blockUnit(-1, 4096); got != 4096 {
		t.Fatalf("negative frsize: %d", got)
	}
	u := usageFrom(1000, 400, 350, 4096)
	if u.Total != 1000*4096 || u.Used != 600*4096 || u.Free != 350*4096 {
		t.Fatalf("%+v", u)
	}
	// A filesystem reporting more free than total blocks must not wrap around.
	u = usageFrom(100, 150, 120, 512)
	if u.Used != 0 || u.Total != 100*512 || u.Free != 120*512 {
		t.Fatalf("saturation: %+v", u)
	}
}
