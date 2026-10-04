#!/usr/bin/env bash
# Reviewed Go 0.9.x digest -> exact candidate OCI runtime -> same reviewed digest.
# Reuses persistence assertions with a synthetic store and one writer per turn.
set -euo pipefail
cd "$(dirname "$0")/.."
BASELINE=$(python3 scripts/rollback-baseline.py image)
: "${SECRETDROP_TEST_IMAGE:?exact verified OCI runtime ID required}"
[[ "$SECRETDROP_TEST_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 2
docker pull "$BASELINE"
export SECRETDROP_COMPAT_PREVIOUS_LABEL="Go $(python3 -c 'import json;print(json.load(open("release/rollback.json"))["version"])')"
export SECRETDROP_COMPAT_GO="env SECRETDROP_TEST_IMAGE=$SECRETDROP_TEST_IMAGE bash scripts/lanzar-imagen.sh"
export SECRETDROP_TEST_IMAGE="$BASELINE"
bash scripts/test-compatibilidad.sh
