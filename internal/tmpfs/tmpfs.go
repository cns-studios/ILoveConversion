// Package tmpfs backs the promise that plaintext never reaches disk: it checks that a scratch
// directory lives on memory-backed storage.
package tmpfs

import (
	"fmt"
	"syscall"
)

const tmpfsMagic = 0x01021994

// Check returns an error unless dir is on tmpfs. In Kubernetes that means an emptyDir with
// medium: Memory.
func Check(dir string) error {
	var st syscall.Statfs_t
	if err := syscall.Statfs(dir, &st); err != nil {
		return fmt.Errorf("statfs %s: %w", dir, err)
	}
	if int64(st.Type) != tmpfsMagic {
		return fmt.Errorf("%s is not on tmpfs", dir)
	}
	return nil
}
