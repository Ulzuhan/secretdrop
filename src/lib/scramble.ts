/**
 * El efecto de «cifrado» ante los ojos: cada carácter se va sustituyendo por
 * glifos hasta asentarse en el destino. Determinista a propósito, con un
 * pseudoaleatorio por posición y fotograma: así no parpadea entre renders.
 */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=$#%&";

export function scramble(from: string, to: string, progress: number): string {
  const p = Math.min(1, Math.max(0, progress));
  const length = Math.max(from.length, to.length);
  const tick = Math.floor(p * 36);
  let out = "";
  for (let i = 0; i < length; i++) {
    // Cada posición «se decide» un poco después que la anterior.
    const settleAt = (i / length) * 0.75;
    const source = from[i] ?? "";
    const target = to[i] ?? "";
    if (source === "\n" || target === "\n") {
      out += p > settleAt ? target : source;
      continue;
    }
    if (p >= settleAt + 0.25) out += target;
    else if (p >= settleAt) out += GLYPHS[(i * 7919 + tick * 104729) % GLYPHS.length];
    else out += source;
  }
  return out;
}

/** Un criptograma de mentira con la misma silueta que el texto. */
export function fakeCipher(plain: string, seed = 7): string {
  let out = "";
  let x = seed;
  for (let i = 0; i < plain.length; i++) {
    if (plain[i] === "\n") {
      out += "\n";
      continue;
    }
    // Los bits bajos de un congruencial lineal apenas cambian: se toman los altos.
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    out += GLYPHS[(x >>> 16) % 64];
  }
  return out;
}
