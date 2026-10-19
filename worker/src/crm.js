/* Lead tracking (owner only): one KV key per lead so two phones saving different leads never overwrite each other.
 * The server owns the timeline (createdAt / updatedAt / dealAt / stage log); the page only sends the fields people type. */
import { HttpError } from './validate.js';

export const STAGES = ['talked', 'hot', 'viewing', 'closing', 'delivered', 'done', 'lost'];
const DEAL = ['delivered', 'done'];
const LEAD = 'crm:l:';
const CFG = 'crm:cfg';
const MAX_LEADS = 900;      // each lead is read with its own KV get; stay well under the 1000-operation limit of one request
const MAX_LOG = 60;

const getKV = async (env, key) => { const v = await env.CMS.get(key); return v ? JSON.parse(v) : null; };
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function money(v, label) {
  if (v === '' || v == null) return '';
  const x = Number(v);
  if (!Number.isFinite(x) || Math.abs(x) > 1e9) throw new HttpError(400, `${label}: סכום לא תקין`);
  return Math.round(x * 100) / 100;
}

export async function crmState(env) {
  const keys = [];
  let cursor;
  do {
    const r = await env.CMS.list({ prefix: LEAD, cursor });
    keys.push(...r.keys.map((k) => k.name));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  const leads = [];
  for (let i = 0; i < keys.length; i += 50) {
    const rows = await Promise.all(keys.slice(i, i + 50).map((k) => getKV(env, k)));
    rows.forEach((l, j) => { if (l) leads.push({ id: keys[i + j].slice(LEAD.length), ...l }); });
  }
  return { leads, cfg: (await getKV(env, CFG)) || { vat: 18, supplierInCost: false } };
}

export async function saveLead(env, id, input) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'בקשה לא תקינה');
  const old = await getKV(env, LEAD + id);
  if (!old && (await env.CMS.list({ prefix: LEAD })).keys.length >= MAX_LEADS) throw new HttpError(400, 'יש יותר מדי לידים במערכת');
  const stage = STAGES.includes(input.stage) ? input.stage : 'talked';
  const name = text(input.name, 120), phone = text(input.phone, 40);
  if (!name && !phone) throw new HttpError(400, 'רשמי לפחות שם או טלפון');
  const follow = text(input.follow, 10);
  if (follow && !/^\d{4}-\d{2}-\d{2}$/.test(follow)) throw new HttpError(400, 'תאריך לא תקין');
  const now = new Date().toISOString();
  const log = (old && Array.isArray(old.log) ? old.log : []).slice(-(MAX_LOG - 1));
  if (!old || old.stage !== stage) log.push({ s: stage, t: now });
  const lead = {
    name, phone, product: text(input.product, 200), source: text(input.source, 120), notes: text(input.notes, 2000), suppName: text(input.suppName, 120), follow,
    stage, price: money(input.price, 'מחיר'), cost: money(input.cost, 'עלות'), supplier: money(input.supplier, 'ספק'), vatIncl: input.vatIncl !== false,
    createdAt: (old && old.createdAt) || now, updatedAt: now, log,
  };
  const dealAt = old && old.dealAt;
  if (dealAt) lead.dealAt = dealAt;
  else if (DEAL.includes(stage)) lead.dealAt = now;
  await env.CMS.put(LEAD + id, JSON.stringify(lead));
  return { id, ...lead };
}

export async function deleteLead(env, id) {
  await env.CMS.delete(LEAD + id);
}

export async function saveCfg(env, input) {
  const vat = Number(input && input.vat);
  if (!Number.isFinite(vat) || vat < 0 || vat > 100) throw new HttpError(400, 'אחוז מע״מ לא תקין');
  const cfg = { vat, supplierInCost: !!(input && input.supplierInCost) };
  await env.CMS.put(CFG, JSON.stringify(cfg));
  return cfg;
}
