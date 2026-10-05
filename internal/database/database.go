package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

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
