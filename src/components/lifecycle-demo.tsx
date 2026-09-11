import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../hooks/use-reduced-motion";
import { fakeCipher, scramble } from "../lib/scramble";
import { Icon } from "../ui/icons";

/**
 * La vida entera de un secreto, en cuatro escenas que se suceden solas: se
 * pega, se cifra ante los ojos, se comparte y arde. Explica el producto mejor
 * que cualquier párrafo sobre cifrado, y quien prefiere leer a su ritmo puede
 * pulsar un paso y parar el reloj.
 */
const STEP_MS = 3600;
const PLAIN = "prod-db password:\nHunter2!-but-longer-2026";
const CIPHER = fakeCipher(PLAIN);

const STEPS = [
  { key: "paste", n: "01", label: "Paste", pill: "draft", tone: "" },
  { key: "encrypt", n: "02", label: "Encrypt", pill: "encrypted", tone: "pill-mint" },
  { key: "share", n: "03", label: "Share", pill: "link ready", tone: "pill-mint" },
  { key: "burn", n: "04", label: "Burn", pill: "burned", tone: "pill-ember" },
] as const;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function LifecycleDemo() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const [progress, setProgress] = useState(0);
  const paused = useRef(false);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / STEP_MS);
      setProgress(p);
      if (p < 1 || (auto && paused.current)) raf = requestAnimationFrame(tick);
      else if (auto) setStep((s) => (s + 1) % STEPS.length);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, auto, reduced]);

  const p = reduced ? 1 : progress;
  const typed = PLAIN.slice(0, Math.round(easeOut(Math.min(1, p / 0.6)) * PLAIN.length));
  const scrambled = scramble(PLAIN, CIPHER, Math.min(1, p / 0.6));
  const current = STEPS[step];

  const pick = (index: number) => {
    setStep(index);
    setAuto(false);
  };

  return (
    <div>
      <figure
        className="panel demo"
        data-step={current.key}
        aria-label="How a secret lives and dies: paste, encrypt, share, burn"
        onPointerEnter={() => (paused.current = true)}
        onPointerLeave={() => (paused.current = false)}
      >
        <div className="demo-bar">
          <span className="demo-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="demo-url">secret.example/v/8fK2wQzLp1xY</span>
          <span className={`pill ${current.tone}`} aria-live="polite">
            {current.pill}
          </span>
        </div>

        <div className="demo-stage">
          <div className="demo-scene" data-active={step === 0} aria-hidden={step !== 0}>
            <div className="demo-editor">
              {typed}
              {typed.length < PLAIN.length && <span className="demo-caret" />}
            </div>
            <p className="demo-caption">
              <Icon name="key" size={15} />
              Nothing has left this tab yet.
            </p>
          </div>

          <div className="demo-scene" data-active={step === 1} aria-hidden={step !== 1}>
            <div className="demo-editor" data-cipher={p > 0.15}>
              {scrambled}
            </div>
            <p className="demo-caption">
              <Icon name="lock" size={15} />
              AES-256-GCM, with a key generated right here.
            </p>
          </div>

          <div className="demo-scene" data-active={step === 2} aria-hidden={step !== 2}>
            <div className="demo-link">
              <div className="demo-linkbox">
                https://secret.example/v/8fK2wQzLp1xY<b>#Lm9vR3pQ7dTx…</b>
              </div>
              <span className="pill pill-mint demo-copied">
                <Icon name="check" />
                Link copied
              </span>
            </div>
            <p className="demo-caption demo-caption-ember">
              <Icon name="key" size={15} />
              The part after # is the key. Browsers never send it to the server.
            </p>
          </div>

          <div className="demo-scene" data-active={step === 3} aria-hidden={step !== 3}>
            <div className="demo-ash">
              <Icon name="flame" size={28} style={{ color: "var(--ember)" }} />
              <strong>This secret is gone.</strong>
              <p>Opened once. There is nothing left on the server to show anyone else.</p>
            </div>
            <dl className="demo-ledger">
              <dt>created</dt>
              <dd>14:02 · today</dd>
              <dt>opened</dt>
              <dd>14:09 · today</dd>
              <dt>stored now</dt>
              <dd className="gone">nothing</dd>
            </dl>
          </div>
        </div>

        <div className="demo-steps">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              className="demo-step"
              aria-current={i === step ? "step" : undefined}
              onClick={() => pick(i)}
            >
              <span className="demo-step-label">
                <small>{s.n}</small>
                {s.label}
              </span>
              <span className="demo-step-bar" aria-hidden="true">
                <i style={{ "--p": i < step ? 1 : i === step ? p : 0 } as React.CSSProperties} />
              </span>
            </button>
          ))}
        </div>
      </figure>

      <div className="demo-foot">
        <span>The whole life of a secret, in about fifteen seconds.</span>
        {!auto && !reduced && (
          <button type="button" className="link-btn" onClick={() => setAuto(true)}>
            Resume autoplay
          </button>
        )}
      </div>
    </div>
  );
}
