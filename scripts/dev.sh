#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  if [[ -n "${server_pid:-}" ]]; then
    kill "$server_pid" 2>/dev/null || true
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

rm -rf .alchemy apps/app/.alchemy apps/docs/.alchemy apps/docs/.astro apps/docs/.wrangler apps/docs/dist
mkdir -p .alchemy/logs
touch \
  .alchemy/logs/artifact-ci-mmkal-app.log \
  .alchemy/logs/artifact-ci-mmkal-docs.log \
  .alchemy/logs/artifact-ci-mmkal-frontdoor.log

pnpm dev:server &
server_pid=$!

for _ in $(seq 1 180); do
  if curl -fsS http://127.0.0.1:1337/ >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

printf '\nOpen in browser: http://artifactci.localhost:1355\n\n'

wait "$server_pid"
