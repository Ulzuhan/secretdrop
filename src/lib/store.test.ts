import { describe, expect, it } from "vitest";
import { enRango, idValido, nuevoId } from "./store";

/**
 * Estas dos funciones no se prueban por completitud: son **exactamente las dos
 * que estaban rotas** cuando se auditó este servicio.
 *
 *   idValido  no existía, y el id de la URL se concatenaba con `join()`. Con
 *             `%2e%2e%2f` repetido se salía del almacén: lectura de cualquier
 *             `meta.json` del sistema y borrado del fichero y su carpeta si la
 *             fecha estaba vencida. Sin sesión, porque leer es público.
 *
 *   enRango   no existía; había un `Math.min(Math.max(ttl ?? 24, 1), 168)` que
 *             con una entrada no numérica devolvía NaN. Como `NaN < Date.now()`
 *             es siempre false, el secreto no caducaba jamás.
 *
 * Un fallo aquí no da error ni se ve en pantalla: simplemente el servicio deja
 * de cumplir lo que promete. Por eso estos casos y no otros.
 */

describe("idValido", () => {
  it("acepta los ids que este servicio genera", () => {
    // No un ejemplo escrito a mano: los de verdad, muchas veces, porque
    // base64url produce `-` y `_` con poca frecuencia y un solo caso podría
    // no verlos nunca.
    for (let i = 0; i < 500; i++) {
      const id = nuevoId();
      expect(id, `id generado: ${id}`).toHaveLength(12);
      expect(idValido(id), `id generado: ${id}`).toBe(true);
    }
  });

  it("rechaza las travesías de ruta, incluidas las codificadas", () => {
    // La forma cruda no llega al manejador porque Next la normaliza; la
    // codificada sí llegaba, y es la que abrió el agujero.
    const ataques = [
      ".",
      "..",
      "../..",
      "../../etc",
      "%2e%2e%2f",
      "%2e%2e%2f%2e%2e%2fetc",
      "..%2f..%2fetc",
      "../../../../../../../tmp/objetivo",
      "a/../..",
      "/etc/passwd",
      "\\..\\..\\windows",
    ];
    for (const a of ataques) {
      expect(idValido(a), `debería rechazar: ${a}`).toBe(false);
    }
  });

  it("rechaza longitudes distintas de 12", () => {
    expect(idValido("")).toBe(false);
    expect(idValido("abc")).toBe(false);
    expect(idValido("abcdefghijk")).toBe(false); // 11
    expect(idValido("abcdefghijklm")).toBe(false); // 13
  });

  it("rechaza caracteres fuera del alfabeto base64url", () => {
    // 12 caracteres exactos en todos, para que lo único que falle sea el
    // alfabeto y no la longitud.
    expect(idValido("abcdefghij.k")).toBe(false);
    expect(idValido("abcdefghij/k")).toBe(false);
    expect(idValido("abcdefghij+k")).toBe(false); // base64 normal, no url-safe
    expect(idValido("abcdefghij=k")).toBe(false);
    expect(idValido("abcdefghij k")).toBe(false);
    expect(idValido("abcdefghijñk")).toBe(false);
    expect(idValido("abcdefghij\u0000k")).toBe(false);
  });

  it("rechaza lo que no es una cadena", () => {
    expect(idValido(undefined)).toBe(false);
    expect(idValido(null)).toBe(false);
    // El id llega de una URL, pero un JSON mal formado podría traer otra cosa.
    expect(idValido(12345678901 as unknown as string)).toBe(false);
  });
});

describe("enRango", () => {
  it("deja pasar los valores dentro del rango", () => {
    expect(enRango(24, 1, 168, 24)).toBe(24);
    expect(enRango(1, 1, 168, 24)).toBe(1);
    expect(enRango(168, 1, 168, 24)).toBe(168);
  });

  it("recorta a los extremos en vez de rechazar", () => {
    expect(enRango(0, 1, 168, 24)).toBe(1);
    expect(enRango(-5, 1, 168, 24)).toBe(1);
    expect(enRango(9999, 1, 168, 24)).toBe(168);
  });

  it("cae al valor por defecto ante cualquier cosa que no sea número finito", () => {
    // Este era el fallo: cualquiera de estos producía NaN y el secreto
    // dejaba de caducar.
    const basura = ["foo", "24", null, undefined, {}, [], true, NaN, Infinity, -Infinity];
    for (const v of basura) {
      expect(enRango(v, 1, 168, 24), `entrada: ${JSON.stringify(v)}`).toBe(24);
    }
  });

  it("nunca devuelve NaN, que es lo que rompía la caducidad", () => {
    const entradas = ["foo", null, undefined, NaN, Infinity, {}, [], 3.7, -2, 1e9];
    for (const v of entradas) {
      const r = enRango(v, 1, 168, 24);
      expect(Number.isFinite(r), `entrada: ${JSON.stringify(v)}`).toBe(true);
      // Y lo que de verdad importaba: la comparación de caducidad funciona.
      const expiresAt = Date.now() + r * 3600_000;
      expect(expiresAt > Date.now()).toBe(true);
    }
  });

  it("trunca los decimales en lugar de guardar fracciones", () => {
    expect(enRango(3.9, 1, 168, 24)).toBe(3);
    expect(enRango(1.9, 1, 10, 1)).toBe(1);
  });
});

/**
 * Dos lecturas a la vez del mismo secreto tienen que hablar del MISMO objeto.
 *
 * Es lo único que sostiene la promesa de esta herramienta. `loadMeta` mira la
 * caché, no lo encuentra, y lee el fichero; entre esas dos cosas hay un `await`,
 * y en ese hueco caben otras peticiones del mismo secreto. Si cada una se queda
 * con su propia copia, cada una lleva su cuenta de lecturas por separado, todas
 * creen ser la primera, y un secreto de un solo uso se entrega a todas.
 *
 * No se prueba con relojes ni con peticiones simultáneas, que dependen de lo
 * cargada que esté la máquina: se prueba por la identidad de los objetos, que es
 * lo que de verdad decide. Si son el mismo, el contador es uno.
 *
 * Se comprobó que esto pasa de verdad ensanchando ese hueco 50 ms a propósito:
 * un secreto de UN SOLO USO se entregó a los 30 lectores a la vez.
 */
describe("loadMeta con la caché fría", () => {
  it("entrega el mismo objeto a quienes llegan a la vez", async () => {
    const { loadMeta, saveMeta, deleteSecret, getStore, nuevoId: nuevo } = await import("./store");

    const id = nuevo();
    await saveMeta({
      id,
      ciphertext: "x".repeat(32),
      iv: "aaaabbbbccccdddd",
      expiresAt: Date.now() + 3_600_000,
      maxViews: 1,
      viewCount: 0,
      createdAt: Date.now(),
      burned: false,
    });

    // Enfriar la caché a mano es lo que reproduce el arranque del servidor: el
    // fichero sigue en disco y la memoria está vacía.
    getStore().delete(id);
    expect(getStore().has(id), "la caché tiene que estar fría para que esto pruebe algo").toBe(false);

    const [a, b, c] = await Promise.all([loadMeta(id), loadMeta(id), loadMeta(id)]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(c).toBe(a);

    // Y la consecuencia, que es lo que importa: una lectura en uno se ve en los
    // otros, así que el segundo en llegar encuentra el secreto ya quemado.
    a!.viewCount++;
    a!.burned = true;
    expect(b!.burned, "quien llegó después tiene que ver que ya está quemado").toBe(true);
    expect(c!.viewCount).toBe(1);

    await deleteSecret(id);
  });
});

describe("consumeSecret", () => {
  it("a failed creation releases its queue and allows a later creation", async () => {
    const { writeFile, unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { STORE_DIR, saveNewMeta, nuevoId, pendingConsumes } = await import("./store");
    const id = nuevoId();
    const meta = { id, ciphertext: "encrypted", iv: "iv", expiresAt: Date.now() + 60_000,
      maxViews: 1, viewCount: 0, createdAt: Date.now(), burned: false };
    // A file in place of the directory makes the actual filesystem write fail.
    await writeFile(join(STORE_DIR, id), "collision");
    await expect(saveNewMeta(meta)).rejects.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pendingConsumes()).toBe(0);
    await unlink(join(STORE_DIR, id));
    await expect(saveNewMeta(meta)).resolves.toBe("ok");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pendingConsumes()).toBe(0);
  });
  it("forgets queues for nonexistent ids after they settle", async () => {
    const { consumeSecret, nuevoId, pendingConsumes } = await import("./store");
    await Promise.all(Array.from({ length: 1000 }, () => consumeSecret(nuevoId())));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pendingConsumes()).toBe(0);
  });
  it("borra el material antes de entregar la última vista", async () => {
    const { consumeSecret, loadMeta, saveMeta, nuevoId: nuevo } = await import("./store");
    const id = nuevo();
    await saveMeta({
      id,
      ciphertext: "cifrado",
      iv: "iv-seguro",
      expiresAt: Date.now() + 60_000,
      maxViews: 1,
      viewCount: 0,
      createdAt: Date.now(),
      burned: false,
    });

    const consumed = await consumeSecret(id);
    expect(consumed.ok).toBe(true);
    if (consumed.ok) expect(consumed.meta.burned).toBe(true);
    const tombstone = await loadMeta(id);
    expect(tombstone?.burned).toBe(true);
    expect(tombstone?.ciphertext).toBe("");
    expect(tombstone?.iv).toBe("");
  });

  it("serializa todas las vistas y nunca entrega más del presupuesto", async () => {
    const { consumeSecret, saveMeta, nuevoId: nuevo } = await import("./store");
    const id = nuevo();
    await saveMeta({
      id,
      ciphertext: "cifrado",
      iv: "iv-seguro",
      expiresAt: Date.now() + 60_000,
      maxViews: 3,
      viewCount: 0,
      createdAt: Date.now(),
      burned: false,
    });

    const results = await Promise.all(Array.from({ length: 30 }, () => consumeSecret(id)));
    expect(results.filter((result) => result.ok)).toHaveLength(3);
  });
});
