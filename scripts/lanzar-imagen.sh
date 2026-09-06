#!/usr/bin/env bash
# Arranca la imagen Go como si fuera un binario más, para poder apuntarle las
# mismas suites sin tocarlas:
#
#   SECRETDROP_TEST_LAUNCH="bash scripts/lanzar-imagen.sh" npm run test:navegador
#
# `--network host` porque el proveedor sintético y el proxy TLS de la prueba
# escuchan en el loopback del anfitrión, y la aplicación tiene que llegar a uno
# y ser alcanzable por el otro. No se monta nada: el almacén se queda dentro del
# contenedor, que se va con `--rm`.
set -euo pipefail

IMAGEN="${SECRETDROP_TEST_IMAGE:-secretdrop-go:sd3b}"
NOMBRE="secretdrop-prueba-$$"

# `docker run` en primer plano reenvía las señales, pero si algo lo mata a él y
# no al contenedor, la siguiente suite encuentra el puerto ocupado y mide el de
# antes. El trap es la red de seguridad.
limpiar() { docker rm -f "$NOMBRE" >/dev/null 2>&1 || true; }
trap limpiar EXIT INT TERM

# Las variables se pasan por nombre: el valor lo pone quien llama, igual que al
# binario.
#
# El almacén tiene dos modos. Por omisión se usa /data, el de la propia imagen.
# Pero si quien llama pasa SECRETDROP_STORE_DIR apuntando a un directorio que
# existe en el anfitrión, se monta ahí dentro con la misma ruta: es lo que
# necesita la suite de compatibilidad, que hace que dos implementaciones se
# turnen SOBRE EL MISMO almacén.
#
# En ese modo el contenedor corre con el uid de quien lanza, y no con el 10001
# de la imagen, para que los ficheros que escriba los pueda leer y escribir
# después el binario de fuera. Es una prueba del FORMATO de los datos; el perfil
# de seguridad de producción —uid 10001, read_only, cap_drop— se verifica
# aparte, y no aquí.
MONTAJE=()
if [ -n "${SECRETDROP_STORE_DIR:-}" ] && [ -d "${SECRETDROP_STORE_DIR}" ]; then
  MONTAJE=(-v "${SECRETDROP_STORE_DIR}:${SECRETDROP_STORE_DIR}"
           -e "SECRETDROP_STORE_DIR=${SECRETDROP_STORE_DIR}"
           --user "$(id -u):$(id -g)")
else
  MONTAJE=(-e SECRETDROP_STORE_DIR=/data)
fi
# Sin `exec`: reemplazaría a esta shell y el trap de arriba no llegaría a
# correr nunca. Se comprobó dejando un contenedor sujetando el puerto.
docker run --rm --network host --name "$NOMBRE" \
  -e PORT -e HOSTNAME \
  -e KAICORP_FOOTER_LINKS \
  -e SECRETDROP_SESSION_SECRET \
  -e SECRETDROP_PUBLIC_HOST \
  -e SECRETDROP_OIDC_CLIENT_ID \
  -e SECRETDROP_OIDC_CLIENT_SECRET \
  -e SECRETDROP_OIDC_ISSUER \
  -e SECRETDROP_OIDC_REDIRECT_URI \
  -e SECRETDROP_OIDC_INTERNAL_BASE \
  -e SECRETDROP_ENROLL_URL \
  -e SECRETDROP_ACCOUNT_URL \
  -e SECRETDROP_INSECURE_COOKIES \
  -e SECRETDROP_MAX_STORE_BYTES \
  -e SECRETDROP_MAX_ACTIVE_SECRETS \
  -e NODE_ENV \
  "${MONTAJE[@]}" \
  "$IMAGEN" &
wait $!
