//go:build !linux && !darwin

package disk

import "errors"

// Stat is not implemented on this platform.
func Stat(path string) (Usage, error) { return Usage{}, errors.ErrUnsupported }
