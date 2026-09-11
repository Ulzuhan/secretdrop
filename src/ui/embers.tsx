import { useMemo } from "react";

/** Rescoldos que suben: el adorno de «esto ya se ha quemado». */
export function Embers({ count = 14 }: { count?: number }) {
  const sparks = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: `${(i * 37 + 11) % 100}%`,
        s: `${2 + ((i * 7) % 4)}px`,
        t: `${5 + ((i * 13) % 6)}s`,
        d: `${-((i * 977) % 6000) / 1000}s`,
        dx: `${((i % 3) - 1) * 2.5}rem`,
      })),
    [count],
  );
  return (
    <div className="ember-field" aria-hidden="true">
      {sparks.map((s, i) => (
        <i
          key={i}
          style={{ "--x": s.x, "--s": s.s, "--t": s.t, "--d": s.d, "--dx": s.dx } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
