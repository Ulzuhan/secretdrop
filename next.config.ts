import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad.
 *
 * En producción esto va además por una regla en el borde, pero se ponen también
 * aquí: la aplicación no debería depender de dónde esté desplegada para no ser
 * enmarcable, y quien la levante por su cuenta —es software autoalojable— no
 * tiene ese borde.
 *
 * `no-referrer` es la que más importa en esta herramienta concreta: la clave de
 * descifrado viaja en el fragmento de la URL (`/v/<id>#<clave>`). El fragmento
 * no se envía al servidor, pero la cabecera `Referer` sí se manda a terceros al
 * navegar fuera, y ahí sí puede acabar la URL completa. Con `no-referrer` no
 * sale nunca.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Fija la raíz del proyecto: sin esto, un package-lock.json suelto más arriba
  // en el árbol hace que Next infiera una raíz equivocada y avise en cada build.
  output: "standalone",
  // El almacén NUNCA dentro del artefacto. El trazador seguía los ficheros que
  // la ruta de limpieza abre y se llevaba los secretos de la gente al build —
  // se vio como un aviso al construir, que es la única señal que da. Igual que
  // TabUp con su `data/`.
  outputFileTracingRoot: import.meta.dirname,
  outputFileTracingExcludes: { "**": ["./.secretdrop-store/**/*"] },
  turbopack: {
    root: import.meta.dirname,
  },

  // `typescript: { ignoreBuildErrors: true }` estaba silenciando el análisis de
  // tipos en el build. Retirado: el proyecto compila limpio, así que lo único
  // que aportaba era dejar pasar a producción errores que nadie vería.

  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
