/* Lead tracking page: login, add / advance / edit / delete a lead against the real Worker code (in-memory KV). Run: node tests/crm.mjs */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import worker from '../worker/src/index.js';

let aiInput = { docType: 'chat', matchId: '', summary: 'שיחה עם רונית: מעוניינת במיטה', name: 'רונית לוי', phone: '0541112222', product: 'מיטה זוגית', source: 'וואטסאפ', stage: 'hot' };
function env0() {
  const real = globalThis.fetch;
  globalThis.fetch = async (u, i) => (String(u).startsWith('https://tg.test') ? new Response(JSON.stringify({ ok: true, result: String(u).endsWith('getMe') ? { username: 'femme_leads_bot' } : true })) : String(u).startsWith('https://anthropic.test') ? new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 'x', name: 'propose_lead', input: aiInput }] })) : real(u, i));
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
  ok(await pg.locator('.empty').count() === 1, `${tag}: logged in, empty state`);

  await pg.click('#newBtn'); await pg.fill('#f_name', 'דנה כהן'); await pg.fill('#f_phone', '0501234567'); await pg.fill('#f_product', 'אוהל לוטוס');
  await pg.click('[data-stg="closing"]');
  await pg.fill('#f_price', '11800'); await pg.fill('#f_cost', '5000'); await pg.fill('#f_supplier', '2000');
  ok((await pg.innerText('#calc')).includes('3,000'), `${tag}: editor shows profit 3,000`);
  await pg.fill('#f_commission', '1800');
  ok(/1,800/.test(await pg.innerText('#calc .pf')), `${tag}: a commission is the profit exactly as written`);
  await pg.fill('#f_commission', '');
  ok((await pg.innerText('#calc .pf')).includes('3,000'), `${tag}: without it the profit is computed`);
  await pg.click('#sheet button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  ok(/דנה כהן/.test(await pg.innerText('#list')), `${tag}: lead saved and listed`);
  ok(/3,000/.test(await pg.innerText('#kpis')), `${tag}: expected profit KPI 3,000`);

  await pg.click('[data-adv]'); await pg.waitForSelector('#veil');            // closing -> delivered opens editor
  ok(await pg.locator('.stg[aria-pressed="true"]').innerText() === 'קיבל סחורה', `${tag}: advanced to delivered`);
  ok(await pg.locator('#row_closed').isVisible() && await pg.locator('#row_follow').isHidden(), `${tag}: a closed deal asks for a closing date, not a follow-up`);
  await pg.fill('#f_closed', '2026-10-05'); await pg.fill('#f_supply', '2026-10-09'); await pg.fill('#f_receipt', 'A-4411'); await pg.click('#sheet button[type=submit]'); await pg.waitForSelector('#veil', { state: 'detached' });
  ok(/נסגר ב/.test(await pg.innerText('.card')), `${tag}: card shows the closing date`);
  ok(/אספקה ב/.test(await pg.innerText('.card')) && /A-4411/.test(await pg.innerText('.card')), `${tag}: card shows the supply date and receipt number`);
  ok(/1,600|3,000/.test(await pg.innerText('.kpi.big')), `${tag}: net profit after delivery: ${(await pg.innerText('.kpi.big')).replace(/\n/g, ' ')}`);
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
  for (let n = 0; n < 2; n++) { await pg.click('.card'); await pg.click('#delBtn'); await pg.click('#delBtn'); await pg.waitForSelector('#veil', { state: 'detached' }); }
  ok(await pg.locator('.empty').count() === 1, `${tag}: delete works`);
  ok(errs.length === 0, `${tag}: no page errors ${errs.join(';')}`);
  await pg.close();
}
await br.close(); srv.close();
console.log(fails ? `RESULT: ${fails} failed` : 'RESULT: all passed');
process.exit(fails ? 1 : 0);
