# Changelog

## Unreleased

- Rebuild the interface from scratch: a new design system (hand-written CSS, self-hosted Inter, Instrument Serif and JetBrains Mono), a landing page with an animated secret lifecycle, a two-column workspace with live status of active secrets, and a viewer with distinct burned, expired, missing-key and error endings.
- Drop Tailwind and PostCSS; the Docker build no longer copies a PostCSS config.
- The share link is always shown in a selectable field; copying is a shortcut, and a denied clipboard says so.
- Retire the legacy Next.js backend and Dockerfile; React + Go is the only maintained application.
- Consolidate the active frontend into src/, preserving browser encryption unchanged.
- Replace Next navigation shims with ordinary links and server-provided viewer IDs.
- Keep HTTP, browser, restart and signed-logout checks; move backend unit coverage to Go.
- Pin compatibility to the published Node 0.7.3 image instead of rebuilding another backend.
- Align CI, local commands, README, deployment documentation and repository hygiene with Go.

No storage-format or production-configuration change. Node remains build/test tooling only.

## 0.8.0 — 2026-09-06

- Replace the production Node server with a Go backend and embedded React/Vite assets.
- Preserve ciphertext, millisecond timestamps, view counters, tombstones and session revocations across Node → Go → Node.
- Secure cookies by default, independently of NODE_ENV; retain an explicit local-HTTP opt-out.
- Correct logout validation and revocation ordering, cold-start listings and no-store responses for ciphertext.
- Add browser and image checks for styling, public assets, metadata, logout and denied clipboard access.

## 0.7.3 — 2026-09-04

- Release idle per-secret consume queues by comparing the promise actually
  stored in the map. Completed operations no longer retain a queue forever.
- Queue tails discard results and recover after rejection without deleting a
  later operation's queue.
- Add regression coverage for 1,000 unknown IDs, storage failures and recovery.
- Isolate unit-test storage in temporary directories, cleaned up after the run.

No configuration or data migration is needed. One-time consumption and
encryption semantics are unchanged.
