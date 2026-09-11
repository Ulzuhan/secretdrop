# SecretDrop

Share a secret once. Encrypted in the browser, with a Go backend and a React interface. Self-hosted.

[![CI](https://github.com/Ulzuhan/secretdrop/actions/workflows/ci.yml/badge.svg)](https://github.com/Ulzuhan/secretdrop/actions/workflows/ci.yml)
[![Container image](https://github.com/Ulzuhan/secretdrop/actions/workflows/docker.yml/badge.svg)](https://github.com/Ulzuhan/secretdrop/pkgs/container/secretdrop)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![The workspace right after creating a secret: the encrypted link, ready to share](assets/screenshot.jpg)

Passwords, API keys and one-off credentials do not belong in chat history. SecretDrop turns them into a link with an expiry and a view budget — one view by default. Creating and listing secrets requires an OIDC account; recipients only need the link.

## How it works

1. The browser encrypts with AES-256-GCM and a random 256-bit key using Web Crypto.
2. Go receives ciphertext, IV and metadata. The key stays in the URL fragment: `/v/<id>#<key>`, which browsers do not send in HTTP requests.
3. The recipient's browser fetches the ciphertext and decrypts it locally. This fetch **consumes a view**, even if decryption later fails.
4. On the last permitted view, the server persists a tombstone without ciphertext before returning the encrypted payload. A second reader cannot reuse that view.

There are no third-party analytics or database services. Encryption protects stored content, not a compromised browser or a server that delivers malicious JavaScript. Treat the **full link** as a secret; do not paste it into logs or support tickets.

## Architecture

| Part | Implementation |
|---|---|
| HTTP, OIDC and storage | Go standard library, `cmd/secretdrop` and `internal/` |
| Interface | React 19 + TypeScript in `src/`, built with Vite; hand-written CSS and self-hosted fonts |
| Encryption | One shared `src/lib/crypto.ts`, executed in the browser |
| Production | One Go binary with embedded assets; **no Node.js runtime** |
| Build and tests | Node.js/npm for frontend tooling and test fixtures |

The Next.js backend is no longer maintained in this tree. Historical source remains in Git; the pinned 0.7.3 image remains a compatibility fixture, not a second implementation to build. [How the port happened](docs/MIGRACION-GO-0.8.0.md) records what it delivered and what it proved.

## Run locally

Requires Go 1.27.1 and Node.js 22 or newer.

```bash
npm ci
npm run dev
# http://127.0.0.1:13461
```

This builds React and Go, then runs the binary with an isolated `.local/data` store. It is **not** a hot-reload server: restart after source changes. Local HTTP explicitly disables Secure cookies; production keeps them enabled by default. If no session key is exported, the dev script generates an ephemeral one: restarting invalidates those local sessions. Direct binary and container launches require a configured key.

Configure OIDC in the process environment to sign in. See [.env.example](.env.example); Go does **not** automatically load `.env` or `.env.local`. For a trusted local `.env`, export it before starting:

```bash
set -a
. ./.env
set +a
npm run dev
```

Register `http://127.0.0.1:13461/api/auth/callback` with your provider for local testing. Without OIDC, public pages render but creating secrets is unavailable.

## Deploy

```bash
cp .env.example .env
# Set the session signing key and OIDC configuration; protect this file.
docker compose up -d --build
```

Compose binds to `127.0.0.1:3461`. Put a trusted TLS proxy in front and run **one instance per store**: locks, quotas and rate limits are process-local. The image runs as UID 10001 with a persistent `/data` volume. See [deployment and rollback](DEPLOYMENT.md) before exposing it.

On `SIGTERM` the process stops accepting and drains in-flight requests for up to
15 s before exiting. Give it that margin — the bundled Compose file declares
`stop_grace_period: 20s`, because Docker's default kills at 10 s — or a delivery
can be cut off mid-response after the secret has already been spent.

## Configuration

| Variable | Purpose / default |
|---|---|
| `SECRETDROP_SESSION_SECRET` | Session HMAC key; generate with `openssl rand -hex 32`. |
| `SECRETDROP_OIDC_CLIENT_ID` / `SECRETDROP_OIDC_CLIENT_SECRET` | Provider credentials. |
| `SECRETDROP_OIDC_ISSUER` | Discovery URL base; endpoint paths come from the provider. |
| `SECRETDROP_OIDC_REDIRECT_URI` | Registered callback URL. |
| `SECRETDROP_OIDC_INTERNAL_BASE` | Optional server-side provider origin; defaults to the issuer origin. |
| `SECRETDROP_ENROLL_URL` / `SECRETDROP_ACCOUNT_URL` | Optional enrolment and account-management links. |
| `SECRETDROP_SESSION_TTL_HOURS` | Default 12 h, clamped to 1–24 h. |
| `SECRETDROP_OIDC_TIMEOUT_MS` | Default 10000 ms, clamped to 1000–60000 ms. |
| `SECRETDROP_STORE_DIR` | Default `.secretdrop-store`; image uses `/data`, dev script uses `.local/data`. |
| `SECRETDROP_MAX_STORE_BYTES` | Storage quota, default 100 MiB. |
| `SECRETDROP_MAX_ACTIVE_SECRETS` | Record quota, default 1000; retained tombstones also count. |
| `SECRETDROP_PUBLIC_HOST` | Optional canonical host for origin checks and public metadata. |
| `SECRETDROP_INSECURE_COOKIES` | Set to `1` **only for local HTTP**; secure by default. |
| `KAICORP_FOOTER_LINKS` | Set to `on` to show sibling-service links. |
| `HOSTNAME` / `PORT` | Bind address and port. Dev binds loopback; image uses port 3461. |

## Contracts that matter

- View budget: 1–10, default 1. Expiry: 1–168 hours, default 24.
- The HTML viewer does not access the store. Without a fragment key, the client does not consume a secret either. **Opening a full link does consume it.**
- The last view burns before delivery. A failed response can therefore spend a view; delivery is not an acknowledgement protocol.
- Listings contain only the account's live metadata, never ciphertext or another account's identifiers. The index is rebuilt before serving requests.
- OIDC back-channel logout persists revocations. Removing a provider permission without a valid notification does not immediately invalidate an issued cookie; its expiry remains the fallback bound.
- A restart does not truncate a delivery: the server drains in-flight requests before exiting, provided the runtime allows the stop budget above.
- Never restore old payloads or revocation files to roll back code: this can resurrect consumed secrets or revoked sessions.

[CONTRATOS.md](CONTRATOS.md) records the compatibility and security contracts.

## Verify changes

```bash
npm run lint
npm run typecheck
npm test                         # build, JS unit, Go race, HTTP, logout, restart
npx playwright install chromium
npm run test:navegador            # HTTPS + synthetic OIDC provider
npm run test:compatibilidad       # pinned Node image → Go → pinned Node image
```

Browser tests also run against the final container in CI. Fixtures use temporary stores, synthetic identities and loopback ports; no production account is needed. Docker is required for compatibility and image tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for the image check and tool requirements.

## License

[MIT](LICENSE).
