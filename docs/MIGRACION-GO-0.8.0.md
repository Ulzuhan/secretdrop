# SecretDrop: la migración a React y Go — 0.8.0 (histórico)

Esto es el registro de la migración del backend a Go, cerrada con la **0.8.0**
el 06-09-2026. Se conserva porque explica **por qué** el árbol está como está y
qué queda probado de aquella entrega; no describe el presente. Para eso están
[AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md) y
[CONTRATOS.md](../CONTRATOS.md). Las notas que este documento sustituye vivían
sin seguimiento en el árbol de trabajo, con una lista de pendientes que ya se
han cerrado; están abajo, con su desenlace.

## Qué entregó la 0.8.0

Un solo proceso Go sirviendo API, autenticación, almacenamiento, HTML y los
recursos de React embebidos con `go:embed`. La PR [#2][pr2] trajo el baseline
corregido y el backend; la PR [#3][pr3], fusionada en `b995029`, la interfaz, la
imagen, la compatibilidad y la preparación de la release. El tag `v0.8.0`
identifica la entrega.

Ni segunda aplicación, ni base nueva, ni segundo escritor: el mismo formato de
almacén, los mismos enlaces y el mismo modelo de un único proceso por almacén.
El cifrado siguió donde estaba —en el navegador, con la clave en el fragmento—
y no se tocó al portarlo.

## Qué quedó acreditado

- Autenticación y back-channel, consumo y persistencia, listado tras reinicio,
  cookies `Secure` por defecto y `no-store` al entregar un criptograma.
- Suites HTTP compartidas, detector de carreras y navegador contra el binario y
  contra la imagen final. Los contratos, en [CONTRATOS.md](../CONTRATOS.md).
- Node → Go → Node sobre el mismo almacén sintético: 22 comprobaciones de usos,
  lápidas, aislamiento y revocaciones, ejecutadas también contra el digest
  exacto de la 0.7.3 y no sólo contra el Node de la rama corregida.
- La imagen bajo restricciones productivas —raíz de sólo lectura, volumen
  escribible, uid 10001— con un ciclo sintético completo.

La comparación acotada, a concurrencia 1, dio CPU agregada 13,63 → 1,00 ms/op y
pico de memoria 60,1 → 6,8 MiB, con mejor p95; el p50 de consumo empeoró de 3,54
a 4,26 ms. Son lotes pequeños y frescos: **no** acreditan capacidad ni memoria
estable con carga sostenida. La tanda de concurrencia 2 quedó incompleta por una
alarma del comparador mal calculada; se aceptó esa laguna para promover, y no
debe citarse como saturación medida.

## Artefactos

Publicada y desplegada entonces:

```text
ghcr.io/ulzuhan/secretdrop:0.8.0@sha256:4b3b61cb96e2d843093f2094b5930740da516d0e11fda135c72b464beed1e0fe
```

Vuelta atrás compatible, la misma que sigue fijando la suite de compatibilidad:

```text
ghcr.io/ulzuhan/secretdrop:0.7.3@sha256:4103ac55664ce49d81bf7b38c6cccbee47d06f7e339ed477398c4be1b7065e2d
```

El rollback cambia binario y comando, **no retrocede datos**: parar Go antes de
arrancar lo anterior, conservar almacén y revocaciones, y nunca restaurar el
volumen —resucitaría secretos ya consumidos—. La 0.7.3 sirve para una
emergencia, no como versión recomendada: no lleva las correcciones posteriores.

## Los pendientes que dejó, y dónde se cerraron

| Pendiente de la 0.8.0 | Desenlace |
|---|---|
| Retirar Next/Node del árbol activo tras la aceptación | Hecho el 08-09-2026: [CLEANUP-2026-09-08.md](CLEANUP-2026-09-08.md). Un solo backend, una sola interfaz en `src/`, sin `Dockerfile.node` |
| Ajustar comandos, CI y documentación al retirar el legado | Hecho en la misma limpieza: `npm run build` compila React y lo embebe en Go; `npm run dev`, `start` y las suites ya no seleccionan Next |
| Rehacer la interfaz, que era la heredada | Hecho en la **0.9.0**: sistema de diseño propio, sin Tailwind ni PostCSS |
| **Apagado**: `Shutdown` corría en una goroutine y `main` volvía sin esperar al drenaje | Corregido en la **0.9.1**, con regresión determinista en `cmd/secretdrop/main_test.go` y el margen de parada documentado en [DEPLOYMENT.md](../DEPLOYMENT.md) |
| Aceptación con cuenta real y cierre de la observación en producción | Es del operador, y se registra en su propio diario: no lo acredita este repositorio |

Publicar no es desplegar, y esto tampoco lo era: fusionar a `main` publica la
imagen de rama y un tag publica la de release, pero el compose productivo está
anclado por digest y sólo cambia cuando alguien lo cambia.

[pr2]: https://github.com/Ulzuhan/secretdrop/pull/2
[pr3]: https://github.com/Ulzuhan/secretdrop/pull/3
