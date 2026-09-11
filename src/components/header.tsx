import type { ReactNode } from "react";

/**
 * La cabecera. La marca lleva a KaiCorp Labs y el nombre del servicio a su
 * portada; el hueco de la derecha lo llena cada pantalla con lo suyo.
 */
export function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <div className="brand">
          <a href="https://kaicorplabs.com" className="brand-home" title="KaiCorp Labs">
            <img src="/kaicorp-mark.png" alt="KaiCorp Labs" width={26} height={26} className="brand-mark" />
          </a>
          <span className="brand-sep" aria-hidden="true">
            /
          </span>
          <a href="/" className="brand-name">
            SecretDrop
          </a>
        </div>
        {children ? <div className="site-header-actions">{children}</div> : null}
      </div>
    </header>
  );
}
