package disk

import "syscall"

// Stat returns the capacity of the filesystem holding path. Darwin's statfs
// has no f_frsize: f_bsize is the fundamental block size the counts use.
func Stat(path string) (Usage, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return Usage{}, err
	}
	unit := blockUnit(0, int64(st.Bsize))
	return usageFrom(st.Blocks, st.Bfree, st.Bavail, unit), nil
}
