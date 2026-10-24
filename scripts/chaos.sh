#!/usr/bin/env bash
# Chaos test: push video-compress jobs through the real upload/poll API while pods are deleted
# at random, then check that every job still ends up completed with a downloadable result.
#
#   BASE_URL=https://ilc.example.com NAMESPACE=ilc scripts/chaos.sh
#
# Needs kubectl (pointed at the cluster), curl, ffmpeg and jq. The cluster is disturbed for real:
# run it against a test deployment, not production.
set -euo pipefail

BASE_URL=${BASE_URL:?set BASE_URL, e.g. https://ilc.example.com}
NAMESPACE=${NAMESPACE:-ilc}
JOBS=${JOBS:-3}
KILL_EVERY=${KILL_EVERY:-20}         # seconds between pod deletions
TIMEOUT=${TIMEOUT:-1800}             # seconds each job may take end to end
KILL_PATTERN=${KILL_PATTERN:-'worker|api|postgres'}

work=$(mktemp -d)
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$work"' EXIT

echo "generating test video..."
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=440 -t 90 -c:v libx264 -crf 14 -c:a aac -y "$work/in.mp4"
size=$(stat -c %s "$work/in.mp4")
echo "input: $size bytes"

# Retry like the browser does: any network error or 5xx/408/429/499 is waited out.
req() { # method url [curl args...] -> body on stdout, status in $work/status
  local method=$1 url=$2; shift 2
  local deadline=$((SECONDS + 600)) code
  while :; do
    code=$(curl -sS -o "$work/body-$TAG" -w '%{http_code}' -X "$method" "$@" "$url" 2>/dev/null) || code=000
    case $code in 000|408|429|499|5??) ;; *) echo "$code" >"$work/status-$TAG"; cat "$work/body-$TAG"; return 0;; esac
    ((SECONDS < deadline)) || { echo "$code" >"$work/status-$TAG"; return 1; }
    sleep 2
  done
}

run_job() {
  TAG=$1   # each job runs in its own subshell, so this global is per job
  local n=$1 start=$SECONDS
  local init id chunks chunk_size
  init=$(req POST "$BASE_URL/api/uploads" \
    -d operation=video_compress -d "filename=chaos-$n.mp4" -d "size=$size" -d quality=50)
  id=$(jq -r .id <<<"$init"); chunks=$(jq -r .chunks <<<"$init"); chunk_size=$(jq -r .chunk_size <<<"$init")
  for ((i = 0; i < chunks; i++)); do
    dd if="$work/in.mp4" of="$work/chunk-$n" bs="$chunk_size" skip="$i" count=1 2>/dev/null
    req PUT "$BASE_URL/api/uploads/$id/chunks/$i" --data-binary "@$work/chunk-$n" >/dev/null
    [[ $(<"$work/status-$TAG") == 204 ]] || { echo "job $n: chunk $i got $(<"$work/status-$TAG")"; return 1; }
  done
  req POST "$BASE_URL/api/uploads/$id/complete" >/dev/null || true
  # A repeat of complete that lands after the first one succeeded answers 409; that is fine.
  [[ $(<"$work/status-$TAG") =~ ^(202|409)$ ]] || { echo "job $n: complete got $(<"$work/status-$TAG")"; return 1; }

  while ((SECONDS - start < TIMEOUT)); do
    local st; st=$(req GET "$BASE_URL/api/jobs/$id") || { sleep 2; continue; }
    case $(jq -r .status <<<"$st" 2>/dev/null) in
      completed)
        local out; out=$(jq -r .output_size <<<"$st")
        local got; got=$(curl -sS -o /dev/null -w '%{size_download}' --retry 30 --retry-all-errors --retry-delay 2 "$BASE_URL/api/jobs/$id/download")
        [[ $got == "$out" ]] || { echo "job $n: download $got bytes, expected $out"; return 1; }
        echo "job $n: OK ($size -> $out bytes, $((SECONDS - start))s)"; return 0;;
      failed) echo "job $n: FAILED: $(jq -r .error_message <<<"$st")"; return 1;;
    esac
    sleep 2
  done
  echo "job $n: timed out"; return 1
}

(
  while sleep "$KILL_EVERY"; do
    pod=$(kubectl -n "$NAMESPACE" get pods -o name | grep -E "$KILL_PATTERN" | shuf -n1 || true)
    [[ -n $pod ]] || continue
    echo "chaos: deleting $pod"
    kubectl -n "$NAMESPACE" delete "$pod" --wait=false >/dev/null || true
  done
) &

pids=()
for ((n = 1; n <= JOBS; n++)); do run_job "$n" & pids+=($!); done
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done

if ((fail)); then echo "CHAOS TEST FAILED"; exit 1; fi
echo "all $JOBS jobs completed despite pod deletions"
