#!/usr/bin/env node
/**
 * Un proveedor de mentira que FIRMA de verdad, como servidor suelto.
 *
 * `test-backchannel.mjs` tiene el suyo dentro y ahí se queda: necesita las
 * variantes negativas —clave impostora, `alg: none`, claims que faltan— que no
 * pintan nada en un fixture compartido. Aquí sólo hace falta lo positivo: un
 * emisor con su JWKS y un `logout_token` bien formado, para que la suite de
 * compatibilidad pueda revocar de verdad contra CUALQUIERA de las dos
 * implementaciones y comprobar que la otra lo respeta.
 *
 *   node scripts/proveedor-firmante.mjs <puerto>
 */
import { createServer } from "node:http";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";

const puerto = Number(process.argv[2] || 9994);
const rutaEmisor = "/application/o/secretdrop";
const emisor = `http://127.0.0.1:${puerto}${rutaEmisor}`;
const clientId = process.env.CLIENT_ID || "secretdrop-pruebas";
const KID = "compat";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };

const documento = {
  issuer: emisor,
  authorization_endpoint: `${emisor}/protocol/openid-connect/auth`,
  token_endpoint: `${emisor}/protocol/openid-connect/token`,
  userinfo_endpoint: `${emisor}/protocol/openid-connect/userinfo`,
  end_session_endpoint: `${emisor}/protocol/openid-connect/logout`,
  jwks_uri: `${emisor}/protocol/openid-connect/certs`,
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function logoutToken(sub) {
  const ahora = Math.floor(Date.now() / 1000);
  const cab = { alg: "RS256", kid: KID, typ: "logout+jwt" };
  const cuerpo = {
    iss: emisor, aud: clientId, iat: ahora, exp: ahora + 3600, jti: randomUUID(),
    events: { "http://schemas.openid.net/event/backchannel-logout": {} },
    sub, sid: randomUUID(),
  };
  const firmado = `${b64(cab)}.${b64(cuerpo)}`;
  return `${firmado}.${createSign("RSA-SHA256").update(firmado).sign(privateKey).toString("base64url")}`;
}

const json = (res, cuerpo) =>
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(cuerpo));

createServer((req, res) => {
  const ruta = req.url ?? "";
  if (ruta.endsWith("/.well-known/openid-configuration")) return json(res, documento);
  if (ruta.endsWith("/certs")) return json(res, { keys: [jwk] });
  if (ruta.endsWith("/token")) return json(res, { access_token: "token-de-pruebas", token_type: "Bearer" });
  if (ruta.endsWith("/userinfo")) return json(res, { sub: "sub-a", email: "a@example.invalid", name: "A" });
  if (req.method === "POST" && ruta.startsWith("/__firmar")) {
    let cuerpo = "";
    req.on("data", (t) => { cuerpo += t; if (cuerpo.length > 4096) req.destroy(); });
    req.on("end", () => {
      let sub = "";
      try { sub = JSON.parse(cuerpo).sub ?? ""; } catch { /* cuerpo inválido */ }
      if (!sub) return res.writeHead(400).end();
      json(res, { logout_token: logoutToken(sub) });
    });
    return;
  }
  res.writeHead(404).end();
}).listen(puerto, "127.0.0.1", () => console.log(`proveedor firmante en ${emisor}`));
