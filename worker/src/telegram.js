/* Telegram bot for Alternative's lead tracker. She sends a message or a screenshot, Claude reads it (crm.js), the bot replies with what it understood
 * and two buttons; only "save" writes the lead. The bot token and the webhook secret live in KV (set from the lead page by the owner);
 * only chats paired with a one-time code from that page may talk to it. */
import { HttpError } from './validate.js';
import { crmState, saveLead, extractFromImages, applyProposal, migrateLegacy, extrasProfit, leadProfit, listExpenses, listShipments } from './crm.js';
import { secretEquals } from './auth.js';

const KEY = 'alt:tg';
const api = (env) => env.TELEGRAM_API || 'https://api.telegram.org';
const getKV = async (env, k) => { const v = await env.CMS.get(k); return v ? JSON.parse(v) : null; };
const rand = (n, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789') => { const r = crypto.getRandomValues(new Uint8Array(n)); return [...r].map((x) => alphabet[x % alphabet.length]).join(''); };
const LABEL = { name: 'שם', phone: 'טלפון', product: 'מוצר', source: 'מקור', follow: 'לחזור ב', notes: 'הערות', suppName: 'ספק', qty: 'כמות', commission: 'העמלה (רווח)', receiptNo: 'מספר קבלה', deliveryDate: 'תאריך אספקה', price: 'מחיר', cost: 'עלות מוצר', supplier: 'הספק קיבל', stage: 'שלב', vatIncl: 'המחיר כולל מע״מ' };
const STAGE = { talked: 'דיברנו', hot: 'ליד חם', season: 'לעונה הבאה', catalog: 'קיבל קטלוג', visit: 'מבקשים ביקור', viewing: 'הלך לראות', closing: 'סוגר', delivered: 'קיבל סחורה', done: 'נסגר', lost: 'לא רלוונטי' };
const money = (v) => '₪' + Math.round(v).toLocaleString('en-US');

async function tg(env, token, method, body) {
  const r = await fetch(`${api(env)}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) throw new HttpError(400, (j && j.description) || 'טלגרם לא ענה');
  return j.result;
}

/* ----- owner side (called from the lead page) ----- */
export async function tgStatus(env) {
  const c = await getKV(env, KEY);
  return c ? { connected: true, username: c.username, devices: c.chats.length } : { connected: false };
}

export async function tgConnect(env, origin, input) {
  let c = await getKV(env, KEY);
  const token = String((input && input.token) || '').trim();
  if (token) {
    if (!/^\d{5,12}:[A-Za-z0-9_-]{30,60}$/.test(token)) throw new HttpError(400, 'הטוקן לא נראה תקין. העתיקי אותו כמו שהוא מ-BotFather.');
    const me = await tg(env, token, 'getMe').catch(() => { throw new HttpError(400, 'טלגרם לא מכיר את הטוקן הזה'); });
    const secret = rand(40, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
    await tg(env, token, 'setWebhook', { url: `${origin}/api/alt/tg-hook`, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    c = { token, secret, username: me.username, chats: (c && c.username === me.username ? c.chats : []), codes: [] };
  }
  if (!c) throw new HttpError(400, 'הדביקי את הטוקן של הבוט');
  const code = rand(8);
  c.codes = (c.codes || []).filter((x) => x.e > Date.now()).concat([{ c: code, e: Date.now() + 10 * 60_000 }]);
  await env.CMS.put(KEY, JSON.stringify(c));
  return { username: c.username, link: `https://t.me/${c.username}?start=${code}`, devices: c.chats.length };
}

export async function tgDisconnect(env) {
  const c = await getKV(env, KEY);
  if (c) { await tg(env, c.token, 'deleteWebhook', {}).catch(() => {}); await env.CMS.delete(KEY); }
}

/* ----- Telegram side ----- */
export async function tgWebhook(env, req) {
  await migrateLegacy(env);
  const c = await getKV(env, KEY);
  const got = req.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!c || !got || !(await secretEquals(got, c.secret))) throw new HttpError(401, 'לא מורשה');
  let u; try { u = await req.json(); } catch { throw new HttpError(400, 'בקשה לא תקינה'); }
  try { await handle(env, c, u); } catch (e) { console.error('telegram', e && e.message); }
  return new Response('ok');                                   // always 200 so Telegram does not retry a bad message forever
}

async function reply(env, c, chat, text, extra = {}) { return tg(env, c.token, 'sendMessage', { chat_id: chat, text: String(text).slice(0, 3800), ...extra }); }

async function handle(env, c, u) {
  const cq = u.callback_query;
  const m = u.message;
  const chat = cq ? cq.message && cq.message.chat : m && m.chat;
  if (!chat || chat.type !== 'private') return;
  const id = chat.id;

  if (m && typeof m.text === 'string' && /^\/start(\s|$)/.test(m.text)) {
    const code = m.text.split(/\s+/)[1] || '';
    const hit = (c.codes || []).find((x) => x.c === code && x.e > Date.now());
    if (!hit) return reply(env, c, id, c.chats.includes(id) ? 'את כבר מחוברת. שלחי לי הודעה או צילום מסך של שיחה או קבלה.' : 'הקישור פג תוקף. צרי קישור חדש בהגדרות של אלטרנייטיב.');
    c.codes = c.codes.filter((x) => x !== hit);
    if (!c.chats.includes(id)) c.chats.push(id);
    await env.CMS.put(KEY, JSON.stringify(c));
    return reply(env, c, id, 'חוברת ✅\nשלחי לי הודעה (למשל: "דנה כהן 0501234567 ספה, הלכה לראות") או צילום מסך של שיחה או קבלה. אני אציג מה הבנתי ותאשרי לפני שאני שומר.\n/summary לסיכום, /help להסבר.');
  }
  if (!c.chats.includes(id)) return;                           // strangers get no answer and nothing is read

  if (cq) return callback(env, c, id, cq);
  if (!m) return;
  const t = (m.text || m.caption || '').trim();
  if (/^\/help/.test(t)) return reply(env, c, id, 'שלחי הודעה או צילום מסך של שיחה או קבלה, ואני אציע ליד חדש או עדכון לליד קיים. כפתור "שמרי" שומר, "בטלי" מוחק.\nדוגמאות:\n• דנה כהן 0501234567 רוצה ספה, הלכה לראות\n• דנה כהן שילמה 11800 כולל מע״מ\n/summary - סיכום');
  if (/^\/summary/.test(t) || t === 'סיכום') return summary(env, c, id);

  const images = [];
  const ph = m.photo && m.photo.length ? m.photo[m.photo.length - 1] : (m.document && /^image\/(jpeg|png|webp)$/.test(m.document.mime_type || '') ? m.document : null);
  if (ph) {
    if (ph.file_size && ph.file_size > 3_000_000) return reply(env, c, id, 'התמונה גדולה מדי. שלחי צילום מסך רגיל.');
    const f = await tg(env, c.token, 'getFile', { file_id: ph.file_id });
    const r = await fetch(`${api(env)}/file/bot${c.token}/${f.file_path}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!r.ok || buf.length > 3_000_000) return reply(env, c, id, 'לא הצלחתי להוריד את התמונה, נסי שוב.');
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    images.push(btoa(bin));
  }
  if (!images.length && !t) return reply(env, c, id, 'שלחי טקסט או צילום מסך.');
  let p;
  try { p = await extractFromImages(env, { images, text: t }); } catch (e) { return reply(env, c, id, e instanceof HttpError ? e.message : 'לא הצלחתי לקרוא. נסי שוב.'); }
  const f = p.fields || {};
  if (!p.matchId && !f.name && !f.phone) return reply(env, c, id, `${p.summary}\nלא מצאתי שם או טלפון, אז לא הצעתי שמירה. כתבי לי שם או טלפון של הליד.`);

  const { leads } = await crmState(env);
  const old = leads.find((l) => l.id === p.matchId);
  const merged = applyProposal(old || { stage: 'talked', vatIncl: true }, f);
  if (!merged.changed.length) return reply(env, c, id, `${p.summary}\nאין מידע חדש לשמירה על ${old ? old.name || old.phone : 'הליד'}.`);
  const pid = rand(12);
  await env.CMS.put('alt:tgp:' + pid, JSON.stringify({ chat: id, matchId: p.matchId, fields: f }), { expirationTtl: 3600 });
  const lines = merged.changed.map((k) => `• ${LABEL[k] || k}: ${k === 'stage' ? STAGE[merged.lead.stage] : k === 'vatIncl' ? (merged.lead.vatIncl ? 'כן' : 'לא') : ['price', 'cost', 'supplier', 'commission'].includes(k) ? money(merged.lead[k]) : String(merged.lead[k]).replace(/\n/g, ' / ')}`);
  return reply(env, c, id, `${p.summary}\n\n${old ? `עדכון לליד: ${old.name || old.phone}` : 'ליד חדש'}\n${lines.join('\n')}`, {
    reply_markup: { inline_keyboard: [[{ text: '✅ שמרי', callback_data: 'ok:' + pid }, { text: '✖ בטלי', callback_data: 'no:' + pid }]] },
  });
}

async function callback(env, c, id, cq) {
  const [act, pid] = String(cq.data || '').split(':');
  const key = 'alt:tgp:' + pid;
  const pend = /^[a-z0-9]{12}$/.test(pid || '') ? await getKV(env, key) : null;
  const done = (t) => tg(env, c.token, 'answerCallbackQuery', { callback_query_id: cq.id, text: t }).catch(() => {});
  if (!pend || pend.chat !== id) { await done('פג תוקף. שלחי שוב.'); return; }
  await env.CMS.delete(key);                                   // a double tap can never save twice
  const strip = () => tg(env, c.token, 'editMessageReplyMarkup', { chat_id: id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  if (act !== 'ok') { await strip(); await done('בוטל'); return; }
  const { leads } = await crmState(env);
  const old = leads.find((l) => l.id === pend.matchId);
  const merged = applyProposal(old || { stage: 'talked', vatIncl: true }, pend.fields).lead;
  const lead = await saveLead(env, old ? old.id : rand(12), merged);
  await strip(); await done('נשמר');
  const cfg = { vat: 18, supplierInCost: false, ...((await getKV(env, 'alt:cfg')) || {}) };
  const extra = (Number(lead.price) > 0 || lead.commission !== '') ? `\nרווח כרגע: ${money(leadProfit(lead, cfg))}` : '';
  await reply(env, c, id, `נשמר ✅ ${lead.name || lead.phone} · ${STAGE[lead.stage]}${extra}`);
}

async function summary(env, c, id) {
  const { leads, cfg } = await crmState(env);
  const open = leads.filter((l) => l.stage !== 'done' && l.stage !== 'lost');
  const by = {}; open.forEach((l) => { by[l.stage] = (by[l.stage] || 0) + 1; });
  const now = new Date(); const ym = now.toISOString().slice(0, 7);
  let profit = 0, deals = 0;
  for (const l of leads) {
    if (!['delivered', 'done'].includes(l.stage) || !(l.dealAt || '').startsWith(ym)) continue;
    profit += leadProfit(l, cfg); deals++;
  }
  const mkt = (await listExpenses(env)).filter((x) => String(x.date).startsWith(ym)).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const ship = (await listShipments(env)).filter((x) => !x.arrived);
  const today = now.toISOString().slice(0, 10);
  const late = open.filter((l) => l.follow && l.follow < today).map((l) => l.name || l.phone);
  return reply(env, c, id, `לידים פתוחים: ${open.length}\n${Object.keys(STAGE).filter((k) => by[k]).map((k) => `• ${STAGE[k]}: ${by[k]}`).join('\n') || '—'}\n\nהחודש: ${deals} עסקאות, רווח ${money(profit)}${mkt ? `, שיווק ${money(mkt)}, אחרי שיווק ${money(profit - mkt)}` : ''}${ship.length ? `\n\nמשלוחים בדרך: ${ship.length}${ship.filter((x) => x.eta && x.eta < now.toISOString().slice(0, 10)).length ? ` (${ship.filter((x) => x.eta && x.eta < now.toISOString().slice(0, 10)).length} באיחור)` : ''}` : ''}${late.length ? `\n\nלחזור אליהם (עבר התאריך): ${late.slice(0, 8).join(', ')}` : ''}`);
}
