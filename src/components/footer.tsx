import { Icon } from "../ui/icons";

/**
 * El pie unificado de KaiCorp Labs.
 * Los enlaces al resto de servicios + Account + Privacy sólo si KAICORP_FOOTER_LINKS está activo.
 */
const SERVICES = [
  { name: "TabUp", url: "https://tabup.kaicorplabs.com", slug: "tabup" },
  { name: "QR-Forge", url: "https://qr.kaicorplabs.com", slug: "qr-forge" },
  { name: "DocDrop", url: "https://docdrop.kaicorplabs.com", slug: "docdrop" },
  { name: "SecretDrop", url: "https://secret.kaicorplabs.com", slug: "secretdrop" },
  { name: "Pixelforge", url: "https://pixel.kaicorplabs.com", slug: "pixelforge" },
  { name: "LinkUp", url: "https://link.kaicorplabs.com", slug: "linkup" },
];

export function Footer({ showLinks }: { showLinks: boolean }) {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <a href="https://kaicorplabs.com" className="footer-brand">
          <img src="/kaicorp-mark.png" alt="" width={18} height={18} />
          <span>
            Built by <strong>KaiCorp Labs</strong>
          </span>
        </a>

        {showLinks && (
          <nav className="footer-nav" aria-label="KaiCorp Labs services">
            {SERVICES.map((s) =>
              s.slug === "secretdrop" ? (
                <span key={s.slug} aria-current="page" className="footer-current">
                  {s.name}
                </span>
              ) : (
                <a key={s.slug} href={s.url}>
                  {s.name}
                </a>
              ),
            )}
            <span className="footer-sep" aria-hidden="true">
              ·
            </span>
            <a href="https://account.kaicorplabs.com/">Account</a>
            <a href="https://kaicorplabs.com/privacy/">Privacy</a>
          </nav>
        )}
      </div>
      <div className="site-footer-sub">
        <span className="footer-note">
          <Icon name="lock" size={13} />
          Encrypted in your browser · <a href="https://github.com/Ulzuhan/secretdrop">Open source</a>
        </span>
      </div>
    </footer>
  );
}
