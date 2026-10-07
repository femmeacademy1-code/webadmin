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
async function limit(env, req, kind = 'dom', max = 30) {
  if (!env.CMS) return;
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  const key = 'rl:' + kind + ':' + ip + ':' + Math.floor(Date.now() / 60000);
  const n = +(await env.CMS.get(key)) || 0;
  if (n >= max) throw new HttpError(429, 'יותר מדי בדיקות. נסו שוב בעוד דקה');
  await env.CMS.put(key, String(n + 1), { expirationTtl: 120 });
}

const CFBASE = (env) => env.CF_API || 'https://api.cloudflare.com/client/v4';
export const usdToIls = (env, usd) => Math.ceil(usd * (+env.DOMAIN_USD_ILS || 3.7) + (+env.DOMAIN_FEE_ILS || 0));

async function registrar(env, method, path, payload) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) throw new HttpError(503, 'בדיקת דומיינים עוד לא הופעלה');
  const r = await fetch(`${CFBASE(env)}/accounts/${env.CF_ACCOUNT_ID}/registrar/${path}`, {
    method, headers: { Authorization: 'Bearer ' + env.CF_API_TOKEN, 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined,
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || (j && j.success === false)) {
    if (r.status === 401 || r.status === 403) throw new HttpError(503, 'חסרה הרשאת Registrar לטוקן של Cloudflare');
    const m = j && j.errors && j.errors[0] && j.errors[0].message;
    throw new HttpError(502, m ? 'Cloudflare: ' + m : 'הבקשה ל-Cloudflare נכשלה (' + r.status + ')');
  }
  return j ? j.result : null;
}

function shape(env, d, name) {
  const price = d && d.registrable && d.pricing ? parseFloat(d.pricing.registration_cost) : null;
  const renew = d && d.registrable && d.pricing ? parseFloat(d.pricing.renewal_cost) : null;
  const usd = Number.isFinite(price) ? price : null;
  return {
    name,
    available: !!(d && d.registrable),
    premium: !!(d && d.tier && d.tier !== 'standard'),
    usd, ils: usd == null ? null : usdToIls(env, usd),
    renewUsd: Number.isFinite(renew) ? renew : null,
    currency: d && d.pricing ? d.pricing.currency || 'USD' : null,
  };
}

async function checkMany(env, names) {
  const res = await registrar(env, 'POST', 'domain-check', { domains: names });
  const list = (res && res.domains) || [];
  return names.map((n) => shape(env, list.find((x) => x.name === n), n));
}

export async function checkDomains(env, req, rawName) {
  const label = cleanLabel(rawName);
  await limit(env, req);
  const results = await checkMany(env, TLDS.map((t) => `${label}.${t}`));
  return { label, results };
}


/* ---------------- orders (semi-automatic): the customer asks, the owner marks it paid and registers with one click ---------------- */
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const nowIso = () => new Date().toISOString();

export async function createOrder(env, req, input) {
  const domain = String(input.domain || '').trim().toLowerCase();
  const m = domain.match(/^([a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?)\.([a-z]+)$/);
  if (!m || !TLDS.includes(m[2])) throw new HttpError(400, 'דומיין לא תקין');
  const name = String(input.name || '').trim().slice(0, 60);
  const phone = String(input.phone || '').replace(/[^\d+]/g, '');
  const email = String(input.email || '').trim().slice(0, 80);
  if (name.length < 2) throw new HttpError(400, 'חסר שם');
  if (phone.length < 7 || phone.length > 16) throw new HttpError(400, 'מספר הטלפון לא תקין');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'כתובת המייל לא תקינה');
  await limit(env, req, 'ord', 10);
  const [d] = await checkMany(env, [domain]);
  if (!d.available || d.usd == null) throw new HttpError(409, 'הדומיין כבר לא פנוי');
  const order = { id: newId(), domain, name, phone, email, usd: d.usd, ils: d.ils, premium: d.premium, status: 'new', created: nowIso() };
  await env.CMS.put('o:' + order.id, JSON.stringify(order));
  return order;
}

export async function listOrders(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.CMS.list({ prefix: 'o:', cursor });
    for (const k of r.keys) { const v = await env.CMS.get(k.name); if (v) out.push(JSON.parse(v)); }
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return out.sort((a, b) => b.created.localeCompare(a.created));
}

export async function orderAction(env, id, action, input = {}) {
  const raw = await env.CMS.get('o:' + id);
  if (!raw) throw new HttpError(404, 'ההזמנה לא נמצאה');
  const o = JSON.parse(raw);
  const save = () => env.CMS.put('o:' + id, JSON.stringify(o));
  if (action === 'delete') { await env.CMS.delete('o:' + id); return { ok: true }; }
  if (action === 'cancel') { if (o.status === 'registered') throw new HttpError(409, 'הדומיין כבר נרשם'); o.status = 'cancelled'; await save(); return o; }
  if (action === 'paid') { if (o.status !== 'new') throw new HttpError(409, 'ההזמנה כבר לא חדשה'); o.status = 'paid'; o.paidAt = nowIso(); await save(); return o; }
  if (action === 'manual') { if (o.status === 'cancelled') throw new HttpError(409, 'ההזמנה בוטלה'); o.status = 'registered'; o.registeredAt = nowIso(); o.manual = true; await save(); return o; }
  if (action === 'register') {
    if (o.status !== 'paid') throw new HttpError(409, 'אפשר לרשום רק הזמנה ששולמה');
    const [d] = await checkMany(env, [o.domain]);
    if (!d.available || d.usd == null) throw new HttpError(409, 'הדומיין כבר לא פנוי. אפשר לבטל את ההזמנה ולהחזיר ללקוח');
    if (d.usd > o.usd * 1.1 && !input.force) throw new HttpError(409, `המחיר ב-Cloudflare עלה מ-$${o.usd} ל-$${d.usd}. אשרו שוב כדי להמשיך`);
    try {
      const res = await registrar(env, 'POST', 'registrations', { domain_name: o.domain });
      o.status = 'registered'; o.registeredAt = nowIso(); o.usdPaid = d.usd; delete o.lastError;
      o.cf = res && typeof res === 'object' ? JSON.parse(JSON.stringify(res).slice(0, 1500)) : null;
    } catch (e) {
      o.lastError = e.message; await save(); throw e;
    }
    await save(); return o;
  }
  throw new HttpError(400, 'פעולה לא מוכרת');
}
