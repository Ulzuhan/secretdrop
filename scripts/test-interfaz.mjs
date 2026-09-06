/**
 * Lo que la capa que sirve HTML tiene que cumplir, en cualquier implementación.
 *
 * Nada de esto mira cómo está hecha la pantalla: son propiedades del servidor
 * que un port rompe en silencio. La que más importa es la primera — abrir el
 * enlace no puede gastar el secreto—, porque el día que se rompa nadie lo verá
 * hasta que alguien pierda un secreto por haberlo previsualizado.
 */
import { api, check, crear, resumen, sesion, BASE } from "./comun.mjs";

const cookie = sesion({ sub: "sub-interfaz" });

const cabeceras = async (ruta, opciones = {}) => {
  const r = await fetch(BASE + ruta, { redirect: "manual", ...opciones });
  return { status: r.status, cuerpo: await r.text(), h: r.headers };
};

console.log("Abrir el enlace no gasta el secreto");

const id = (await crear(cookie, { ttlHours: 2, maxViews: 3 })).body.id;
const visor = await cabeceras(`/v/${id}`);
check("el visor responde", visor.status, 200);
check("  con HTML", (visor.h.get("content-type") || "").startsWith("text/html"), true);
// Un mensajero que previsualiza el enlace no puede quemar nada.
await cabeceras(`/v/${id}`);
await cabeceras(`/v/${id}`);
const tras = await api(`/api/secrets/${id}`);
check("  y tras abrirlo tres veces, la primera lectura sigue siendo la primera",
  tras.body?.viewCount, 1);
check("  el criptograma no viaja en el HTML del visor",
  visor.cuerpo.includes(tras.body?.ciphertext ?? "imposible"), false);

console.log("\nEl documento del visor no se indexa");
check("lleva noindex", /name=["']robots["'][^>]*noindex/i.test(visor.cuerpo), true);

console.log("\nCabeceras de seguridad");
for (const [ruta, nombre] of [["/", "la portada"], [`/v/${id}`, "el visor"]]) {
  const r = await cabeceras(ruta);
  check(`${nombre}: sin marcos`, r.h.get("x-frame-options"), "DENY");
  check(`${nombre}: sin adivinar tipos`, r.h.get("x-content-type-options"), "nosniff");
  check(`${nombre}: sin referente`, r.h.get("referrer-policy"), "no-referrer");
  const csp = r.h.get("content-security-policy") || "";
  check(`${nombre}: con CSP`, csp.length > 0, true);
  check(`${nombre}: con nonce por respuesta`, /nonce-[A-Za-z0-9+/=]+/.test(csp), true);
  check(`${nombre}: sin unsafe-eval`, csp.includes("unsafe-eval"), false);
  check(`${nombre}: sin marcos ajenos`, csp.includes("frame-ancestors 'none'"), true);
  check(`${nombre}: sin base ajena`, csp.includes("base-uri 'none'"), true);
  check(`${nombre}: no se guarda`, /no-store/.test(r.h.get("cache-control") || ""), true);
}

// Dos respuestas seguidas no pueden compartir nonce: uno reutilizado deja de
// servir para nada.
const uno = (await cabeceras("/")).h.get("content-security-policy");
const dos = (await cabeceras("/")).h.get("content-security-policy");
check("cada respuesta lleva su propio nonce", uno === dos, false);

console.log("\nLo que no existe, no existe");
for (const ruta of ["/api/no-existe", "/api/secrets/extra/cosa", "/no-existe-tampoco"]) {
  const r = await cabeceras(ruta);
  check(`${ruta} no responde 200`, r.status === 200, false);
  // Lo peor de una SPA mal servida: 200 con HTML para cualquier ruta de API.
  check(`  ni HTML de relleno`, r.status === 200 && (r.h.get("content-type") || "").includes("html"), false);
}

console.log("\nLa API no se cachea");
const otro = (await crear(cookie, { ttlHours: 1, maxViews: 1 })).body.id;
const lectura = await cabeceras(`/api/secrets/${otro}`);
check("leer un secreto no se guarda", /no-store/.test(lectura.h.get("cache-control") || ""), true);

resumen();
