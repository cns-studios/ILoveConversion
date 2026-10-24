package database

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"fileforge/internal/models"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

type scanner interface {
	Scan(dest ...interface{}) error
}

const jobColumns = `id, session_id, operation, status,
	input_filename, output_filename, input_size, output_size,
	original_name, params, file_nonce, error_message, retry_count,
	created_at, started_at, completed_at, expires_at,
	queued_at, run_after, locked_until, lock_token, key_id, output_name`

func prefixedJobColumns(alias string) string {
	cols := strings.Split(jobColumns, ",")
	for i, c := range cols {
		cols[i] = alias + "." + strings.TrimSpace(c)
	}
	return strings.Join(cols, ", ")
}

func scanJob(s scanner) (*models.Job, error) {
	return scanJobExtra(s)
}

// scanJobExtra scans the job columns followed by any extra destinations.
func scanJobExtra(s scanner, extra ...interface{}) (*models.Job, error) {
	var j models.Job
	dest := []interface{}{
		&j.ID, &j.SessionID, &j.Operation, &j.Status,
		&j.InputFilename, &j.OutputFilename, &j.InputSize, &j.OutputSize,
		&j.OriginalName, &j.Params, &j.FileNonce, &j.ErrorMessage, &j.RetryCount,
		&j.CreatedAt, &j.StartedAt, &j.CompletedAt, &j.ExpiresAt,
		&j.QueuedAt, &j.RunAfter, &j.LockedUntil, &j.LockToken, &j.KeyID, &j.OutputName,
	}
	if err := s.Scan(append(dest, extra...)...); err != nil {
		return nil, err
	}
	return &j, nil
}

type CreateJobParams struct {
	SessionID    string
	Operation    string
	OriginalName string
	InputSize    int64
	Params       models.JobParams
	KeyID        string
}

func (db *DB) CreateJob(ctx context.Context, p CreateJobParams, retentionHours int) (*models.Job, error) {
	jobID := uuid.New().String()

	paramsJSON, err := json.Marshal(p.Params)
	if err != nil {
		return nil, fmt.Errorf("marshal params: %w", err)
	}

	expiresAt := time.Now().Add(time.Duration(retentionHours) * time.Hour)

	row := db.pool.QueryRowContext(ctx, `
		INSERT INTO jobs (id, session_id, operation, input_filename, input_size, original_name, params, expires_at, key_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING `+jobColumns,
		jobID, p.SessionID, p.Operation, jobID,
		p.InputSize, p.OriginalName, paramsJSON, expiresAt, p.KeyID,
	)

	return scanJob(row)
}

func (db *DB) GetJob(ctx context.Context, jobID string) (*models.Job, error) {
	row := db.pool.QueryRowContext(ctx,
		`SELECT `+jobColumns+` FROM jobs WHERE id = $1`, jobID)

	j, err := scanJob(row)
	if err != nil {
		return nil, fmt.Errorf("get job %s: %w", jobID, err)
	}
	return j, nil
}

func (db *DB) DeleteJob(ctx context.Context, jobID string) (bool, error) {
	res, err := db.pool.ExecContext(ctx, `DELETE FROM jobs WHERE id = $1`, jobID)
	if err != nil {
		return false, fmt.Errorf("delete job %s: %w", jobID, err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}
