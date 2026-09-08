const ADMIN_SESSION_COOKIE = "rumo_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export { ADMIN_SESSION_COOKIE, SESSION_MAX_AGE };

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function textToBytes(value: string) {
  return new TextEncoder().encode(value);
}

async function sign(value: string) {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD;

  if (!secret) {
    throw new Error("ADMIN_PASSWORD não configurado.");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    textToBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textToBytes(value)
  );

  return toBase64Url(new Uint8Array(signature));
}

async function verifySignature(value: string, signature: string) {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD;

  if (!secret) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    textToBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  return crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(signature),
    textToBytes(value)
  );
}

export async function createAdminSession() {
  const payload = toBase64Url(
    textToBytes(
      JSON.stringify({
        user: process.env.ADMIN_USER || "",
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
        nonce: crypto.randomUUID(),
      })
    )
  );

  const signature = await sign(payload);
  return `${payload}.${signature}`;
}

export async function verifyAdminSession(token: string | undefined | null) {
  if (!token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!signature) return false;

  try {
    const validSignature = await verifySignature(payload, signature);
    if (!validSignature) return false;

    const decoded = new TextDecoder().decode(fromBase64Url(payload));
    const data = JSON.parse(decoded) as { user?: string; exp?: number };

    if (!data.user || data.user !== process.env.ADMIN_USER) return false;
    if (!data.exp || data.exp <= Math.floor(Date.now() / 1000)) return false;

    return true;
  } catch {
    return false;
  }
}

export function getAdminCredentials() {
  return {
    user: process.env.ADMIN_USER || "",
    password: process.env.ADMIN_PASSWORD || "",
  };
}
