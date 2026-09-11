# Security policy

SecretDrop's promise is narrow and absolute: a secret is readable the number of
times its author allowed — once, by default — and the server never sees it in
the clear. Anything that breaks either half is the kind of report this file
exists for.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/Ulzuhan/secretdrop/security/advisories/new)
on this repository. That channel stays private until we publish it together.

Please do not open a public issue for anything exploitable.

**What to expect:** an acknowledgement within 72 hours, an assessment within
7 days, and a fix or a written explanation of why there is not going to be one.
You will be credited in the advisory unless you would rather not be. There is no
bounty.

## What it is, in security terms

- **The encryption happens in the browser.** AES-256-GCM under a random 256-bit
  key from Web Crypto. The server receives the ciphertext, the IV and the
  metadata — never the plaintext, never the key.
- **The key travels in the URL fragment**, which browsers do not send to
  servers. The whole link is therefore the secret; half of it is useless.
- **Reading consumes.** Fetching the ciphertext spends a view even if the
  decryption afterwards fails: delivery is not an acknowledgement protocol.
- **The last view burns before it is served.** A tombstone without ciphertext is
  persisted first and retained, so a crash cannot resurrect a spent secret.
- **One process per store.** Locks, quotas and rate limits are process-local;
  two writers over the same directory break the guarantees above.
- **Creating needs an account, reading does not.** That asymmetry is the design,
  not an oversight: whoever receives the link should not have to register to open it.
- **Sessions are signed cookies**, 12 hours by default and clamped to 1–24.
  Back-channel logout from the provider records a revocation; without that
  notification, removing access upstream is bounded by the cookie's expiry.

## In scope

- Reading a secret twice, or reading one without the fragment key.
- Any path where the plaintext or the key reaches the server, a log or a third party.
- Listing, reading or deleting another account's secrets.
- Resurrecting a consumed or expired secret, or defeating the tombstone.
- Forging or replaying a session; bypassing the origin check, the quota or the
  rate limits.
- Anything that makes the viewer render attacker-controlled markup or script.

## Out of scope

- Scanner output with no working exploit, or missing headers with no shown impact.
- Volumetric denial of service. A way *around* a documented limit is in scope;
  sending more traffic than a host can take is not.
- Misconfiguration of your own deployment, unless an unsafe default here causes it.
- Sharing a link with the wrong person. The link is the secret; we cannot fix that end.

## What it does not claim

Encryption protects what is stored. It does not protect a compromised browser,
and it does not protect you from a server that serves hostile JavaScript — which
is why the origin you type matters and why there is no third-party script on the
page. Restoring a backup of the data directory is not a rollback: it can revive
secrets the service already promised to burn, and the deployment guide says not
to take one.

## Supply chain

Dependencies are pinned by `go.mod`, `go.sum` and `package-lock.json`; Renovate
opens grouped updates weekly and security updates immediately. Every GitHub
Action is pinned by commit SHA. The image is built with signed provenance —
attested to this repository, workflow and commit, and verified in the same run —
carries an SBOM, and every published digest is scanned with Trivy for fixable
critical and high CVEs. A red run is not deployed.
