/**
 * El cuerpo de una petición, leído como objeto.
 *
 * `request.json()` falla de dos maneras y las dos acababan en un 500. Un cuerpo
 * que no es JSON —vacío, a medias, un formulario enviado a mano— hace que
 * `json()` lance. Y el texto `null` es JSON perfectamente válido, así que no
 * protesta y devuelve `null`; quien luego lee un campo se lleva un TypeError.
 * Medido antes: de seis cuerpos raros, cinco daban 500.
 *
 * Un cuerpo que no se entiende es culpa de quien lo manda: 400.
 *
 * Y se exige `application/json`, que no es formalismo. Los cinco servicios de
 * este dominio son el MISMO sitio para el navegador, así que la cookie de sesión
 * viaja en una petición lanzada desde una página de cualquiera de ellos. El
 * navegador sólo deja salir una petición a otro sitio sin preguntar antes si el
 * tipo es `text/plain`, `multipart/form-data` o el de un formulario; con
 * `application/json` está obligado a preguntar, y esa pregunta aquí no se
 * contesta. Como `json()` no miraba esa cabecera, la vía estaba abierta.
 *
 * El tipo de vuelta es `any` a propósito: es lo mismo que devolvía
 * `request.json()`, así que la ruta sigue validando campo por campo como hacía.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jsonBody(request: Request): Promise<any | null> {
  const tipo = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(tipo.trim())) return null;

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return null;
  }
  // Las listas tampoco: ninguna ruta de esta API espera una arriba del todo, y
  // aceptarlas sólo servía para que los campos salieran `undefined` sin decir
  // por qué.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed;
}
