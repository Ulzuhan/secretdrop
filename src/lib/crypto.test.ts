import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, generateKey } from "./crypto";

/**
 * La promesa de este servicio es que el servidor no puede leer el secreto.
 * Eso descansa entero en este módulo, así que aquí se comprueba lo que esa
 * promesa significa de verdad:
 *
 *   · que lo que se cifra se recupera intacto, incluido texto que no es ASCII,
 *   · que sin la clave correcta NO se descifra —ni se devuelve basura, que
 *     sería peor: falla—,
 *   · y que dos cifrados del mismo texto no se parecen, porque un IV repetido
 *     en AES-GCM es catastrófico.
 *
 * Usa el Web Crypto del entorno, el mismo que corre en el navegador.
 */

describe("cifrar y descifrar", () => {
  it("recupera el texto tal cual", async () => {
    const clave = generateKey();
    const original = "contraseña-de-produccion-2026";
    const { ciphertext, iv } = await encryptSecret(original, clave);
    expect(await decryptSecret(ciphertext, iv, clave)).toBe(original);
  });

  it("aguanta lo que la gente pega de verdad", async () => {
    const casos = [
      "",                                    // vacío
      " ",                                   // solo un espacio
      "a",                                   // un carácter
      "contraseña con acentos y ñ",
      "日本語のパスワード",
      "clave con emoji 🔐🎨",
      "línea uno\nlínea dos\r\nlínea tres",  // saltos mezclados
      '{"json":"con \\"comillas\\" dentro"}',
      "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----",
      "x".repeat(50_000),                    // largo
    ];
    for (const original of casos) {
      const clave = generateKey();
      const { ciphertext, iv } = await encryptSecret(original, clave);
      const recuperado = await decryptSecret(ciphertext, iv, clave);
      expect(recuperado, `falló con: ${original.slice(0, 30)}`).toBe(original);
    }
  });

  it("falla con la clave equivocada, en vez de devolver basura", async () => {
    const { ciphertext, iv } = await encryptSecret("secreto", generateKey());
    // AES-GCM autentica: con otra clave la etiqueta no cuadra y tiene que
    // reventar. Si algún día esto devolviera algo, el modo estaría mal usado.
    await expect(decryptSecret(ciphertext, iv, generateKey())).rejects.toThrow();
  });

  it("falla si el criptograma viene manipulado", async () => {
    const clave = generateKey();
    const { ciphertext, iv } = await encryptSecret("secreto", clave);
    // Se cambia un carácter del criptograma: la autenticación debe detectarlo.
    const tocado =
      ciphertext.slice(0, 4) + (ciphertext[4] === "A" ? "B" : "A") + ciphertext.slice(5);
    await expect(decryptSecret(tocado, iv, clave)).rejects.toThrow();
  });

  it("falla si el IV viene manipulado", async () => {
    const clave = generateKey();
    const { ciphertext, iv } = await encryptSecret("secreto", clave);
    const tocado = iv.slice(0, 2) + (iv[2] === "A" ? "B" : "A") + iv.slice(3);
    await expect(decryptSecret(ciphertext, tocado, clave)).rejects.toThrow();
  });
});

describe("generación de claves e IV", () => {
  it("no repite claves", () => {
    const vistas = new Set(Array.from({ length: 1000 }, () => generateKey()));
    expect(vistas.size).toBe(1000);
  });

  it("no repite el IV entre dos cifrados", async () => {
    // Reutilizar un IV con la misma clave en AES-GCM rompe la confidencialidad
    // por completo. Es el error clásico de este modo.
    const clave = generateKey();
    const ivs = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { iv } = await encryptSecret("mismo texto", clave);
      ivs.add(iv);
    }
    expect(ivs.size).toBe(200);
  });

  it("cifrar dos veces lo mismo no da el mismo resultado", async () => {
    const clave = generateKey();
    const a = await encryptSecret("idéntico", clave);
    const b = await encryptSecret("idéntico", clave);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
