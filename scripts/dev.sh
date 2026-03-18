#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  if [[ -n "${ngrok_pid:-}" ]]; then
    kill "$ngrok_pid" 2>/dev/null || true
  fi
}

on_signal() {
  cleanup
  # 130 is the conventional shell exit code for "terminated by ctrl-c" (128+2(SIGINT))
  exit 130
}

trap cleanup EXIT
trap on_signal INT TERM

pkill -f "ngrok http .*artifactci.eu.ngrok.io" 2>/dev/null || true
pkill -f "ngrok http .*--domain=artifactci.eu.ngrok.io" 2>/dev/null || true

docker compose up -d

# use portless proxy start so we can control the server "name" and explicitly start the server
portless proxy start >/dev/null 2>&1 || true

# no https needed, it's not automatic with portless proxy, and ngrok handles it anyway
ngrok http 1355 --host-header=artifactci.localhost:1355 --domain=artifactci.eu.ngrok.io >/tmp/artifactci-ngrok.log 2>&1 &
ngrok_pid=$!

portless artifactci pnpm dev:server
