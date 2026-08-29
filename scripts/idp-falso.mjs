#!/usr/bin/env node
/**
 * Un proveedor de identidad de mentira, solo para las suites.
 *
 * POR QUÉ EXISTE: desde que el cliente OIDC descubre sus endpoints
 * (`<emisor>/.well-known/openid-configuration`), iniciar sesión hace una
 * petición de red ANTES de redirigir. Sin alguien escuchando, `/api/auth/login`
 * no puede construir la URL y la suite fallaba por una razón que no era la que
 * estaba probando.
 *
 * Y sirve para algo más: **el documento que devuelve usa las rutas de
 * Keycloak**, que no se parecen en nada a las de Authentik. Así la suite
 * comprueba de verdad que la aplicación obedece al documento del proveedor en
 * vez de llevar una forma de URL escrita a mano. Si alguien vuelve a
 * escribirla, `test-auth.mjs` lo ve.
 *
 *   node scripts/idp-falso.mjs <puerto> [ruta-del-emisor]
 */
import { createServer } from "node:http";

const puerto = Number(process.argv[2] || 9999);
const rutaEmisor = process.argv[3] || "/application/o/secretdrop/";
const origen = `http://127.0.0.1:${puerto}`;
const emisor = `${origen}${rutaEmisor.replace(/\/+$/, "")}`;

// A propósito con la forma de Keycloak, no con la de Authentik.
const documento = {
  issuer: emisor,
  authorization_endpoint: `${emisor}/protocol/openid-connect/auth`,
  token_endpoint: `${emisor}/protocol/openid-connect/token`,
  userinfo_endpoint: `${emisor}/protocol/openid-connect/userinfo`,
  end_session_endpoint: `${emisor}/protocol/openid-connect/logout`,
  jwks_uri: `${emisor}/protocol/openid-connect/certs`,
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
};

createServer((req, res) => {
  if (req.url?.endsWith("/.well-known/openid-configuration")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(documento));
    return;
  }
  // Nada más hace falta: la suite no llega a canjear ningún código.
  res.writeHead(404).end();
}).listen(puerto, "127.0.0.1", () => {
  console.log(`idp falso en ${origen} (emisor ${emisor})`);
});
