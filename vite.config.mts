import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Go serves the HTML shell and routes; Vite builds only browser assets.
export default defineConfig({
  publicDir: "public",
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [react(), {
    name: "secretdrop:preserve-placeholder",
    closeBundle() {
      writeFileSync(fileURLToPath(new URL("./internal/web/dist/.gitkeep", import.meta.url)), "");
    },
  }],
  build: {
    outDir: "internal/web/dist",
    emptyOutDir: true,
    manifest: true,
    // Self-hosted fonts are referenced from CSS and must stay separate files:
    // the CSP allows `font-src 'self'` and nothing inline.
    assetsInlineLimit: 0,
    rollupOptions: { input: "src/main.tsx" },
  },
});
