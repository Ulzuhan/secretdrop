/**
 * El recorrido completo en un navegador de verdad.
 *
 * Lo que aquí se comprueba no se puede comprobar con `fetch`: que la clave vive
 * en el fragmento y por tanto NO viaja, que el texto claro no sale nunca del
 * navegador, y que abrir el enlace una segunda vez ya no entrega nada.
 *
 * Va sobre HTTPS con un certificado de usar y tirar porque el atributo `Secure`
 * de las cookies no existe sobre http, y es justo lo que se coló en el port.
 */
import { chromium } from "@playwright/test";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const { BASE, EMISOR, PUERTO_APP, PUERTO_TLS, PUERTO_IDP, CERT, LLAVE } = process.env;
const SUB = `sub-navegador-${randomUUID()}`;

let fallos = 0;
const check = (que, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗"} ${que}${ok ? "" : `  (esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)})`}`);
};

/**
 * Escribir y crear, aguantando la hidratación.
 *
 * Con Next el `textarea` viene en el HTML y React se engancha después: escribir
 * en ese hueco no actualiza su estado, y el botón se queda deshabilitado para
 * siempre. Con la interfaz montada en cliente el hueco no existe. Se reintenta
 * hasta que el botón se habilita, que es la señal de que React ya está.
 */
async function crearSecreto(pagina, texto) {
  const caja = pagina.locator("textarea");
  const boton = pagina.getByRole("button", { name: /create encrypted link/i });
  await caja.waitFor({ timeout: 15_000 });
  for (let intento = 0; intento < 40; intento++) {
    await caja.fill(texto);
    if (await boton.isEnabled()) break;
    await pagina.waitForTimeout(250);
  }
  await boton.click();
  await pagina.waitForSelector("text=/ready to share/i", { timeout: 15_000 });
  await pagina.getByRole("button", { name: /copy/i }).first().click();
  return pagina.evaluate(() => navigator.clipboard.readText());
}

// ── El proveedor de mentira, que sí completa el inicio de sesión ─────
const codigos = new Map();
const idp = createHttpServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PUERTO_IDP}`);
  const json = (o) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(o));
  if (u.pathname.endsWith("/.well-known/openid-configuration")) {
    return json({
      issuer: EMISOR,
      authorization_endpoint: `${EMISOR}/authorize`,
      token_endpoint: `${EMISOR}/token`,
      userinfo_endpoint: `${EMISOR}/userinfo`,
      end_session_endpoint: `${EMISOR}/logout`,
    });
  }
  if (u.pathname.endsWith("/authorize")) {
    const code = randomUUID();
    codigos.set(code, true);
    const vuelta = new URL(u.searchParams.get("redirect_uri"));
    vuelta.searchParams.set("code", code);
    vuelta.searchParams.set("state", u.searchParams.get("state") ?? "");
    return res.writeHead(302, { Location: vuelta.toString() }).end();
  }
  if (u.pathname.endsWith("/token")) return json({ access_token: "token-de-pruebas", token_type: "Bearer" });
  if (u.pathname.endsWith("/userinfo")) return json({ sub: SUB, email: `${SUB}@example.invalid`, name: "Quien Prueba" });
  res.writeHead(404).end();
});
await new Promise((listo) => idp.listen(Number(PUERTO_IDP), "127.0.0.1", listo));

// ── Y el HTTPS de delante, para que las cookies puedan ser `Secure` ──
const proxy = createHttpsServer(
  { cert: readFileSync(CERT), key: readFileSync(LLAVE) },
  (req, res) => {
    const salida = httpRequest(
      { host: "127.0.0.1", port: Number(PUERTO_APP), path: req.url, method: req.method,
        headers: { ...req.headers, "x-forwarded-proto": "https" } },
      (respuesta) => {
        res.writeHead(respuesta.statusCode ?? 502, respuesta.headers);
        respuesta.pipe(res);
      }
    );
    salida.on("error", () => res.writeHead(502).end());
    req.pipe(salida);
  }
);
await new Promise((listo) => proxy.listen(Number(PUERTO_TLS), "127.0.0.1", listo));

const navegador = await chromium.launch();
const nuevoContexto = () => navegador.newContext({ ignoreHTTPSErrors: true });

const TEXTO_CLARO = `secreto-en-claro-${randomUUID()}`;

try {
  const contexto = await nuevoContexto();
  await contexto.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const pagina = await contexto.newPage();
  if (process.env.DIAG) {
    pagina.on("console", (m) => console.log("   [consola]", m.type(), m.text().slice(0, 160)));
    pagina.on("pageerror", (e) => console.log("   [error]", String(e).slice(0, 200)));
    pagina.on("requestfailed", (r) => console.log("   [falló]", r.url().slice(0, 90), r.failure()?.errorText));
  }

  // Todo lo que sale del navegador, guardado para poder afirmar qué NO salió.
  const salidas = [];
  pagina.on("request", (r) => salidas.push(`${r.url()} ${r.postData() ?? ""}`));

  console.log("Sin sesión");
  const portada = await pagina.goto(`${BASE}/`, { waitUntil: "networkidle" });
  check("la portada responde", portada.status(), 200);
  check("  con CSP y su nonce", /nonce-/.test(portada.headers()["content-security-policy"] ?? ""), true);
  check("  ofrece el alta del entorno",
    await pagina.locator('a[href="https://idp.example.invalid/if/flow/enroll-secretdrop/"]').count() > 0, true);
  check("  y no hay caja de secreto todavía", await pagina.locator("textarea").count(), 0);
  // Fuera de la lista acotada, pero se añade porque el port lo perdía en
  // silencio: el pie es un componente de SERVIDOR en Next y leía el entorno él
  // mismo. Compilado para el navegador no hay entorno, y la bandera quedaba
  // siempre apagada sin que fallara nada. Sólo se ve renderizando de verdad.
  check("  y el pie enlaza a los otros servicios",
    await pagina.locator('footer a[href="https://link.kaicorplabs.com"]').count() > 0, true);

  // Que el CSS llegue con un 200 no dice nada: sin PostCSS, vite emite el CSS
  // fuente sin una sola utilidad generada y la respuesta sigue siendo un 200
  // de tamaño parecido. Lo único que lo distingue es preguntarle al navegador
  // qué ha aplicado de verdad. `border-t` es de Tailwind, está en el pie —que
  // es idéntico en las dos implementaciones— y sin ella el borde mide 0px.
  // No vale cualquier utilidad: `mt-auto` parecía servir y no, porque
  // getComputedStyle devuelve el margen ya resuelto en píxeles.
  const borde = await pagina.locator("footer").evaluate(
    (e) => getComputedStyle(e).borderTopWidth);
  check("  y los estilos están aplicados de verdad", borde, "1px");

  // El logo lo servía Next desde public/. naturalWidth y no el 200: una página
  // de error también responde 200 en algunos servidores, y una imagen rota da
  // cero de ancho pase lo que pase.
  const ancho = await pagina.locator('footer img').first().evaluate(
    (e) => e.naturalWidth);
  check("  y el logo carga", ancho > 0, true);

  // La tarjeta de enlace declara summary_large_image; sin og:image eso es una
  // tarjeta grande vacía.
  const og = await pagina.locator('meta[property="og:image"]').getAttribute("content");
  check("  y la tarjeta de enlace tiene imagen", /\/og\.jpg$/.test(og ?? ""), true);
  const imagen = await pagina.request.get(og ?? `${BASE}/og.jpg`);
  check("    que además se sirve", imagen.status(), 200);

  // La variante CON host público: aquí sí está configurado, y es la que anuncia
  // el sitemap. Sin estas líneas el mapa existe y no se entera nadie.
  const robots = await (await pagina.request.get(`${BASE}/robots.txt`)).text();
  check("  robots anuncia el sitemap",
    robots.endsWith(`Host: ${BASE}\nSitemap: ${BASE}/sitemap.xml\n`), true);
  const mapa = await (await pagina.request.get(`${BASE}/sitemap.xml`)).text();
  check("  y el sitemap lista la portada", mapa.includes(`<loc>${BASE}/</loc>`), true);

  console.log("\nEntrar de verdad, pasando por el proveedor");
  await pagina.goto(`${BASE}/api/auth/login?next=%2F`, { waitUntil: "networkidle" });
  check("vuelve a la aplicación", new URL(pagina.url()).pathname, "/");
  await pagina.waitForSelector("textarea", { timeout: 15_000 });
  check("  y ahora sí hay caja de secreto", await pagina.locator("textarea").count(), 1);

  const galletas = await contexto.cookies();
  const sesion = galletas.find((c) => c.name === "secretdrop_session");
  check("la cookie de sesión existe", Boolean(sesion), true);
  check("  es Secure", sesion?.secure, true);
  check("  es HttpOnly", sesion?.httpOnly, true);
  check("  es SameSite=Lax", sesion?.sameSite, "Lax");

  console.log("\nCrear y compartir");
  const enlace = await crearSecreto(pagina, TEXTO_CLARO);
  check("el enlace copiado apunta al visor", /\/v\/[A-Za-z0-9_-]{12}#.+/.test(enlace), true);

  const clave = enlace.split("#")[1];
  console.log("\nLo que NO salió del navegador");
  check("el texto claro no viaja en ninguna petición",
    salidas.some((s) => s.includes(TEXTO_CLARO)), false);
  check("la clave tampoco",
    salidas.some((s) => s.includes(clave)), false);

  console.log("\nAbrirlo en otro navegador, sin sesión");
  const otro = await nuevoContexto();
  const visor = await otro.newPage();
  const salidasVisor = [];
  visor.on("request", (r) => salidasVisor.push(r.url()));
  await visor.goto(enlace, { waitUntil: "networkidle" });
  await visor.waitForSelector("pre", { timeout: 15_000 });
  check("descifra el secreto", (await visor.locator("pre").first().innerText()).trim(), TEXTO_CLARO);
  check("  sin cookie de sesión", (await otro.cookies()).some((c) => c.name === "secretdrop_session"), false);
  check("  y la clave no llegó al servidor",
    salidasVisor.some((u) => u.includes(clave)), false);
  await otro.close();

  console.log("\nUna sola vez");
  const tercero = await nuevoContexto();
  const repetido = await tercero.newPage();
  await repetido.goto(enlace, { waitUntil: "networkidle" });
  await repetido.waitForSelector("text=/burned|expired|went wrong/i", { timeout: 15_000 });
  check("la segunda vez ya no entrega nada", await repetido.locator("pre").count(), 0);
  await tercero.close();

  console.log("\nUn enlace sin la clave no gasta el secreto");
  // Tras crear, la caja desaparece y queda la tarjeta del resultado: hay que
  // volver a empezar como lo haría cualquiera.
  await pagina.getByRole("button", { name: /new secret/i }).click();
  const segundo = await crearSecreto(pagina, "otro-secreto-distinto");
  const sinClave = segundo.split("#")[0];

  const cuarto = await nuevoContexto();
  const desnudo = await cuarto.newPage();
  await desnudo.goto(sinClave, { waitUntil: "networkidle" });
  check("sin clave no enseña nada", await desnudo.locator("pre").count(), 0);
  await cuarto.close();

  // Y con la clave sigue estando: abrir sin clave no lo ha gastado.
  const quinto = await nuevoContexto();
  const conClave = await quinto.newPage();
  await conClave.goto(segundo, { waitUntil: "networkidle" });
  await conClave.waitForSelector("pre", { timeout: 15_000 });
  check("  y con la clave sigue entregándose",
    (await conClave.locator("pre").first().innerText()).trim(), "otro-secreto-distinto");
  await quinto.close();

  console.log("\nSalir");
  await pagina.goto(`${BASE}/`, { waitUntil: "networkidle" });
  // Por el botón, que es como sale la gente. Antes esto abría el menú con un
  // `.catch(() => {})` que se tragaba el fallo y hacía el POST a mano: probaba
  // la ruta, no el logout.
  await pagina.getByRole("button", { name: /account/i }).first().click();
  await pagina.getByRole("menuitem", { name: /sign out/i }).click();
  await pagina.waitForFunction(
    () => !document.querySelector("textarea"), null, { timeout: 15_000 });
  const tras = await contexto.cookies();
  check("la sesión se retira", tras.some((c) => c.name === "secretdrop_session" && c.value), false);
  check("  y la pantalla vuelve a la portada", await pagina.locator("textarea").count(), 0);

  await contexto.close();
} finally {
  await navegador.close();
  idp.close();
  proxy.close();
}

console.log(`\n${fallos === 0 ? "todo verde" : `${fallos} fallan`}`);
process.exit(fallos === 0 ? 0 : 1);
