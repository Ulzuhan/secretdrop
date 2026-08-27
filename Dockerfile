FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3461 SECRETDROP_STORE_DIR=/data
WORKDIR /app
RUN addgroup -S secretdrop && adduser -S -G secretdrop secretdrop && mkdir /data && chown secretdrop:secretdrop /data
COPY --from=build --chown=secretdrop:secretdrop /app/.next/standalone ./
COPY --from=build --chown=secretdrop:secretdrop /app/.next/static ./.next/static
COPY --from=build --chown=secretdrop:secretdrop /app/public ./public
USER secretdrop
EXPOSE 3461
CMD ["node", "server.js"]
