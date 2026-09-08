/** Secret identifier supplied by Go; the key stays in the browser fragment. */
export function routeParams(): { id?: string } {
  return { id: document.getElementById("app")?.dataset.secretId };
}
