#!/usr/bin/env node
/**
 * Node → Go → Node sobre el MISMO almacén, y nunca los dos a la vez.
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
const ESTADO = process.env.ESTADO ?? "/tmp/compat-estado.json";
const IDP = process.env.ORIGEN_IDP ?? "http://127.0.0.1:9994";

const A = sesion({ sub: "sub-a", email: "a@example.invalid" });
const B = sesion({ sub: "sub-b", email: "b@example.invalid" });

const leer = () => JSON.parse(readFileSync(ESTADO, "utf8"));
const guardar = (o) => writeFileSync(ESTADO, JSON.stringify(o));

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
  console.log("Node siembra");
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

  guardar({ s1: s1.id, s2: s2.id, s3: s3.id, s4: s4.id, cifrado2: s2.ciphertext ?? null });
  resumen();
}

if (paso === "verificar-go") {
  console.log("Go, sobre lo que dejó Node");
  const e = leer();
  check("la lápida no resucita", (await consumir(e.s1)).status, 410);
  const resto = await consumir(e.s2);
  check("el uso previo se conserva", [resto.status, resto.body.viewCount, resto.body.burned], [200, 2, true]);
  const listaA = await listar(A);
  check("A sigue entrando con la cookie de Node", listaA.status, 200);
  check("  y ve lo suyo sin gastar", listaA.body.secrets?.some((s) => s.id === e.s3), true);
  check("  sin ver lo de B", listaA.body.secrets?.some((s) => s.id === e.s4), false);
  check("la revocación de B la escribió Node y Go la respeta", (await listar(B)).status, 401);

  // Go escribe: crea uno y gasta otro de los de Node.
  const s5 = (await crear(A, { ttlHours: 2, maxViews: 1 })).body;
  check("Go crea sobre el almacén de Node", s5?.id?.length, 12);
  check("  y gasta uno de los de Node", (await consumir(e.s3)).body.burned, true);
  // Y revoca a otra cuenta, para comprobar el sentido contrario al volver.
  check("Go revoca a C", await revocar("sub-c"), 200);

  guardar({ ...e, s5: s5.id });
  resumen();
}

if (paso === "verificar-node") {
  console.log("Node otra vez: la vuelta atrás");
  const e = leer();
  const C = sesion({ sub: "sub-c", email: "c@example.invalid" });
  const listaA = await listar(A);
  check("Node lee lo que creó Go", listaA.body.secrets?.some((s) => s.id === e.s5), true);
  check("y lo entrega", (await consumir(e.s5)).body.burned, true);

  // Lo importante de una vuelta atrás: nada de lo gastado vuelve.
  for (const [nombre, id] of [["el que gastó Node", e.s1], ["el que agotó Go", e.s2], ["el que gastó Go", e.s3]]) {
    check(`${nombre} sigue gastado`, (await consumir(id)).status, 410);
  }
  check("y el listado de A queda vacío", (await listar(A)).body.secrets?.length, 0);

  // Ni los permisos: las dos revocaciones siguen en pie, la escribiera quien
  // la escribiera.
  check("la revocación que escribió Node sigue en pie", (await listar(B)).status, 401);
  check("la revocación que escribió Go también", (await listar(C)).status, 401);
  resumen();
}
