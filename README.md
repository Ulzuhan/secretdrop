# SecretDrop

**Share a secret once.** Encrypted in the browser before it leaves, burned the moment it is read. Self-hosted.

[![CI](https://github.com/Ulzuhan/secretdrop/actions/workflows/ci.yml/badge.svg)](https://github.com/Ulzuhan/secretdrop/actions/workflows/ci.yml)

Passwords, API keys and one-off credentials do not belong in chat history or email threads. SecretDrop turns them into a link that works exactly as many times as you allow — once, by default — and then destroys itself.

## Security model

The server never sees the plaintext — not even with full disk access:

1. The secret is encrypted **in the browser** with AES-256-GCM under a random 256-bit key (Web Crypto API, `src/lib/crypto.ts`).
2. The key travels in the **URL fragment** — `/v/<id>#<key>` — which browsers never send to servers.
3. The server stores only the ciphertext, the IV and the metadata (expiry, view budget).
4. Opening the link fetches the ciphertext, and the browser decrypts it locally with the key from the fragment.

Same security model as OneTimeSecret, Yopass or PrivateBin.

## Burn semantics

- **View budget** — 1 to 10 views, default 1. The view that exhausts the budget marks the secret burned and deletes it from disk; a burned or expired link answers `410`, never the ciphertext again.
- **Expiry** — 1 hour to 7 days, default 24 h. Expired secrets are removed on access, at startup, and by `POST /api/cleanup`.
- **Storage** — flat files under `.secretdrop-store/` with an in-memory cache in front. No database required.

## Who can do what

The asymmetry is the whole design: **creating a secret needs an account, opening one does not.** Whoever you send a link to is, by definition, somebody without an account here — asking them to get one would defeat the point of the tool. Sign-in (OIDC, e.g. against Authentik) guards the writing side only; `/v/<id>` stays open to anyone holding the link. There is no user store: a session is just a signed cookie carrying the identity the OIDC provider vouched for.

## Quickstart

```bash
npm ci
npm run dev        # http://localhost:3461
```

Until OIDC is configured nobody can sign in to create secrets — set the variables below.

## Environment variables

| Variable | Purpose |
|---|---|
| `SECRETDROP_SESSION_SECRET` | HMAC key that signs the session cookie. Without it (and an OIDC client), nobody can sign in. |
| `SECRETDROP_OIDC_CLIENT_ID` / `_SECRET` | OIDC client credentials. |
| `SECRETDROP_OIDC_REDIRECT_URI` | Must match one of the URIs registered in the provider. |
| `SECRETDROP_OIDC_PUBLIC_BASE` | The provider as the browser sees it. |
| `SECRETDROP_OIDC_INTERNAL_BASE` | The provider as this server sees it — redeeming the authorization code never leaves the internal network. |

## API

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/secrets` | account | Store ciphertext + IV; returns the id. |
| `GET /api/secrets` | account | List live secrets on this instance (metadata only, never ciphertext). |
| `GET /api/secrets/:id` | none | Fetch ciphertext + IV; counts toward the view budget. |
| `POST /api/cleanup` | account | Purge expired and burned secrets. |

## Stack

Next.js 16 · React 19 · TypeScript. No runtime dependencies beyond Next itself — the crypto is the platform's.
