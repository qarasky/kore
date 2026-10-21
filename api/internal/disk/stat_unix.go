//go:build linux || darwin

package disk

import "syscall"

// Stat returns the capacity of the filesystem holding path. The statfs
// field types differ between platforms (e.g. Bsize is int64 on Linux and
// uint32 on Darwin), hence the uint64 conversions.
func Stat(path string) (Usage, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return Usage{}, err
	}
	bs := uint64(st.Bsize)
	total := uint64(st.Blocks) * bs
	return Usage{
		Total: total,
		Used:  (uint64(st.Blocks) - uint64(st.Bfree)) * bs,
		Free:  uint64(st.Bavail) * bs,
	}, nil
}
