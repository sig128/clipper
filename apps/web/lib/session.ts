/** Owner session cookie: "<expiry>.<HMAC>" signed with SESSION_SECRET. Web Crypto, so it runs in middleware too. */
const enc = new TextEncoder();
export const COOKIE = "cf_session";

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function makeSession(secret: string, days = 30): Promise<string> {
  const exp = String(Date.now() + days * 86_400_000);
  return `${exp}.${await hmac(secret, exp)}`;
}

export async function validSession(secret: string | undefined, value: string | undefined): Promise<boolean> {
  if (!secret || !value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return same(await hmac(secret, exp), sig);
}

/** Compares a typed password with OWNER_PASSWORD without leaking timing. */
export async function passwordMatches(secret: string, typed: string, expected: string): Promise<boolean> {
  return same(await hmac(secret, `pw:${typed}`), await hmac(secret, `pw:${expected}`));
}
