#!/usr/bin/env bash
#
# Levanta Secretdrop apuntando a un proveedor de mentira y corre
# `test-backchannel.mjs` contra él.
#
# El proveedor sintético de test-backchannel.mjs publica JWKS y firma avisos.
#
#   npm run test:backchannel     # hace falta un build antes (npm run build)
set -uo pipefail
set -m

cd "$(dirname "$0")/.."

PORT="${PORT:-3997}"
export BASE="http://127.0.0.1:$PORT"
export PUERTO_IDP="${PUERTO_IDP:-9995}"
export CLIENT_ID="secretdrop-pruebas"
WORK="$(mktemp -d)"
LOG="$WORK/server.log"

EMISOR="http://127.0.0.1:$PUERTO_IDP/application/o/secretdrop"

server_pid=""

stop() {
  [ -n "$server_pid" ] || return 0
  # Stop the launcher and its children.
  kill -- -"$server_pid" 2>/dev/null || kill "$server_pid" 2>/dev/null
  wait "$server_pid" 2>/dev/null
  server_pid=""
}

cleanup() {
  stop
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
for puerto in "$PORT" "$PUERTO_IDP"; do
  ss -tln | grep -qE ":$puerto " && { echo "puerto $puerto ocupado"; exit 2; }
done

SECRETDROP_STORE_DIR="$WORK/almacen" \
  SECRETDROP_SESSION_SECRET="secreto-de-pruebas-con-treinta-y-dos-bytes" \
  SECRETDROP_OIDC_CLIENT_ID="$CLIENT_ID" \
  SECRETDROP_OIDC_CLIENT_SECRET=secreto-de-pruebas \
  SECRETDROP_OIDC_INTERNAL_BASE="http://127.0.0.1:$PUERTO_IDP" \
  SECRETDROP_OIDC_ISSUER="$EMISOR/" \
  SECRETDROP_OIDC_REDIRECT_URI="$BASE/api/auth/callback" \
  HOSTNAME=127.0.0.1 PORT="$PORT" \
  ${SECRETDROP_TEST_LAUNCH:-./secretdrop} >"$LOG" 2>&1 &
server_pid=$!

for _ in $(seq 1 90); do
  curl -sf -o /dev/null "$BASE/" && break
  sleep 0.5
done

if ! curl -sf -o /dev/null "$BASE/"; then
  echo "el servidor no arrancó:"
  tail -20 "$LOG"
  cleanup
  exit 1
fi

SECRETDROP_STORE_DIR="$WORK/almacen" node scripts/test-backchannel.mjs
estado=$?

# El log solo si algo falló: en verde no aporta nada y esconde el resultado.
[ "$estado" -eq 0 ] || tail -30 "$LOG"

exit "$estado"
