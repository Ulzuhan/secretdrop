import { useEffect, useState } from "react";

/**
 * Un reloj que avanza cada `every` ms, para cuentas atrás y «hace 4m». Quien
 * lo usa lee `Date.now()` al pintar; el valor devuelto sólo sirve de latido.
 */
export function useNow(every = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}
