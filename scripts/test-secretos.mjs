/**
 * Lo que este servicio promete.
 *
 * La promesa es corta y por eso es exigente: un secreto se lee las veces que se
 * dijo y ni una más, deja de existir cuando toca, y el servidor nunca ve lo que
 * hay dentro —la clave viaja en el fragmento de la URL, que no se manda—.
 *
 * Todo lo de aquí es alcanzable desde internet sin cuenta, porque leer un enlace
 * es público por diseño: quien lo recibe no tiene por qué tener sesión. Eso hace
 * que la validación del identificador no sea cosmética, y que un fallo aquí no
 * dé error en pantalla: simplemente el servicio deja de cumplir lo que dice.
 */
import { existsSync, readFileSync } from "node:fs";
import { api, check, crear, nota, resumen, sesion } from "./comun.mjs";

const SENUELO = process.env.SENUELO;
const SENUELO_VIVO = process.env.SENUELO_VIVO;

const cookie = sesion();

console.log("Quién puede crear y quién puede leer");
check("crear sin sesión no se puede", (await crear(null)).status, 401);
const creado = await crear(cookie);
check("con sesión sí", creado.status, 200);
check("y devuelve un identificador", /^[A-Za-z0-9_-]{12}$/.test(creado.body?.id ?? ""), true);
check("leerlo NO pide sesión: el enlace es para quien lo reciba", (await api(`/api/secrets/${creado.body.id}`)).status, 200);
check("la limpieza sí pide sesión", (await api("/api/cleanup", { metodo: "POST" })).status, 401);

console.log("\nSe lee una vez y se acabó");
const unaVez = await crear(cookie, { maxViews: 1 });
const primera = await api(`/api/secrets/${unaVez.body.id}`);
check("la primera lectura lo entrega", primera.body?.ciphertext?.length > 0, true);
check("y ya queda marcado como quemado", primera.body?.burned, true);
const segunda = await api(`/api/secrets/${unaVez.body.id}`);
check("la segunda no lo entrega", segunda.body?.ciphertext ?? null, null);
check("y lo dice con un 410, no con un 404", segunda.status, 410);

console.log("\nCon varias lecturas, se cuentan");
const tres = await crear(cookie, { maxViews: 3 });
const cuentas = [];
for (let i = 0; i < 4; i++) {
  const r = await api(`/api/secrets/${tres.body.id}`);
  cuentas.push(r.status);
}
check("tres lecturas y a la cuarta se acabó", cuentas, [200, 200, 200, 410]);

console.log("\nLecturas a la vez de un secreto de un solo uso");
// Es la promesa entera de esta herramienta. La carrera está probada aparte, en
// el test unitario de `loadMeta`, porque ahí se mide lo que de verdad decide —si
// dos peticiones hablan del mismo objeto— y no el reloj de una máquina cargada.
// Esto es la comprobación de arriba: por la puerta, como se usa.
const aLaVez = await crear(cookie, { maxViews: 1 });
const enTromba = await Promise.all(
  Array.from({ length: 20 }, () => api(`/api/secrets/${aLaVez.body.id}`))
);
const conSecreto = enTromba.filter((r) => r.status === 200 && r.body?.ciphertext).length;
nota("veinte a la vez", enTromba.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}));
check("lo recibe exactamente uno", conSecreto, 1);

console.log("\nEl identificador viene de la URL, así que se mira");
// Esto no es cosmética. El id se concatenaba con `join(STORE_DIR, id, …)` sin
// comprobar nada, y aunque Next normaliza `.` y `..`, la forma codificada sí
// llegaba: `%2e%2e%2f` repetido salía del almacén. Lectura de cualquier
// `meta.json` del sistema y, si su fecha estaba vencida, borrado del fichero y
// `rmdir` de su carpeta. Todo sin sesión.
for (const id of [
  "../../etc/passwd",
  "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
  "....//....//etc",
  "corto",
  "demasiadolargoparaser",
  "con espacio",
  "doce.puntos",
  "%00AAAAAAAAAA",
]) {
  const r = await api(`/api/secrets/${encodeURIComponent(id)}`);
  check(`no sirve ${JSON.stringify(id.slice(0, 26))}`, r.status, 404);
}
// Y un identificador con la forma buena pero que no existe responde igual: no
// hay motivo para distinguir "mal formado" de "no existe" ante quien prueba.
check("un id inventado con la forma buena da lo mismo", (await api("/api/secrets/AAAAAAAAAAAA")).status, 404);

// Lo anterior, por sí solo, no probaba nada: pedir `../../etc/passwd` da 404
// tanto si la validación está como si no, porque ahí no hay ningún `meta.json`
// que leer. Comprobado quitando la validación a propósito: los ocho casos
// seguían pasando. Hace falta un fichero de verdad al otro lado.
//
// El señuelo lo pone el guion que levanta el servidor, fuera del almacén y con
// la fecha vencida —que es la mitad peor: el manejador, al ver algo caducado,
// llamaba a `deleteSecret()` sobre lo que hubiera encontrado—.
if (!SENUELO || !SENUELO_VIVO) {
  console.log("  ✗ falta la variable SENUELO: este bloque no probaría nada");
  process.exit(1);
}
const alSenuelo = [
  "../senuelo",
  "..%2Fsenuelo",
  "%2e%2e%2fsenuelo",
  "%2e%2e/senuelo",
  "....//senuelo",
];
for (const id of alSenuelo) {
  const r = await api(`/api/secrets/${id}`);
  check(`no alcanza el señuelo con ${JSON.stringify(id)}`, r.body?.ciphertext ?? null, null);
}
// Leer el fichero sólo si sigue ahí. Antes se leía a pelo, y cuando la defensa
// fallaba —que es justo cuando este bloque importa— el `readFileSync` lanzaba, el
// script moría a mitad y las comprobaciones de abajo no llegaban a ejecutarse. En
// el resumen eso se veía como un solo fallo, no como media suite sin correr.
const sigueElSenuelo = existsSync(`${SENUELO}/meta.json`);
check("el señuelo sigue en su sitio, sin borrar", sigueElSenuelo, true);
check(
  "con su contenido intacto",
  sigueElSenuelo ? JSON.parse(readFileSync(`${SENUELO}/meta.json`, "utf8")).ciphertext : null,
  "NO-DEBERIA-SALIR-DE-AQUI"
);

// El señuelo caducado prueba el borrado; éste, vigente, prueba la lectura, que
// es la mitad que entrega el contenido a quien lo pide.
for (const id of ["../senuelovivo", "..%2Fsenuelovivo", "%2e%2e%2fsenuelovivo"]) {
  const r = await api(`/api/secrets/${id}`);
  check(`no lee el señuelo vigente con ${JSON.stringify(id)}`, r.body?.ciphertext ?? null, null);
}
check("y ése también sigue en su sitio", existsSync(`${SENUELO_VIVO}/meta.json`), true);

console.log("\nLos topes al crear");
check(
  "un criptograma enorme se rechaza",
  (await crear(cookie, { ciphertext: "x".repeat(300 * 1024) })).status,
  413
);
check("y un iv enorme también", (await crear(cookie, { iv: "y".repeat(500) })).status, 413);
check("sin criptograma no hay secreto", (await crear(cookie, { ciphertext: "" })).status, 400);

console.log("\nLos plazos y las lecturas se acotan");
// `Math.min(Math.max(ttl ?? 24, 1), 168)` parecía suficiente y no lo era: con
// `ttlHours: "foo"` daba NaN, y como `NaN < Date.now()` es SIEMPRE false, el
// secreto no caducaba nunca. Un "se borra en una hora" que era para siempre.
const horas = (r) => Math.round((r.body.expiresAt - Date.now()) / 3_600_000);
check("un plazo absurdo se corta en siete días", horas(await crear(cookie, { ttlHours: 999999 })), 168);
check("uno negativo sube a una hora", horas(await crear(cookie, { ttlHours: -5 })), 1);
check("uno que no es número usa el de por defecto", horas(await crear(cookie, { ttlHours: "foo" })), 24);
check("y null también", horas(await crear(cookie, { ttlHours: null })), 24);
check("las lecturas se cortan en diez", (await crear(cookie, { maxViews: 99999 })).body.maxViews, 10);
check("y cero sube a una", (await crear(cookie, { maxViews: 0 })).body.maxViews, 1);

console.log("\nCuerpos que no se entienden");
// Cinco de seis daban 500. Un cuerpo que no se entiende es culpa de quien lo
// manda, no del servidor. Y exigir `application/json` es lo que corta el CSRF
// entre los servicios de este dominio: son el mismo sitio para el navegador, así
// que la cookie viaja, y sólo `text/plain`, `multipart` y los formularios salen
// sin que el navegador pregunte antes.
for (const [que, cuerpo, tipo] of [
  ["a medias", "{no-es-json", "application/json"],
  ["vacío", "", "application/json"],
  ["el texto null", "null", "application/json"],
  ["una lista", "[1,2]", "application/json"],
  ["texto suelto", "hola", "text/plain"],
  ["un formulario", "ciphertext=x&iv=y", "application/x-www-form-urlencoded"],
  ["JSON anunciado como texto", JSON.stringify({ ciphertext: "x".repeat(64), iv: "aaaabbbbccccdddd" }), "text/plain"],
]) {
  const r = await api("/api/secrets", { cookie, metodo: "POST", cuerpo, tipo });
  check(`un cuerpo ${que} da 400, no 500`, r.status, 400);
}
check(
  "y con el juego de caracteres detrás sigue valiendo",
  (await api("/api/secrets", {
    cookie,
    metodo: "POST",
    tipo: "application/json; charset=utf-8",
    cuerpo: { ciphertext: "x".repeat(64), iv: "aaaabbbbccccdddd" },
  })).status,
  200
);

resumen();
