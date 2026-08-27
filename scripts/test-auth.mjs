/**
 * La puerta.
 *
 * Crear un secreto exige cuenta; leerlo no, porque quien recibe el enlace no
 * tiene por qué tenerla. Esa asimetría es de diseño, y por eso importa que la
 * mitad cerrada esté cerrada de verdad —y que la abierta siga abierta—.
 */
import { api, check, crear, firmar, resumen, sesion, BASE } from "./comun.mjs";

console.log("La puerta, por sus dos caras");
const buena = sesion();
check("una sesión legítima crea", (await crear(buena)).status, 200);
check("sin cookie, no", (await crear(null)).status, 401);

console.log("\nSesiones que no valen");
const [carga, firma] = buena.split("=")[1].split(".");
const con = (v) => `secretdrop_session=${v}`;
const ahora = Date.now();
for (const [que, cookie] of [
  ["la firma cambiada", con(`${carga}.${firma.slice(0, -4)}AAAA`)],
  ["la firma vacía", con(`${carga}.`)],
  ["sin firma ni punto", con(carga)],
  [
    "la carga cambiada dejando la firma buena",
    con(`${Buffer.from(JSON.stringify({ sub: "otro", email: "otro@x.invalid", exp: ahora + 3600_000 })).toString("base64url")}.${firma}`),
  ],
  ["firmada con otro secreto", firmar({ sub: "x", email: "x@x.invalid", exp: ahora + 3600_000 }, "otro-secreto")],
  ["caducada", firmar({ sub: "x", email: "x@x.invalid", exp: ahora - 1000 })],
  ["sin fecha de caducidad", firmar({ sub: "x", email: "x@x.invalid" })],
  ["con la caducidad como texto", firmar({ sub: "x", email: "x@x.invalid", exp: "9999999999999" })],
  ["sin correo", firmar({ sub: "x", exp: ahora + 3600_000 })],
  ["basura", con("nada.de-nada")],
  ["vacía", con("")],
]) {
  check(`no crea con ${que}`, (await crear(cookie)).status, 401);
}

console.log("\nEl desvío al entrar");
// Sin esto, un enlace con ?next=https://otro-sitio convierte el inicio de sesión
// en un redirector a donde quiera quien mande el enlace.
for (const destino of [
  "https://malo.example",
  "//malo.example",
  "/\\malo.example",
  "javascript:alert(1)",
  "https:/malo.example",
  "  //malo.example",
]) {
  const res = await fetch(`${BASE}/api/auth/login?next=${encodeURIComponent(destino)}`, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  const sale = Boolean(location) && !location.startsWith("/") && !/^https?:\/\/127\.0\.0\.1:9999/.test(location);
  check(`next=${destino.trim().slice(0, 20)} no saca de casa`, sale, false);
}

console.log("\nLa vuelta del proveedor");
// El `state` es lo único que impide que alguien nos haga abrir sesión con SU
// código.
for (const [que, cola, galleta] of [
  ["sin nada", "", null],
  ["sólo con el código", "?code=inventado", null],
  ["con código y state pero sin cookie", "?code=x&state=y", null],
  [
    "con el state de la URL distinto al de la cookie",
    "?code=x&state=elmio",
    `secretdrop_oidc=${encodeURIComponent(JSON.stringify({ verifier: "v", state: "otro", next: "/" }))}`,
  ],
]) {
  const r = await fetch(`${BASE}/api/auth/callback${cola}`, {
    redirect: "manual",
    ...(galleta ? { headers: { cookie: galleta } } : {}),
  });
  check(`no abre sesión ${que}`, /secretdrop_session=[^;]{10,}/.test(r.headers.get("set-cookie") ?? ""), false);
}


console.log("\nPeticiones simples desde otro origen");
const cruzadas = { Origin: "https://evil.example.com", "Sec-Fetch-Site": "same-site" };
const limpiezaCruzada = await api("/api/cleanup", {
  cookie: buena,
  metodo: "POST",
  cabeceras: cruzadas,
});
check("un dominio hermano no fuerza la limpieza", limpiezaCruzada.status, 403);
const salidaCruzada = await api("/api/auth/logout", {
  cookie: buena,
  metodo: "POST",
  cabeceras: cruzadas,
});
check("ni fuerza el cierre de sesión", salidaCruzada.status, 403);

/**
 * Y la cabecera que decide de dónde viene la petición no la puede escribir quien
 * llama.
 *
 * `X-Forwarded-Host` **no la reemplaza este despliegue**: comprobado en vivo contra
 * el túnel, llega intacta mientras `Host` sigue valiendo el nombre de verdad.
 * Mientras se prefirió la primera, los dos guardianes se saltaban solos: cerrar la
 * sesión y lanzar la purga daban 200 con un `Origin` a juego.
 *
 * El `Origin` va con el mismo esquema que ve el servidor de pruebas, a propósito:
 * con otro, la comprobación rechazaría por el esquema y este test pasaría aunque el
 * fallo siguiera ahí. Y sin `Sec-Fetch-Site`, que es como llega un navegador que no
 * manda Fetch Metadata: deja sola a la comprobación de origen.
 */
const falseada = { Origin: "http://malo.example", "X-Forwarded-Host": "malo.example" };
check(
  "una cabecera X-Forwarded-Host inventada no fuerza la limpieza",
  (await api("/api/cleanup", { cookie: buena, metodo: "POST", cabeceras: falseada })).status,
  403
);
check(
  "ni el cierre de sesión",
  (await api("/api/auth/logout", { cookie: buena, metodo: "POST", cabeceras: falseada })).status,
  403
);
check("y la sesión sigue en pie", (await crear(buena)).status, 200);
check("ni manda borrar la cookie", salidaCruzada.set, null);
console.log("\nSalir");
const salida = await api("/api/auth/logout", { cookie: buena, metodo: "POST" });
const borrada = /secretdrop_session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/.test(salida.set ?? "");
check("al salir se borra la cookie", borrada, true);

resumen();
