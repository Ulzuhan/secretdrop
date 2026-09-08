# Contributing

The maintained application is React + Go. Keep server code in `internal/` and `cmd/secretdrop/`, browser code in `src/`. Do not reintroduce Next.js or duplicate encryption code.

## Tools and commands

Use Go 1.27.1, Node.js 22+, npm, Bash, curl, OpenSSL and `ss` (iproute2 on Linux). Docker is needed for compatibility and final-image checks. Install dependencies with `npm ci`.

```bash
npm run lint
npm run typecheck
npm test
npx playwright install --with-deps chromium
npm run test:navegador
npm run test:compatibilidad
```

To exercise the final image:

```bash
docker build -t secretdrop-cleanup:local .
SECRETDROP_TEST_IMAGE=secretdrop-cleanup:local SECRETDROP_TEST_LAUNCH="bash scripts/lanzar-imagen.sh" npm run test:navegador
```

`npm run build` compiles React first and embeds it in Go. A bare `go build` without frontend assets is not a complete application build. Generated assets, binaries, credentials, stores and test reports must stay untracked.

The HTTP fixture defaults to port 3992 and IdP port 9999; override `PORT` and `PUERTO_IDP` if occupied. Browser fixtures use `PUERTO_APP`, `PUERTO_TLS` and `PUERTO_IDP`. Never kill an unrelated process to free a test port.

## Review requirements

Preserve browser-only encryption, durable consumption, ownership filtering and revocations across restarts. Add deterministic regressions for changes to these contracts. Use fake identities and isolated stores, not live secrets. The legacy image compatibility test checks data format and intentionally uses the caller's UID for its shared temporary store; it is not the production security profile.

Publishing is separate from testing: pushing to `main` triggers the image workflow. Do not tag, publish, deploy or edit infrastructure as part of an unauthorised cleanup. See [DEPLOYMENT.md](DEPLOYMENT.md) for promotion and rollback.
