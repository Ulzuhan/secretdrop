# Contratos: qué tiene que cumplir otra implementación para ser este servicio

Escrito el 06-09-2026 para el port del backend a Go. Lo que manda son las suites
—`scripts/test-contratos.mjs` y las que ya había—; esto explica **dónde una
reescritura se desvía sin que nadie lo note**.

## Cómo se apunta una suite a otra implementación

Las suites no saben qué las sirve. Se cambia el arranque, no las pruebas:

```bash
SECRETDROP_TEST_LAUNCH="./secretdrop" \
SECRETDROP_TEST_BUILD_STAMP="./secretdrop" \
  ./scripts/run-suites.sh
```

`SECRETDROP_TEST_LAUNCH` es la orden que levanta el servidor; por omisión el
artefacto standalone de Next. `SECRETDROP_TEST_BUILD_STAMP` es el fichero cuya
fecha delata un build viejo; si no existe, esa comprobación se salta avisando.
Todo lo demás —puerto, almacén, variables `SECRETDROP_*`, proveedor de
mentira— se mantiene igual a propósito: **el contrato es el entorno y el HTTP,
no el runtime**.

## Lo que hay que reproducir a propósito

Dos comportamientos que parecen un descuido y no lo son del todo. Un port que
los "arregle" sin decidirlo cambia el servicio.

### El listado sale de un índice en memoria que nadie reconstruye

`GET /api/secrets` recorre un `Map` en memoria. `loadMeta()` lo va sembrando
cuando alguien pide un secreto por su id, pero **nada lo rellena desde disco al
arrancar**.

La consecuencia es visible: **tras reiniciar el proceso, la lista de alguien
aparece vacía aunque todos sus enlaces sigan funcionando**. Los enlaces van por
id y sí leen disco; el listado no.

Está fijado en la suite en las dos direcciones: lo creado por la API aparece, y
lo que sólo está en disco no aparece aunque su enlace funcione. Si el port
reconstruye el índice —que es la optimización que contempla docs/37 §4 de
infra— **cambia un comportamiento observable**, y eso es una decisión, no un
detalle de implementación.

### La cuota cuenta lápidas y mezcla dos medidas

`saveNewMeta()` recorre todos los `meta.json` del almacén sin filtrar quemados
ni caducados: las lápidas cuentan para el límite de 1000 y para los 100 MiB. Y
suma **bytes en disco** de lo existente contra el **JSON compacto** del registro
nuevo. «1000 secretos activos» no describe lo que hace el código.

## Lo que está congelado

**Almacén** — `/data/<id>/meta.json`, ids base64url de 12 caracteres (9 bytes),
fechas en milisegundos. TTL 1–168 h (24 por defecto), 1–10 usos (1 por defecto),
criptograma hasta 256 Ki caracteres, iv hasta 256.

| Estado del registro | `GET /api/secrets/<id>` |
|---|---|
| vivo | 200 con criptograma, cuenta la vista, quema en el último uso |
| ya quemado / lápida | 410 |
| caducado | 410 |
| heredado sin `owner` | 200; su enlace vive, pero no sale en ningún listado |
| id desconocido o con forma inválida | 404 |
| no se puede consumir con seguridad | 503 |

Una lápida es un registro `burned` **sin criptograma**, con `burnedAt`, que se
conserva siete días para poder responder «ya se usó» en vez de «no existe».

**Sesión** — cookie `secretdrop_session`, carga base64url firmada con
HMAC-SHA256, `sub`, `email`, `name` opcional, `iat` y `exp` en milisegundos.
12 h por defecto, configurable entre 1 y 24. `HttpOnly`, `Secure` en producción,
`SameSite=Lax`, `Path=/`.

**La firma se verifica sobre los bytes recibidos**, no sobre el JSON vuelto a
serializar. Un port que decodifique, reserialice y luego verifique aceptaría
cualquier reordenación o espaciado que produzca el mismo objeto. Está en la
suite: la misma carga recodificada con la firma de la original se rechaza.

**Revocación** — `revocaciones.json`, retención 25 h. Sólo llega por aviso de
back-channel; no hay comprobación de permisos por petición. Desde el 06-09 el
aviso exige `exp`, un aviso con sólo `sid` se rechaza porque aquí la cookie no
lleva `sid`, y el `jti` se apunta **después** de que la revocación esté escrita,
para que un reintento pueda terminar lo que un fallo de disco dejó a medias.

## Lo que esta entrega no hace

No mide, no compara Node con Go, no toca producción y no decide si el índice se
reconstruye o si la cuota se corrige. Fija el punto de partida para poder
responder esas preguntas con algo delante.
