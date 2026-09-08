# SecretDrop: React + Go

Go is the only backend. React in src/ is built with Vite and embedded in the
binary. Node is a build/test tool, never a production server.

- Keep a single src/lib/crypto.ts, shared by the UI and unit tests. Never send
  fragment keys or plaintext to Go, logs or external services.
- Consuming a secret mutates it. Do not prefetch consuming URLs. Preserve the
  missing-key guard and durable burn before returning the final view.
- Preserve millisecond timestamps, explicit counters, tombstones and revocations.
  One process per store; never restore spent secrets from backups.
- Use isolated test stores. Keep HTTP/browser/restart tests and compatibility
  against the exact published Node image, not a second maintained Node backend.
- Run npm run lint, npm run typecheck, npm test and relevant browser/image tests.
- Do not publish, push or deploy without authorization; main pushes publish images.
- Preserve unrelated edits, including existing untracked documentation.
