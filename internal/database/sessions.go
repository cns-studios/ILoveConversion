package database

import (
	"context"
	"fmt"

	"fileforge/internal/models"

	_ "github.com/lib/pq"
)

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
