import { useEffect, useState } from "react";

/**
 * Un progreso de 0 a 1 en `ms` milisegundos, movido por requestAnimationFrame.
 * Cambia `token` para volver a empezar; con `active` en falso se queda en 0.
 */
export function useProgress(active: boolean, ms: number, token: unknown = null): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setProgress(0);
    };
  }, [active, ms, token]);
  return active ? progress : 0;
}
