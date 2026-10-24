// Package testdb gives integration tests a fresh, migrated Postgres database.
package testdb

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"testing"

	"fileforge/internal/database"

	"github.com/google/uuid"
)

// New skips the test unless TEST_DATABASE_URL points at a Postgres server where the caller may
// create databases, then returns a handle to a new, migrated database that is dropped afterwards.
func New(t *testing.T) *database.DB {
	t.Helper()

	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		if os.Getenv("REQUIRE_DB") != "" {
			t.Fatal("TEST_DATABASE_URL not set but REQUIRE_DB is")
		}
		t.Skip("TEST_DATABASE_URL not set; skipping Postgres integration test")
	}
	admin, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}

	conn, err := sql.Open("postgres", admin.String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	name := "ilc_test_" + uuid.NewString()[:8]
	if _, err := conn.Exec(`CREATE DATABASE ` + name); err != nil {
		t.Fatalf("create database: %v", err)
	}
	t.Cleanup(func() {
		c, err := sql.Open("postgres", admin.String())
		if err != nil {
			return
		}
		defer c.Close()
		c.Exec(`DROP DATABASE IF EXISTS ` + name + ` WITH (FORCE)`)
	})

	u := *admin
	u.Path = "/" + name
	db, err := database.New(u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	if err := db.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}
