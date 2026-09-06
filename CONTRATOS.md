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

## El listado, y una corrección de lo que aquí ponía

`GET /api/secrets` sale de un índice en memoria. Al cargarse el módulo de esa
ruta se lanza `cleanupExpired()`, que recorre el almacén con `loadMeta()` —y
`loadMeta()` cachea—, así que **el índice sí se rellena desde disco**.

La primera versión de este documento afirmaba lo contrario: que nadie lo
reconstruía y que tras un reinicio la lista aparecía vacía. Era falso, y la
prueba que lo "demostraba" sembraba ficheros **después** de arrancar, cuando ese
recorrido ya había pasado. Una prueba que confirma lo que uno cree y no lo que
el programa hace.

Lo que sí había, y se arregló el 06-09: el barrido se lanzaba **sin esperarlo**,
así que la primera petición al listado corría a la vez. Con 2000 registros
sembrados antes de arrancar, ese primer listado devolvía **1606 de 2000**. Con
1000 salía completo: es una carrera, no un umbral. No se perdían datos —los
enlaces van por id y leen disco— pero a alguien podían faltarle secretos de su
lista justo después de un despliegue, y aparecer minutos después.

Ahora la promesa se guarda y el listado la espera. `scripts/test-reinicio.sh` es
la regresión: siembra propios, ajenos y sin dueño **antes** de que exista el
servidor, hace que la primera petición sea el listado, y después crea por la API,
para el servidor y lo vuelve a arrancar con el mismo almacén.

**Lo que un port debe garantizar**, y es lo único que se congela aquí: en la
primera petición tras arrancar, el listado ya está completo; enseña sólo lo del
titular, vivo y no quemado; y excluye lo de otras cuentas y lo que no tiene
dueño. **Cómo** lo consiga —índice en memoria, lectura por petición, lo que
sea— es asunto suyo.

## Lo que hay que reproducir a propósito

La cuota cuenta lápidas y mezcla dos medidas. `saveNewMeta()` recorre todos los
`meta.json` sin filtrar quemados ni caducados: las lápidas cuentan para el
límite de 1000 y para los 100 MiB. Y suma **bytes en disco** de lo existente
contra el **JSON compacto** del registro nuevo. «1000 secretos activos» no
describe lo que hace el código.

Esto se documenta, no se toca: corregirlo cambia cuándo alguien recibe un 507,
y es una decisión aparte de este port.

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

## Estado del port

El backend Go pasa hoy, con las mismas suites y sin tocarlas:

| | contra Node | contra Go |
|---|---|---|
| `auth` | 34 | 34 |
| `secretos` | 53 | 53 |
| `contratos` | 23 | 23 |
| `backchannel` | ✓ | ✓ |
| reinicio en frío y tras rearranque | ✓ | ✓ |

Más las suyas propias en Go: carreras del almacén —treinta lectores contra un
secreto de un solo uso, veinte vueltas—, persistencia antes de entregar,
lápidas, purga al hidratar, cuota con lápidas dentro, y la sesión con su carga
recodificada y su lista de revocación.

CI corre las dos, así que una divergencia se ve el día que aparece.

**Lo que todavía sirve Node y no Go: la interfaz.** La portada de Go es un marco
mínimo —con el enlace de alta salido del entorno, que eso sí es contrato— y no
la pantalla de React. Crear, compartir y descifrar en el navegador es la
siguiente entrega.

Y dos cosas que el port dejó escritas porque se descubrieron rompiéndose:

- La cookie del estado OIDC va **URL-encoded**, como la deja Next. Su valor es
  JSON, y `{`, `"` y `,` no son bytes válidos de cookie: `http.SetCookie` los
  borra en silencio y lo que vuelve ya no es JSON. Además así una cookie emitida
  por Node durante una migración se sigue leyendo.
- El POST de creación exige `application/json`. No es formalismo: es lo que
  obliga al navegador a preguntar antes de mandar la cookie desde otro sitio del
  mismo dominio.

## Lo que esta entrega no hace

No mide, no compara Node con Go, no toca producción y no decide si el índice se
reconstruye o si la cuota se corrige. Fija el punto de partida para poder
responder esas preguntas con algo delante.
