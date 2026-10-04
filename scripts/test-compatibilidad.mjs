#!/usr/bin/env node
/**
 * Baseline → candidata Go → mismo baseline sobre el MISMO almacén, y nunca los dos a la vez.
 *
 * Es la prueba que decide si se puede cambiar de implementación y volver: lo
 * que una escribe, la otra lo tiene que entender, y **volver atrás no puede
 * resucitar nada** — ni un secreto ya entregado ni un permiso ya retirado.
 *
 * Lo lanza `test-compatibilidad.sh`, que arranca y para cada implementación en
 * su turno y comprueba que el puerto queda libre en medio.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BASE, check, crear, resumen, sesion } from "./comun.mjs";

const paso = process.argv[2];
const anterior = process.env.SECRETDROP_COMPAT_PREVIOUS_LABEL ?? "Node 0.7.3";
const ESTADO = process.env.ESTADO ?? "/tmp/compat-estado.json";
const IDP = process.env.ORIGEN_IDP ?? "http://127.0.0.1:9994";

const A = sesion({ sub: "sub-a", email: "a@example.invalid" });
const B = sesion({ sub: "sub-b", email: "b@example.invalid" });

const leer = () => JSON.parse(readFileSync(ESTADO, "utf8"));
const guardar = (o) => writeFileSync(ESTADO, JSON.stringify(o));
// Only the synthetic fixture directory supplied by the harness.
const meta = (id) => JSON.parse(readFileSync(`${process.env.ALMACEN}/${id}/meta.json`, "utf8"));
const persisted = (id, views, burned) => {
  const m = meta(id);
  check("contador y lápida durables", [m.viewCount, m.burned], [views, burned]);
  check("fechas en milisegundos", [m.createdAt, m.expiresAt].every((n) => Number.isSafeInteger(n) && n > 10 ** 12), true);
  if (burned) {
    check("lápida sin criptograma ni IV", [m.ciphertext, m.iv], ["", ""]);
    check("burnedAt en milisegundos", Number.isSafeInteger(m.burnedAt) && m.burnedAt > 10 ** 12, true);
  }
};

const consumir = async (id) => {
  const r = await fetch(`${BASE}/api/secrets/${id}`);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const listar = async (cookie) => {
  const r = await fetch(`${BASE}/api/secrets`, { headers: { cookie } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const revocar = async (sub) => {
  const { logout_token } = await (await fetch(`${IDP}/__firmar`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sub }),
  })).json();
  const r = await fetch(`${BASE}/api/auth/backchannel-logout`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ logout_token }),
  });
  return r.status;
};

if (paso === "sembrar-node") {
  console.log(`${anterior} siembra`);
  const s1 = (await crear(A, { ttlHours: 2, maxViews: 1 })).body;
  const s2 = (await crear(A, { ttlHours: 2, maxViews: 2 })).body;
  const s3 = (await crear(A, { ttlHours: 2, maxViews: 1 })).body;
  const s4 = (await crear(B, { ttlHours: 2, maxViews: 1 })).body;
  check("crea cuatro secretos", [s1, s2, s3, s4].every((s) => s?.id?.length === 12), true);

  // Uno se gasta entero: deja lápida. Otro se usa una vez de dos: deja uso.
  check("gasta el primero", (await consumir(s1.id)).body.burned, true);
  const medio = await consumir(s2.id);
  check("usa el segundo una vez de dos", [medio.body.viewCount, medio.body.burned], [1, false]);

  // Y se revoca a B con un aviso de cierre firmado de verdad.
  check("el proveedor revoca a B", await revocar("sub-b"), 200);
  check("  y B deja de ver lo suyo aquí mismo", (await listar(B)).status, 401);

  persisted(s3.id, 0, false);
  persisted(s1.id, 1, true);
  persisted(s2.id, 1, false);
  guardar({ s1: s1.id, s2: s2.id, s3: s3.id, s4: s4.id, cifrado2: s2.ciphertext ?? null });
  resumen();
}

if (paso === "verificar-go") {
  console.log(`Candidata Go, sobre lo que dejó ${anterior}`);
  const e = leer();
  check("la lápida no resucita", (await consumir(e.s1)).status, 410);
  persisted(e.s1, 1, true);
  persisted(e.s2, 1, false);
  persisted(e.s3, 0, false);
  const resto = await consumir(e.s2);
  check("el uso previo se conserva", [resto.status, resto.body.viewCount, resto.body.burned], [200, 2, true]);
  const listaA = await listar(A);
  check(`A sigue entrando con la cookie de ${anterior}`, listaA.status, 200);
  check("  y ve lo suyo sin gastar", listaA.body.secrets?.some((s) => s.id === e.s3), true);
  check("  sin ver lo de B", listaA.body.secrets?.some((s) => s.id === e.s4), false);
  check(`la revocación de B la escribió ${anterior} y Go la respeta`, (await listar(B)).status, 401);

  // La candidata escribe: crea uno y gasta otro del baseline.
  const s5 = (await crear(A, { ttlHours: 2, maxViews: 1 })).body;
  check("la candidata crea sobre el almacén anterior", s5?.id?.length, 12);
  check("  y gasta uno del baseline", (await consumir(e.s3)).body.burned, true);
  // Y revoca a otra cuenta, para comprobar el sentido contrario al volver.
  check("la candidata revoca a C", await revocar("sub-c"), 200);

  persisted(s5.id, 0, false);
  persisted(e.s2, 2, true);
  persisted(e.s3, 1, true);
  guardar({ ...e, s5: s5.id });
  resumen();
}

if (paso === "verificar-node") {
  console.log(`${anterior} otra vez: la vuelta atrás`);
  const e = leer();
  const C = sesion({ sub: "sub-c", email: "c@example.invalid" });
  persisted(e.s5, 0, false);
  persisted(e.s2, 2, true);
  const listaA = await listar(A);
  check(`${anterior} lee lo que creó Go`, listaA.body.secrets?.some((s) => s.id === e.s5), true);
  check("y lo entrega", (await consumir(e.s5)).body.burned, true);

  // Lo importante de una vuelta atrás: nada de lo gastado vuelve.
  for (const [nombre, id] of [["el que gastó el baseline", e.s1], ["el que agotó la candidata", e.s2], ["el que gastó la candidata", e.s3]]) {
    check(`${nombre} sigue gastado`, (await consumir(id)).status, 410);
  }
  check("y el listado de A queda vacío", (await listar(A)).body.secrets?.length, 0);

  // Ni los permisos: las dos revocaciones siguen en pie, la escribiera quien
  // la escribiera.
  check("la revocación que escribió el baseline sigue en pie", (await listar(B)).status, 401);
  check("la revocación que escribió la candidata también", (await listar(C)).status, 401);
  resumen();
}
