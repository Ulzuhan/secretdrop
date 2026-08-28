# Despliegue y operación

SecretDrop debe ejecutarse como **una sola instancia** detrás de un proxy TLS. Los bloqueos de consumo, la cuota y los límites de frecuencia son locales al proceso; varias réplicas compartiendo el mismo volumen romperían esas garantías. El proxy debe reemplazar (no anexar) `X-Forwarded-For`, `X-Forwarded-Host` y `X-Forwarded-Proto`.

## Docker Compose

1. Copia `.env.example` a `.env`, genera `SECRETDROP_SESSION_SECRET` con `openssl rand -hex 32` y configura OIDC con URLs HTTPS públicas. Añade `SECRETDROP_ENROLL_URL` con el flujo de alta de tu proveedor: es el botón «Request an account» de la portada y sin ella no aparece — que es lo correcto si tu proveedor no tiene alta autoservicio.
2. Ejecuta `docker compose up -d --build`.
3. Publica únicamente el proxy HTTPS; Compose enlaza la aplicación a `127.0.0.1:3461`.

El contenedor corre sin root, sin capacidades, con raíz de solo lectura y un volumen persistente en `/data`. Los límites predeterminados son 100 MiB y 1000 secretos activos; ajústalos con `SECRETDROP_MAX_STORE_BYTES` y `SECRETDROP_MAX_ACTIVE_SECRETS`.

## Datos, copias y recuperación

No hagas copias de seguridad de `/data`: una copia puede reintroducir criptogramas que el servicio ya prometió quemar. El último consumo escribe primero una lápida sin criptograma y la retiene siete días, de modo que una caída no revive el secreto. Los secretos no consumidos se eliminan al acceder, al iniciar el proceso o mediante la limpieza autenticada. Supervisa espacio, respuestas 429/507/503 y reinicios.

La clave de descifrado sólo vive en el fragmento de la URL y nunca llega al servidor, pero el criptograma y sus metadatos sí. Evita logs de URL completos, no añadas analítica de terceros y conserva `Referrer-Policy: no-referrer`.

## Lo que se le exige al proxy de delante

Dos cosas, y las dos están comprobadas en vivo contra el túnel de Cloudflare:

- **`X-Forwarded-For` debe llegar con la dirección real al final.** El límite de
  peticiones toma el último valor, no el primero, y eso es deliberado: el primero lo
  escribe quien llama. Verificado — mandando `X-Forwarded-For: 1.2.3.4` desde fuera,
  a la aplicación le llega `1.2.3.4,<la de verdad>`, así que el último es el bueno y
  rotar la cabecera no esquiva nada. **Expuesto sin proxy, sí se esquiva**: de ahí
  que la aplicación deba escuchar sólo en loopback.
- **`Host` debe traer el nombre público.** La comprobación de origen lo usa a él y
  no a `X-Forwarded-Host`, porque esa segunda **el túnel no la reemplaza** —también
  verificado— y quien llama puede escribirla. Si el proxy reescribe `Host` con un
  nombre interno, hay que poner `SECRETDROP_PUBLIC_HOST`.

## Identidad y rotación

Las sesiones firmadas duran 12 horas por defecto (máximo 24) y no tienen revocación local; deshabilitar una cuenta en OIDC no invalida inmediatamente una cookie ya emitida. Rota `SECRETDROP_SESSION_SECRET` para invalidar todas las sesiones. Guarda los secretos OIDC fuera de la imagen y restringe la lectura del fichero `.env`.

Antes de actualizar ejecuta `npm ci`, `npm run lint`, `npm run test:unit`, `npm run build` y `npm run test:http`. No despliegues si alguno falla.
