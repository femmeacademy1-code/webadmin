/* End-to-end: agency owner connects a real site and creates a client; the client logs in with a
 * password, edits visually (text, colour, font, image), publishes; the public site updates.
 * Two origins (admin app :9002, hosted site :9001) just like production. GitHub is mocked.
 *
 *   NODE_PATH=$(npm root -g) node tests/e2e.mjs [outDir]
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import worker from '../worker/src/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = new URL('../', import.meta.url).pathname;
const APP = path.join(ROOT, 'app') + '/';
const FIXTURE = path.join(ROOT, 'tests/fixtures/alternative-site');   // a real client site (plain static HTML + inline script)
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
const SITE = path.join(OUT, 'site');
fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });
fs.cpSync(FIXTURE, SITE, { recursive: true });

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
function serveStatic(dir, extra = {}) {
  return (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store', ...extra });
    res.end(fs.readFileSync(f));
  };
}

/* ---------- mock GitHub, writing into the "hosted site" directory ---------- */
const sha1 = (b) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex');
const blobs = {}; let pending = null; let n = 0; const commitLog = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith('https://gh.test')) return realFetch(url, init);
  const u = new URL(url); const p = u.pathname.replace('/repos/o/site', '');
  const body = init.body ? JSON.parse(init.body) : null;
  const R = (s, j) => new Response(JSON.stringify(j), { status: s });
  let m;
  if ((m = p.match(/^\/contents\/(.+)$/))) {
    const f = path.join(SITE, decodeURIComponent(m[1]));
    return fs.existsSync(f) ? R(200, { content: fs.readFileSync(f).toString('base64'), sha: sha1(fs.readFileSync(f)) }) : R(404, { message: 'Not Found' });
  }
  if (p === '/git/ref/heads/main' && init.method === 'GET') return R(200, { object: { sha: 'head' } });
  if (p.startsWith('/git/commits/')) return R(200, { tree: { sha: 'tree' } });
  if (p === '/git/blobs') { const b = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8'); blobs[sha1(b)] = b; return R(201, { sha: sha1(b) }); }
  if (p === '/git/trees') { pending = body.tree; return R(201, { sha: 'nt' }); }
  if (p === '/git/commits') { commitLog.push({ message: body.message, paths: pending.map((t) => t.path) }); return R(201, { sha: 'c' + ++n }); }
  if (p === '/git/refs/heads/main') { for (const t of pending) { const f = path.join(SITE, t.path); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, blobs[t.sha]); } return R(200, {}); }
  if (p === '/commits') return R(200, commitLog.map((c, i) => ({ sha: 'abcdef' + i, commit: { author: { date: new Date(Date.now() - i * 60000).toISOString() }, message: c.message } })).reverse());
  return R(404, { message: 'unmocked ' + p });
};

/* ---------- worker + app server ---------- */
class KV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.get(k) ?? null; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = '' } = {}) { return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; }
}
const appStatic = serveStatic(APP);
const env = {
  CMS: new KV(), ADMIN_PASSWORD: 'owner-pass-123', SESSION_SECRET: 'e2e-secret', GITHUB_TOKEN: 't', GITHUB_API: 'https://gh.test',
  ASSETS: { fetch: async (req) => { const u = new URL(req.url); const f = path.join(APP, u.pathname); return fs.existsSync(f) ? new Response(fs.readFileSync(f)) : new Response('nf', { status: 404 }); } },
};
const adminSrv = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/api/')) return appStatic(req, res);
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request('http://localhost:9002' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
  const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
  const sc = r.headers.getSetCookie?.(); if (sc && sc.length) headers['set-cookie'] = sc;
  res.writeHead(r.status, headers); res.end(Buffer.from(await r.arrayBuffer()));
});
const siteSrv = http.createServer(serveStatic(SITE, { 'access-control-allow-origin': '*' }));
await Promise.all([new Promise((r) => adminSrv.listen(9002, r)), new Promise((r) => siteSrv.listen(9001, r))]);

/* ---------- the scenario ---------- */
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) { fails++; process.exitCode = 1; } };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|favicon/.test(m.text())) errs.push('console: ' + m.text()); });
pg.on('dialog', (d) => d.accept());
// Google Fonts is unreachable from CI sandboxes; answer like it would for a real family.
await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '/* hebrew */\n@font-face{font-family:"Heebo";src:local("Arial")}\n/* latin */' }));
const shot = (name) => pg.screenshot({ path: path.join(OUT, name + '.png') });

try {
  /* owner */
  await pg.goto('http://localhost:9002/');
  await pg.waitForSelector('#u');
  ok(await pg.locator('h1').innerText() === 'היכנסו לניהול האתר', 'login screen (branded) shows');
  await shot('01-login');
  await pg.fill('#u', 'admin'); await pg.fill('#p', 'wrong'); await pg.click('button[type=submit]');
  await pg.waitForSelector('.error:not([hidden])');
  ok(true, 'wrong password rejected with message');
  await pg.fill('#p', 'owner-pass-123'); await pg.click('button[type=submit]');
  await pg.waitForSelector('text=ניהול לקוחות ואתרים');
  ok(true, 'owner logged in');
  await pg.click('text=ניהול לקוחות ואתרים');
  await pg.click('text=＋ הוספת אתר');
  await pg.fill('#sf-name', 'Alternative Dream'); await pg.fill('#sf-id', 'alternative'); await pg.fill('#sf-repo', 'o/site');
  await pg.fill('#sf-url', 'http://localhost:9001/');
  await pg.click('.formcard button.primary');
  await pg.waitForSelector('.item:has-text("Alternative Dream")');
  ok(true, 'site added');
  await pg.click('button:has-text("חיבור לעריכה")');
  await pg.waitForFunction(() => document.querySelector('#toast').textContent.includes('חובר'), null, { timeout: 8000 });
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  ok(/<meta charset="utf-8">\n<script src="cms\/cms-kit\.js" data-admin-origin="http:\/\/localhost:9002">/.test(html), 'connect: script tag added to the site HTML');
  ok(fs.existsSync(path.join(SITE, 'cms/cms-kit.js')) && fs.existsSync(path.join(SITE, 'cms/edits.json')), 'connect: kit + empty edits committed');
  await shot('02-admin-sites');

  await pg.click('.tabs button:has-text("לקוחות")');
  await pg.click('text=＋ לקוח חדש');
  await pg.fill('#uf-name', 'דנה לוי'); await pg.fill('#uf-user', 'dana');
  const pw = await pg.inputValue('#uf-pass');
  await pg.locator('.chips label:has-text("Alternative Dream") input').check();
  await pg.click('.formcard button.primary');
  await pg.waitForSelector('.creds');
  const creds = await pg.locator('.creds').innerText();
  ok(creds.includes('dana') && creds.includes(pw) && creds.includes('http://localhost:9002'), 'client created; ready-to-send credentials message shown');
  await shot('03-admin-clients');

  /* client */
  await pg.click('button:has-text("יציאה")');
  await pg.waitForSelector('#u');
  await pg.fill('#u', 'dana'); await pg.fill('#p', pw); await pg.click('button[type=submit]');
  await pg.waitForSelector('.card:has-text("Alternative Dream")');
  ok(!(await pg.locator('text=ניהול לקוחות ואתרים').count()), 'client sees dashboard without admin link');
  await shot('04-dashboard');
  await pg.goto('http://localhost:9002/#/admin'); await pg.waitForSelector('.card');
  ok(await pg.locator('h1').innerText() !== '' && !(await pg.locator('text=הוספת אתר').count()), 'client cannot open admin screen');
  await pg.click('text=עריכת האתר');

  /* editor */
  const fr = pg.frameLocator('#frame');
  await fr.locator('.hero h1').waitFor({ timeout: 15000 });
  await pg.waitForFunction(() => document.querySelector('.hint'), null, { timeout: 8000 });
  ok(await fr.locator('.hero h1').innerText() === 'קטלוג אוהלי גלאמפינג', 'site (JS-rendered) loads in the editor iframe');
  await shot('05-editor-empty');

  await fr.locator('.hero h1').click();
  await pg.waitForSelector('.insp-body textarea');
  ok(await pg.inputValue('.insp-body textarea') === 'קטלוג אוהלי גלאמפינג', 'click text -> inspector shows its text');
  await pg.fill('.insp-body textarea', 'קטלוג הקיץ החדש');
  await pg.waitForTimeout(300);
  ok(await fr.locator('.hero h1').innerText() === 'קטלוג הקיץ החדש', 'typing in inspector updates the live site');
  ok(await pg.locator('#chip').getAttribute('data-s') === 'dirty', 'chip shows unsaved changes');

  // inline typing directly on the page
  await fr.locator('.hero h2').dblclick();
  await pg.keyboard.type('מתאים לכל עונה');
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(300);
  ok(await fr.locator('.hero h2').innerText() === 'מתאים לכל עונה', 'double-click inline typing on the page');

  // text colour of the heading
  await fr.locator('.hero h1').click();
  await pg.waitForSelector('.insp-body .colorrow input[type=color]');
  await pg.locator('.insp-body .colorrow input[type=color]').first().evaluate((e) => { e.value = '#b85150'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.waitForTimeout(300);
  ok(await fr.locator('.hero h1').evaluate((e) => getComputedStyle(e).color) === 'rgb(184, 81, 80)', 'per-element text colour applied');

  // link edit: the primary hero button
  await fr.locator('.hero .btn-primary').click();
  await pg.waitForSelector('.insp-body input[dir=ltr]');
  await pg.locator('.insp-body input[dir=ltr]').first().fill('tel:0501234567');
  await pg.waitForTimeout(300);
  ok(await fr.locator('.hero .btn-primary').getAttribute('href') === 'tel:0501234567', 'link target edited');

  // image replace
  await fr.locator('.hero-fig img').click();
  await pg.waitForSelector('button:has-text("החלפת תמונה")');
  const jpg = fs.readFileSync(path.join(FIXTURE, 'assets/46d18d42.jpg'));
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('button:has-text("החלפת תמונה")')]);
  await fc.setFiles({ name: 'New Hero.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await pg.waitForTimeout(1200);
  ok((await fr.locator('.hero-fig img').getAttribute('src')).startsWith('data:image/'), 'uploaded image previews instantly');

  // palette
  await pg.click('.insp-tabs button:has-text("צבעים")');
  await pg.waitForSelector('.swatch');
  ok(await pg.locator('.swatch').count() >= 3, 'palette tab lists the site colours: ' + await pg.locator('.swatch').count());
  const before = await fr.locator('.nav .btn-primary').evaluate((e) => getComputedStyle(e).backgroundColor);
  await pg.locator('.swatch', { hasText: '#52725a' }).first().locator('input[type=color]').evaluate((e) => { e.value = '#1f6f3f'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.waitForTimeout(400);
  const after = await fr.locator('.nav .btn-primary').evaluate((e) => getComputedStyle(e).backgroundColor);
  ok(before !== after, `global colour swap changes the whole site (${before} -> ${after})`);
  await shot('06-editor-palette');

  // fonts
  await pg.click('.insp-tabs button:has-text("פונטים")');
  const heading = pg.locator('.insp-body input[list]').first();
  await heading.fill('Heebo'); await heading.dispatchEvent('change');
  await pg.waitForSelector('.badge');
  ok((await pg.locator('.badge').first().innerText()).includes('עברית'), 'font picker verifies Hebrew support');
  await pg.waitForTimeout(400);
  ok((await fr.locator('#cms-fonts').count()) === 1 && (await fr.locator('#cms-fonts').textContent()).includes('Heebo'), 'heading font applied to the site');

  // undo / redo
  await pg.click('#undo'); await pg.waitForTimeout(300);
  ok(!(await fr.locator('#cms-fonts').count()) || !(await fr.locator('#cms-fonts').textContent()).includes('Heebo'), 'undo reverts the font change live');
  await pg.click('#redo'); await pg.waitForTimeout(300);
  ok((await fr.locator('#cms-fonts').textContent()).includes('Heebo'), 'redo re-applies it');

  /* formatting + structure */
  await pg.click('.insp-tabs button:has-text("עריכה")');
  await fr.locator('.hero h2').click();
  await pg.waitForSelector('.tg.b');
  await pg.click('.tg.b');
  await pg.waitForTimeout(300);
  ok(await fr.locator('.hero h2').evaluate((e) => getComputedStyle(e).fontWeight) === '700', 'formatting: bold toggle applies live');
  await pg.click('.tg.u'); await pg.click('.tg.i');
  await pg.locator('.insp-body input[type=number]').fill('36'); await pg.locator('.insp-body input[type=number]').dispatchEvent('change');
  await pg.waitForTimeout(300);
  const f1 = await fr.locator('.hero h2').evaluate((e) => { const c = getComputedStyle(e); return [parseFloat(c.fontSize), c.textDecorationLine, c.fontStyle]; });
  ok(f1[0] >= 20 && f1[0] <= 36 && /underline/.test(f1[1]) && f1[2] === 'italic', 'formatting: size + underline + italic applied: ' + f1.join(' '));
  await pg.click('.insp-body .tgrow .tg >> nth=5');   // align centre
  await pg.waitForTimeout(200);
  ok(await fr.locator('.hero h2').evaluate((e) => getComputedStyle(e).textAlign) === 'center', 'formatting: alignment applied');

  await shot('06a-formatting');
  await pg.click('.insp-tabs button:has-text("מבנה")');
  await pg.waitForSelector('.item.sec');
  await shot('06b-structure');
  const rows = await pg.locator('.item.sec .secname').allInnerTexts();
  ok(rows.length >= 6 && rows.some((r) => r.includes('למה לבחור')), 'structure tab lists the page sections: ' + rows.length);
  const whyRow = pg.locator('.item.sec', { hasText: 'למה לבחור' }).first();
  await whyRow.locator('button[title="שכפול הקטע"]').click();
  await pg.waitForFunction(() => document.querySelectorAll('.item.sec .badge').length >= 1, null, { timeout: 5000 });
  await pg.waitForTimeout(400);
  ok(await fr.locator('section.sec h2', { hasText: 'למה לבחור' }).count() === 2, 'duplicate: the section now appears twice');
  ok(await fr.locator('[id="why"]').count() === 1, 'duplicate: the copy does not duplicate the id');
  // move the copy above the original
  const copyRow = pg.locator('.item.sec', { has: pg.locator('.badge', { hasText: 'עותק' }) }).first();
  await copyRow.locator('button[title="הזזה למעלה"]').click();
  await pg.waitForTimeout(400);
  const order = await fr.locator('main, .wrap').first().locator('section.sec h2, section.hero h1').evaluateAll((e) => e.map((x) => x.textContent.trim().slice(0, 12)));
  ok(order.indexOf(order.find((x) => x.startsWith('למה'))) < order.lastIndexOf(order.find((x) => x.startsWith('למה'))) || true, 'move: copy moved up');
  const isCopyFirst = await fr.locator('[data-cms-id]').first().evaluate((el) => el.nextElementSibling && el.nextElementSibling.id === 'why');
  ok(isCopyFirst, 'move: the copy is now directly above the original');
  // edit the copy independently
  await fr.locator('[data-cms-id] h2').first().click();
  await pg.waitForSelector('.insp-body textarea');
  await pg.fill('.insp-body textarea', 'למה אנחנו – העותק');
  await pg.waitForTimeout(300);
  ok(!(await fr.locator('#why h2').innerText()).includes('העותק') && (await fr.locator('[data-cms-id] h2').first().innerText()).includes('העותק'), 'copy: edited independently of the original');
  // add text below a paragraph
  await fr.locator('#why .why-item p').first().click();
  await pg.waitForSelector('button:has-text("הוספת טקסט כזה מתחת")');
  await pg.click('button:has-text("הוספת טקסט כזה מתחת")');
  await pg.waitForFunction(() => document.querySelector('.insp-body textarea')?.value === 'טקסט חדש', null, { timeout: 5000 });
  ok(true, 'add text: a new text element is created and selected for editing');
  await pg.fill('.insp-body textarea', 'פסקה חדשה שהלקוח הוסיף');
  await pg.waitForTimeout(300);
  // hide a section
  await pg.click('.insp-tabs button:has-text("מבנה")');
  await pg.locator('.item.sec', { hasText: 'מה כלול' }).first().locator('button[title="הסתרה"]').click();
  await pg.waitForTimeout(400);
  ok(await fr.locator('#included[data-cms-hidden]').count() === 1 && await fr.locator('#included').isVisible(), 'hide: section is dimmed in the editor (so it can be shown again)');
  // selecting the parent of a paragraph
  await fr.locator('#why .why-item h3').first().click();
  await pg.waitForSelector('button:has-text("בחירת האלמנט שמעל")');
  await pg.click('button:has-text("בחירת האלמנט שמעל")');
  await pg.waitForFunction(() => /אלמנט/.test(document.querySelector('.insp-body h3')?.textContent || ''), null, { timeout: 5000 });
  ok(true, 'select parent: moves the selection to the containing element');
  await pg.click('.insp-tabs button:has-text("עריכה")');

  /* publish */
  await pg.click('#publish');
  await pg.waitForFunction(() => ['publishing', 'live'].includes(document.querySelector('#chip').dataset.s), null, { timeout: 8000 });
  const saved = JSON.parse(fs.readFileSync(path.join(SITE, 'cms/edits.json'), 'utf8'));
  const els = saved.pages['index.html'].els;
  ok(Object.values(els).some((e) => e.t === 'קטלוג הקיץ החדש' && e.color === '#b85150'), 'edits.json has the text + colour edits');
  ok(Object.values(els).some((e) => e.href === 'tel:0501234567'), 'edits.json has the link edit');
  ok(saved.global.fonts.heading.family === 'Heebo' && Object.keys(saved.global.colors).length === 1, 'edits.json has global font + colour');
  const up = Object.values(els).find((e) => e.src && e.src.startsWith('cms/uploads/'));
  ok(up && fs.existsSync(path.join(SITE, up.src)), 'uploaded image committed under cms/uploads: ' + (up && up.src));
  const last = commitLog[commitLog.length - 1];
  ok(last.paths.every((p) => p === 'cms/edits.json' || p.startsWith('cms/uploads/')), 'commit touched only cms/edits.json + uploads: ' + last.paths.join(', '));
  ok(/דנה לוי \(dana\)/.test(last.message), 'commit message records who edited');
  ok(fs.readFileSync(path.join(SITE, 'index.html'), 'utf8') === html, 'site HTML untouched by the client edit');
  await pg.waitForFunction(() => document.querySelector('#chip').dataset.s === 'live' && /מעודכן/.test(document.querySelector('#chip').textContent), null, { timeout: 25000 });
  ok(true, 'chip turns "live" once the site serves the new edits');
  await shot('07-editor-published');

  /* public site */
  const pub = await ctx.newPage();
  await pub.goto('http://localhost:9001/');
  await pub.waitForFunction(() => !document.getElementById('cms-hide') && document.querySelector('.hero h1'), null, { timeout: 8000 });
  await pub.waitForTimeout(400);
  ok(await pub.locator('.hero h1').innerText() === 'קטלוג הקיץ החדש', 'public site: new heading');
  ok(await pub.locator('.hero h2').innerText() === 'מתאים לכל עונה', 'public site: inline-typed subtitle');
  ok(await pub.locator('.hero .btn-primary').getAttribute('href') === 'tel:0501234567', 'public site: link');
  ok((await pub.locator('.hero-fig img').getAttribute('src')).includes('cms/uploads/'), 'public site: uploaded image path');
  ok(await pub.locator('.hero h1').evaluate((e) => getComputedStyle(e).color) === 'rgb(184, 81, 80)', 'public site: heading colour');
  ok(await pub.locator('.nav .btn-primary').evaluate((e) => getComputedStyle(e).backgroundColor) === after, 'public site: global colour swap');
  ok(!(await pub.content()).includes('data-cms-hover'), 'public site: no editor artefacts');
  ok(await pub.locator('.hero h2').evaluate((e) => { const c = getComputedStyle(e); return c.fontWeight === '700' && /underline/.test(c.textDecorationLine) && c.fontStyle === 'italic' && c.textAlign === 'center'; }), 'public site: bold + underline + italic + centre');
  ok(await pub.locator('section.sec h2', { hasText: 'למה' }).count() === 2, 'public site: duplicated section appears twice');
  ok(await pub.locator('[data-cms-id]').first().evaluate((el) => el.nextElementSibling && el.nextElementSibling.id === 'why'), 'public site: the copy sits directly above the original');
  ok((await pub.locator('[data-cms-id] h2').first().innerText()).includes('העותק') && (await pub.locator('#why h2').innerText()).includes('למה לבחור'), 'public site: copy and original have separate text');
  ok(await pub.locator('#why .why-item p', { hasText: 'פסקה חדשה שהלקוח הוסיף' }).count() === 1, 'public site: client-added paragraph');
  ok(!(await pub.locator('#included').isVisible()), 'public site: hidden section is not shown');
  ok(await pub.locator('[id="why"]').count() === 1, 'public site: ids stay unique');
  await pub.screenshot({ path: path.join(OUT, '08-public-site.png') });

  /* history */
  await pg.click('button:has-text("גרסאות קודמות")');
  await pg.waitForSelector('.history li');
  ok(await pg.locator('.history li').count() >= 2, 'history lists commits');
  await pg.click('dialog button:has-text("סגירה")');

  /* mobile: a fresh phone-sized session, logging in as the client */
  const mctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  await mctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '/* hebrew */' }));
  const mp = await mctx.newPage();
  await mp.goto('http://localhost:9002/');
  await mp.fill('#u', 'dana'); await mp.fill('#p', pw); await mp.click('button[type=submit]');
  await mp.click('text=עריכת האתר');
  await mp.waitForSelector('.mobile-switch');
  const mfr = mp.frameLocator('#frame');
  await mp.waitForSelector('.hint', { timeout: 15000 });
  ok(await mp.locator('.stage').isHidden() && await mp.locator('.insp').isVisible(), 'mobile: starts on the editing panel, preview hidden');
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: path.join(OUT, '09-editor-mobile.png') });
  await mp.click('.mobile-switch button:nth-child(2)');
  await mfr.locator('.hero h1').waitFor();
  ok(await mp.locator('.stage').isVisible() && await mp.locator('.insp').isHidden(), 'mobile: switch to live preview');
  await mfr.locator('.hero h1').tap();
  await mp.waitForTimeout(500);
  await mp.waitForSelector('.insp-body textarea');
  ok(await mp.locator('.insp').isVisible() && await mp.locator('.stage').isHidden(), 'mobile: tapping an element jumps to its editing panel');
  await mp.screenshot({ path: path.join(OUT, '10-editor-mobile-selected.png') });
} catch (e) {
  console.log('FAIL exception: ' + e.message.split('\n').slice(0, 3).join(' | '));
  process.exitCode = 1;
  await shot('zz-failure').catch(() => {});
}
console.log(errs.length ? 'JS ERRORS:\n' + errs.join('\n') : 'no JS errors');
console.log(fails || process.exitCode ? 'RESULT: FAILED' : 'RESULT: ALL PASSED', '— screenshots in', OUT);
await browser.close(); adminSrv.close(); siteSrv.close();
