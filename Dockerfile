FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3461 SECRETDROP_STORE_DIR=/data
WORKDIR /app
# uid fijo y alto a propósito: es la política de las cinco imágenes (10001), no
# choca con usuarios del sistema del host, y los bind mounts saben a quién
# pertenecer. Sin `-u`, alpine asigna 100 — que en muchos hosts es un usuario
# del sistema de verdad.
# apk upgrade: la base arrastra arreglos de seguridad de Alpine (libcrypto,
# medido por el Trivy semanal). Y npm/npx/yarn FUERA: el runtime ejecuta
# `node server.js` y nada más — el npm CLI trae sus propios node_modules
# (tar, brace-expansion…) que salen en los escáneres y jamás se usarían.
RUN apk -U upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && addgroup -S -g 10001 secretdrop && adduser -S -u 10001 -G secretdrop secretdrop && mkdir /data && chown secretdrop:secretdrop /data
COPY --from=build --chown=secretdrop:secretdrop /app/.next/standalone ./
COPY --from=build --chown=secretdrop:secretdrop /app/.next/static ./.next/static
COPY --from=build --chown=secretdrop:secretdrop /app/public ./public
USER secretdrop
EXPOSE 3461
CMD ["node", "server.js"]
