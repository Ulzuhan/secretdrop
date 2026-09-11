import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";

/** Copiar con estado: «copied» durante dos segundos, o «failed» si se deniega. */
export function useCopy(): {
  state: "idle" | "copied" | "failed";
  copy: (text: string) => Promise<void>;
  reset: () => void;
} {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async (text: string) => {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    if (ok) timer.current = setTimeout(() => setState("idle"), 2200);
  }, []);

  const reset = useCallback(() => setState("idle"), []);
  return { state, copy, reset };
}
