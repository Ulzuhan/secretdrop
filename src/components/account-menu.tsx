import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "../lib/api";
import { Icon } from "../ui/icons";

/**
 * Quién eres y por dónde se sale. Salir pasa por el proveedor: recargar no
 * basta, porque su sesión sigue viva y «entrar» volvería a entrar sin pedir
 * nada. El `next` que contesta el servidor es su pantalla de cierre.
 */
export function AccountMenu({ email, accountUrl }: { email: string; accountUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const handle = email.split("@")[0] || email;

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  // Al abrir, el foco va al primer elemento del menú.
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };

  const leave = async () => {
    setLeaving(true);
    window.location.href = await signOut();
  };

  return (
    <div className="account" ref={box}>
      <button
        type="button"
        className="account-trigger"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden="true">
          {handle.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-name">{handle}</span>
        <Icon name="chevron" size={14} className="account-chevron" />
      </button>

      {open && (
        <div role="menu" id={menuId} className="menu" onKeyDown={onMenuKey}>
          <div className="menu-identity">
            <strong>{handle}</strong>
            <span title={email}>{email}</span>
          </div>
          <div className="menu-sep" />
          {accountUrl && (
            <a role="menuitem" href={accountUrl} target="_blank" rel="noreferrer" className="menu-item">
              <Icon name="external" size={16} />
              Manage your account
            </a>
          )}
          <button type="button" role="menuitem" className="menu-item" onClick={leave} disabled={leaving}>
            <Icon name="logout" size={16} />
            {leaving ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
