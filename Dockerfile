# Build React with Node; ship only the Go binary and its embedded assets.

FROM node:22-alpine AS assets
WORKDIR /app
# Browser binaries are installed only for tests, never for the image build.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package*.json ./
# `npm ci` y no `--omit=dev`: vite y su cadena son dependencias de desarrollo, y
# sin ellas no hay nada que compilar.
RUN npm ci
# La interfaz es CSS propio y fuentes autoalojadas (salen de node_modules): no
# hay PostCSS ni Tailwind que configurar. `npm ci` ya ha traído las fuentes.
COPY vite.config.mts tsconfig.json ./
COPY src ./src
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
# Preserve uid 10001: existing persistent volumes belong to this identity.
RUN apk -U upgrade --no-cache \
 && addgroup -S -g 10001 secretdrop && adduser -S -u 10001 -G secretdrop secretdrop \
 && mkdir /data && chown secretdrop:secretdrop /data
# El binario y nada más. La interfaz va embebida con go:embed, así que aquí no
# hay ni `node_modules`, ni npm, ni Playwright, ni navegadores: no hay nada que
# retirar después como en la imagen de Node.
COPY --from=build /out/secretdrop /usr/local/bin/secretdrop
USER secretdrop
EXPOSE 3461

# Exercise the real read route with the nonexistent probe ID; expect 404.
# The built-in probe needs neither curl nor JavaScript.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["secretdrop", "health"]

CMD ["secretdrop"]
