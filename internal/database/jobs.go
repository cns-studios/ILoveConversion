package database

import (
	"context"
	"encoding/json"
	"fmt"
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
	created_at, started_at, completed_at, expires_at`

func scanJob(s scanner) (*models.Job, error) {
	var j models.Job
	err := s.Scan(
		&j.ID, &j.SessionID, &j.Operation, &j.Status,
		&j.InputFilename, &j.OutputFilename, &j.InputSize, &j.OutputSize,
		&j.OriginalName, &j.Params, &j.FileNonce, &j.ErrorMessage, &j.RetryCount,
		&j.CreatedAt, &j.StartedAt, &j.CompletedAt, &j.ExpiresAt,
	)
	if err != nil {
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
}

func (db *DB) CreateJob(ctx context.Context, p CreateJobParams, retentionHours int) (*models.Job, error) {
	jobID := uuid.New().String()

	paramsJSON, err := json.Marshal(p.Params)
	if err != nil {
		return nil, fmt.Errorf("marshal params: %w", err)
	}

	expiresAt := time.Now().Add(time.Duration(retentionHours) * time.Hour)

	row := db.pool.QueryRowContext(ctx, `
		INSERT INTO jobs (id, session_id, operation, input_filename, input_size, original_name, params, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+jobColumns,
		jobID, p.SessionID, p.Operation, jobID,
		p.InputSize, p.OriginalName, paramsJSON, expiresAt,
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

func (db *DB) UpdateJobStarted(ctx context.Context, jobID string) error {
	_, err := db.pool.ExecContext(ctx, `
		UPDATE jobs SET status = 'processing', started_at = NOW()
		WHERE id = $1
	`, jobID)
	if err != nil {
		return fmt.Errorf("update job started %s: %w", jobID, err)
	}
	return nil
}

func (db *DB) UpdateJobCompleted(ctx context.Context, jobID, outputFilename string, outputSize int64) error {
	_, err := db.pool.ExecContext(ctx, `
		UPDATE jobs
		SET status = 'completed',
			output_filename = $2,
			output_size = $3,
			completed_at = NOW()
		WHERE id = $1
	`, jobID, outputFilename, outputSize)
	if err != nil {
		return fmt.Errorf("update job completed %s: %w", jobID, err)
	}
	return nil
}

func (db *DB) UpdateJobFailed(ctx context.Context, jobID, errorMsg string) error {
	_, err := db.pool.ExecContext(ctx, `
		UPDATE jobs
		SET status = 'failed',
			error_message = $2,
			completed_at = NOW()
		WHERE id = $1
	`, jobID, errorMsg)
	if err != nil {
		return fmt.Errorf("update job failed %s: %w", jobID, err)
	}
	return nil
}

func (db *DB) IncrementRetryCount(ctx context.Context, jobID string) (int, error) {
	var count int
	err := db.pool.QueryRowContext(ctx, `
		UPDATE jobs SET retry_count = retry_count + 1, status = 'pending'
		WHERE id = $1
		RETURNING retry_count
	`, jobID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("increment retry %s: %w", jobID, err)
	}
	return count, nil
}

func (db *DB) DeleteJob(ctx context.Context, jobID string) (bool, error) {
	res, err := db.pool.ExecContext(ctx, `DELETE FROM jobs WHERE id = $1`, jobID)
	if err != nil {
		return false, fmt.Errorf("delete job %s: %w", jobID, err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func (db *DB) CleanupExpiredJobs(ctx context.Context) ([]string, error) {
	rows, err := db.pool.QueryContext(ctx,
		`DELETE FROM jobs WHERE expires_at < NOW() RETURNING id`)
	if err != nil {
		return nil, fmt.Errorf("cleanup expired jobs: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return ids, fmt.Errorf("scan expired job id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
