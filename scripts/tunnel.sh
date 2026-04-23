#!/usr/bin/env bash
# Persistent cloudflared tunnel helper.
#
#   pnpm tunnel         — start (detached, survives terminal close)
#   pnpm tunnel:stop    — stop
#   pnpm tunnel:status  — show current hostname + pid
#
# Prefers the named tunnel `artifactci-dev` (stable hostname
# artifactci.dev) if you've run the one-time setup:
#
#   cloudflared tunnel login
#   cloudflared tunnel create artifactci-dev
#   cloudflared tunnel route dns artifactci-dev artifactci.dev
#
# Falls back to a quick tunnel (random *.trycloudflare.com URL) if no
# named tunnel is configured, so first-run contributors still get a
# working dev loop.
set -euo pipefail

cmd="${1:-start}"
pid_file=.alchemy/tunnel.pid
url_file=.alchemy/tunnel-url.txt
log_file=.alchemy/logs/cloudflared.log
named_tunnel="${ARTIFACTCI_TUNNEL_NAME:-artifactci-dev}"
named_hostname="${ARTIFACTCI_TUNNEL_HOSTNAME:-https://artifactci.dev}"

alive() {
  [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

named_tunnel_exists() {
  cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -Fxq "$named_tunnel"
}

wait_for_quick_url() {
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

wait_for_named_ready() {
  local timeout=60
  for _ in $(seq 1 "$timeout"); do
    # cloudflared logs "Registered tunnel connection" once a connection is up.
    if grep -q "Registered tunnel connection" "$log_file" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

sync_webhook() {
  local url="$1"
  if [[ "${GITHUB_APP_WEBHOOK_SYNC:-1}" == "0" ]]; then
    return 0
  fi
  pnpm exec tsx scripts/sync-github-app-webhook.ts "$url" \
    || printf '[tunnel] webhook sync failed; point the GitHub App webhook at %s/github/events manually\n' "$url" >&2
}

start_named() {
  : >"$log_file"
  nohup cloudflared tunnel --no-autoupdate \
    run --url http://127.0.0.1:1337 "$named_tunnel" \
    >"$log_file" 2>&1 &
  pid=$!
  echo "$pid" >"$pid_file"
  if wait_for_named_ready; then
    printf '%s\n' "$named_hostname" >"$url_file"
    printf '[tunnel] named tunnel %s → %s (pid %s)\n' "$named_tunnel" "$named_hostname" "$pid"
    sync_webhook "$named_hostname"
  else
    printf '[tunnel] named tunnel %s did not come up; see %s\n' "$named_tunnel" "$log_file" >&2
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file"
    exit 1
  fi
}

start_quick() {
  : >"$log_file"
  nohup cloudflared tunnel --url http://127.0.0.1:1337 --no-autoupdate \
    >"$log_file" 2>&1 &
  pid=$!
  echo "$pid" >"$pid_file"
  if url=$(wait_for_quick_url); then
    printf '[tunnel] quick tunnel: %s (pid %s)\n' "$url" "$pid"
    printf '[tunnel] tip: run `cloudflared tunnel create %s && cloudflared tunnel route dns %s artifactci.dev` for a stable URL\n' "$named_tunnel" "$named_tunnel"
    sync_webhook "$url"
  else
    printf '[tunnel] quick tunnel did not surface a URL in time; see %s\n' "$log_file" >&2
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file"
    exit 1
  fi
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
    if named_tunnel_exists; then
      start_named
    else
      printf '[tunnel] named tunnel `%s` not found, falling back to quick tunnel\n' "$named_tunnel"
      start_quick
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
