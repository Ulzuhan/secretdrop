import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El HTML de producción lo sirve Go, no este `index.html`: aquí sólo se
// construyen los recursos, con nombre por contenido para poder cachearlos
// eternamente. El manifiesto le dice a Go cómo se llaman.
export default defineConfig({
  // El pie común está GENERADO desde el repo del tema y se comparte con los
  // otros servicios: no se le puede cambiar la lógica aquí. Lee
  // `process.env.KAICORP_FOOTER_LINKS`, que en Next es un componente de
  // servidor y aquí no existe — Vite sustituye `process.env` por `{}` y la
  // bandera salía SIEMPRE apagada, perdiendo los enlaces entre servicios sin
  // que nada fallara. Se sustituye por la lectura del atributo que pone el
  // servidor, que es donde sí hay entorno.
  define: {
    "process.env.KAICORP_FOOTER_LINKS":
      "document.getElementById('app')?.dataset.footerLinks",
  },
  root: "web",
  // `public/` está en la raíz del repo, no dentro de `web/`. Vite copia lo que
  // haya aquí a la raíz de `dist`, y así el logo del pie y la imagen de
  // OpenGraph viajan embebidos en el binario como todo lo demás. Sin esto Go
  // devolvía 404 en /kaicorp-mark.png y /og.jpg: Next los servía desde disco.
  publicDir: "../public",
  plugins: [
    react(),
    // `emptyOutDir` vacía el directorio, y ahí dentro vive el único fichero que
    // el repositorio sí guarda: sin él `go:embed all:dist` no compila en un
    // clon limpio. Se rehace al terminar, o cada build dejaría el árbol sucio
    // con un borrado que nadie pidió.
    {
      name: "secretdrop:conservar-gitkeep",
      closeBundle() {
        writeFileSync(join(import.meta.dirname, "internal", "web", "dist", ".gitkeep"), "");
      },
    },
  ],
  build: {
    outDir: "../internal/web/dist",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: { input: "web/src/main.tsx" },
  },
});
