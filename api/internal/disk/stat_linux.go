package disk

import "syscall"

// Stat returns the capacity of the filesystem holding path.
func Stat(path string) (Usage, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return Usage{}, err
	}
	// Field types vary between Linux architectures, hence the conversions.
	unit := blockUnit(int64(st.Frsize), int64(st.Bsize))
	return usageFrom(uint64(st.Blocks), uint64(st.Bfree), uint64(st.Bavail), unit), nil
}
