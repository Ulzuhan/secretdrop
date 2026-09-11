import type { SVGProps } from "react";

/**
 * Iconos dibujados aquí, sin dependencia: la CSP no deja cargar nada de fuera
 * y una biblioteca entera por veinte trazos no se justifica.
 */
const PATHS = {
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm6 4v2",
  unlock: "M7 11V8a5 5 0 0 1 9.6-2M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm6 4v2",
  flame: "M12 3c.6 3.2 2.3 4.7 4 6.6a6 6 0 1 1-9.4 6.9C7.4 14.6 9 13 9 11c1.6.9 2.2 2.2 2 3.7C13 13 13.3 9.5 12 3Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2",
  eye: "M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  key: "M15 8a6 6 0 1 1-4.7 9.7L9 19H7v2H4v-3l6.3-6.3A6 6 0 0 1 15 8Zm1 3h.01",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7L12.5 17",
  copy: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Zm-4 6H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  check: "m5 12.5 4.5 4.5L19 7.5",
  refresh: "M20 12a8 8 0 0 1-14.2 5M4 12a8 8 0 0 1 14.2-5M18 3v4h-4M6 21v-4h4",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9",
  external: "M15 3h6v6m0-6L10 14M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  shield: "M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4",
  alert: "M12 9v4m0 4h.01M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z",
  chevron: "m6 9 6 6 6-6",
  sparkle: "M12 3v4m0 10v4m9-9h-4M7 12H3m14.5-6.5-2.8 2.8M9.3 14.7l-2.8 2.8m0-11 2.8 2.8m5.4 5.4 2.8 2.8",
  eyeOff: "m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M7.3 7.3C4.5 9 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.8 0 3.3-.5 4.7-1.3M12 5.5c6 0 9.5 6.5 9.5 6.5s-.9 1.7-2.6 3.3",
  hourglass: "M6 3h12M6 21h12M7 3v3.5a5 5 0 0 0 2.3 4.2L12 12l-2.7 1.3A5 5 0 0 0 7 17.5V21m10-18v3.5a5 5 0 0 1-2.3 4.2L12 12l2.7 1.3a5 5 0 0 1 2.3 4.2V21",
  ghost: "M5 21v-9a7 7 0 0 1 14 0v9l-2.3-2-2.3 2-2.4-2-2.4 2-2.3-2L5 21Zm4.5-9h.01M14.5 12h.01",
  home: "M4 11 12 4l8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1v-9Z",
  x: "M6 6l12 12M18 6 6 18",
  inbox: "M4 13h4l2 3h4l2-3h4M4 13V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v7M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  ...rest
}: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
