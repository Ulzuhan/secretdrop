import type { NextRequest } from "next/server";

/**
 * De dónde se considera que viene esta petición.
 *
 * Se toma `Host` y no `X-Forwarded-Host`, y la diferencia importa: la segunda la
 * escribe quien llama, y **este despliegue no la reemplaza**. Comprobado en vivo
 * contra el túnel: llega intacta a la aplicación mientras `Host` sigue valiendo el
 * nombre de verdad. Prefiriendo la primera, los dos guardianes se saltaban solos —
 * comprobado: cerrar la sesión y lanzar la purga daban 200 con un `Origin` a juego.
 *
 * `Host` sí lo pone el túnel, y una página no puede inventárselo en una petición a
 * otro sitio sin convertirla en una que necesita permiso previo.
 *
 * `SECRETDROP_PUBLIC_HOST` queda para el caso contrario: un proxy que reescriba
 * `Host` con el nombre interno.
 *
 * (El esquema es otra cosa: `X-Forwarded-Proto` también viene de fuera, pero
 * cambiarlo no cruza orígenes —haría falta un `Origin` con este mismo host— así
 * que se usa lo que reconstruye Next.)
 */
function hostDeConfianza(request: NextRequest): string | null {
  return process.env.SECRETDROP_PUBLIC_HOST?.trim() || request.headers.get("host");
}

export function isSameOriginMutation(request: NextRequest): boolean {
  // Fetch Metadata primero: dos subdominios del mismo dominio son `same-site` para
  // el navegador y la cookie viaja igual, que es el caso que hay aquí.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;

  const origin = request.headers.get("origin");
  // Sin `Origin` no hay navegador detrás, y sin navegador no hay cookie ajena que
  // aprovechar. Es lo que deja pasar a curl y a las suites.
  if (!origin) return true;

  const host = hostDeConfianza(request);
  if (!host) return false;

  const protocol = request.nextUrl.protocol.replace(":", "");
  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}
