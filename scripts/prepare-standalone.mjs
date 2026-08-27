import { rmSync } from "node:fs";
import { join } from "node:path";

// Next puede trazar el almacén local completo porque su ruta es configurable.
// Nunca debe convertirse en parte de una imagen o un artefacto desplegable.
rmSync(join(import.meta.dirname, "..", ".next", "standalone", ".secretdrop-store"), {
  recursive: true,
  force: true,
});
