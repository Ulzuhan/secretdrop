import Link from "next/link";

/**
 * What somebody without a session sees.
 *
 * Server-rendered with no client JavaScript: it is the first thing a stranger
 * loads, and there is nothing here that needs hydrating to be useful.
 *
 * The card on the right is the one screen that matters — a secret that has
 * already been opened and is therefore gone. Showing the ending explains the
 * product better than any amount of copy about encryption.
 */
export function Landing() {
  return (
    <main className="kc-product-landing flex-1">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl overflow-x-clip px-5 pt-12 pb-16 sm:pt-20 sm:pb-24">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="text-center lg:text-left">
            <span className="inline-block rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
              Encrypted in your browser · self-hosted
            </span>

            <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
              Send it once.{" "}
              <span className="text-accent">Then it&apos;s gone.</span>
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-[17px] lg:mx-0">
              A password, a key, a recovery code — the things you should never
              leave sitting in a chat history. Paste it here, send the link, and
              it deletes itself the moment it is read.
            </p>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              <Link
                href="https://auth.kaicorplabs.com/if/flow/enroll-secretdrop/"
                className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-7 text-base font-medium text-background transition-opacity hover:opacity-90"
              >
                Request an account
              </Link>
              <Link
                href="/api/auth/login"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-border px-7 text-base font-medium transition-colors hover:bg-surface"
              >
                Sign in
              </Link>
            </div>
            <p className="mt-3 text-xs text-muted">
              Opening a secret needs no account — only creating one does.
            </p>
            <p className="mt-1 text-xs text-muted">
              Already have a KaiCorp Labs account? Use the same button — it asks for access to this one.
            </p>
          </div>

          <DemoCard />
        </div>
      </section>

      {/* ── Cómo funciona ────────────────────────────────────────────── */}
      <section className="border-t border-border bg-surface/30">
        <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:py-20">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted">
            How it works
          </h2>

          <div className="kc-card-grid mt-8 grid gap-8 sm:grid-cols-3">
            {STEPS.map(({ n, title, body }) => (
              <div key={n}>
                <span className="flex size-9 items-center justify-center rounded-xl bg-accent/10 font-mono text-sm text-accent">
                  {n}
                </span>
                <h3 className="mt-3.5 font-medium">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Por qué no un chat ───────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl px-5 py-16 sm:py-20">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted">
          Why not just send it over chat
        </h2>

        <div className="kc-card-grid mt-8 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon, title, body }) => (
            <div key={title}>
              <div className="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-lg">
                {icon}
              </div>
              <h3 className="mt-3.5 font-medium">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Cierre ───────────────────────────────────────────────────── */}
      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-5 py-16 text-center sm:py-24">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Stop pasting passwords into WhatsApp
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted">
            It takes about as long, and afterwards there is nothing left behind
            to leak.
          </p>
          <Link
            href="https://auth.kaicorplabs.com/if/flow/enroll-secretdrop/"
            className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-7 text-base font-medium text-background transition-opacity hover:opacity-90"
          >
            Request an account
            <span aria-hidden>→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}

const STEPS = [
  {
    n: "1",
    title: "Paste the secret",
    body: "It is encrypted in your browser before it leaves it. The key never travels to the server.",
  },
  {
    n: "2",
    title: "Send the link",
    body: "The key rides in the part of the URL browsers never send anywhere — so only whoever holds the link can read it.",
  },
  {
    n: "3",
    title: "It burns",
    body: "Opened once, or expired, and the ciphertext is deleted. A second attempt finds nothing.",
  },
];

const FEATURES = [
  {
    icon: "🔥",
    title: "Read once, then nothing",
    body: "A chat keeps your password forever, on every phone in the group and in every backup of it. This does not.",
  },
  {
    icon: "🔐",
    title: "The server cannot read it",
    body: "Encryption happens in the browser with AES-256-GCM. What is stored here is bytes nobody on this machine can turn back into text.",
  },
  {
    icon: "⏱",
    title: "It expires anyway",
    body: "Set a lifetime. If nobody opens it, it dies on its own instead of waiting around to be found.",
  },
  {
    icon: "👁",
    title: "You can tell it was read",
    body: "Each secret shows whether it has been opened, which is how you notice when it was not you who opened it.",
  },
  {
    icon: "🚫",
    title: "Nothing to sign up for",
    body: "Whoever receives it installs nothing and creates no account. They click, they read, they are done.",
  },
  {
    icon: "🏠",
    title: "On our own hardware",
    body: "No third-party service in the middle of your credentials, and no company whose breach becomes your breach.",
  },
];

/** El final de la historia: un secreto ya leído, que ya no existe. */
function DemoCard() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      {/* Un resplandor detrás, para que la tarjeta parezca iluminada y no pegada. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[3rem] opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 40%, color-mix(in oklch, var(--accent) 22%, transparent), transparent 70%)",
        }}
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <p className="font-mono text-xs text-muted">secret.kaicorplabs.com/v/…</p>
          <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-danger">
            burned
          </span>
        </div>

        <div className="px-5 py-8 text-center">
          <p className="text-4xl">🔥</p>
          <p className="mt-4 font-medium">This secret is gone</p>
          <p className="mx-auto mt-1.5 max-w-[26ch] text-sm leading-relaxed text-muted">
            It was opened once. There is nothing left on the server to show you.
          </p>
        </div>

        <div className="space-y-2 border-t border-border bg-background/40 px-5 py-4 font-mono text-xs">
          <div className="flex justify-between">
            <span className="text-muted">created</span>
            <span>14:02 · today</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">opened</span>
            <span>14:09 · today</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">stored now</span>
            <span className="text-danger">nothing</span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-muted">
        What the second person to click the link would see.
      </p>
    </div>
  );
}
