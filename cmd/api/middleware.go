package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"fileforge/internal/models"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type contextKey string

const sessionCtxKey contextKey = "session"

func sessionFromCtx(r *http.Request) *models.Session {
	s, _ := r.Context().Value(sessionCtxKey).(*models.Session)
	return s
}

func (a *app) sessionMiddleware(count bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := clientIP(r, a.cfg.TrustedProxies, a.cfg.ClientIPHeader)
			if ip == "" {
				writeError(w, http.StatusBadRequest, "Could not determine client IP")
				return
			}

			session, err := a.db.TouchSession(r.Context(), ip, count, a.cfg.FlagThreshold)
			if err != nil {
				log.Printf("[session] touch error: %v", err)
				writeError(w, http.StatusInternalServerError, "Session error")
				return
			}

			if session.IsFlagged {
				log.Printf("[session] Blocked flagged client")
				writeError(w, http.StatusForbidden,
					"Access restricted. Too many requests from this IP.")
				return
			}

			if count && session.HourlyRequestCount > a.cfg.RateLimitPerHour {
				log.Printf("[session] Rate limited a client (%d/%d this hour)",
					session.HourlyRequestCount, a.cfg.RateLimitPerHour)

				retryAfter := int(time.Until(session.HourlyWindowStart.Add(time.Hour)).Seconds()) + 1
				if retryAfter < 1 {
					retryAfter = 1
				}
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				writeError(w, http.StatusTooManyRequests, fmt.Sprintf(
					"Rate limit exceeded. Please try again in %d minutes.", (retryAfter+59)/60))
				return
			}

			ctx := context.WithValue(r.Context(), sessionCtxKey, session)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		log.Printf("[json] encode error: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, models.ErrorResponse{Error: msg})
}

// requestLogger logs method, route pattern, status and duration. It deliberately omits the
// client address and the raw path: IPs and job ids stay out of the logs.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)

		route := "unmatched"
		if rc := chi.RouteContext(r.Context()); rc != nil && rc.RoutePattern() != "" {
			route = rc.RoutePattern()
		}
		status := ww.Status()
		if status == 0 {
			status = http.StatusOK
		}
		log.Printf("[http] %s %s %d %dB %v", r.Method, route, status, ww.BytesWritten(), time.Since(start).Round(time.Millisecond))
	})
}
