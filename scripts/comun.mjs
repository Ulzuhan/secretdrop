/**
 * Lo que comparten las suites HTTP.
 *
 * Esta aplicación no tiene login local: la identidad la lleva Authentik entera.
 * Así que las pruebas acuñan la cookie de sesión con el mismo secreto que el
 * servidor de pruebas, que es la única forma de ejercitar lo que hay detrás sin
 * levantar un proveedor de identidad para cada tirada.
 */
import { createHmac } from "node:crypto";

export const BASE = process.env.BASE || "http://127.0.0.1:3992";
export const SECRETO = process.env.SECRETDROP_SESSION_SECRET || "secreto-de-pruebas-secretdrop-32-bytes-minimo";

let pasan = 0;
let fallan = 0;

export function check(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(
    `  ${ok ? "✓" : "✗"} ${nombre}${ok ? "" : `  (esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)})`}`
  );
  if (ok) pasan++;
  else fallan++;
}

export function nota(nombre, valor) {
  console.log(`  · ${nombre}: ${typeof valor === "string" ? valor : JSON.stringify(valor)}`);
}

export function resumen() {
  console.log(`\n${pasan} pasan, ${fallan} fallan`);
  process.exit(fallan === 0 ? 0 : 1);
}

export function sesion(extra = {}) {
  const carga = Buffer.from(
    JSON.stringify({ sub: "pruebas", email: "pruebas@example.invalid", exp: Date.now() + 3600_000, ...extra })
  ).toString("base64url");
  return `secretdrop_session=${carga}.${createHmac("sha256", SECRETO).update(carga).digest("base64url")}`;
}

export function firmar(objeto, secreto = SECRETO) {
  const carga = Buffer.from(JSON.stringify(objeto)).toString("base64url");
  return `secretdrop_session=${carga}.${createHmac("sha256", secreto).update(carga).digest("base64url")}`;
}

/** Una petición, con el tipo de cuerpo por defecto que usa el cliente. */
export async function api(ruta, { cookie, metodo = "GET", cuerpo, tipo = "application/json", cabeceras = {} } = {}) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      ...(cuerpo !== undefined ? { "Content-Type": tipo } : {}),
      ...(cookie ? { cookie } : {}),
      ...cabeceras,
    },
    ...(cuerpo !== undefined ? { body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) } : {}),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body, set: res.headers.get("set-cookie"), location: res.headers.get("location") };
}

/** Crea un secreto y devuelve su id. */
export async function crear(cookie, campos = {}) {
  const r = await api("/api/secrets", {
    cookie,
    metodo: "POST",
    cuerpo: { ciphertext: "x".repeat(64), iv: "aaaabbbbccccdddd", ttlHours: 1, maxViews: 1, ...campos },
  });
  return r;
}
