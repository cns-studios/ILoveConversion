package main

import (
	"testing"
	"time"

	"fileforge/internal/database"
	"fileforge/internal/models"
	"fileforge/internal/storage"
)

func TestIsOrphan(t *testing.T) {
	const id = "6f1c2d3e-0000-4000-8000-000000000001"
	now := time.Now()
	old := now.Add(-4 * time.Hour)
	fresh := now.Add(-time.Hour)

	state := func(status, out string) *database.JobFileState {
		return &database.JobFileState{Status: status, OutputName: out}
	}

	tests := []struct {
		name  string
		entry storage.Entry
		st    *database.JobFileState
		want  bool
	}{
		{"fresh file without a row is spared", storage.Entry{Kind: storage.KindInput, JobID: id, ModTime: fresh}, nil, false},
		{"old input without a row", storage.Entry{Kind: storage.KindInput, JobID: id, ModTime: old}, nil, true},
		{"old output without a row", storage.Entry{Kind: storage.KindOutput, JobID: id, ModTime: old}, nil, true},
		{"stray name without a job id", storage.Entry{Kind: storage.KindOutput, ModTime: old}, nil, true},
		{"live output of a completed job", storage.Entry{Kind: storage.KindOutput, JobID: id, Name: id + ".tok1", ModTime: old},
			state(models.StatusCompleted, id+".tok1"), false},
		{"loser output of a completed job", storage.Entry{Kind: storage.KindOutput, JobID: id, Name: id + ".tok2", ModTime: old},
			state(models.StatusCompleted, id+".tok1"), true},
		{"fresh loser output is spared", storage.Entry{Kind: storage.KindOutput, JobID: id, Name: id + ".tok2", ModTime: fresh},
			state(models.StatusCompleted, id+".tok1"), false},
		{"output of a failed job", storage.Entry{Kind: storage.KindOutput, JobID: id, Name: id + ".tok2", ModTime: old},
			state(models.StatusFailed, ""), true},
		{"in-flight output is kept", storage.Entry{Kind: storage.KindOutput, JobID: id, Name: id + ".tok2", ModTime: old},
			state(models.StatusProcessing, ""), false},
		{"abandoned assembly of a pending job", storage.Entry{Kind: storage.KindInput, JobID: id, Name: id + ".ab12.assembling", ModTime: old},
			state(models.StatusPending, ""), true},
		{"recent assembly of a pending job", storage.Entry{Kind: storage.KindInput, JobID: id, Name: id + ".ab12.assembling", ModTime: fresh},
			state(models.StatusPending, ""), false},
		{"output referenced by output_name survives a long age", storage.Entry{Kind: storage.KindOutput, JobID: id, Name: id + ".tok1", ModTime: now.Add(-48 * time.Hour)},
			state(models.StatusCompleted, id+".tok1"), false},
		{"legacy output named by job id", storage.Entry{Kind: storage.KindOutput, JobID: id, Name: id, ModTime: old},
			state(models.StatusCompleted, id), false},
		{"input of a pending job is kept", storage.Entry{Kind: storage.KindInput, JobID: id, ModTime: old},
			state(models.StatusPending, ""), false},
		{"input left behind by a completed job", storage.Entry{Kind: storage.KindInput, JobID: id, ModTime: old},
			state(models.StatusCompleted, id+".tok1"), true},
		{"parts of a pending job are kept", storage.Entry{Kind: storage.KindParts, JobID: id, ModTime: old},
			state(models.StatusPending, ""), false},
		{"parts of a processing job", storage.Entry{Kind: storage.KindParts, JobID: id, ModTime: old},
			state(models.StatusProcessing, ""), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isOrphan(tt.entry, tt.st, now); got != tt.want {
				t.Errorf("isOrphan = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestUploadChunkSizeStaysUnderCloudflareLimit(t *testing.T) {
	const cloudflareLimit = 100 << 20
	if uploadChunkSize < 8<<20 || uploadChunkSize > 32<<20 {
		t.Errorf("uploadChunkSize = %d, want within 8–32 MiB", uploadChunkSize)
	}
	if uploadChunkSize >= cloudflareLimit {
		t.Errorf("uploadChunkSize %d reaches Cloudflare's %d limit", uploadChunkSize, cloudflareLimit)
	}
}
