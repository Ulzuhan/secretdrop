import { readdir, readFile, writeFile, mkdir, unlink, rmdir } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";

/**
 * Acceso al almacén de secretos: disco + caché en memoria, en un solo sitio.
 *
 * Antes esto estaba triplicado —`STORE_DIR`, `SecretMeta`, `deleteSecret` y la
 * limpieza vivían por separado en las tres rutas de API— y las copias ya habían
 * divergido: la de limpieza borraba del disco pero no de la caché en memoria,
 * así que un secreto podía seguir sirviéndose después de haber sido purgado.
 */

/**
 * Dónde viven los secretos.
 *
 * Configurable por entorno para que las pruebas no escriban en el almacén de
 * verdad: sin esto, cada tirada de tests dejaba secretos suyos mezclados con los
 * de la gente, en el mismo directorio y con la misma limpieza automática
 * pasándoles por encima. Sin variable puesta, se comporta como siempre.
 */
export const STORE_DIR =
  process.env.SECRETDROP_STORE_DIR?.trim() || join(process.cwd(), ".secretdrop-store");

export interface SecretMeta {
  id: string;
  ciphertext: string;
  iv: string;
  expiresAt: number;
  maxViews: number;
  viewCount: number;
  createdAt: number;
  burned: boolean;
}

const globalStore = globalThis as typeof globalThis & {
  __secretdrop_store__?: Map<string, SecretMeta>;
};

export function getStore(): Map<string, SecretMeta> {
  globalStore.__secretdrop_store__ ??= new Map();
  return globalStore.__secretdrop_store__;
}

/**
 * ¿Es este identificador uno de los nuestros?
 *
 * ESTO NO ES COSMÉTICA. El `id` llega de la URL y se concatenaba directamente
 * con `join(STORE_DIR, id, "meta.json")`. Next normaliza `.` y `..` con una
 * redirección, así que esa forma no llegaba — pero **la codificada sí**:
 * `%2e%2e%2f` repetido salía del almacén. Comprobado en vivo antes de arreglarlo:
 *
 *   · lectura de cualquier `meta.json` del sistema que el proceso pueda leer,
 *   · y si su `expiresAt` estaba en el pasado, el propio manejador llamaba a
 *     `deleteSecret()`, que **borraba ese fichero y hacía `rmdir` de su carpeta**.
 *
 * Todo ello **sin sesión**, porque leer un secreto es público por diseño: quien
 * recibe el enlace no tiene cuenta. Es decir, lectura y borrado arbitrarios
 * desde internet.
 *
 * Los ids son `randomBytes(9).toString("base64url")`: exactamente 12 caracteres
 * de `[A-Za-z0-9_-]`. Se valida contra esa forma exacta, lista blanca y no lista
 * negra, para que ninguna codificación nueva vuelva a colarse.
 */
const ID_VALIDO = /^[A-Za-z0-9_-]{12}$/;

export function idValido(id: string | undefined | null): boolean {
  return typeof id === "string" && ID_VALIDO.test(id);
}

export function nuevoId(): string {
  return randomBytes(9).toString("base64url");
}

/** Lee un secreto. Devuelve null si el id no es de los nuestros. */
export async function loadMeta(id: string): Promise<SecretMeta | null> {
  if (!idValido(id)) return null;

  const store = getStore();
  if (store.has(id)) return store.get(id)!;

  try {
    const raw = await readFile(join(STORE_DIR, id, "meta.json"), "utf-8");
    const meta: SecretMeta = JSON.parse(raw);

    // Segunda mirada a la caché, y no sobra.
    //
    // Entre el `store.has` de arriba y esta línea hay un `await`, y en ese hueco
    // caben otras peticiones del mismo secreto: todas ven la caché vacía, todas
    // leen el fichero y **cada una se queda con su propio objeto**. A partir de
    // ahí cada una lleva su cuenta de lecturas por separado, todas creen ser la
    // primera, y un secreto de un solo uso se entrega a todas.
    //
    // Con la lectura de disco a velocidad normal no se reprodujo —150 lecturas
    // simultáneas en frío, servidas una sola vez—. Pero eso no es una garantía,
    // es una carrera que hoy se pierde: ensanchando el hueco 50 ms a propósito,
    // un secreto de UN SOLO USO se entregó a los 30 lectores a la vez. Un disco
    // cargado o un sistema de ficheros más lento hacen lo mismo sin avisar.
    //
    // Quien llegue segundo se queda con el objeto del primero. Uno solo, y las
    // cuentas de lecturas vuelven a ser una.
    const yaCargado = store.get(id);
    if (yaCargado) return yaCargado;

    store.set(id, meta);
    return meta;
  } catch {
    return null;
  }
}

export async function saveMeta(meta: SecretMeta): Promise<void> {
  await mkdir(join(STORE_DIR, meta.id), { recursive: true });
  await writeFile(join(STORE_DIR, meta.id, "meta.json"), JSON.stringify(meta, null, 2));
  getStore().set(meta.id, meta);
}

/** Borra un secreto de disco y de memoria. No hace nada si el id no es válido. */
export async function deleteSecret(id: string): Promise<void> {
  if (!idValido(id)) return;
  try { await unlink(join(STORE_DIR, id, "meta.json")); } catch {}
  try { await rmdir(join(STORE_DIR, id)); } catch {}
  getStore().delete(id);
}

/**
 * Purga los caducados y los ya quemados.
 *
 * Pasa por `deleteSecret()` en lugar de borrar a mano, que es lo que antes
 * dejaba la caché desincronizada con el disco.
 */
export async function cleanupExpired(): Promise<number> {
  let borrados = 0;
  let entradas: string[];
  try {
    entradas = await readdir(STORE_DIR);
  } catch {
    return 0;
  }

  const ahora = Date.now();
  for (const id of entradas) {
    // Cualquier cosa que no tenga forma de id nuestro se ignora, no se borra:
    // este barrido no tiene por qué decidir sobre ficheros ajenos.
    if (!idValido(id)) continue;
    const meta = await loadMeta(id);
    if (!meta) continue;
    if (meta.burned || meta.expiresAt < ahora) {
      await deleteSecret(id);
      borrados++;
    }
  }
  return borrados;
}

/**
 * Un número dentro de un rango, o el valor por defecto.
 *
 * `Math.min(Math.max(ttlHours ?? 24, 1), 168)` parecía suficiente y no lo era:
 * con `ttlHours: "foo"` o `null`, `Math.max` devuelve NaN, y `expiresAt` se
 * guardaba como NaN. Como `NaN < Date.now()` es **siempre false**, el secreto
 * no caducaba nunca: un "se borra en 1 hora" que en realidad era para siempre.
 */
export function enRango(valor: unknown, min: number, max: number, porDefecto: number): number {
  const n = typeof valor === "number" ? valor : Number.NaN;
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(Math.max(Math.floor(n), min), max);
}
