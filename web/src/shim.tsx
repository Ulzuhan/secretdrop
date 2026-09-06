/**
 * Lo poquito que Next ponía y aquí no hay.
 *
 * `next/link` era un `<a>` con prebúsqueda; sin router no hay nada que
 * prebuscar, así que es un `<a>`. Y `useParams` leía el id de la ruta: aquí lo
 * pone el servidor en el nodo raíz, ya validado, para que el visor no tenga que
 * volver a fiarse de la URL.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";

export default function Link({
  href, children, prefetch: _prefetch, ...resto
}: { href: string; children?: ReactNode; prefetch?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  // `prefetch` se acepta y se tira: los componentes vienen tal cual del árbol
  // de Next, y sin router no hay nada que prebuscar. Pasárselo al `<a>` sólo
  // pintaría un atributo inventado en el HTML.
  return <a href={href} {...resto}>{children}</a>;
}

export function useParams(): { id?: string } {
  const raiz = document.getElementById("app");
  return { id: raiz?.dataset.secretId };
}
