// Package volume guards the data directory and maps blob IDs to paths.
package volume

import (
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

const marker = ".kore-volume"

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// Check requires the volume marker to exist; it never creates it.
func Check(dataDir string) error {
	if _, err := os.Stat(filepath.Join(dataDir, marker)); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("volume marker %s missing in %s (wrong or unmounted volume? run `kore init` to initialize)", marker, dataDir)
		}
		return fmt.Errorf("checking volume marker %s: %w", marker, err)
	}
	return nil
}

// Init creates the marker and the blobs/ and tmp/uploads/ directories.
func Init(dataDir string) error {
	if err := os.MkdirAll(filepath.Join(dataDir, "blobs"), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "tmp", "uploads"), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(dataDir, marker), os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	return f.Close()
}

// NewBlobID returns a random UUIDv4.
func NewBlobID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// BlobPath returns <dataDir>/blobs/<id[0:2]>/<id>, rejecting non-UUIDv4 ids.
func BlobPath(dataDir, blobID string) (string, error) {
	if !uuidRe.MatchString(blobID) {
		return "", fmt.Errorf("invalid blob id %q", blobID)
	}
	return filepath.Join(dataDir, "blobs", blobID[:2], blobID), nil
}
