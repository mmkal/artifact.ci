#!/usr/bin/env bash
# Cloudflared tunnel daemon helper.
#
#   pnpm tunnel         — start (detached, survives terminal close)
#   pnpm tunnel:stop    — stop
#   pnpm tunnel:status  — show current hostname + pid
#
# Preferred path: alchemy.run.ts provisions a remotely-managed tunnel via
# Cloudflare's API (using the same credentials it uses for Worker deploys)
# and writes the runner token to .alchemy/tunnel-token.txt plus the public
# hostname to .alchemy/tunnel-url.txt. We just invoke `cloudflared tunnel
# run --token <token>` — no `cloudflared tunnel login`, no origin cert,
# no manual DNS.
#
# Fallbacks, in order:
#   1. Locally-managed named tunnel (the older flow; requires
#      `cloudflared tunnel login` + `create` + `route dns`).
#   2. Quick tunnel (random *.trycloudflare.com URL).
set -euo pipefail

cmd="${1:-start}"
pid_file=.alchemy/tunnel.pid
url_file=.alchemy/tunnel-url.txt
token_file=.alchemy/tunnel-token.txt
log_file=.alchemy/logs/cloudflared.log
named_tunnel="${ARTIFACTCI_TUNNEL_NAME:-artifactci-dev}"

alive() {
  [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

wait_for_token_file() {
  local timeout="${1:-60}"
  for _ in $(seq 1 "$timeout"); do
    if [[ -s "$token_file" && -s "$url_file" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_cloudflared_ready() {
  local timeout="${1:-60}"
  for _ in $(seq 1 "$timeout"); do
    if grep -q "Registered tunnel connection" "$log_file" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_quick_url() {
  local timeout="${1:-120}"
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

sync_webhook() {
  local url="$1"
  if [[ "${GITHUB_APP_WEBHOOK_SYNC:-1}" == "0" ]]; then
    return 0
  fi
  pnpm exec tsx scripts/sync-github-app-webhook.ts "$url" \
    || printf '[tunnel] webhook sync failed; point the GitHub App webhook at %s/github/events manually\n' "$url" >&2
}

start_with_token() {
  : >"$log_file"
  local token
  token=$(cat "$token_file")
  nohup cloudflared tunnel --no-autoupdate run --token "$token" \
    >"$log_file" 2>&1 &
  pid=$!
  echo "$pid" >"$pid_file"
  if wait_for_cloudflared_ready; then
    local url
    url=$(cat "$url_file")
    printf '[tunnel] connected: %s (pid %s)\n' "$url" "$pid"
    sync_webhook "$url"
  else
    printf '[tunnel] did not report a registered connection; see %s\n' "$log_file" >&2
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file"
    exit 1
  fi
}

named_tunnel_exists() {
  cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -Fxq "$named_tunnel"
}

start_named_via_origin_cert() {
  : >"$log_file"
  nohup cloudflared tunnel --no-autoupdate run \
    --url http://127.0.0.1:1337 "$named_tunnel" \
    >"$log_file" 2>&1 &
  pid=$!
  echo "$pid" >"$pid_file"
  if wait_for_cloudflared_ready; then
    local url
    url=${ARTIFACTCI_TUNNEL_HOSTNAME:-https://artifactci.dev}
    printf '%s\n' "$url" >"$url_file"
    printf '[tunnel] connected (named): %s (pid %s)\n' "$url" "$pid"
    sync_webhook "$url"
  else
    printf '[tunnel] named tunnel did not connect; see %s\n' "$log_file" >&2
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
    printf '[tunnel] tip: run alchemy (pnpm dev:server) to provision a stable artifactci.dev tunnel automatically\n'
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

    # Prefer alchemy-managed tunnel (token in .alchemy/tunnel-token.txt).
    # Wait a few seconds in case alchemy is still provisioning it.
    if [[ -s "$token_file" && -s "$url_file" ]] || wait_for_token_file 3; then
      start_with_token
    elif named_tunnel_exists; then
      start_named_via_origin_cert
    else
      printf '[tunnel] no alchemy-managed tunnel token and no local named tunnel found; falling back to quick tunnel\n'
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
    rm -f "$pid_file"
    # Keep url_file / token_file — they belong to the alchemy resource state.
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
