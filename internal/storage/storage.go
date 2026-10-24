package storage

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Storage is the shared volume. Everything on it is ciphertext; plaintext only ever exists in
// each pod's tmpfs.
type Storage struct {
	basePath   string
	inputsDir  string
	outputsDir string
	partsDir   string
}

const (
	dirMode  = 0o770
	fileMode = 0o660
)

func New(basePath string) (*Storage, error) {
	s := &Storage{
		basePath:   basePath,
		inputsDir:  filepath.Join(basePath, "inputs"),
		outputsDir: filepath.Join(basePath, "outputs"),
		partsDir:   filepath.Join(basePath, "inputs", "parts"),
	}

	for _, dir := range []string{s.inputsDir, s.outputsDir} {
		if err := os.MkdirAll(dir, dirMode); err != nil {
			return nil, fmt.Errorf("create storage dir %s: %w", dir, err)
		}
	}

	return s, nil
}

// Writable proves the volume accepts writes right now.
func (s *Storage) Writable() error {
	f, err := os.CreateTemp(s.basePath, ".health-*")
	if err != nil {
		return err
	}
	name := f.Name()
	_, werr := f.Write([]byte("ok"))
	cerr := f.Close()
	rerr := os.Remove(name)
	for _, err := range []error{werr, cerr, rerr} {
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Storage) InputPath(jobID string) string {
	return filepath.Join(s.inputsDir, jobID)
}

// OutputName is the stored name of one attempt's output. The lock token makes it unique per
// attempt, so two workers racing on the same job never write the same file.
func OutputName(jobID, lockToken string) string {
	return jobID + "." + lockToken
}

func (s *Storage) OutputPath(name string) string {
	return filepath.Join(s.outputsDir, filepath.Base(name))
}

func (s *Storage) InputExists(jobID string) bool {
	_, err := os.Stat(s.InputPath(jobID))
	return err == nil
}

func (s *Storage) OutputExists(name string) bool {
	_, err := os.Stat(s.OutputPath(name))
	return err == nil
}

func (s *Storage) DeleteInput(jobID string) {
	os.Remove(s.InputPath(jobID))
}

func (s *Storage) DeleteOutput(name string) {
	os.Remove(s.OutputPath(name))
}

// DeleteJobFiles removes every file a job may have left: input, upload parts, interrupted
// assemblies, and the outputs of every attempt, including losers. Files that are already gone
// count as deleted; any other error is returned so the caller can retry.
func (s *Storage) DeleteJobFiles(jobID string) error {
	var errs []error
	remove := func(p string) {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			errs = append(errs, err)
		}
	}

	remove(s.InputPath(jobID))
	if err := os.RemoveAll(filepath.Join(s.partsDir, jobID)); err != nil {
		errs = append(errs, err)
	}
	for _, dir := range []string{s.inputsDir, s.outputsDir} {
		matches, _ := filepath.Glob(filepath.Join(dir, jobID+".*"))
		for _, m := range matches {
			remove(m)
		}
	}
	return errors.Join(errs...)
}

func (s *Storage) partPath(jobID string, index int) string {
	return filepath.Join(s.partsDir, jobID, strconv.Itoa(index))
}

func (s *Storage) CreatePart(jobID string, index int) (*os.File, error) {
	dir := filepath.Join(s.partsDir, jobID)
	if err := os.MkdirAll(dir, dirMode); err != nil {
		return nil, fmt.Errorf("create parts dir %s: %w", dir, err)
	}
	f, err := os.OpenFile(s.partPath(jobID, index)+".tmp", os.O_WRONLY|os.O_CREATE|os.O_TRUNC, fileMode)
	if err != nil {
		return nil, fmt.Errorf("create part %d of %s: %w", index, jobID, err)
	}
	return f, nil
}

func (s *Storage) CommitPart(jobID string, index int) error {
	p := s.partPath(jobID, index)
	return os.Rename(p+".tmp", p)
}

func (s *Storage) DiscardPart(jobID string, index int) {
	os.Remove(s.partPath(jobID, index) + ".tmp")
}

func (s *Storage) OpenPart(jobID string, index int) (*os.File, error) {
	return os.Open(s.partPath(jobID, index))
}

func (s *Storage) DeleteParts(jobID string) {
	os.RemoveAll(filepath.Join(s.partsDir, jobID))
}

// CreateAssembly opens a private file to assemble the input into. CommitInput publishes it, so
// a second replica completing the same upload can never observe or truncate a half-written input.
func (s *Storage) CreateAssembly(jobID string) (*os.File, error) {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		return nil, err
	}
	p := filepath.Join(s.inputsDir, jobID+"."+hex.EncodeToString(b[:])+".assembling")
	f, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, fileMode)
	if err != nil {
		return nil, fmt.Errorf("create assembly %s: %w", p, err)
	}
	return f, nil
}

func (s *Storage) CommitInput(jobID string, assembly *os.File) error {
	return os.Rename(assembly.Name(), s.InputPath(jobID))
}

func (s *Storage) CreateInput(jobID string) (*os.File, error) {
	p := s.InputPath(jobID)
	f, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, fileMode)
	if err != nil {
		return nil, fmt.Errorf("create input %s: %w", p, err)
	}
	return f, nil
}

func (s *Storage) OpenInput(jobID string) (*os.File, error) {
	p := s.InputPath(jobID)
	f, err := os.Open(p)
	if err != nil {
		return nil, fmt.Errorf("open input %s: %w", p, err)
	}
	return f, nil
}

func (s *Storage) OpenOutput(name string) (*os.File, error) {
	p := s.OutputPath(name)
	f, err := os.Open(p)
	if err != nil {
		return nil, fmt.Errorf("open output %s: %w", p, err)
	}
	return f, nil
}

type Kind int

const (
	KindInput Kind = iota
	KindParts
	KindOutput
)

// Entry is one top-level item on the volume that belongs to a job.
type Entry struct {
	Kind    Kind
	JobID   string
	Name    string // file name; for KindParts the directory name
	Path    string
	ModTime time.Time
}

// List returns every job-owned item on the volume. Names that do not start with a job id are
// returned with an empty JobID so the sweeper can treat them as strays.
func (s *Storage) List() ([]Entry, error) {
	var out []Entry

	add := func(dir string, kind Kind, skip string) error {
		items, err := os.ReadDir(dir)
		if err != nil {
			return err
		}
		for _, it := range items {
			if it.Name() == skip {
				continue
			}
			info, err := it.Info()
			if err != nil {
				continue
			}
			kindOf := kind
			if kind == KindInput && it.IsDir() {
				continue
			}
			out = append(out, Entry{
				Kind:    kindOf,
				JobID:   jobIDOf(it.Name()),
				Name:    it.Name(),
				Path:    filepath.Join(dir, it.Name()),
				ModTime: info.ModTime(),
			})
		}
		return nil
	}

	if err := add(s.inputsDir, KindInput, "parts"); err != nil {
		return nil, err
	}
	if err := add(s.outputsDir, KindOutput, ""); err != nil {
		return nil, err
	}
	if _, err := os.Stat(s.partsDir); err == nil {
		if err := add(s.partsDir, KindParts, ""); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// jobIDOf returns the leading UUID of a stored name, or "" if there is none.
func jobIDOf(name string) string {
	if len(name) < 36 {
		return ""
	}
	id := name[:36]
	if len(name) > 36 && name[36] != '.' {
		return ""
	}
	for i, c := range id {
		switch {
		case i == 8 || i == 13 || i == 18 || i == 23:
			if c != '-' {
				return ""
			}
		case !strings.ContainsRune("0123456789abcdef", c):
			return ""
		}
	}
	return id
}

func (s *Storage) Remove(e Entry) {
	os.RemoveAll(e.Path)
}
