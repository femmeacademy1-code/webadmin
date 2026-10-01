/* Password hashing + signed session tokens, WebCrypto only (works in Workers and Node 20+). */
const enc = new TextEncoder();

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64u = (buf) => toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

// Workers caps PBKDF2 at 100,000 iterations.
const ITER = 100_000;

async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toB64(salt), hash: toB64(await pbkdf2(password, salt)) };
}

export async function verifyPassword(password, rec) {
  const salt = rec ? fromB64(rec.salt) : new Uint8Array(16);   // unknown user: still burn the same CPU
  const got = toB64(await pbkdf2(password, salt));
  return !!rec && safeEqual(got, rec.hash);
}

export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Constant-time comparison of two secrets of any length. */
export async function secretEquals(a, b) {
  const [x, y] = await Promise.all([a, b].map((v) => crypto.subtle.digest('SHA-256', enc.encode(v))));
  return safeEqual(toB64(x), toB64(y));
}

async function hmac(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signToken(payload, secret) {
  const body = toB64u(enc.encode(JSON.stringify(payload)));
  const sig = toB64u(await crypto.subtle.sign('HMAC', await hmac(secret), enc.encode(body)));
  return `${body}.${sig}`;
}

export async function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await hmac(secret), fromB64u(sig), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64u(body)));
    return p.e > Date.now() ? p : null;
  } catch { return null; }
}
