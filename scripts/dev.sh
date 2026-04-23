#!/usr/bin/env bash
set -euo pipefail

tunnel_mode="${CLOUDFLARE_TUNNEL:-quick}"
tunnel_url_file=.alchemy/tunnel-url.txt
tunnel_log=.alchemy/logs/cloudflared.log

cleanup() {
  if [[ -n "${server_pid:-}" ]]; then
    kill "$server_pid" 2>/dev/null || true
  fi
  if [[ -n "${tunnel_pid:-}" ]]; then
    kill "$tunnel_pid" 2>/dev/null || true
  fi
}

on_signal() {
  cleanup
  exit 130
}

trap cleanup EXIT
trap on_signal INT TERM

pkill -f "alchemy dev" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
for port in 1337 1355 43111 43112; do
  lsof -ti tcp:"$port" | xargs kill -9 2>/dev/null || true
done

portless proxy start >/dev/null 2>&1 || true
portless alias artifactci 1337 >/dev/null 2>&1 || true

rm -rf .alchemy apps/app/.alchemy apps/docs/.alchemy apps/docs/.astro apps/docs/.wrangler apps/docs/dist
mkdir -p .alchemy/logs apps/docs/dist
# minimal placeholder so python http.server + alchemy Website have something
# to serve while we're skipping the broken astro build.
printf '<!doctype html><title>artifact.ci</title><h1>artifact.ci docs (dev placeholder)</h1>' \
  > apps/docs/dist/index.html
touch \
  .alchemy/logs/artifact-ci-mmkal-app.log \
  .alchemy/logs/artifact-ci-mmkal-docs.log \
  .alchemy/logs/artifact-ci-mmkal-frontdoor.log
rm -f "$tunnel_url_file" "$tunnel_log"

start_quick_tunnel() {
  if ! command -v cloudflared >/dev/null 2>&1; then
    printf '[dev] cloudflared not found; skipping public tunnel. Install with: brew install cloudflared\n' >&2
    return
  fi
  : >"$tunnel_log"
  cloudflared tunnel --url http://127.0.0.1:1337 --no-autoupdate >"$tunnel_log" 2>&1 &
  tunnel_pid=$!

  for _ in $(seq 1 120); do
    if url=$(grep -Eo 'https://[A-Za-z0-9.-]+\.trycloudflare\.com' "$tunnel_log" | head -n1); then
      if [[ -n "$url" ]]; then
        printf '%s\n' "$url" >"$tunnel_url_file"
        printf '[dev] public tunnel: %s\n' "$url"
        return
      fi
    fi
    sleep 1
  done

  printf '[dev] cloudflared did not surface a trycloudflare URL in time; see %s\n' "$tunnel_log" >&2
}

start_named_tunnel() {
  local name="$1"
  if ! command -v cloudflared >/dev/null 2>&1; then
    printf '[dev] cloudflared not found; cannot start named tunnel %s\n' "$name" >&2
    return
  fi
  : >"$tunnel_log"
  cloudflared tunnel --no-autoupdate run "$name" >"$tunnel_log" 2>&1 &
  tunnel_pid=$!

  if [[ -n "${PUBLIC_DEV_URL:-}" ]]; then
    printf '%s\n' "$PUBLIC_DEV_URL" >"$tunnel_url_file"
    printf '[dev] named tunnel %s → %s\n' "$name" "$PUBLIC_DEV_URL"
  else
    printf '[dev] named tunnel %s started; set PUBLIC_DEV_URL so scripts/tests know the public hostname\n' "$name"
  fi
}

case "$tunnel_mode" in
  off|none|false|0)
    ;;
  quick)
    start_quick_tunnel
    ;;
  *)
    start_named_tunnel "$tunnel_mode"
    ;;
esac

if [[ -s "$tunnel_url_file" ]]; then
  export PUBLIC_DEV_URL="$(cat "$tunnel_url_file")"
fi

pnpm dev:server &
server_pid=$!

for _ in $(seq 1 180); do
  if curl -fsS http://127.0.0.1:1337/ >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if [[ -s "$tunnel_url_file" && "${GITHUB_APP_WEBHOOK_SYNC:-1}" != "0" ]]; then
  pnpm exec tsx scripts/sync-github-app-webhook.ts "$(cat "$tunnel_url_file")" || \
    printf '[dev] webhook sync failed; point the GitHub App webhook at %s/github/events manually\n' \
      "$(cat "$tunnel_url_file")"
fi

printf '\nOpen in browser: http://artifactci.localhost:1355\n'
if [[ -s "$tunnel_url_file" ]]; then
  printf 'Public tunnel:    %s\n' "$(cat "$tunnel_url_file")"
fi
printf '\n'

wait "$server_pid"
