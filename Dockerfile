# La imagen del servicio, con el backend en Go.
#
# La de Node vive en `Dockerfile.node` y ya no se publica. Node se conserva
# como herramienta: compila la interfaz con vite y corre las suites, que pasan
# contra las dos implementaciones. En el runtime productivo no queda nada suyo.
#
# El nombre importa: esto se llamó `Dockerfile.go` y esa extensión hace que el
# herramental de Go intente COMPILARLO —`govulncheck ./...` y `go build ./...`
# fallaban con «illegal character U+0023»—.
#
# Esto no despliega: sustituir la imagen viva necesita su ventana autorizada.

FROM node:22-alpine AS assets
WORKDIR /app
# Playwright es dependencia de desarrollo y su instalación se baja navegadores.
# Aquí no se usa —la suite de navegador corre fuera de la imagen— y no debe
# aparecer ni siquiera en esta capa intermedia.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package*.json ./
# `npm ci` y no `--omit=dev`: vite y su cadena son dependencias de desarrollo, y
# sin ellas no hay nada que compilar.
RUN npm ci
# postcss.config.mjs NO es opcional: es quien mete Tailwind. Sin él vite emite
# el CSS fuente sin una sola utilidad generada, la página sale sin estilos y
# nada falla — el build pasa, el asset se sirve con su MIME y pesa parecido.
COPY vite.config.mts postcss.config.mjs ./
COPY web ./web
COPY public ./public
RUN npx vite build

FROM golang:1.27.1-alpine AS build
WORKDIR /src
# Sin dependencias externas: no hay `go.sum` que verificar ni módulos que bajar.
# Si algún día entra una, este build empezará a necesitar red y hay que verlo.
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
# Los assets vienen de la etapa anterior y nunca del host: `internal/web/dist`
# está en .dockerignore para que un `vite build` local no se cuele en la imagen.
COPY --from=assets /app/internal/web/dist ./internal/web/dist
# CGO fuera: binario estático, sin enlazar contra la libc de la imagen de
# compilación. -trimpath deja las rutas de compilación fuera del binario, que es
# lo que permite reconstruirlo igual desde otro directorio.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/secretdrop ./cmd/secretdrop

FROM alpine:3.24 AS runtime
ENV HOSTNAME=0.0.0.0 PORT=3461 SECRETDROP_STORE_DIR=/data
# uid fijo y alto a propósito: es la política de las siete imágenes propias
# (10001) — DocDrop, SecretDrop, QR-Forge, TabUp, PixelForge, LinkUp y
# SignDrop—, no
# choca con usuarios del sistema del host, y los bind mounts saben a quién
# pertenecer. Sin `-u`, alpine asigna 100 — que en muchos hosts es un usuario
# del sistema de verdad.
RUN apk -U upgrade --no-cache \
 && addgroup -S -g 10001 secretdrop && adduser -S -u 10001 -G secretdrop secretdrop \
 && mkdir /data && chown secretdrop:secretdrop /data
# El binario y nada más. La interfaz va embebida con go:embed, así que aquí no
# hay ni `node_modules`, ni npm, ni Playwright, ni navegadores: no hay nada que
# retirar después como en la imagen de Node.
COPY --from=build /out/secretdrop /usr/local/bin/secretdrop
USER secretdrop
EXPOSE 3461

# Misma sonda que la imagen de Node, y por la misma razón: se pide un secreto
# que no existe y se espera un 404, la ruta que de verdad ejercita el servidor
# —enruta, entra en la base y responde— sin escribir nada ni depender de sesión.
# `/api/health` devuelve 200 fijo y sólo probaría que el proceso arrancó.
# La sonda va dentro del propio binario porque aquí no hay shell con la que
# preguntar desde fuera.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["secretdrop", "health"]

CMD ["secretdrop"]
