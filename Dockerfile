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

# El healthcheck que faltaba: era la única de las cinco imágenes sin él, y el
# compose lo compensaba con el smoke de `deploy.sh` — que mira el dominio, no el
# contenedor, y por tanto no distingue «arrancando» de «arrancado». Sin esto,
# `deploy.sh` daba por bueno un contenedor que todavía no servía.
#
# Se pide un secreto que no existe y se espera un 404: es la ruta que de verdad
# ejercita el servidor —enruta, entra en la base y responde— sin escribir nada
# ni depender de sesión. Un 200 en `/` sólo prueba que Next arrancó.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3461)+'/api/secrets/000000000000').then(r=>process.exit(r.status===404?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
