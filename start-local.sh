#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
# This launcher intentionally starts a password-free, loopback-only instance.
export NODE_ENV=development
export STUDY_USERNAME=''
export STUDY_PASSWORD=''
export PORT="${PORT:-4173}"
export STUDY_ORIGIN="http://127.0.0.1:${PORT}"
if [[ ! -f dist/index.html ]]; then
  echo 'Run bash install.sh first to install dependencies and build the site.' >&2
  exit 1
fi
printf 'Open http://127.0.0.1:%s — no password needed. Press Ctrl+C to stop.\n' "$PORT"
exec node server.mjs
