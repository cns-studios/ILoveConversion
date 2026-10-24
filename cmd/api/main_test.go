package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"fileforge/internal/metrics"
)

// /api/live must answer with no database, no storage and no config behind it.
func TestLiveHasNoDependencies(t *testing.T) {
	a := &app{metrics: metrics.New()}
	rec := httptest.NewRecorder()
	a.buildRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/live", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/api/live = %d, want 200", rec.Code)
	}
}
