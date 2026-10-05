package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"fileforge/internal/models"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

type DB struct {
	pool *sql.DB
}

func New(dsn string) (*DB, error) {
	var pool *sql.DB
	var err error

	for attempt := 1; attempt <= 30; attempt++ {
		pool, err = sql.Open("postgres", dsn)
		if err != nil {
			log.Printf("[db] open attempt %d/30: %v", attempt, err)
			time.Sleep(time.Second)
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		err = pool.PingContext(ctx)
		cancel()

		if err == nil {
			break
		}

		pool.Close()
		log.Printf("[db] ping attempt %d/30: %v", attempt, err)
		time.Sleep(time.Second)
	}

	if err != nil {
		return nil, fmt.Errorf("database not ready after 30 attempts: %w", err)
	}

	pool.SetMaxOpenConns(25)
	pool.SetMaxIdleConns(5)
	pool.SetConnMaxLifetime(5 * time.Minute)

	log.Println("[db] Connected to PostgreSQL")
	return &DB{pool: pool}, nil
}

func (db *DB) Close() error {
	return db.pool.Close()
}

func (db *DB) Ping(ctx context.Context) error {
	return db.pool.PingContext(ctx)
}

func (db *DB) Migrate(ctx context.Context) error {
	tx, err := db.pool.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	defer tx.Rollback()

	var exists bool
	err = tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = 'sessions' AND column_name = 'hourly_window_start'
		)
	`).Scan(&exists)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if !exists {
		// Counts and flags from before this column existed included status polls
		// and lifetime totals, so they are reset once along with the schema change.
		_, err = tx.ExecContext(ctx, `
			ALTER TABLE sessions ADD COLUMN hourly_window_start TIMESTAMPTZ NOT NULL DEFAULT NOW();
			UPDATE sessions SET hourly_request_count = 0, is_flagged = FALSE;
		`)
		if err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
		log.Println("[db] Migrated sessions table (hourly_window_start)")
	}

	// Lifetime request totals per IP are no longer kept.
	err = tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = 'sessions' AND column_name = 'total_request_count'
		)
	`).Scan(&exists)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if exists {
		if _, err := tx.ExecContext(ctx, `ALTER TABLE sessions DROP COLUMN total_request_count`); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
		log.Println("[db] Dropped sessions.total_request_count")
	}

	return tx.Commit()
}

// TouchSession upserts the session for ip. With count set, the request is
// added to the current hourly window, which restarts once it is an hour old.
func (db *DB) TouchSession(ctx context.Context, ip string, count bool, flagThreshold int) (*models.Session, error) {
	var s models.Session

	n := 0
	if count {
		n = 1
	}

	err := db.pool.QueryRowContext(ctx, `
		INSERT INTO sessions (ip_address, hourly_request_count)
		VALUES ($1, $3::int)
		ON CONFLICT (ip_address) DO UPDATE SET
			last_request_at = NOW(),
			hourly_window_start = CASE
				WHEN sessions.hourly_window_start < NOW() - INTERVAL '1 hour' THEN NOW()
				ELSE sessions.hourly_window_start
			END,
			hourly_request_count = CASE
				WHEN sessions.hourly_window_start < NOW() - INTERVAL '1 hour' THEN $3::int
				ELSE sessions.hourly_request_count + $3::int
			END,
			is_flagged = sessions.is_flagged OR (
				sessions.hourly_window_start >= NOW() - INTERVAL '1 hour'
				AND sessions.hourly_request_count + $3::int >= $2::int
			)
		RETURNING id, ip_address::TEXT, created_at, last_request_at,
				  hourly_window_start, hourly_request_count, is_flagged
	`, ip, flagThreshold, n).Scan(
		&s.ID, &s.IPAddress, &s.CreatedAt, &s.LastRequestAt,
		&s.HourlyWindowStart, &s.HourlyRequestCount, &s.IsFlagged,
	)

	if err != nil {
		return nil, fmt.Errorf("touch session: %w", err)
	}
	return &s, nil
}

// CleanupInactiveSessions deletes sessions (and with them the stored IP address) that
// have seen no request for 24 hours. Sessions that still own jobs are kept until the
// job cleanup has removed those jobs and their files.
func (db *DB) CleanupInactiveSessions(ctx context.Context) (int64, error) {
	res, err := db.pool.ExecContext(ctx, `
		DELETE FROM sessions s
		WHERE s.last_request_at < NOW() - INTERVAL '24 hours'
		  AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.session_id = s.id)
	`)
	if err != nil {
		return 0, fmt.Errorf("cleanup inactive sessions: %w", err)
	}
	return res.RowsAffected()
}

func (db *DB) ResetHourlyCounts(ctx context.Context) (int64, error) {
	res, err := db.pool.ExecContext(ctx, `
		UPDATE sessions
		SET hourly_request_count = 0
		WHERE hourly_request_count > 0
		  AND hourly_window_start < NOW() - INTERVAL '1 hour'
	`)
	if err != nil {
		return 0, fmt.Errorf("reset hourly counts: %w", err)
	}
	return res.RowsAffected()
}

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


func (db *DB) GetAdminStats(ctx context.Context) (*models.AdminStats, error) {
	var s models.AdminStats

	err := db.pool.QueryRowContext(ctx, `SELECT * FROM admin_stats`).Scan(
		&s.QueueLength,
		&s.ActiveJobs,
		&s.Completed24h,
		&s.Failed24h,
		&s.ActiveSessions,
	)
	if err != nil {
		return nil, fmt.Errorf("get admin stats: %w", err)
	}
	return &s, nil
}