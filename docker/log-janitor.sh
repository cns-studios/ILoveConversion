#!/bin/sh
set -u

DAYS="${LOG_RETENTION_DAYS:-7}"
INTERVAL="${LOG_JANITOR_INTERVAL_SECONDS:-3600}"
ROOT=/containers
TMP=/tmp/kept.log

prune() {
    cutoff=$(date -u -d "@$(( $(date +%s) - DAYS * 86400 ))" +%Y-%m-%dT%H:%M:%S)

    for dir in "$ROOT"/*/; do
        grep -q '"ilc.log-retention":"true"' "${dir}config.v2.json" 2>/dev/null || continue

        for file in "$dir"*-json.log*; do
            [ -f "$file" ] || continue
            : > "$TMP"
            dropped=$(awk -v cutoff="$cutoff" -v out="$TMP" '
                match($0, /"time":"[^"]*"/) {
                    if (substr($0, RSTART + 8, RLENGTH - 9) < cutoff) { dropped++; next }
                }
                { print > out }
                END { print dropped + 0 }
            ' "$file")

            if [ "$dropped" -gt 0 ]; then
                cat "$TMP" > "$file"
                echo "[log-janitor] removed $dropped entries older than $DAYS days from $(basename "$file")"
            fi
        done
    done
    rm -f "$TMP"
}

trap 'exit 0' TERM INT

echo "[log-janitor] keeping $DAYS days of logs, checking every ${INTERVAL}s"
while true; do
    prune
    sleep "$INTERVAL" &
    wait $!
done
