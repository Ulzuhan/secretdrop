/**
 * Los contratos que un port tiene que cumplir para ser el mismo servicio.
 *
 * Esto no prueba funciones nuevas: fija lo que YA hace la implementación actual
 * en los sitios donde una reescritura se desvía sin que nadie lo note. Dos
 * frentes, y los dos se comprueban por HTTP contra lo que haya escuchando:
 *
 *   · el almacén, sembrando `meta.json` a mano y mirando qué responde;
 *   · la sesión, acuñando cookies y mirando cuáles se aceptan.
 *
 * Sembrar los ficheros directamente es deliberado: crear los casos por la API
 * no permite fabricar una lápida, un registro heredado sin dueño ni algo ya
 * caducado, que es justo donde un almacén nuevo se equivoca.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { api, check, crear, resumen, sesion, SECRETO } from "./comun.mjs";

const ALMACEN = process.env.ALMACEN;
if (!ALMACEN) {
  console.error("falta ALMACEN: esta suite siembra el almacén a mano");
  process.exit(1);
}

const DUENO = "sub-contratos";
const ahora = Date.now();
const nuevoId = () => randomBytes(9).toString("base64url");

async function sembrar(campos) {
  const id = campos.id ?? nuevoId();
  const meta = {
    id, ciphertext: "Y0lQSEVSVEVYVE8=", iv: "aaaabbbbccccdddd",
    expiresAt: ahora + 3_600_000, maxViews: 1, viewCount: 0,
    createdAt: ahora - 1000, burned: false, ...campos, ...(campos.id ? {} : { id }),
  };
  await mkdir(join(ALMACEN, id), { recursive: true });
  await writeFile(join(ALMACEN, id, "meta.json"), JSON.stringify(meta));
  return id;
}

console.log("El almacén: lo que un port tiene que leer igual");

const vivo = await sembrar({ owner: DUENO });
const entrega = await api(`/api/secrets/${vivo}`);
check("un secreto vivo se entrega", entrega.status, 200);
check("  con su criptograma intacto", entrega.body?.ciphertext, "Y0lQSEVSVEVYVE8=");
check("  con su iv intacto", entrega.body?.iv, "aaaabbbbccccdddd");
check("  contando la vista", entrega.body?.viewCount, 1);
check("  y marcado como quemado", entrega.body?.burned, true);
check("el mismo, una segunda vez, ya no", (await api(`/api/secrets/${vivo}`)).status, 410);

const parcial = await sembrar({ maxViews: 3, viewCount: 2, owner: DUENO });
const ultima = await api(`/api/secrets/${parcial}`);
check("el último uso de varios se entrega", ultima.status, 200);
check("  y ese último quema", ultima.body?.burned, true);

const caducado = await sembrar({ expiresAt: ahora - 1000, owner: DUENO });
check("un secreto caducado no se entrega", (await api(`/api/secrets/${caducado}`)).status, 410);

// Una lápida es un registro quemado SIN criptograma: se conserva para poder
// responder «ya se usó» en vez de «no existe» durante su retención.
const lapida = await sembrar({
  ciphertext: "", iv: "", burned: true, viewCount: 1,
  burnedAt: ahora - 60_000, owner: DUENO,
});
check("una lápida responde que ya se usó", (await api(`/api/secrets/${lapida}`)).status, 410);

// Los registros anteriores al campo `owner` no tienen dueño: su enlace sigue
// funcionando, pero no se le pueden enseñar a nadie en un listado.
// Los registros anteriores al campo `owner` conservan su enlace: se lee por id
// y va a disco. Que NO salgan en ningún listado se comprueba en la suite de
// reinicio, que es la que puede sembrarlos antes de que el índice se llene.
const heredado = await sembrar({});
check("el enlace de un registro heredado sin dueño sigue sirviendo",
  (await api(`/api/secrets/${heredado}`)).status, 200);

const cookieDueno = sesion({ sub: DUENO });
const creado = await crear(cookieDueno, { ttlHours: 2, maxViews: 2 });
check("crear por la API devuelve el id", typeof creado.body?.id, "string");
const listado = await api("/api/secrets", { cookie: cookieDueno });
check("el listado del titular responde", listado.status, 200);
check("  y enseña lo que acaba de crear",
  (listado.body?.secrets ?? []).map((x) => x.id).includes(creado.body?.id), true);

check("un id que no existe es 404", (await api(`/api/secrets/${nuevoId()}`)).status, 404);
check("un id con forma inválida es 404", (await api("/api/secrets/no-valido!!")).status, 404);

console.log("\nLa sesión: lo que un port tiene que aceptar y rechazar igual");

check("una cookie válida entra", (await api("/api/secrets", { cookie: sesion({ sub: DUENO }) })).status, 200);
check("sin cookie, no", (await api("/api/secrets")).status, 401);
check("una cookie caducada, no",
  (await api("/api/secrets", { cookie: sesion({ sub: DUENO, exp: ahora - 1000 }) })).status, 401);

const buena = sesion({ sub: DUENO });
const [carga, firma] = buena.split("=")[1].split(".");
check("con la firma cambiada, no",
  (await api("/api/secrets", { cookie: `secretdrop_session=${carga}.${firma.slice(0, -2)}xy` })).status, 401);
check("firmada con otro secreto, no",
  (await api("/api/secrets", {
    cookie: `secretdrop_session=${carga}.${createHmac("sha256", "otro-secreto-distinto-de-32-bytes-min").update(carga).digest("base64url")}`,
  })).status, 401);

// La firma va sobre los BYTES recibidos, no sobre el JSON vuelto a serializar.
// Un port que decodifique, reserialice y luego verifique aceptaría esto, y con
// ello cualquier reordenación o espaciado que produzca el mismo objeto.
const original = JSON.parse(Buffer.from(carga, "base64url").toString());
const recodificada = Buffer.from(JSON.stringify(original, null, 1)).toString("base64url");
check("la misma carga recodificada con la firma de la original, no",
  (await api("/api/secrets", { cookie: `secretdrop_session=${recodificada}.${firma}` })).status, 401);

const noJson = Buffer.from("esto no es json").toString("base64url");
check("una carga que no es JSON, no",
  (await api("/api/secrets", {
    cookie: `secretdrop_session=${noJson}.${createHmac("sha256", SECRETO).update(noJson).digest("base64url")}`,
  })).status, 401);

resumen();
