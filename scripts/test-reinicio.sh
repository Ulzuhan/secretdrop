#!/usr/bin/env bash
#
# El listado en frío y tras un reinicio de verdad.
#
# Necesita su propio arrancador porque hay que parar y volver a arrancar el
# servidor CON EL MISMO ALMACÉN, y `run-suites.sh` levanta uno por suite y lo
# tira al terminar. Aquí lo que se prueba es justo lo de en medio.
#
# Necesita un build antes (`npm run build`).
set -uo pipefail
set -m

cd "$(dirname "$0")/.."

PUERTO="${PORT:-3994}"
export BASE="http://127.0.0.1:$PUERTO"
export SECRETDROP_SESSION_SECRET="${SECRETDROP_SESSION_SECRET:-secreto-de-pruebas-secretdrop-32-bytes-minimo}"
WORK="$(mktemp -d)"
export ALMACEN="$WORK/almacen"
export ESTADO="$WORK/estado.json"
LOG="$WORK/server.log"
LANZAR="${SECRETDROP_TEST_LAUNCH:-node .next/standalone/server.js}"

servidor=""

parar() {
  [ -n "$servidor" ] || return 0
  # El grupo entero: el standalone deja un trabajador con el puerto cogido.
  kill -- -"$servidor" 2>/dev/null || kill "$servidor" 2>/dev/null
  wait "$servidor" 2>/dev/null
  servidor=""
  for _ in $(seq 1 40); do
    ss -tln 2>/dev/null | grep -qE ":$PUERTO " || return 0
    sleep 0.25
  done
}

limpiar() { parar; rm -rf "$WORK"; }
trap 'limpiar; exit 130' INT TERM

arrancar() {
  PORT="$PUERTO" HOSTNAME=127.0.0.1 \
    SECRETDROP_STORE_DIR="$ALMACEN" \
    SECRETDROP_SESSION_SECRET="$SECRETDROP_SESSION_SECRET" \
    SECRETDROP_MAX_ACTIVE_SECRETS=100000 \
    SECRETDROP_MAX_STORE_BYTES=1073741824 \
    SECRETDROP_OIDC_CLIENT_ID=pruebas \
    SECRETDROP_OIDC_CLIENT_SECRET=pruebas \
    SECRETDROP_OIDC_REDIRECT_URI="$BASE/api/auth/callback" \
    SECRETDROP_OIDC_ISSUER="http://127.0.0.1:9999/application/o/secretdrop/" \
    $LANZAR >>"$LOG" 2>&1 &
  servidor=$!
  # OJO: la espera pega a `/`, NO a `/api/secrets`. Cargar esa ruta es lo que
  # dispara el `cleanupExpired()` que llena el índice, y si se tocara aquí se
  # estaría calentando justo lo que la prueba quiere ver frío.
  for _ in $(seq 1 90); do
    curl -sf -o /dev/null "$BASE/" && return 0
    sleep 0.5
  done
  echo "el servidor no arrancó:"; tail -20 "$LOG"; return 1
}

mkdir -p "$ALMACEN"
fallo=0

echo "Sembrando el almacén antes de que exista el servidor"
node scripts/test-reinicio.mjs sembrar || fallo=1

echo
echo "Arranque en frío: la primera petición es el listado"
arrancar || fallo=1
node scripts/test-reinicio.mjs frio || fallo=1
node scripts/test-reinicio.mjs crear || fallo=1

echo
echo "Y ahora el reinicio de verdad, con el mismo almacén"
parar
arrancar || fallo=1
node scripts/test-reinicio.mjs tras-reinicio || fallo=1

limpiar
[ "$fallo" -eq 0 ] && echo && echo "todo verde"
exit "$fallo"
