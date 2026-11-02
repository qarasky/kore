// Package volume guards the data directory.
package volume

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const marker = ".korecal-volume"

// Check requires the volume marker to exist as a regular file; it never
// creates it, so a missing mount never turns into an empty fresh install.
func Check(dataDir string) error {
	st, err := os.Stat(filepath.Join(dataDir, marker))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("volume marker %s missing in %s (wrong or unmounted volume? run `korecalendar init` to initialize)", marker, dataDir)
		}
		return fmt.Errorf("checking volume marker %s: %w", marker, err)
	}
	if !st.Mode().IsRegular() {
		return fmt.Errorf("volume marker %s in %s is not a regular file", marker, dataDir)
	}
	return nil
}

// Init creates the marker. If dataDir does not exist it is created, but only
// when its parent exists: a missing parent usually means the volume is not
// mounted.
func Init(dataDir string) error {
	st, err := os.Stat(dataDir)
	switch {
	case errors.Is(err, os.ErrNotExist):
		if err := os.Mkdir(dataDir, 0o755); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("parent of data dir %s does not exist (is the volume mounted?)", dataDir)
			}
			return err
		}
	case err != nil:
		return err
	case !st.IsDir():
		return fmt.Errorf("data dir %s is not a directory", dataDir)
	}
	p := filepath.Join(dataDir, marker)
	if st, err := os.Stat(p); err == nil && !st.Mode().IsRegular() {
		return fmt.Errorf("volume marker %s exists but is not a regular file", p)
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	return f.Close()
}
