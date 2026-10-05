package storage

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
)

type Storage struct {
	basePath   string
	inputsDir  string
	outputsDir string
	partsDir   string
}

func New(basePath string) (*Storage, error) {
	s := &Storage{
		basePath:   basePath,
		inputsDir:  filepath.Join(basePath, "inputs"),
		outputsDir: filepath.Join(basePath, "outputs"),
		partsDir:   filepath.Join(basePath, "inputs", "parts"),
	}

	for _, dir := range []string{s.inputsDir, s.outputsDir} {
		if err := os.MkdirAll(dir, 0777); err != nil {
			return nil, fmt.Errorf("create storage dir %s: %w", dir, err)
		}
		os.Chmod(dir, 0777)
	}

	return s, nil
}

func (s *Storage) InputPath(jobID string) string {
	return filepath.Join(s.inputsDir, jobID)
}

func (s *Storage) OutputPath(jobID string) string {
	return filepath.Join(s.outputsDir, jobID)
}

func (s *Storage) InputExists(jobID string) bool {
	_, err := os.Stat(s.InputPath(jobID))
	return err == nil
}

func (s *Storage) OutputExists(jobID string) bool {
	_, err := os.Stat(s.OutputPath(jobID))
	return err == nil
}

func (s *Storage) DeleteInput(jobID string) {
	os.Remove(s.InputPath(jobID))
}

func (s *Storage) DeleteJobFiles(jobID string) {
	os.Remove(s.InputPath(jobID))
	os.Remove(s.OutputPath(jobID))
	s.DeleteParts(jobID)
}

func (s *Storage) partPath(jobID string, index int) string {
	return filepath.Join(s.partsDir, jobID, strconv.Itoa(index))
}

func (s *Storage) CreatePart(jobID string, index int) (*os.File, error) {
	dir := filepath.Join(s.partsDir, jobID)
	if err := os.MkdirAll(dir, 0777); err != nil {
		return nil, fmt.Errorf("create parts dir %s: %w", dir, err)
	}
	f, err := os.OpenFile(s.partPath(jobID, index)+".tmp", os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0666)
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

func (s *Storage) CreateInput(jobID string) (*os.File, error) {
	p := s.InputPath(jobID)
	f, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0666)
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

func (s *Storage) OpenOutput(jobID string) (*os.File, error) {
	p := s.OutputPath(jobID)
	f, err := os.Open(p)
	if err != nil {
		return nil, fmt.Errorf("open output %s: %w", p, err)
	}
	return f, nil
}

func (s *Storage) FileSize(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

func (s *Storage) UsedBytes() (int64, error) {
	var total int64
	err := filepath.WalkDir(s.basePath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			info, err := d.Info()
			if err != nil {
				return nil
			}
			total += info.Size()
		}
		return nil
	})
	return total, err
}

func (s *Storage) UsedMB() int64 {
	bytes, _ := s.UsedBytes()
	return bytes / (1024 * 1024)
}
