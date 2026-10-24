// Package metrics holds the Prometheus instruments and the small internal HTTP listener that
// serves them. Labels are operation names and outcomes only: no IPs, no filenames, no job ids.
package metrics

import (
	"context"
	"net/http"
	"time"

	"fileforge/internal/database"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Metrics struct {
	Registry *prometheus.Registry

	Claims         prometheus.Counter
	Reclaims       prometheus.Counter
	JobDuration    *prometheus.HistogramVec
	JobFailures    *prometheus.CounterVec
	LockLost       prometheus.Counter
	CleanupLastOK  prometheus.Gauge
	ExpiredRemoved prometheus.Counter
	OrphansRemoved prometheus.Counter
}

func New() *Metrics {
	reg := prometheus.NewRegistry()
	reg.MustRegister(collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))

	m := &Metrics{
		Registry: reg,
		Claims: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "ilc_job_claims_total", Help: "Jobs claimed by this process.",
		}),
		Reclaims: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "ilc_job_reclaims_total", Help: "Claims that took over a job whose lease had expired.",
		}),
		JobDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "ilc_job_duration_seconds",
			Help:    "Wall time of one job attempt, by operation and outcome.",
			Buckets: []float64{1, 2, 5, 10, 30, 60, 120, 300, 600, 1800},
		}, []string{"operation", "outcome"}),
		JobFailures: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "ilc_job_failures_total", Help: "Failed job attempts, by operation and what happened to the job.",
		}, []string{"operation", "result"}),
		LockLost: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "ilc_job_lock_lost_total", Help: "Attempts abandoned because the lease was lost.",
		}),
		CleanupLastOK: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "ilc_cleanup_last_success_timestamp_seconds", Help: "Unix time of the last cleanup pass that finished without error.",
		}),
		ExpiredRemoved: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "ilc_cleanup_expired_jobs_total", Help: "Expired jobs deleted, with their files.",
		}),
		OrphansRemoved: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "ilc_cleanup_orphan_files_total", Help: "Files removed by the orphan sweep.",
		}),
	}
	reg.MustRegister(m.Claims, m.Reclaims, m.JobDuration, m.JobFailures, m.LockLost,
		m.CleanupLastOK, m.ExpiredRemoved, m.OrphansRemoved)
	return m
}

// RegisterQueue adds gauges sampled from the database at scrape time. Every replica reports the
// same numbers, so aggregate with max() rather than sum().
func (m *Metrics) RegisterQueue(db *database.DB) {
	m.Registry.MustRegister(&queueCollector{
		db:      db,
		depth:   prometheus.NewDesc("ilc_queue_depth", "Jobs waiting to be claimed.", nil, nil),
		active:  prometheus.NewDesc("ilc_jobs_processing", "Jobs currently leased by a worker.", nil, nil),
		oldest:  prometheus.NewDesc("ilc_queue_oldest_pending_age_seconds", "Age of the oldest job that is due and unclaimed.", nil, nil),
		storage: prometheus.NewDesc("ilc_storage_bytes", "Bytes held on the shared volume, tracked from job rows.", nil, nil),
	})
}

type queueCollector struct {
	db                             *database.DB
	depth, active, oldest, storage *prometheus.Desc
}

func (c *queueCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.depth
	ch <- c.active
	ch <- c.oldest
	ch <- c.storage
}

func (c *queueCollector) Collect(ch chan<- prometheus.Metric) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	s, err := c.db.GetQueueStats(ctx)
	if err != nil {
		ch <- prometheus.NewInvalidMetric(c.depth, err)
		return
	}
	ch <- prometheus.MustNewConstMetric(c.depth, prometheus.GaugeValue, float64(s.Pending))
	ch <- prometheus.MustNewConstMetric(c.active, prometheus.GaugeValue, float64(s.Processing))
	ch <- prometheus.MustNewConstMetric(c.oldest, prometheus.GaugeValue, s.OldestPendingAgeS)
	ch <- prometheus.MustNewConstMetric(c.storage, prometheus.GaugeValue, float64(s.StorageBytes))
}

// Handler serves /metrics.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.Registry, promhttp.HandlerOpts{})
}
