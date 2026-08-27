import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // `node` para la lógica pura y de disco; los tests de criptografía piden
    // explícitamente el entorno del navegador con su propia anotación, porque
    // Web Crypto es lo que usa la aplicación de verdad.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
