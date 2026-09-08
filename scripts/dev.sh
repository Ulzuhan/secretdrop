#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export HOSTNAME=127.0.0.1 PORT="${PORT:-13461}"
export SECRETDROP_STORE_DIR="${SECRETDROP_STORE_DIR:-$PWD/.local/data}"
export SECRETDROP_INSECURE_COOKIES=1
# Local-only, ephemeral signing key. Production must supply its own persistent key.
if [ -z "${SECRETDROP_SESSION_SECRET:-}" ]; then
  SECRETDROP_SESSION_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  export SECRETDROP_SESSION_SECRET
fi
exec ./secretdrop
