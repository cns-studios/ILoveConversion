package database

import (
	"context"
	"fmt"

	"fileforge/internal/models"

	_ "github.com/lib/pq"
)

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
