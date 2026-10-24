package storage

import (
	"os"
	"path/filepath"
	"testing"
)

const jobA = "6f1c2d3e-0000-4000-8000-00000000000a"

func TestJobIDOf(t *testing.T) {
	tests := map[string]string{
		jobA:                                   jobA,
		jobA + ".tok":                          jobA,
		jobA + ".abc123.assembling":            jobA,
		jobA + "x":                             "",
		"short":                                "",
		".health-123":                          "",
		"6F1C2D3E-0000-4000-8000-00000000000A": "", // ids are lowercase
	}
	for name, want := range tests {
		if got := jobIDOf(name); got != want {
			t.Errorf("jobIDOf(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestDeleteJobFilesRemovesEveryAttempt(t *testing.T) {
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	write := func(p string) {
		if err := os.MkdirAll(filepath.Dir(p), 0o770); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o660); err != nil {
			t.Fatal(err)
		}
	}
	write(s.InputPath(jobA))
	write(filepath.Join(s.inputsDir, jobA+".ab12.assembling"))
	write(s.OutputPath(OutputName(jobA, "tok1")))
	write(s.OutputPath(OutputName(jobA, "tok2")))
	write(s.partPath(jobA, 0))

	other := "6f1c2d3e-0000-4000-8000-00000000000b"
	write(s.OutputPath(OutputName(other, "tok1")))

	s.DeleteJobFiles(jobA)

	entries, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].JobID != other {
		t.Errorf("after delete, entries = %+v; want only the other job's output", entries)
	}
}

func TestAssemblyIsInvisibleUntilCommitted(t *testing.T) {
	s, _ := New(t.TempDir())

	f, err := s.CreateAssembly(jobA)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString("data")
	f.Close()
	if s.InputExists(jobA) {
		t.Fatal("input visible before commit")
	}
	if err := s.CommitInput(jobA, f); err != nil {
		t.Fatal(err)
	}
	if !s.InputExists(jobA) {
		t.Fatal("input missing after commit")
	}
}

func TestOutputPathCannotEscapeOutputsDir(t *testing.T) {
	s, _ := New(t.TempDir())
	if got, want := s.OutputPath("../../etc/passwd"), filepath.Join(s.outputsDir, "passwd"); got != want {
		t.Errorf("OutputPath = %q, want %q", got, want)
	}
}

func TestWritable(t *testing.T) {
	dir := t.TempDir()
	s, _ := New(dir)
	if err := s.Writable(); err != nil {
		t.Fatalf("Writable on a fresh volume: %v", err)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, ".health-*")); len(left) != 0 {
		t.Errorf("probe left files behind: %v", left)
	}
}
