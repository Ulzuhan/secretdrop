/**
 * Lo que el servidor deja en el nodo raíz. Él manda: tiene la cookie, sabe si
 * hay sesión y qué pantalla toca. El navegador sólo lo lee; deducirlo por su
 * cuenta sería inventarse una respuesta que sólo el servidor puede dar.
 */
export type Page = "landing" | "tool" | "viewer";

export interface AppContext {
  page: Page;
  email: string;
  enrollUrl: string | null;
  accountUrl: string | null;
  footerLinks: boolean;
}

export function readContext(root: HTMLElement): AppContext {
  const d = root.dataset;
  const page: Page = d.page === "tool" || d.page === "viewer" ? d.page : "landing";
  return {
    page,
    email: d.email || "",
    enrollUrl: d.enrollUrl || null,
    accountUrl: d.accountUrl || null,
    footerLinks: Boolean(d.footerLinks),
  };
}
