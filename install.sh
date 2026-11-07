#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command -v node >/dev/null || { echo 'Install Node.js 24 LTS (includes npm), then rerun this script.' >&2; exit 1; }
command -v npm >/dev/null || { echo 'npm is required. Install Node.js with npm and rerun.' >&2; exit 1; }
node --input-type=module -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Node.js 22.12+ required; Node.js 24 LTS recommended."); process.exit(1); }'
npm ci --include=dev
npm run build
npm run seed
exec bash ./start-local.sh
