package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"fileforge/internal/models"
)

type contextKey string

const sessionCtxKey contextKey = "session"

func sessionFromCtx(r *http.Request) *models.Session {
	s, _ := r.Context().Value(sessionCtxKey).(*models.Session)
	return s
}

// sessionMiddleware attaches the caller's session and blocks flagged IPs.
// Only routes built with count=true are charged against the hourly limit, so
// status polls and downloads of an existing job don't use it up.
func (a *app) sessionMiddleware(count bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := clientIP(r)
			if ip == "" {
				writeError(w, http.StatusBadRequest, "Could not determine client IP")
				return
			}

			session, err := a.db.TouchSession(r.Context(), ip, count, a.cfg.FlagThreshold)
			if err != nil {
				log.Printf("[session] touch error for %s: %v", ip, err)
				writeError(w, http.StatusInternalServerError, "Session error")
				return
			}

			if session.IsFlagged {
				log.Printf("[session] Blocked flagged IP: %s", ip)
				writeError(w, http.StatusForbidden,
					"Access restricted. Too many requests from this IP.")
				return
			}

			if count && session.HourlyRequestCount > a.cfg.RateLimitPerHour {
				log.Printf("[session] Rate limited: %s (%d/%d this hour)",
					ip, session.HourlyRequestCount, a.cfg.RateLimitPerHour)

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

func clientIP(r *http.Request) string {
	if ip := strings.TrimSpace(r.Header.Get("X-Real-IP")); ip != "" {
		return ip
	}

	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		if ip := strings.TrimSpace(parts[0]); ip != "" {
			return ip
		}
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
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