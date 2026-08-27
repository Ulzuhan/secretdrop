#!/usr/bin/env bash
#
# Las suites, cada una contra un servidor levantado aquí mismo.
#
# El servidor se arranca con un secreto de sesión propio, y no con el de
# producción: las suites acuñan sus cookies con ese mismo secreto porque esta
# aplicación no tiene login local —la identidad la lleva Authentik entera—, y sin
# eso no habría forma de ejercitar una sola ruta.
#
#   ./scripts/run-suites.sh          # todas
#   ./scripts/run-suites.sh auth     # una
#
# Necesita un build antes (`npm run build`). Sale con código distinto de cero si
# algo falla, que es lo que lee CI.
set -uo pipefail
set -m

cd "$(dirname "$0")/.."

PUERTO="${PORT:-3992}"
export BASE="http://127.0.0.1:$PUERTO"
export SECRETDROP_SESSION_SECRET="${SECRETDROP_SESSION_SECRET:-secreto-de-pruebas-secretdrop-32-bytes-minimo}"
LOG="$(mktemp)"
RAIZ_PRUEBAS="$(mktemp -d)"
ALMACEN="$RAIZ_PRUEBAS/almacen"

# Un señuelo FUERA del almacén, con la fecha vencida.
#
# Sin esto, el test de recorrido de directorio no probaba nada: pedir
# `../../etc/passwd` da 404 tanto si la validación está como si no, porque ahí no
# hay ningún `meta.json` que leer. Comprobado quitando la validación a propósito:
# los ocho casos seguían pasando. Con un `meta.json` de verdad detrás, la
# diferencia se ve —y con la fecha vencida se ve la peor mitad, porque el manejador
# llamaba a `deleteSecret()` sobre lo que encontrara—.
export SENUELO="$RAIZ_PRUEBAS/senuelo"
mkdir -p "$SENUELO"
cat > "$SENUELO/meta.json" <<'JSON'
{"id":"senuelo","ciphertext":"NO-DEBERIA-SALIR-DE-AQUI","iv":"aaaabbbbccccdddd",
 "expiresAt":1,"maxViews":1,"viewCount":0,"createdAt":1,"burned":false}
JSON

# Y un segundo señuelo VIGENTE, para la otra mitad del fallo. El caducado prueba
# el borrado; éste prueba la lectura, que es la que entrega el contenido.
export SENUELO_VIVO="$RAIZ_PRUEBAS/senuelovivo"
mkdir -p "$SENUELO_VIVO"
python3 - "$SENUELO_VIVO/meta.json" <<'PY'
import json, sys, time
json.dump({"id": "senuelovivo", "ciphertext": "TAMPOCO-DEBERIA-SALIR", "iv": "aaaabbbbccccdddd",
           "expiresAt": int(time.time() * 1000) + 86_400_000, "maxViews": 5,
           "viewCount": 0, "createdAt": int(time.time() * 1000), "burned": False},
          open(sys.argv[1], "w"))
PY

TODAS=(auth secretos)
SUITES=("${@:-${TODAS[@]}}")
[ $# -gt 0 ] && SUITES=("$@")

servidor=""

parar() {
  [ -n "$servidor" ] || return 0
  # El grupo entero, no el proceso: `next start` levanta un trabajador aparte, y
  # matar sólo al padre deja el puerto ocupado. La siguiente suite encontraría un
  # servidor en pie, decidiría que ya ha arrancado, y mediría el de antes.
  kill -- -"$servidor" 2>/dev/null || kill "$servidor" 2>/dev/null
  wait "$servidor" 2>/dev/null
  servidor=""
  for _ in $(seq 1 40); do
    ss -tln 2>/dev/null | grep -qE ":$PUERTO " || return 0
    sleep 0.25
  done
  echo "aviso: el puerto $PUERTO sigue ocupado"
}
trap 'parar; exit 130' INT TERM

arrancar() {
  ss -tln 2>/dev/null | grep -qE ":$PUERTO " && { echo "el puerto $PUERTO ya está ocupado"; return 1; }

  # Los valores de OIDC son de mentira a propósito: ninguna suite completa un
  # inicio de sesión contra el proveedor, sólo comprueban que el desvío se
  # construye y que no saca de casa.
  # Almacén aparte, y no el de verdad. Sin esto cada tirada de pruebas dejaba sus
  # secretos mezclados con los de la gente, en el mismo directorio y con la misma
  # limpieza automática pasándoles por encima.
  # Se arranca el artefacto standalone, que es el que ejecuta producción y el que
  # se empaquetará en la imagen. `next start` sirve `.next`, que es otra cosa.
  #
  # OJO: las asignaciones van encadenadas con `\`, y meter un comentario entre
  # medias rompe la continuación **en silencio** — el servidor arranca igual, pero
  # sin ninguna variable. Por eso este comentario está aquí y no ahí abajo.
  # El servidor standalone no acepta `-p`: toma PORT y HOSTNAME del entorno, y sin
  # HOSTNAME escucha en 0.0.0.0 — comprobado.
  PORT="$PUERTO" HOSTNAME=127.0.0.1 \
    SECRETDROP_STORE_DIR="$ALMACEN" \
    SECRETDROP_MAX_STORE_BYTES=65536 \
    SECRETDROP_SESSION_SECRET="$SECRETDROP_SESSION_SECRET" \
    SECRETDROP_OIDC_CLIENT_ID=pruebas \
    SECRETDROP_OIDC_CLIENT_SECRET=pruebas \
    SECRETDROP_OIDC_REDIRECT_URI="$BASE/api/auth/callback" \
    SECRETDROP_OIDC_PUBLIC_BASE="http://127.0.0.1:9999" \
    SECRETDROP_OIDC_INTERNAL_BASE="http://127.0.0.1:9999" \
    SECRETDROP_OIDC_APP_SLUG=secretdrop \
    node .next/standalone/server.js >"$LOG" 2>&1 &
  servidor=$!

  for _ in $(seq 1 90); do
    curl -sf -o /dev/null "$BASE/" && break
    sleep 0.5
  done

  # La precondición, afirmada: quien escucha tiene que ser este proceso y no un
  # servidor de una tirada anterior que se quedó vivo. Sin esto se mide un build
  # viejo y nada lo dice.
  local escucha
  escucha=$(ss -tlnp 2>/dev/null | grep ":$PUERTO " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | head -1)
  if [ -z "$escucha" ]; then
    echo "el servidor no arrancó:"
    tail -20 "$LOG"
    return 1
  fi
  local suyo
  suyo=$(tr '\0' '\n' < "/proc/$escucha/environ" 2>/dev/null | grep '^SECRETDROP_SESSION_SECRET=' | cut -d= -f2-)
  if [ "$suyo" != "$SECRETDROP_SESSION_SECRET" ]; then
    echo "en $PUERTO escucha otro servidor, no el de esta tirada"
    return 1
  fi
  if [ "$(stat -c %Y "/proc/$escucha")" -lt "$(stat -c %Y .next/BUILD_ID)" ]; then
    echo "el build es más nuevo que el servidor: falta un 'npm run build'"
    return 1
  fi
  return 0
}

fallo=0
for suite in "${SUITES[@]}"; do
  rm -rf "$ALMACEN"
  mkdir -p "$ALMACEN"
  arrancar || { fallo=1; continue; }
  printf "%-10s " "$suite"
  salida=$(node "scripts/test-$suite.mjs" 2>&1)
  estado=$?
  echo "$salida" | tail -1
  if [ $estado -ne 0 ]; then
    echo "$salida" | grep -E "✗" | head -10
    # Y si la suite se cayó en vez de terminar contando, decirlo: un script que
    # muere a mitad deja comprobaciones sin ejecutar, y en el resumen eso se
    # parece demasiado a un fallo pequeño. Pasó.
    if ! echo "$salida" | grep -qE "^[0-9]+ pasan, [0-9]+ fallan$"; then
      echo "  ⚠ la suite '$suite' se cayó antes de terminar; lo que sigue no llegó a ejecutarse:"
      echo "$salida" | tail -6 | sed 's/^/     /'
    fi
    fallo=1
  fi
  parar
done

rm -f "$LOG"
rm -rf "$RAIZ_PRUEBAS"
if [ $fallo -ne 0 ]; then
  echo
  echo "HAY FALLOS"
  exit 1
fi
echo
echo "todo verde"
