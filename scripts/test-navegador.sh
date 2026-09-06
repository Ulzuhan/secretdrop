#!/usr/bin/env bash
#
# El recorrido de verdad, en un navegador: entrar, crear, compartir, abrir en
# otro contexto, descifrar y comprobar que no se puede dos veces.
#
# Sobre HTTPS a propósito, con un certificado de usar y tirar: el atributo
# `Secure` de las cookies no se puede comprobar de otra forma, y es justo lo
# que se coló en el port.
#
# Necesita un build antes: `npm run build` para Node, o `npx vite build` y
# `go build` para Go.
set -uo pipefail
set -m

cd "$(dirname "$0")/.."

export PUERTO_APP="${PUERTO_APP:-3972}"
export PUERTO_TLS="${PUERTO_TLS:-3971}"
export PUERTO_IDP="${PUERTO_IDP:-9971}"
export BASE="https://127.0.0.1:$PUERTO_TLS"
export EMISOR="http://127.0.0.1:$PUERTO_IDP/application/o/secretdrop"
export SECRETDROP_SESSION_SECRET="secreto-de-pruebas-secretdrop-32-bytes-minimo"
WORK="$(mktemp -d)"
export CERT="$WORK/cert.pem" LLAVE="$WORK/key.pem"
LOG="$WORK/app.log"
LANZAR="${SECRETDROP_TEST_LAUNCH:-node .next/standalone/server.js}"

servidor=""
parar() {
  [ -n "$servidor" ] || return 0
  kill -- -"$servidor" 2>/dev/null || kill "$servidor" 2>/dev/null
  wait "$servidor" 2>/dev/null
  servidor=""
}
limpiar() { parar; rm -rf "$WORK"; }
trap 'limpiar; exit 130' INT TERM

openssl req -x509 -newkey rsa:2048 -nodes -keyout "$LLAVE" -out "$CERT" \
  -days 1 -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" 2>/dev/null || {
  echo "no se pudo generar el certificado"; limpiar; exit 1; }

# NODE_ENV=production porque así corre de verdad, y porque es de lo que Node
# hace depender el `Secure` de sus cookies.
NODE_ENV=production PORT="$PUERTO_APP" HOSTNAME=127.0.0.1 \
  SECRETDROP_STORE_DIR="$WORK/almacen" \
  SECRETDROP_PUBLIC_HOST="127.0.0.1:$PUERTO_TLS" \
  SECRETDROP_OIDC_CLIENT_ID=pruebas \
  SECRETDROP_OIDC_CLIENT_SECRET=pruebas \
  SECRETDROP_OIDC_ISSUER="$EMISOR/" \
  SECRETDROP_OIDC_REDIRECT_URI="$BASE/api/auth/callback" \
  SECRETDROP_ENROLL_URL="https://idp.example.invalid/if/flow/enroll-secretdrop/" \
  KAICORP_FOOTER_LINKS=on \
  $LANZAR >"$LOG" 2>&1 &
servidor=$!

for _ in $(seq 1 90); do
  curl -sf -o /dev/null "http://127.0.0.1:$PUERTO_APP/" && break
  sleep 0.5
done
if ! curl -sf -o /dev/null "http://127.0.0.1:$PUERTO_APP/"; then
  echo "la aplicación no arrancó:"; tail -20 "$LOG"; limpiar; exit 1
fi

node scripts/test-navegador.mjs
estado=$?
[ "$estado" -eq 0 ] || { echo "--- registro de la aplicación ---"; tail -20 "$LOG"; }
limpiar
exit "$estado"
