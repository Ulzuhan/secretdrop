# Despliegue y operación

SecretDrop debe ejecutarse como **una sola instancia** detrás de un proxy TLS. Los bloqueos de consumo, la cuota y los límites de frecuencia son locales al proceso; varias réplicas compartiendo el mismo volumen romperían esas garantías. El proxy debe controlar la identidad del cliente y conservar el host público, como se detalla abajo.

## Docker Compose

1. Copia `.env.example` a `.env`, genera `SECRETDROP_SESSION_SECRET` con `openssl rand -hex 32` y configura OIDC con URLs HTTPS públicas. Añade `SECRETDROP_ENROLL_URL` con el flujo de alta de tu proveedor: es el botón «Request an account» de la portada y sin ella no aparece — que es lo correcto si tu proveedor no tiene alta autoservicio.
2. Ejecuta `docker compose up -d --build`.
3. Publica únicamente el proxy HTTPS; Compose enlaza la aplicación a `127.0.0.1:3461`.

El contenedor corre sin root, sin capacidades, con raíz de solo lectura y un volumen persistente en `/data`. Los límites predeterminados son 100 MiB y 1000 registros (incluidas las lápidas retenidas); ajústalos con `SECRETDROP_MAX_STORE_BYTES` y `SECRETDROP_MAX_ACTIVE_SECRETS`.

## Parada ordenada

Al recibir `SIGTERM` el proceso deja de admitir conexiones y **espera** hasta
15 s a que terminen las peticiones en vuelo; sólo entonces sale. Desde 0.9.1:
antes ese drenaje se lanzaba sin esperarlo y el proceso podía salir con una
respuesta a medio escribir. En este servicio eso no es cosmético — la entrega de
un secreto de un solo uso lo gasta, y cortarla deja a quien abrió el enlace sin
lo suyo y sin repetición posible.

Quien orquesta tiene que conceder ese margen: Docker mata a los 10 s por
defecto, así que el compose de este repositorio declara `stop_grace_period: 20s`.
Si despliegas con otra configuración, súbelo ahí también; si no, el drenaje se
corta igual por fuera.

## Datos, copias y recuperación

No hagas copias de seguridad de `/data`: una copia puede reintroducir criptogramas que el servicio ya prometió quemar. El último consumo escribe primero una lápida sin criptograma y la retiene siete días, de modo que una caída no revive el secreto. Los secretos no consumidos caducados se eliminan al acceder, al iniciar el proceso o mediante la limpieza autenticada. Supervisa espacio, respuestas 429/507/503 y reinicios.

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

Las sesiones firmadas duran 12 horas por defecto (máximo 24). Sí hay revocación local, pero sólo llega por aviso: si el proveedor manda un cierre de sesión por back-channel válido, esa persona queda anotada en `revocaciones.json` (25 h) y sus cookies dejan de valer. Lo que **no** hay es comprobación de permisos en cada petición: deshabilitar una cuenta en OIDC sin que llegue ese aviso no invalida una cookie ya emitida hasta que caduca. Rota `SECRETDROP_SESSION_SECRET` para invalidar todas las sesiones de golpe. Guarda los secretos OIDC fuera de la imagen y restringe la lectura del fichero `.env`.

Antes de actualizar sigue la batería de [CONTRIBUTING.md](CONTRIBUTING.md), incluida la interfaz contra la imagen final y la compatibilidad. No despliegues si falla.

## Runtime React + Go

Desde 0.8.0, `Dockerfile` construye React con Node/Vite y lo embebe en `/usr/local/bin/secretdrop`. La etapa final no contiene Node, npm ni navegadores. UID 10001 y `/data` permanecen iguales. El comando es `secretdrop`; si un compose externo usa un envoltorio para cargar secretos, debe terminar con `exec secretdrop`, no con el arranque histórico de Node.

El binario no lee dotenv por sí solo: Compose carga `.env`; fuera de Compose exporta las variables. Las cookies son Secure por defecto, independientemente de `NODE_ENV`. `SECRETDROP_INSECURE_COOKIES=1` sólo se permite para HTTP local.

## Publicación y promoción

El workflow publica en pushes a `main` y etiquetas de versión. La firma de procedencia y su verificación pertenecen al workflow actual; no convierten en firmadas las imágenes históricas. Antes de promover un digest nuevo, comprueba sus checks, procedencia firmada para el repositorio/workflow/commit/referencia esperados y escaneo. El SBOM de BuildKit es un artefacto distinto, no una firma por sí mismo.

Ancla por digest, recrea sólo SecretDrop y nunca mantengas dos escritores sobre `/data`. Verifica salud, portada, login y un ciclo con datos sintéticos autorizado; no consumas secretos reales ajenos para probar. Retirar código antiguo no autoriza ni requiere un despliegue.

## Vuelta atrás

La imagen histórica de compatibilidad es:

```text
ghcr.io/ulzuhan/secretdrop:0.7.3@sha256:4103ac55664ce49d81bf7b38c6cccbee47d06f7e339ed477398c4be1b7065e2d
```

La suite alterna esa imagen, Go y esa misma imagen sobre un almacén temporal. Conservarla permite probar formato y revocaciones sin mantener Next en la rama activa. Compatibilidad de datos no significa igualdad de correcciones: 0.7.3 carece de arreglos posteriores, por lo que es una referencia de emergencia, no la versión recomendada.

Para volver a una versión Go anterior, restaura su imagen y recrea sólo el servicio. Si fuese imprescindible volver a 0.7.3, restaura además el comando Node exacto de la configuración archivada de ese despliegue. **No restaures ni vacíes el volumen**: puedes resucitar secretos consumidos o permisos revocados. La limpieza de Git no borra etiquetas, historial ni imágenes publicadas.
