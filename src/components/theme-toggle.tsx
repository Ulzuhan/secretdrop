import { useEffect } from "react";

const STORAGE_KEY = "color-scheme";

function getSystemScheme(): "light" | "dark" {
  if (typeof matchMedia !== "function") return "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getMeta(): HTMLMetaElement | null {
  return document.querySelector('meta[name="color-scheme"]');
}

function syncFromStorage() {
  const meta = getMeta();
  if (!meta) return;
  let stored: string | null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  meta.content = stored === "light" || stored === "dark" ? stored : "light dark";
}

export function ThemeToggle() {
  useEffect(() => {
    syncFromStorage();
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        syncFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = () => {
    const meta = getMeta();
    const sys = getSystemScheme();
    let stored: string | null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    const current = stored === "light" || stored === "dark" ? stored : sys;
    const target = current === "dark" ? "light" : "dark";

    if (target === sys) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore blocked storage; still apply to meta for this load.
      }
      if (meta) meta.content = "light dark";
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, target);
      } catch {
        // Ignore blocked storage; still apply to meta for this load.
      }
      if (meta) meta.content = target;
    }
  };

  return (
    <button type="button" className="kc-theme-btn" onClick={toggle}>
      <span className="kc-theme-to-light">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
        <span className="sr-only">Switch to light theme</span>
      </span>
      <span className="kc-theme-to-dark">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
        <span className="sr-only">Switch to dark theme</span>
      </span>
    </button>
  );
}
