#!/usr/bin/env bash
# Persistent cloudflared quick-tunnel helper.
#
#   pnpm tunnel         — start (detached, survives terminal close)
#   pnpm tunnel:stop    — stop
#   pnpm tunnel:status  — show current URL + pid
#
# Running `pnpm dev` will reuse an already-started tunnel's URL, so you
# can keep one tunnel alive across many dev sessions (webhook URL stays
# stable, no need to re-sync the GitHub App every time).
set -euo pipefail

cmd="${1:-start}"
pid_file=.alchemy/tunnel.pid
url_file=.alchemy/tunnel-url.txt
log_file=.alchemy/logs/cloudflared.log

alive() {
  [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

wait_for_url() {
  local timeout=120
  for _ in $(seq 1 "$timeout"); do
    local url
    url=$(grep -Eo 'https://[A-Za-z0-9.-]+\.trycloudflare\.com' "$log_file" 2>/dev/null | head -n1 || true)
    if [[ -n "$url" ]]; then
      printf '%s\n' "$url" >"$url_file"
      printf '%s\n' "$url"
      return 0
    fi
    sleep 1
  done
  return 1
}

case "$cmd" in
  start)
    if ! command -v cloudflared >/dev/null 2>&1; then
      printf 'cloudflared not installed. brew install cloudflared\n' >&2
      exit 1
    fi
    mkdir -p .alchemy/logs
    if alive; then
      printf '[tunnel] already running: %s (pid %s)\n' "$(cat "$url_file" 2>/dev/null || echo unknown)" "$(cat "$pid_file")"
      exit 0
    fi
    : >"$log_file"
    # Detach so the tunnel survives the terminal that started it.
    nohup cloudflared tunnel --url http://127.0.0.1:1337 --no-autoupdate \
      >"$log_file" 2>&1 &
    pid=$!
    # `disown` isn't in sh; nohup already handles SIGHUP. We just need the PID.
    echo "$pid" >"$pid_file"
    if url=$(wait_for_url); then
      printf '[tunnel] started: %s (pid %s)\n' "$url" "$pid"
    else
      printf '[tunnel] did not surface a URL in time; see %s\n' "$log_file" >&2
      kill "$pid" 2>/dev/null || true
      rm -f "$pid_file"
      exit 1
    fi
    ;;
  stop)
    if ! alive; then
      printf '[tunnel] not running\n'
      rm -f "$pid_file" "$url_file"
      exit 0
    fi
    pid=$(cat "$pid_file")
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file" "$url_file"
    printf '[tunnel] stopped (was pid %s)\n' "$pid"
    ;;
  status)
    if alive; then
      printf '[tunnel] running: %s (pid %s)\n' "$(cat "$url_file" 2>/dev/null || echo unknown)" "$(cat "$pid_file")"
    else
      printf '[tunnel] not running\n'
    fi
    ;;
  *)
    printf 'usage: tunnel.sh [start|stop|status]\n' >&2
    exit 1
    ;;
esac
