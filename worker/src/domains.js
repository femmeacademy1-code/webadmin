/* Public domain search for the "buy a domain" page, using the Cloudflare Registrar API (beta).
 * Only checks availability and price: nothing is bought here, and no money moves. An order is finished by the agency
 * (the customer pays through the payment provider, then the domain is registered from the Cloudflare account).
 * Needs CF_API_TOKEN with the Registrar permission and CF_ACCOUNT_ID. */
import { HttpError } from './validate.js';

export const TLDS = ['com', 'net', 'org', 'app', 'dev', 'xyz', 'info', 'online', 'site', 'shop', 'cloud', 'pro'];

/* the name part only: letters, digits and hyphens, no leading/trailing hyphen */
export function cleanLabel(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  const dot = s.indexOf('.');
  if (dot > 0) s = s.slice(0, dot);   // "mybrand.com" -> "mybrand"
  if (!/^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/.test(s)) throw new HttpError(400, 'אפשר רק אותיות באנגלית, מספרים ומקף (למשל mybrand)');
  return s;
}

/* up to 30 requests a minute per visitor, kept in KV */
async function limit(env, req) {
  if (!env.CMS) return;
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  const key = 'rl:dom:' + ip + ':' + Math.floor(Date.now() / 60000);
  const n = +(await env.CMS.get(key)) || 0;
  if (n >= 30) throw new HttpError(429, 'יותר מדי בדיקות. נסו שוב בעוד דקה');
  await env.CMS.put(key, String(n + 1), { expirationTtl: 120 });
}

export async function checkDomains(env, req, rawName) {
  const label = cleanLabel(rawName);
  await limit(env, req);
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) throw new HttpError(503, 'בדיקת דומיינים עוד לא הופעלה');
  const domains = TLDS.map((t) => `${label}.${t}`);
  const r = await fetch(`${env.CF_API || 'https://api.cloudflare.com/client/v4'}/accounts/${env.CF_ACCOUNT_ID}/registrar/domain-check`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.CF_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ domains }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || (j && j.success === false)) {
    if (r.status === 401 || r.status === 403) throw new HttpError(503, 'בדיקת דומיינים לא זמינה כרגע (חסרה הרשאת Registrar לטוקן)');
    throw new HttpError(502, 'בדיקת הדומיינים נכשלה. נסו שוב בעוד רגע');
  }
  const list = (j && j.result && j.result.domains) || [];
  const results = domains.map((name) => {
    const d = list.find((x) => x.name === name);
    const price = d && d.registrable && d.pricing ? parseFloat(d.pricing.registration_cost) : null;
    const renew = d && d.registrable && d.pricing ? parseFloat(d.pricing.renewal_cost) : null;
    return {
      name,
      available: !!(d && d.registrable),
      premium: !!(d && d.tier && d.tier !== 'standard'),
      usd: Number.isFinite(price) ? price : null,
      renewUsd: Number.isFinite(renew) ? renew : null,
      currency: d && d.pricing ? d.pricing.currency || 'USD' : null,
    };
  });
  return { label, results };
}
