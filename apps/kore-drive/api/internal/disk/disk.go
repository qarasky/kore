// Package disk reports the capacity of the filesystem holding the data
// directory (for the admin overview).
package disk

import (
	"bufio"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Usage is a filesystem's capacity in bytes.
//
// Free is what an unprivileged writer can still use (statfs f_bavail, what
// df shows as "Avail"); Used is Total minus all free blocks (f_bfree). On
// ext4 the root-reserved blocks (5% by default) are in neither Used nor
// Free, so Used+Free < Total, and df's "Use%" (Used/(Used+Avail)) is higher
// than Used/Total. Kore writes as an unprivileged user, so Free is the
// honest "space left".
type Usage struct {
	Total uint64
	Used  uint64
	Free  uint64
}

// Label is a best-effort human label for the mount holding path, e.g.
// "/data (/dev/md0, ext4)", read from /proc/self/mountinfo. Empty where
// that file does not exist (non-Linux) or nothing matches.
func Label(path string) string {
	f, err := os.Open("/proc/self/mountinfo")
	if err != nil {
		return ""
	}
	defer f.Close()
	if p, err := filepath.EvalSymlinks(path); err == nil {
		path = p
	}
	if p, err := filepath.Abs(path); err == nil {
		path = p
	}
	return mountLabel(f, path)
}

// mountLabel picks the mountinfo entry whose mount point is the longest
// parent (or equal) of path. Format (proc(5)):
// id parent major:minor root mountpoint options [optional...] - fstype source superopts
func mountLabel(r io.Reader, path string) string {
	best, label := -1, ""
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		sep := -1
		for i := 6; i < len(f); i++ {
			if f[i] == "-" {
				sep = i
				break
			}
		}
		if len(f) < 7 || sep < 0 || sep+2 >= len(f) {
			continue
		}
		mp := unescape(f[4])
		if !within(path, mp) || len(mp) <= best {
			continue
		}
		fstype, source := unescape(f[sep+1]), unescape(f[sep+2])
		best = len(mp)
		if source == "" || source == fstype || source == "none" {
			label = mp + " (" + fstype + ")"
		} else {
			label = mp + " (" + source + ", " + fstype + ")"
		}
	}
	return label
}

// within reports whether path is mp or below it.
func within(path, mp string) bool {
	if mp == "/" {
		return strings.HasPrefix(path, "/")
	}
	return path == mp || strings.HasPrefix(path, mp+"/")
}

// unescape decodes mountinfo's octal escapes (\040 for a space, ...).
func unescape(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+3 < len(s) {
			if n, err := strconv.ParseUint(s[i+1:i+4], 8, 8); err == nil {
				b.WriteByte(byte(n))
				i += 3
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String()
}
