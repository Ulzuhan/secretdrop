import { useState, type PointerEvent } from "react";
import { LifecycleDemo } from "../components/lifecycle-demo";
import { Icon, type IconName } from "../ui/icons";

/**
 * Lo que ve quien llega sin sesión. `enrollUrl` —dónde se pide cuenta— viene
 * del entorno: sin él no hay botón de alta y entrar pasa a ser la acción
 * principal, que es la única que lleva a alguna parte.
 */
export function Landing({ enrollUrl }: { enrollUrl: string | null }) {
  const [signinFailed, setSigninFailed] = useState(
    () => new URLSearchParams(window.location.search).get("error") === "signin",
  );

  const dismiss = () => {
    setSigninFailed(false);
    window.history.replaceState(null, "", "/");
  };

  return (
    <main>
      <section className="container hero">
        {signinFailed && (
          <div role="alert" className="notice notice-danger signin-notice rise">
            <Icon name="alert" />
            <span>
              Sign-in didn&apos;t complete. The provider sent you back without a session; try again, and
              if it keeps happening, the callback URL on the provider side may not match this address.
            </span>
            <button type="button" className="link-btn" onClick={dismiss} aria-label="Dismiss" style={{ marginLeft: "auto" }}>
              <Icon name="x" size={16} />
            </button>
          </div>
        )}

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow rise" style={{ "--i": 0 } as React.CSSProperties}>
              One-time secrets<span className="eyebrow-more"> · encrypted in your browser</span>
            </p>
            <h1 className="display hero-title rise" style={{ "--i": 1 } as React.CSSProperties}>
              Send it once. <em>Then it&apos;s gone.</em>
            </h1>
            <p className="lede rise" style={{ "--i": 2 } as React.CSSProperties}>
              A password, an API key, a recovery code: the things that should never sit in a chat
              history. Paste it here, share the link, and it deletes itself the moment it&apos;s read.
            </p>

            <div className="hero-actions rise" style={{ "--i": 3 } as React.CSSProperties}>
              {enrollUrl ? (
                <>
                  <a href={enrollUrl} className="btn btn-primary btn-lg">
                    Request an account
                    <Icon name="arrow" size={18} />
                  </a>
                  <a href="/api/auth/login" className="btn btn-secondary btn-lg">
                    Sign in
                  </a>
                </>
              ) : (
                <a href="/api/auth/login" className="btn btn-primary btn-lg">
                  Sign in
                  <Icon name="arrow" size={18} />
                </a>
              )}
            </div>

            <div className="hero-fineprint rise" style={{ "--i": 4 } as React.CSSProperties}>
              <span>
                <Icon name="check" size={14} />
                Opening a secret needs no account. Only creating one does.
              </span>
              <span>
                <Icon name="check" size={14} />
                Self-hosted and open source. No third party in the middle.
              </span>
            </div>
          </div>

          <div className="rise" style={{ "--i": 2 } as React.CSSProperties}>
            <LifecycleDemo />
          </div>
        </div>
      </section>

      <section className="section-rule">
        <div className="container section">
          <div className="section-head">
            <p className="eyebrow">How it works</p>
            <h2 className="display section-title">Three steps, and the third one is the point.</h2>
          </div>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="step">
                <span className="step-num">0{i + 1}</span>
                <span className="step-icon">
                  <Icon name={s.icon} size={20} />
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section-rule">
        <div className="container section">
          <div className="section-head">
            <p className="eyebrow">Why not just send it over chat</p>
            <h2 className="display section-title">Because chat remembers <em>everything.</em></h2>
          </div>
          <ul className="features" onPointerMove={followPointer}>
            {FEATURES.map((f) => (
              <li key={f.title} className="feature">
                <span className="feature-icon">
                  <Icon name={f.icon} size={19} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="container" style={{ paddingBottom: "clamp(3rem, 7vw, 5.5rem)" }}>
        <div className="closing">
          <div className="closing-inner">
            <h2 className="display section-title">Stop pasting passwords into WhatsApp.</h2>
            <p>It takes about as long, and afterwards there is nothing left behind to leak.</p>
            <a href={enrollUrl ?? "/api/auth/login"} className="btn btn-primary btn-lg">
              {enrollUrl ? "Request an account" : "Sign in"}
              <Icon name="arrow" size={18} />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

/** La luz de cada tarjeta sigue al puntero. Una variable CSS y nada más. */
function followPointer(event: PointerEvent<HTMLUListElement>) {
  const card = (event.target as HTMLElement).closest<HTMLElement>(".feature");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  card.style.setProperty("--my", `${event.clientY - rect.top}px`);
}

const STEPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "lock",
    title: "Paste the secret",
    body: "It is encrypted in your browser with AES-256-GCM before anything is sent. The key is generated right there, and the server never receives it.",
  },
  {
    icon: "link",
    title: "Share the link",
    body: "The key rides in the part of the URL after #, which browsers never send anywhere. Only whoever holds the complete link can decrypt.",
  },
  {
    icon: "flame",
    title: "It burns",
    body: "Opened as many times as you allowed, or expired, and the ciphertext is deleted. A second attempt finds nothing at all.",
  },
];

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "flame",
    title: "Read once, then nothing",
    body: "A chat keeps your password forever, on every phone in the group and in every backup of it. This doesn't.",
  },
  {
    icon: "lock",
    title: "The server can't read it",
    body: "What is stored here is ciphertext nobody on this machine can turn back into text, not even with full access to the disk.",
  },
  {
    icon: "clock",
    title: "It expires anyway",
    body: "Set a lifetime from an hour to a week. If nobody opens it, it dies on its own instead of waiting around to be found.",
  },
  {
    icon: "eye",
    title: "You can tell it was read",
    body: "Each secret shows how many times it has been opened, which is how you notice when it wasn't you.",
  },
  {
    icon: "ghost",
    title: "Nothing to install, nobody to sign up",
    body: "Whoever receives it clicks, reads, and is done. No account, no app, no plugin.",
  },
  {
    icon: "home",
    title: "On your own hardware",
    body: "Self-hosted: no third-party service between you and your credentials, and nobody else's breach becoming yours.",
  },
];
