import type { MetadataRoute } from "next";

/**
 * Se evalúa en cada petición, y no es opcional: estas rutas son Route Handlers
 * que Next cachea en la construcción por defecto, y la construcción ocurre en
 * CI, donde el origen público NO existe — el sitemap salía vacío y a robots le
 * faltaba su línea Sitemap. Medido antes de publicar nada.
 */
export const dynamic = "force-dynamic";

/**
 * `/v/` is disallowed because the identifier in those URLs is the credential,
 * and opening one consumes the secret. The front page, which explains what this
 * is, is the only thing worth indexing.
 */
export default function robots(): MetadataRoute.Robots {
  const host = process.env.SECRETDROP_PUBLIC_HOST?.trim();
  const base = host ? `https://${host}` : undefined;
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/v/", "/api/"] },
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
