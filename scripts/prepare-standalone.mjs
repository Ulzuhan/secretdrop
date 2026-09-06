import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const raiz = join(import.meta.dirname, "..");
const standalone = join(raiz, ".next", "standalone");

// Next puede trazar el almacén local completo porque su ruta es configurable.
// Nunca debe convertirse en parte de una imagen o un artefacto desplegable.
rmSync(join(standalone, ".secretdrop-store"), { recursive: true, force: true });

// `next build` deja fuera del standalone los assets estáticos: hay que copiarlos
// a mano. El Dockerfile ya lo hacía al construir la imagen, así que producción
// nunca estuvo afectada, pero el artefacto local que arrancan las suites servía
// 404 en todos los chunks de `/_next/static`. Las suites HTTP no lo veían porque
// no ejecutan JavaScript; la de navegador cargaba la página sin hidratar y el
// botón de crear se quedaba deshabilitado para siempre.
// Se borra el destino antes de copiar: los nombres llevan hash, y si no, los
// chunks de compilaciones anteriores se acumulan ahí dentro.
for (const activos of [join(".next", "static"), "public"]) {
  const origen = join(raiz, activos);
  if (!existsSync(origen)) continue;
  const destino = join(standalone, activos);
  rmSync(destino, { recursive: true, force: true });
  cpSync(origen, destino, { recursive: true });
}
