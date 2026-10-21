/* Lead tracking page: login, add / advance / edit / delete a lead against the real Worker code (in-memory KV). Run: node tests/crm.mjs */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import worker from '../worker/src/index.js';

let aiInput = { docType: 'chat', matchId: '', summary: 'שיחה עם רונית: מעוניינת במיטה', name: 'רונית לוי', phone: '0541112222', product: 'מיטה זוגית', source: 'וואטסאפ', stage: 'hot' };
function env0() {
  const real = globalThis.fetch;
  globalThis.fetch = async (u, i) => (String(u).startsWith('https://anthropic.test') && String(i && i.body).includes('"propose_leads"') ? new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 'y', name: 'propose_leads', input: { leads: [{ docType: 'commission_receipt', model: 'לוטוס 5M', commission: 1800, closedDate: '2026-07-12', stage: 'done', name: 'משה בדיקה', phone: '0531111111', summary: 'משה' }, { docType: 'other', stage: 'viewing', name: 'דנה', phone: '050-123-4567', summary: 'דנה' }] } }] })) : String(u).startsWith('https://tg.test') ? new Response(JSON.stringify({ ok: true, result: String(u).endsWith('getMe') ? { username: 'femme_leads_bot' } : true })) : String(u).startsWith('https://anthropic.test') ? new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 'x', name: 'propose_lead', input: aiInput }] })) : real(u, i));
}
const kv = new Map();
env0();
const env = { TELEGRAM_API: 'https://tg.test', ANTHROPIC_API_KEY: 'k', ANTHROPIC_API: 'https://anthropic.test', ADMIN_PASSWORD: 'pw-123456', SESSION_SECRET: 's', ASSETS: { fetch: async () => new Response('x') },
  CMS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) } };
const app = new URL('../app/', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.js': 'text/javascript' };
const srv = http.createServer(async (rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of rq) chunks.push(c);
    const r = await worker.fetch(new Request('https://t.test' + rq.url, { method: rq.method, headers: rq.headers, body: ['GET', 'HEAD'].includes(rq.method) ? undefined : Buffer.concat(chunks) }), env);
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    const sc = r.headers.get('set-cookie'); if (sc) h['set-cookie'] = sc.replace('; Secure', '');
    rs.writeHead(r.status, h);
    return rs.end(Buffer.from(await r.arrayBuffer()));
  }
  const f = path.join(app, u.pathname === '/alternative' ? 'alternative.html' : u.pathname);
  if (!f.startsWith(app) || !fs.existsSync(f)) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); rs.end(fs.readFileSync(f));
}).listen(0);
const base = `http://localhost:${srv.address().port}`;

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [w, tag] of [[1100, 'desktop'], [390, 'mobile']]) {
  kv.clear();
  const pg = await br.newPage({ viewport: { width: w, height: 900 } });
  const money = async () => { if (await pg.locator('#sumBox').isHidden()) await pg.click('#moneyBtn'); };
  const leadsV = async () => { if (await pg.locator('#sumBox').isVisible()) await pg.click('#backBtn'); };
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(base + '/alternative');
  await pg.waitForSelector('#login:not([hidden])');
  await pg.waitForSelector('#l_adminRow:not([hidden])');
  ok(true, `${tag}: first visit asks to set a password`);
  await pg.fill('#l_admin', 'wrong'); await pg.fill('#l_pass', 'alt-pass-1234'); await pg.click('#login button'); await pg.waitForFunction(() => document.querySelector('#l_err').textContent.length > 0);
  ok(true, `${tag}: wrong admin password refused`);
  await pg.fill('#l_admin', 'pw-123456'); await pg.click('#login button'); await pg.waitForSelector('#app:not([hidden])');
  await pg.click('#outBtn'); await pg.waitForSelector('#login:not([hidden])');
  ok((await pg.locator('#l_adminRow').isHidden()), `${tag}: after setup the login asks only for the password`);
  await pg.fill('#l_pass', 'wrong-pass-1'); await pg.click('#login button'); await pg.waitForFunction(() => document.querySelector('#l_err').textContent.length > 0);
  await pg.fill('#l_pass', 'alt-pass-1234'); await pg.click('#login button'); await pg.waitForSelector('#app:not([hidden])');
  ok(await pg.locator('#list .empty').count() === 1, `${tag}: logged in, empty state`);

  await pg.click('#newBtn'); await pg.waitForSelector('#f_price'); await pg.waitForTimeout(150); await pg.fill('#f_price', '₪7,500');
  ok(await pg.inputValue('#f_supplier') === '4449', `${tag}: supplier fills itself at 70% of the pre-VAT price`);
  ok((await pg.innerText('#calc .pf')).includes('1,907'), `${tag}: so the profit is the 30% commission`);
  await pg.fill('#f_qty', '3');
  ok(await pg.inputValue('#f_supplier') === String(Math.round(7500 * 3 / 1.18 * 0.7)), `${tag}: quantity 3 multiplies the price: supplier share for all three`);
  ok((await pg.innerText('#calc')).includes('5,721'), `${tag}: profit for three tents`);
  await pg.fill('#f_qty', '1');
  await pg.fill('#f_supplier', '4000'); await pg.fill('#f_price', '8000');
  ok(await pg.inputValue('#f_supplier') === '4000', `${tag}: a typed supplier amount is not overwritten`);
  await pg.click('#supReset');
  ok(await pg.inputValue('#f_supplier') === String(Math.round(8000 / 1.18 * 0.7)), `${tag}: reset recalculates`);
  await pg.fill('#f_price', ''); await pg.fill('#f_supplier', ''); await pg.click('#cancelBtn'); await pg.click('#newBtn');
  await pg.fill('#f_name', 'דנה כהן'); await pg.fill('#f_phone', '0501234567'); await pg.fill('#f_product', 'אוהל לוטוס');
  await pg.click('[data-stg="closing"]');
  await pg.fill('#f_price', '11800'); await pg.fill('#f_cost', '5000'); await pg.fill('#f_supplier', '2000');
  ok((await pg.innerText('#calc')).includes('3,000'), `${tag}: editor shows profit 3,000`);
  await pg.fill('#f_commission', '1800');
  ok(/1,800/.test(await pg.innerText('#calc .pf')), `${tag}: a commission is the profit exactly as written`);
  await pg.fill('#f_commission', '');
  ok((await pg.innerText('#calc .pf')).includes('3,000'), `${tag}: without it the profit is computed`);
  await pg.click('#sheet button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  ok(/דנה כהן/.test(await pg.innerText('#list')), `${tag}: lead saved and listed`);
  ok(await pg.locator('#sumBox').isHidden(), `${tag}: the money section is not on the leads page`);
  await money();
  ok(/3,000/.test(await pg.innerText('#kpis')), `${tag}: expected profit KPI 3,000`);
  await leadsV();

  await pg.click('[data-adv]'); await pg.waitForSelector('#veil');            // closing -> delivered opens editor
  ok(await pg.locator('.stg[aria-pressed="true"]').innerText() === 'קיבל סחורה', `${tag}: advanced to delivered`);
  ok(await pg.locator('#row_closed').isVisible() && await pg.locator('#row_follow').isHidden(), `${tag}: a closed deal asks for a closing date, not a follow-up`);
  await pg.fill('#f_closed', '2026-10-05'); await pg.fill('#f_supply', '2026-10-09'); await pg.fill('#f_receipt', 'A-4411'); await pg.check('.xo[data-k=insulation] .xk'); await pg.fill('.xo[data-k=insulation] .xa', '1180'); await pg.fill('.xo[data-k=insulation] .xc', '700');
  ok(await pg.inputValue('.xo[data-k=insulation] .xp') === '300', `${tag}: extra profit = amount before VAT - cost`);
  await pg.click('#xAdd'); await pg.fill('#x_other .xl', 'שטיח'); await pg.fill('#x_other .xa', '300'); await pg.fill('#x_other .xp', '100'); await pg.click('#sheet button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  ok(/נסגר ב/.test(await pg.innerText('.card')), `${tag}: card shows the closing date`);
  ok(/תוספות/.test(await pg.innerText('.card')) && /1,480/.test(await pg.innerText('.card')) && /400/.test(await pg.innerText('.card')), `${tag}: card shows extras total 1,480 and their profit 400`);
  ok(/אספקה ב/.test(await pg.innerText('.card')) && /A-4411/.test(await pg.innerText('.card')), `${tag}: card shows the supply date and receipt number`);
  await money();
  ok(/3,400/.test(await pg.innerText(".kpi.big")), `${tag}: net profit after delivery: ${(await pg.innerText('.kpi.big')).replace(/\n/g, ' ')}`);
  await leadsV();
  // telegram connect box
  await pg.click('#settingsBtn'); await pg.waitForSelector('#tg_token');
  await pg.fill('#tg_token', '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'); await pg.click('#tgConnect'); await pg.waitForSelector('#tgBox a');
  ok((await pg.innerText('#tgBox')).includes('femme_leads_bot') && /t\.me\/femme_leads_bot\?start=/.test(await pg.locator('#tgBox a').getAttribute('href')), `${tag}: telegram connected, pairing link shown`);
  await pg.click('#cancelBtn');
  // screenshot -> proposal -> confirm
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await pg.setInputFiles('#shotIn', { name: 's.png', mimeType: 'image/png', buffer: png });
  await pg.waitForSelector('.hint');
  ok(await pg.inputValue('#f_name') === 'רונית לוי' && await pg.inputValue('#f_phone') === '0541112222', `${tag}: screenshot proposal prefilled a new lead`);
  ok(await pg.locator('.stg[aria-pressed="true"]').innerText() === 'ליד חם', `${tag}: proposal stage applied`);
  ok((await pg.locator('.card').count()) === 1, `${tag}: nothing saved before confirming`);
  await pg.click('#sheet button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  ok((await pg.locator('.card').count()) === 2, `${tag}: saved after confirming`);
  await pg.reload(); await pg.waitForSelector('#app:not([hidden])');
  ok(/דנה כהן/.test(await pg.innerText('#list')), `${tag}: survives reload (stored on the server)`);
  ok(await pg.evaluate(() => document.documentElement.scrollWidth) <= w, `${tag}: no horizontal scroll`);
  await pg.screenshot({ path: `/tmp/crm-${tag}.png`, fullPage: true });
  // potential profit of open leads (bottom of the open tab)
  await pg.click('#newBtn'); await pg.waitForSelector('#f_name'); await pg.waitForTimeout(150);
  await pg.fill('#f_name', 'פוטנציאל'); await pg.fill('#f_product', 'לוטוס 5M'); await pg.fill('#f_notes', 'הערה לדוגמה: מחכה לתשובה'); await pg.click('[data-stg="hot"]'); await pg.click('#sheet button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  await pg.click('[data-f="open"]');
  ok((await pg.locator('#potBox').isVisible()) && /1,907/.test(await pg.innerText('#potBox')), `${tag}: potential profit from the catalog (7,500 -> 1,907) shown at the bottom of the open tab`);
  await pg.click('[data-f="all"]');
  ok(await pg.locator('#potBox').isHidden(), `${tag}: hidden outside the open tab`);
  ok(/הערה לדוגמה/.test(await pg.innerText('#list .card:has-text("פוטנציאל")')), `${tag}: the card's notes are visible in the list`);
  await pg.click('#list .card:has-text("פוטנציאל") [data-adv]');
  await pg.waitForFunction(() => /📖 פוטנציאל/.test(document.querySelector('#list').innerText));
  ok(/קיבל קטלוג/.test(await pg.innerText('#list .card:has-text("פוטנציאל")')), `${tag}: one tap marks 'received the catalog' with 📖 on the card`);
  // no duplicate buttons: a hot lead's → button already says 'received the catalog'
  await pg.click('[data-f="hot"]');
  ok(await pg.locator('#list .card:has-text("רונית") [data-adv]').innerText().then((t) => /קיבל קטלוג/.test(t)) && await pg.locator('#list .card:has-text("רונית") [data-cat]').count() === 0, `${tag}: no second 'received the catalog' button`);
  await pg.click('[data-f="all"]');
  // the logo at the top
  ok(await pg.evaluate(() => { const i = document.querySelector('#app .brand img'); return !!i && i.complete && i.naturalWidth > 100; }), `${tag}: the Alternative logo is shown`);
  // order of the open tab: hot first, the delivered deal last
  await pg.click('[data-f="open"]');
  const order = await pg.locator('#list .card h3').allInnerTexts();
  ok(order.length >= 3 && /דנה/.test(order[order.length - 1]) && !/דנה/.test(order[0]), `${tag}: open tab order: ${order.join(' | ')}`);
  await pg.click('[data-f="all"]');
  // duplicates: the same phone (any format) is refused, with where the lead is
  await pg.click('#newBtn'); await pg.waitForSelector('#f_name'); await pg.waitForTimeout(150);
  await pg.fill('#f_name', 'מישהו חדש'); await pg.fill('#f_phone', '050-123-4567');
  await pg.waitForSelector('#dupHint:not([hidden])');
  const dh = await pg.innerText('#dupHint');
  ok(/כבר קיים במערכת/.test(dh) && /דנה כהן/.test(dh) && /קיבל סחורה/.test(dh), `${tag}: the hint says the lead exists and where (${dh.replace(/\n/g, ' ')})`);
  await pg.click('#sheet button[type=submit]');
  ok((await pg.locator('#veil').count()) === 1 && (await pg.locator('#list .card').count()) === 3, `${tag}: saving the duplicate is blocked`);
  await pg.click('[data-opendup]'); await pg.waitForFunction(() => document.querySelector('#f_name') && document.querySelector('#f_name').value === 'דנה כהן');
  ok(await pg.locator('#dupHint').isHidden(), `${tag}: the existing lead opens from the hint`);
  await pg.click('#cancelBtn');
  await pg.click('#newBtn'); await pg.waitForSelector('#f_name'); await pg.waitForTimeout(150);
  await pg.fill('#f_name', ' דנה  כהן '); await pg.waitForSelector('#dupHint:not([hidden])');
  ok(/אותו שם/.test(await pg.innerText('#dupHint')), `${tag}: the same name is caught too`);
  await pg.click('#cancelBtn');
  // a one-tap "hot" button for a lead that is not hot (here: it received the catalog)
  await pg.click('#list .card:has-text("פוטנציאל") [data-hot]');
  await pg.waitForFunction(() => /🔥 פוטנציאל/.test(document.querySelector('#list').innerText));
  ok(/ליד חם/.test(await pg.innerText('#list .card:has-text("פוטנציאל")')) && await pg.locator('#list .card:has-text("פוטנציאל") [data-hot]').count() === 0, `${tag}: one tap marks it hot with 🔥`);
  // next season: one button, a date to call him (chips or any date), 🗓️ on the card
  await pg.click('#list .card:has-text("פוטנציאל") [data-season]'); await pg.waitForSelector('#folForm');
  await pg.click('[data-fchip]:has-text("עוד 3 חודשים")'); await pg.click('#folForm button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  await pg.waitForFunction(() => /🗓️ פוטנציאל/.test(document.querySelector('#list').innerText));
  ok(/לעונה הבאה/.test(await pg.innerText('#list .card:has-text("פוטנציאל")')) && /לחזור ב/.test(await pg.innerText('#list .card:has-text("פוטנציאל")')), `${tag}: next season with a call date shown on the card`);
  await pg.click('#list .card:has-text("פוטנציאל") [data-follow]'); await pg.waitForSelector('#folForm'); await pg.fill('#f_fdate', '2027-03-01'); await pg.click('#folForm button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  await pg.waitForFunction(() => /לחזור ב1\.3\.27/.test(document.querySelector('#list').innerText));
  ok(true, `${tag}: the call date can be changed with 📅`);
  await pg.click('#list .card:has-text("פוטנציאל") [data-irr]');
  await pg.waitForSelector('#list .card.lostc');
  ok(/לא רלוונטי/.test(await pg.innerText('#list .card:has-text("פוטנציאל")')) && (await pg.locator('#list .card:has-text("פוטנציאל")').innerText()).includes('🚫 פוטנציאל') && await pg.locator('#list .card:has-text("פוטנציאל") [data-undo]').count() === 1, `${tag}: one tap marks it not relevant with 🚫 on the card`);
  await pg.click('[data-f="open"]');
  ok((await pg.locator('#list .card:has-text("פוטנציאל")').count()) === 0, `${tag}: it leaves the open tab`);
  await pg.click('[data-f="all"]'); await pg.click('#list .card:has-text("פוטנציאל") [data-undo]');
  await pg.waitForFunction(() => !document.querySelector('#list .card.lostc'));
  ok(/לעונה הבאה/.test(await pg.innerText('#list .card:has-text("פוטנציאל")')), `${tag}: ↩ brings it back to the stage it came from`);
  await pg.click('#list .card:has-text("פוטנציאל")'); await pg.click('#delBtn'); await pg.click('#delBtn'); await pg.waitForSelector('#veil', { state: 'detached' });
  // moving a lead to a stage outside the open tab must not make it vanish
  await pg.click('[data-f="hot"]'); await pg.click('.card h3'); await pg.click('[data-stg="lost"]'); await pg.click('#sheet button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  ok(/רונית/.test(await pg.innerText('#list')) && await pg.locator('.tab[aria-pressed="true"]').innerText().then((t) => /לא רלוונטי/.test(t)), `${tag}: the lead moved to lost stays visible (tab switched)`);
  await pg.click('[data-f="all"]');
  // bulk import from a CSV: review the proposed rows, then save them all
  await pg.click('[data-f="all"]');
  await pg.setInputFiles('#impIn', { name: 'מכירות גלאמפינג 2026 יולי.csv', mimeType: 'text/csv', buffer: Buffer.from('שם,טלפון\nמשה,0531111111\nדנה,0501234567\n', 'utf8') });
  await pg.waitForSelector('#impSheet');
  ok((await pg.locator('#impSheet .card.imp').count()) === 2, `${tag}: import preview lists both rows`);
  ok(/זיהיתי יולי 2026/.test(await pg.innerText('#impSheet')) && /נסגר 31\.7\.26/.test(await pg.innerText('#impSheet')), `${tag}: the month is read from the file name and set as the closing date`);
  ok(/עדכון ליד קיים/.test(await pg.innerText('#impSheet')) && /ליד חדש/.test(await pg.innerText('#impSheet')), `${tag}: same phone is an update, the other a new lead`);
  ok((await pg.locator('#list .card').count()) === 2, `${tag}: nothing saved before confirming the import`);
  await pg.fill('#impDate', '2026-07-31'); await pg.click('#impApplyDate');
  ok(/נסגר 31\.7\.26/.test(await pg.innerText('#impSheet')), `${tag}: one closing date can be applied to all imported rows`);
  await pg.click('#impGo'); await pg.waitForSelector('#veil', { state: 'detached' });
  ok((await pg.locator('.card').count()) === 3 && /משה בדיקה/.test(await pg.innerText('#list')) && /נסגר ב/.test(await pg.innerText('#list')), `${tag}: imported lead added with its closing date`);
  // profits by a month of her choice
  await money();
  const opts = await pg.locator('#period option').allInnerTexts();
  ok(opts.some((t) => /יולי 2026 \(1\)/.test(t)) && opts.some((t) => /אוקטובר 2026 \(1\)/.test(t)), `${tag}: months with deals are listed (${opts.join(' | ')})`);
  await pg.selectOption('#period', 'm:2026-07');
  ok(/1,800/.test(await pg.innerText('.kpi.big')) && /משה/.test(await pg.textContent('#dealList')), `${tag}: July shows only July's profit and its deals`);
  // marketing expenses lower the month's profit
  await pg.selectOption('#period', 'm:2026-07');
  await pg.click('#expAdd'); await pg.waitForSelector('#e_amount'); await pg.waitForTimeout(150);
  ok(await pg.inputValue('#e_date') === '2026-07-31', `${tag}: a new expense is dated in the month being viewed`);
  await pg.fill('#e_amount', '₪1,000'); await pg.fill('#e_label', 'פייסבוק'); await pg.click('#expForm button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  ok(/אחרי שיווק/.test(await pg.innerText('#kpis')) && /1,000/.test(await pg.innerText('#kpis')) && /800/.test(await pg.innerText('.kpi.big')), `${tag}: July profit 1,800 - marketing 1,000 = 800 (${(await pg.innerText('.kpi.big')).replace(/\n/g, ' ')})`);
  ok(/פייסבוק/.test(await pg.textContent('#expList')), `${tag}: the expense is listed`);
  await pg.click('#expList summary'); await pg.click('#expList [data-exp]'); await pg.waitForSelector('#expDel'); await pg.waitForTimeout(150);
  await pg.fill('#e_date', '2026-08-02'); await pg.click('#expForm button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  ok(!/אחרי שיווק/.test(await pg.innerText('#kpis')) && /1,800/.test(await pg.innerText('.kpi.big')), `${tag}: moving it to August removes it from July`);
  await pg.selectOption('#period', 'all');
  // the manager: see everything, select, move to another date, delete
  await pg.selectOption('#period', 'all');
  await pg.click('#expMgr'); await pg.waitForSelector('#xmSheet'); await pg.waitForTimeout(150);
  ok((await pg.locator('#xmSheet [data-xm]').count()) === 1 && /אוגוסט 2026/.test(await pg.innerText('#xmSheet')), `${tag}: the manager lists the August expense`);
  await pg.click('#xmAll'); await pg.fill('#xm_date', '2026-07-12'); await pg.click('#xmApply');
  await pg.waitForFunction(() => /יולי 2026/.test(document.querySelector('#xmSheet').innerText));
  ok(/יולי 2026/.test(await pg.innerText('#xmSheet')) && !/אוגוסט 2026/.test(await pg.innerText('#xmSheet')), `${tag}: moved to July in one go`);
  await pg.click('#cancelBtn');
  await pg.selectOption('#period', 'm:2026-07');
  ok(/אחרי שיווק/.test(await pg.innerText('#kpis')), `${tag}: July profit is after marketing again`);
  await pg.click('#expMgr'); await pg.waitForSelector('#xmSheet'); await pg.click('#xmAll'); await pg.click('#xmDel'); await pg.click('#xmDel');
  await pg.waitForFunction(() => /עוד אין הוצאות/.test(document.querySelector('#xmSheet').innerText));
  await pg.click('#cancelBtn');
  ok(await pg.locator('#expList').isHidden(), `${tag}: deleted from the manager`);
  await pg.selectOption('#period', 'm:2026-07');
  await leadsV();
  // the closed tabs follow the chosen month
  await pg.click('[data-f="delivered"]');
  ok((await pg.locator('#list .card').count()) === 0 && /יולי 2026/.test(await pg.locator('#period2 option:checked').innerText()), `${tag}: with July chosen the delivered tab shows no October deal`);
  await pg.selectOption('#period2', 'm:2026-10');
  ok((await pg.locator('#list .card').count()) === 1 && /דנה/.test(await pg.innerText('#list')), `${tag}: with October chosen it shows that deal`);
  await pg.selectOption('#period2', 'm:2026-07'); await pg.click('[data-f="all"]');
  // bulk change of closing date (select mode)
  await pg.click('#selBtn'); await pg.click('#list .card:has-text("דנה")'); await pg.fill('#selDate', '2026-07-20'); await pg.click('#selApply');
  await pg.waitForFunction(() => /20\.7\.26/.test(document.querySelector('#list').innerText));
  await pg.click('#selOff');
  await money();
  ok((await pg.locator('#period option:checked').innerText()).includes('יולי 2026 (2)'), `${tag}: after moving a deal to July the month has 2 deals`);
  await pg.selectOption('#period', 'all');
  await leadsV();
  // shipments on the way
  await pg.click('#shipBtn'); await pg.waitForSelector('#shAdd');
  ok(await pg.locator('#tabs').isHidden() && await pg.locator('#list').isHidden() && await pg.locator('#sumBox').isHidden(), `${tag}: the shipments view replaces the leads page`);
  await pg.click('#shAdd'); await pg.waitForSelector('#s_title'); await pg.waitForTimeout(150);
  await pg.fill('#s_title', 'ספה לדנה'); await pg.fill('#s_supplier', 'ספק א'); await pg.fill('#s_shipped', '2026-10-01'); await pg.click('[data-shdays]:has-text("חודש")');
  ok(await pg.inputValue('#s_eta') === '2026-10-31', `${tag}: the arrival chip counts from the shipping date`);
  await pg.click('#shForm button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  const sb = await pg.innerText('#shipBox');
  ok(/ספה לדנה/.test(sb) && /ספק א/.test(sb) && /יצא ב-1\.10\.26/.test(sb) && /אמור להגיע ב-31\.10\.26/.test(sb), `${tag}: shipment shows what, supplier, when it left, when it should arrive`);
  await pg.click('[data-sharr]'); await pg.waitForFunction(() => /הגיעו \(1\)/.test(document.querySelector('#shipBox').innerText));
  ok(/אין משלוחים בדרך/.test(await pg.innerText('#shipBox')), `${tag}: marked arrived, moves to the arrived list`);
  await pg.evaluate(() => { document.getElementById('shDone').open = true; });
  await pg.click('#shDone [data-shedit]'); await pg.waitForSelector('#shDel'); await pg.waitForTimeout(150); await pg.click('#shDel'); await pg.click('#shDel'); await pg.waitForSelector('#veil', { state: 'detached' });
  ok(!/הגיעו/.test(await pg.innerText('#shipBox')), `${tag}: deleted`);
  await pg.click('#backBtn');
  // a stale list from the server (eventually consistent storage) must not undo an update that was just saved
  await pg.click('.card h3'); await pg.fill('#f_product', 'מוצר מעודכן'); await pg.click('#sheet button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  await pg.route('**/api/alt/leads', async (route) => {
    const j = await (await route.fetch()).json();
    j.leads = j.leads.map((l) => ({ ...l, product: 'ישן-STALE', updatedAt: '2020-01-01T00:00:00.000Z' }));
    await route.fulfill({ json: j });
  });
  await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForTimeout(500);
  ok(/מוצר מעודכן/.test(await pg.innerText('#list')), `${tag}: a stale server list does not undo a fresh save`);
  await pg.unroute('**/api/alt/leads');
  for (let n = 0; n < 3; n++) { await pg.click('.card h3'); await pg.click('#delBtn'); await pg.click('#delBtn'); await pg.waitForSelector('#veil', { state: 'detached' }); }
  ok(await pg.locator('#list .empty').count() === 1, `${tag}: delete works`);
  ok(errs.length === 0, `${tag}: no page errors ${errs.join(';')}`);
  await pg.close();
}
await br.close(); srv.close();
console.log(fails ? `RESULT: ${fails} failed` : 'RESULT: all passed');
process.exit(fails ? 1 : 0);
