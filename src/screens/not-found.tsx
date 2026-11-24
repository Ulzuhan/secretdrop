import { Icon } from "../ui/icons";

export function NotFound() {
  return (
    <main className="container-narrow viewer">
      <div className="panel ending">
        <span className="glyph" aria-hidden="true">
          <Icon name="ghost" size={26} />
        </span>
        <h1 className="display">Nothing at this address.</h1>
        <p>
          There is nothing on the server under this address. Shared secrets open
          at <code>/v/…</code>.
        </p>
        <div className="ending-actions">
          <a href="/" className="btn btn-secondary">
            <Icon name="home" size={16} />
            Go to SecretDrop
          </a>
        </div>
      </div>
    </main>
  );
}
