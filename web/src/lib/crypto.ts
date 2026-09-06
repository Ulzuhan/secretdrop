/**
 * SecretDrop — Client-side AES-256-GCM encryption utilities
 *
 * Security model:
 * - The secret is encrypted in the browser with a random 256-bit key
 * - The key travels in the URL fragment (#key), which is NEVER sent to the server
 * - The server only stores: encrypted ciphertext + IV + auth tag
 * - Without the key, the server cannot decrypt the secret — not even with full DB access
 *
 * This is the same security model as OneTimeSecret / Yopass / PrivateBin.
 */

// ─── Key generation ────────────────────────────────────────────────
export function generateKey(): string {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32)); // 256 bits
  return base64UrlEncode(keyBytes);
}

// ─── Encryption ────────────────────────────────────────────────────
export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string;         // base64
}

export async function encryptSecret(plaintext: string, keyB64: string): Promise<EncryptedPayload> {
  const keyRaw = base64UrlDecode(keyB64);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyRaw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const encoded = new TextEncoder().encode(plaintext);

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encoded
  );

  return {
    ciphertext: base64Encode(new Uint8Array(encryptedBuffer)),
    iv: base64Encode(iv),
  };
}

// ─── Decryption ────────────────────────────────────────────────────
export async function decryptSecret(
  ciphertextB64: string,
  ivB64: string,
  keyB64: string
): Promise<string> {
  const keyRaw = base64UrlDecode(keyB64);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyRaw,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const iv = base64Decode(ivB64);
  const ciphertext = base64Decode(ciphertextB64);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext
  );

  return new TextDecoder().decode(decryptedBuffer);
}

// ─── Base64 helpers ─────────────────────────────────────────────────

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64Decode(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// URL-safe base64 (no +, /, =) for use in URL fragments
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return base64Decode(padded);
}