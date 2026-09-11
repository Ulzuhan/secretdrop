/**
 * Copiar al portapapeles, diciendo la verdad. Se deniega en más sitios de los
 * que parece —Safari sin gesto reciente, contexto no seguro, permiso negado— y
 * una promesa rechazada sin manejar dejaba el botón diciendo «Copy» como si
 * nada. Aquí devuelve si ha ocurrido o no, y quien llama enseña un recambio.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
