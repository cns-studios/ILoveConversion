package tmpfs

import "testing"

func TestCheck(t *testing.T) {
	if err := Check("/dev/shm"); err != nil {
		t.Skipf("/dev/shm is not tmpfs here: %v", err)
	}
	if err := Check("/nonexistent-dir"); err == nil {
		t.Error("missing directory accepted")
	}
}
