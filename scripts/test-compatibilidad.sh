#!/usr/bin/env bash
#
# Node → Go → Node sobre el MISMO almacén, y nunca los dos a la vez.
#
# Lo que decide si se puede cambiar de implementación y volver. Cada turno para
# de verdad antes de que empiece el siguiente: dos escritores sobre el mismo
# directorio no es un escenario soportado y no se va a medir como si lo fuera.
#
#   npm run build
#   npm run test:compatibilidad  # Docker pulls the pinned legacy image as needed
set -uo pipefail
set -m

cd "$(dirname "$0")/.."

PUERTO="${PORT:-3993}"
PUERTO_IDP="${PUERTO_IDP:-9994}"
export BASE="http://127.0.0.1:$PUERTO"
export ORIGEN_IDP="http://127.0.0.1:$PUERTO_IDP"
export SECRETDROP_SESSION_SECRET="${SECRETDROP_SESSION_SECRET:-secreto-de-pruebas-secretdrop-32-bytes-minimo}"
export CLIENT_ID="secretdrop-pruebas"

NODE_LANZAR="${SECRETDROP_COMPAT_NODE:-bash scripts/lanzar-imagen.sh}"
export SECRETDROP_TEST_IMAGE="${SECRETDROP_TEST_IMAGE:-ghcr.io/ulzuhan/secretdrop:0.7.3@sha256:4103ac55664ce49d81bf7b38c6cccbee47d06f7e339ed477398c4be1b7065e2d}"
GO_LANZAR="${SECRETDROP_COMPAT_GO:-./secretdrop}"
[ -n "$GO_LANZAR" ] || { echo "hace falta SECRETDROP_COMPAT_GO con el binario Go"; exit 2; }

WORK="$(mktemp -d)"
export ALMACEN="$WORK/almacen"
export ESTADO="$WORK/estado.json"
LOG="$WORK/server.log"
mkdir -p "$ALMACEN"

servidor=""; idp=""

parar() {
  [ -n "$servidor" ] || return 0
  kill -- -"$servidor" 2>/dev/null || kill "$servidor" 2>/dev/null
  wait "$servidor" 2>/dev/null
  servidor=""
  # Que el puerto quede libre no es cosmético: es la prueba de que no quedan
  # dos escritores sobre el mismo almacén.
  for _ in $(seq 1 40); do
    ss -tln 2>/dev/null | grep -qE ":$PUERTO " || return 0
    sleep 0.25
  done
  echo "aviso: el puerto $PUERTO sigue ocupado"; return 1
}

limpiar() { parar; [ -n "$idp" ] && kill "$idp" 2>/dev/null; rm -rf "$WORK"; }
trap limpiar EXIT
trap 'exit 130' INT TERM

arrancar() { # $1 = etiqueta, $2 = orden
  ss -tln 2>/dev/null | grep -qE ":$PUERTO " && { echo "el puerto $PUERTO ya está ocupado"; return 1; }
  echo "--- arranca $1" >>"$LOG"
  PORT="$PUERTO" HOSTNAME=127.0.0.1 NODE_ENV=production \
    SECRETDROP_STORE_DIR="$ALMACEN" \
    SECRETDROP_SESSION_SECRET="$SECRETDROP_SESSION_SECRET" \
    SECRETDROP_INSECURE_COOKIES=1 \
    SECRETDROP_MAX_ACTIVE_SECRETS=1000 \
    SECRETDROP_MAX_STORE_BYTES=10485760 \
    SECRETDROP_OIDC_CLIENT_ID="$CLIENT_ID" \
    SECRETDROP_OIDC_CLIENT_SECRET=pruebas \
    SECRETDROP_OIDC_REDIRECT_URI="$BASE/api/auth/callback" \
    SECRETDROP_OIDC_INTERNAL_BASE="$ORIGEN_IDP" \
    SECRETDROP_OIDC_ISSUER="$ORIGEN_IDP/application/o/secretdrop" \
    $2 >>"$LOG" 2>&1 &
  servidor=$!
  for _ in $(seq 1 90); do
    curl -sf -o /dev/null "$BASE/" && return 0
    sleep 0.5
  done
  echo "$1 no arrancó:"; tail -20 "$LOG"; return 1
}

for puerto in "$PUERTO" "$PUERTO_IDP"; do
  ss -tln | grep -qE ":$puerto " && { echo "puerto $puerto ocupado"; exit 2; }
done

node scripts/proveedor-firmante.mjs "$PUERTO_IDP" >>"$LOG" 2>&1 &
idp=$!
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "$ORIGEN_IDP/application/o/secretdrop/.well-known/openid-configuration" && break
  sleep 0.25
done

fallo=0
arrancar Node "$NODE_LANZAR" || fallo=1
[ "$fallo" -eq 0 ] && { node scripts/test-compatibilidad.mjs sembrar-node || fallo=1; }
parar || fallo=1

echo
[ "$fallo" -eq 0 ] && { arrancar Go "$GO_LANZAR" || fallo=1; }
[ "$fallo" -eq 0 ] && { node scripts/test-compatibilidad.mjs verificar-go || fallo=1; }
parar || fallo=1

echo
[ "$fallo" -eq 0 ] && { arrancar "Node (vuelta atrás)" "$NODE_LANZAR" || fallo=1; }
[ "$fallo" -eq 0 ] && { node scripts/test-compatibilidad.mjs verificar-node || fallo=1; }

[ "$fallo" -ne 0 ] && { echo "--- registro ---"; tail -30 "$LOG"; }
[ "$fallo" -eq 0 ] && echo && echo "todo verde"
exit "$fallo"
