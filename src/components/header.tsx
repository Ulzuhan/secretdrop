import type { ReactNode } from "react";
import { AppSwitcher } from "./app-switcher";

/**
 * La cabecera. El icono + nombre del servicio siempre llevan a `/` de la app;
 * el selector de aplicaciones a su izquierda conecta con el resto de KaiCorp Labs.
 */
export function Header({
  showSwitcher = false,
  children,
}: {
  showSwitcher?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        {showSwitcher && <AppSwitcher current="secretdrop" />}
        <a href="/" className="brand" title="SecretDrop">
          <img src="/kaicorp-mark.png" alt="" width={26} height={26} className="brand-mark" />
          <span className="brand-name">SecretDrop</span>
        </a>
        {children ? <div className="site-header-actions">{children}</div> : null}
      </div>
    </header>
  );
}
