#!/usr/bin/env bash
# Reviewed Go 0.9.x digest -> exact candidate OCI runtime -> same reviewed digest.
# Reuses persistence assertions with a synthetic store and one writer per turn.
set -euo pipefail
cd "$(dirname "$0")/.."
BASELINE=$(python3 scripts/rollback-baseline.py image)
: "${SECRETDROP_TEST_IMAGE:?exact verified OCI runtime ID required}"
[[ "$SECRETDROP_TEST_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 2
case "$(uname -m)" in
  x86_64) NATIVE=amd64 ;;
  aarch64|arm64) NATIVE=arm64 ;;
  *) echo "unsupported native runtime" >&2; exit 2 ;;
esac
[[ "${SECRETDROP_TEST_ARCH:-$NATIVE}" == "$NATIVE" ]] || {
  echo "expected a native $SECRETDROP_TEST_ARCH runner, observed $NATIVE" >&2; exit 2;
}
PLATFORM="linux/$NATIVE"
CANDIDATE=$SECRETDROP_TEST_IMAGE
CANDIDATE_ID=$(docker image inspect --format '{{.Os}}/{{.Architecture}} {{.Id}}' "$SECRETDROP_TEST_IMAGE")
[[ "$CANDIDATE_ID" == "$PLATFORM $SECRETDROP_TEST_IMAGE" ]] || exit 2
docker pull --platform "$PLATFORM" "$BASELINE"
PREVIOUS_ID=$(docker image inspect --format '{{.Os}}/{{.Architecture}} {{.Id}}' "$BASELINE")
[[ "$PREVIOUS_ID" =~ ^"$PLATFORM sha256:"[a-f0-9]{64}$ && "$PREVIOUS_ID" != "$CANDIDATE_ID" ]] || exit 2
printf 'SECRETDROP_NATIVE_PAIR_BEGIN arch=%s previous_ref=%s previous_id=%s candidate_id=%s\n' \
  "$NATIVE" "$BASELINE" "${PREVIOUS_ID#* }" "$CANDIDATE"
export SECRETDROP_COMPAT_PREVIOUS_LABEL="Go $(python3 -c 'import json;print(json.load(open("release/rollback.json"))["version"])')"
export SECRETDROP_COMPAT_GO="env SECRETDROP_TEST_IMAGE=$SECRETDROP_TEST_IMAGE bash scripts/lanzar-imagen.sh"
export SECRETDROP_TEST_IMAGE="${PREVIOUS_ID#* }"
bash scripts/test-compatibilidad.sh
printf 'SECRETDROP_NATIVE_PAIR_OK arch=%s candidate=%s\n' "$NATIVE" "$CANDIDATE"
