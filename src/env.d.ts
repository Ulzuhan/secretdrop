/// <reference types="vite/client" />

// `process` no existe en el navegador. La única expresión que lo usa es la del
// pie generado, y `define` en vite.config.mts la sustituye antes de compilar.
// Esta declaración describe exactamente eso y nada más: si aparece otro
// `process.env.LO_QUE_SEA` sin su `define`, saldrá `undefined` en ejecución.
declare const process: { env: Record<string, string | undefined> };
