// HMAC-SHA256 request signing shared by both directions of the n8n
// integration. Runs on Web Crypto, so it works in the default Convex runtime
// without a Node action.
//
// Signed string: `${timestamp}.${rawBody}`
// Headers:       X-LendLoop-Timestamp: <unix seconds>
//                X-LendLoop-Signature: v1=<hex digest>
//
// The timestamp bounds replays to a five minute window. Inside that window,
// writes are protected by idempotency keys, so a replayed request is harmless.

export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
export const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

async function importKey(secret: string, usage: "sign" | "verify") {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function sign(
  secret: string,
  rawBody: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<{ timestamp: string; signature: string }> {
  const key = await importKey(secret, "sign");
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  return { timestamp: String(timestamp), signature: `v1=${toHex(digest)}` };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "stale" | "malformed" | "mismatch" };

export async function verify(
  secret: string,
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: "missing" };
  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp)) return { ok: false, reason: "malformed" };
  if (Math.abs(nowSeconds - timestamp) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale" };
  const digest = signatureHeader.startsWith("v1=") ? fromHex(signatureHeader.slice(3)) : null;
  if (!digest || digest.length !== 32) return { ok: false, reason: "malformed" };
  // subtle.verify compares in constant time, so the check does not leak how
  // many leading bytes matched.
  const key = await importKey(secret, "verify");
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    digest,
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  return valid ? { ok: true } : { ok: false, reason: "mismatch" };
}
