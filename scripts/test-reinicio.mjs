/**
 * El listado tras un arranque en frío y tras un reinicio de verdad.
 *
 * El módulo de `/api/secrets` lanza `cleanupExpired()` al cargarse, y esa
 * función recorre el almacén con `loadMeta()`, que siembra el índice en
 * memoria. O sea que el índice **sí** se rellena desde disco. Lo que hay que
 * comprobar es que se rellena a tiempo: la llamada no se espera, así que la
 * primera petición al listado corre a la vez que ese recorrido.
 *
 * Por fases, porque hay que parar y arrancar el servidor entre medias:
 *
 *   sembrar        escribe el almacén ANTES de que exista el servidor
 *   frio           primera petición del proceso: el listado
 *   crear          uno por la API, para tenerlo también en disco
 *   tras-reinicio  el mismo almacén, otro proceso
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { api, check, crear, resumen, sesion } from "./comun.mjs";

const [fase] = process.argv.slice(2);
const ALMACEN = process.env.ALMACEN;
const ESTADO = process.env.ESTADO;
if (!ALMACEN || !ESTADO) {
  console.error("faltan ALMACEN y ESTADO");
  process.exit(1);
}

// Dos mil, y no menos, porque es el tamaño con el que la carrera de
// inicialización se perdía de verdad: con 1000 el listado salía completo y con
// 2000 devolvía 1606 de 2000. No es un umbral, es una carrera — bajar esto
// convierte la regresión en una prueba que no prueba nada.
const MIOS = Number(process.env.REINICIO_MIOS ?? 2000);
const AJENOS = Number(process.env.REINICIO_AJENOS ?? 200);
const SIN_DUENO = Number(process.env.REINICIO_HUERFANOS ?? 200);
const DUENO = "sub-reinicio";
const OTRO = "sub-de-otra-persona";
const cookie = sesion({ sub: DUENO });

const nuevoId = () => randomBytes(9).toString("base64url");

async function sembrarUno(owner) {
  const id = nuevoId();
  const ahora = Date.now();
  await mkdir(join(ALMACEN, id), { recursive: true });
  await writeFile(join(ALMACEN, id, "meta.json"), JSON.stringify({
    id, ciphertext: "Y0lQSEVSVEVYVE8=", iv: "aaaabbbbccccdddd",
    expiresAt: ahora + 86_400_000, maxViews: 5, viewCount: 0,
    createdAt: ahora - 1000, burned: false, ...(owner ? { owner } : {}),
  }));
  return id;
}

async function listar() {
  const r = await api("/api/secrets", { cookie });
  return { status: r.status, ids: (r.body?.secrets ?? []).map((s) => s.id) };
}

if (fase === "sembrar") {
  const mios = [];
  for (let i = 0; i < MIOS; i++) mios.push(await sembrarUno(DUENO));
  const ajenos = [];
  for (let i = 0; i < AJENOS; i++) ajenos.push(await sembrarUno(OTRO));
  const huerfanos = [];
  for (let i = 0; i < SIN_DUENO; i++) huerfanos.push(await sembrarUno(null));
  await writeFile(ESTADO, JSON.stringify({ mios, ajenos, huerfanos }));
  console.log(`  sembrados ${mios.length} propios, ${ajenos.length} ajenos y ${huerfanos.length} sin dueño`);
  process.exit(0);
}

const estado = JSON.parse(await readFile(ESTADO, "utf-8"));

if (fase === "frio") {
  // LA PRIMERA petición que este proceso recibe en /api/secrets. Si el índice
  // se llena sin esperarse, aquí se ve una lista corta.
  const { status, ids } = await listar();
  check("el listado responde en frío", status, 200);
  check(`  están los ${MIOS} propios sembrados antes de arrancar`,
    estado.mios.filter((id) => ids.includes(id)).length, MIOS);
  check("  no está ninguno de otra persona",
    estado.ajenos.some((id) => ids.includes(id)), false);
  check("  no está ninguno sin dueño",
    estado.huerfanos.some((id) => ids.includes(id)), false);
  check("  y no aparece nada más", ids.length, MIOS);
  resumen();
} else if (fase === "crear") {
  const r = await crear(cookie, { ttlHours: 24, maxViews: 3 });
  check("crear por la API responde", r.status, 200);
  check("  con un id", typeof r.body?.id, "string");
  await writeFile(ESTADO, JSON.stringify({ ...estado, creado: r.body?.id }));
  resumen();
} else if (fase === "tras-reinicio") {
  const { status, ids } = await listar();
  check("el listado responde tras reiniciar", status, 200);
  check("  sigue el creado por la API", ids.includes(estado.creado), true);
  check(`  y siguen los ${MIOS} sembrados`,
    estado.mios.filter((id) => ids.includes(id)).length, MIOS);
  check("  sin colarse los ajenos ni los huérfanos", ids.length, MIOS + 1);
  resumen();
} else {
  console.error(`fase desconocida: ${fase}`);
  process.exit(1);
}
