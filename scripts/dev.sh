#!/usr/bin/env bash
set -euo pipefail

tunnel_url_file=.alchemy/tunnel-url.txt
tunnel_pid_file=.alchemy/tunnel.pid

# Whether this dev session owns the tunnel (and therefore should kill it on
# exit). If a tunnel was already running (`pnpm tunnel`), we just reuse its
# URL and leave it alone.
tunnel_owned_by_session=0

persistent_tunnel_alive() {
  [[ -f "$tunnel_pid_file" ]] && kill -0 "$(cat "$tunnel_pid_file")" 2>/dev/null
}

cleanup() {
  if [[ -n "${server_pid:-}" ]]; then
    kill "$server_pid" 2>/dev/null || true
  fi
  if [[ "$tunnel_owned_by_session" == "1" && -f "$tunnel_pid_file" ]]; then
    kill "$(cat "$tunnel_pid_file")" 2>/dev/null || true
    rm -f "$tunnel_url_file" "$tunnel_pid_file"
  fi
}

on_signal() {
  cleanup
  exit 130
}

trap cleanup EXIT
trap on_signal INT TERM

pkill -f "alchemy dev" 2>/dev/null || true
for port in 1337 1355 43111 43112; do
  lsof -ti tcp:"$port" | xargs kill -9 2>/dev/null || true
done

portless proxy start >/dev/null 2>&1 || true
portless alias artifactci 1337 >/dev/null 2>&1 || true

rm -rf .alchemy/artifact-ci apps/app/.alchemy apps/docs/.alchemy apps/docs/.astro apps/docs/.wrangler apps/docs/dist
mkdir -p .alchemy/logs

# Pre-build the docs site so python http.server has real content to serve.
# Falls back to a placeholder if astro build fails so the rest of dev still
# comes up.
if ! pnpm --dir apps/docs build >.alchemy/logs/astro-build.log 2>&1; then
  printf '[dev] astro build failed, using placeholder (see .alchemy/logs/astro-build.log)\n' >&2
  mkdir -p apps/docs/dist
  printf '<!doctype html><title>artifact.ci</title><h1>docs placeholder</h1>' > apps/docs/dist/index.html
fi
touch \
  .alchemy/logs/artifact-ci-mmkal-app.log \
  .alchemy/logs/artifact-ci-mmkal-docs.log \
  .alchemy/logs/artifact-ci-mmkal-frontdoor.log

if persistent_tunnel_alive && [[ -s "$tunnel_url_file" ]]; then
  printf '[dev] reusing tunnel: %s (pid %s)\n' "$(cat "$tunnel_url_file")" "$(cat "$tunnel_pid_file")"
else
  # No tunnel running — start one via scripts/tunnel.sh (prefers named
  # tunnel, falls back to quick). dev.sh owns it and will kill it on exit.
  rm -f "$tunnel_url_file" "$tunnel_pid_file"
  if bash scripts/tunnel.sh start; then
    tunnel_owned_by_session=1
  else
    printf '[dev] tunnel failed to start; continuing without public URL\n' >&2
  fi
fi

if [[ -s "$tunnel_url_file" ]]; then
  export PUBLIC_DEV_URL="$(cat "$tunnel_url_file")"
fi

# --unhandled-rejections=warn so stray websocket / client errors in alchemy
# or miniflare don't kill the process. Node 24's default is `throw`, which
# brought dev down every time Chrome opened a stale HMR websocket.
NODE_OPTIONS="${NODE_OPTIONS:-} --unhandled-rejections=warn" pnpm dev:server &
server_pid=$!

for _ in $(seq 1 180); do
  if curl -fsS http://127.0.0.1:1337/ >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

printf '\nOpen in browser: http://artifactci.localhost:1355\n'
if [[ -s "$tunnel_url_file" ]]; then
  printf 'Public tunnel:    %s\n' "$(cat "$tunnel_url_file")"
fi
printf '\n'

wait "$server_pid"
