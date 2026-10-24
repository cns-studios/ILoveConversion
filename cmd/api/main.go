package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"fileforge/internal/config"
	"fileforge/internal/database"
	"fileforge/internal/metrics"
	"fileforge/internal/storage"
	"fileforge/internal/tmpfs"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type app struct {
	cfg     *config.Config
	db      *database.DB
	store   *storage.Storage
	metrics *metrics.Metrics

	// bg outlives requests; background assemblies run under it and are waited for on shutdown.
	bg         context.Context
	assembling sync.WaitGroup
}

func (a *app) backgroundCtx() context.Context {
	if a.bg == nil {
		return context.Background()
	}
	return a.bg
}

func main() {
	migrateOnly := flag.Bool("migrate-only", false, "apply database migrations and exit")
	flag.Parse()

	log.SetFlags(log.LstdFlags)
	log.Println("FileForge API starting...")

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Config error: %v", err)
	}
	log.Printf("Config loaded (max file size: %d MB, retention: %dh)",
		cfg.MaxFileSize/(1024*1024), cfg.FileRetentionHours)

	db, err := database.New(cfg.DSN())
	if err != nil {
		log.Fatalf("Database error: %v", err)
	}
	defer db.Close()

	if *migrateOnly {
		if err := db.Migrate(context.Background()); err != nil {
			log.Fatalf("Migration error: %v", err)
		}
		log.Println("Migrations complete")
		return
	}

	if err := requireTmpfs(os.TempDir()); err != nil {
		log.Fatalf("%v", err)
	}

	store, err := storage.New(cfg.StoragePath)
	if err != nil {
		log.Fatalf("Storage error: %v", err)
	}
	log.Printf("Storage ready at %s", cfg.StoragePath)

	a := &app{
		cfg:     cfg,
		db:      db,
		store:   store,
		metrics: metrics.New(),
	}
	a.metrics.RegisterQueue(db)

	r := a.buildRouter()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bgCtx, bgCancel := context.WithCancel(context.Background())
	defer bgCancel()
	a.bg = bgCtx
	go a.resumeLoop(ctx)
	go a.startCleanup(ctx)

	// Metrics stay off the public listener: /metrics is for the cluster network only.
	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", a.metrics.Handler())
	metricsSrv := &http.Server{Addr: cfg.MetricsAddr, Handler: metricsMux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := metricsSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Metrics listener error: %v", err)
		}
	}()

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.APIPort),
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       10 * time.Minute,
		WriteTimeout:      10 * time.Minute,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("API server listening on :%d", cfg.APIPort)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-done
	log.Println("Shutting down API server...")
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	metricsSrv.Shutdown(shutdownCtx)
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("Shutdown error: %v", err)
	}
	// Let running assemblies finish within the grace period; the rest is resumed by other replicas.
	waited := make(chan struct{})
	go func() { a.assembling.Wait(); close(waited) }()
	select {
	case <-waited:
	case <-shutdownCtx.Done():
		log.Println("Assemblies still running at shutdown; they will be resumed elsewhere")
	}
	bgCancel()
	log.Println("API server stopped.")
}

func (a *app) buildRouter() chi.Router {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(requestLogger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5))

	r.Route("/api", func(r chi.Router) {
		r.Get("/live", a.handleLive)
		r.Get("/health", a.handleHealth)
		r.Get("/formats", a.handleFormats)
		r.Get("/admin/stats", a.handleAdminStats)

		r.With(a.sessionMiddleware(true)).Post("/jobs", a.handleCreateJob)

		r.With(a.sessionMiddleware(true)).Post("/uploads", a.handleInitUpload)

		r.Group(func(r chi.Router) {
			r.Use(a.sessionMiddleware(false))

			r.Put("/uploads/{id}/chunks/{index}", a.handleUploadChunk)
			r.Post("/uploads/{id}/complete", a.handleCompleteUpload)

			r.Get("/jobs/{id}", a.handleGetJob)
			r.Get("/jobs/{id}/download", a.handleDownload)
			r.Delete("/jobs/{id}", a.handleDeleteJob)
		})
	})

	r.Handle("/*", newStaticSite())

	return r
}

// requireTmpfs enforces that anything the process spills to its temp directory lands in memory.
// ALLOW_DISK_TMP=true opts out, for development only.
func requireTmpfs(dir string) error {
	if err := tmpfs.Check(dir); err != nil {
		if os.Getenv("ALLOW_DISK_TMP") == "true" {
			log.Printf("WARNING: %v; plaintext may touch disk (ALLOW_DISK_TMP=true)", err)
			return nil
		}
		return fmt.Errorf("%w: mount a memory-backed volume there or set ALLOW_DISK_TMP=true for development", err)
	}
	return nil
}
