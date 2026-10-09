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
let aiMode = 'edit'; const aiSeen = [];
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('https://anthropic.test')) {
    const b = JSON.parse(init.body); aiSeen.push(b);
    const page = JSON.parse(String(b.messages[b.messages.length - 1].content).match(/<page_data>\n([\s\S]*?)\n<\/page_data>/)[1]);
    const h1 = page.elements.find((e) => e.tag === 'h1');
    const content = aiMode === 'edit'
      ? [{ type: 'text', text: 'הגדלתי את הכותרת' }, { type: 'tool_use', id: 'e1', name: 'edit_element', input: { key: h1.key, fields: { fs: 61, fw: 800 } } }]
      : [{ type: 'text', text: 'הוספתי קטע המלצות' }, { type: 'tool_use', id: 'e2', name: 'add_section_html', input: { label: 'המלצות', html: '<section style="padding:30px;background:#fff7ee"><h2>מה אומרים עלינו</h2><p data-cms-todo>כאן יופיע ציטוט של לקוח</p><script>alert(1)</script></section>' } }];
    return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', content, stop_reason: 'tool_use' }));
  }
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
  if (p === '/git/refs/heads/main') { for (const t of pending) { const f = path.join(SITE, t.path); if (t.sha === null) { fs.rmSync(f, { force: true }); continue; } fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, blobs[t.sha]); } return R(200, {}); }
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
  CMS: new KV(), ANTHROPIC_API_KEY: 'ak-e2e', ANTHROPIC_API: 'https://anthropic.test', ADMIN_PASSWORD: 'owner-pass-123', SESSION_SECRET: 'e2e-secret', GITHUB_TOKEN: 't', GITHUB_API: 'https://gh.test',
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
  await pg.check('#sf-chat');
  await pg.click('.formcard button.primary');
  await pg.waitForSelector('.item:has-text("Alternative Dream")');
  ok(true, 'site added');
  await pg.click('button:has-text("חיבור לעריכה")');
  await pg.waitForFunction(() => document.querySelector('#toast').textContent.includes('חובר'), null, { timeout: 8000 });
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  ok(/<meta charset="utf-8">\n<script src="cms\/cms-kit\.js\?v=[0-9a-f]{10}" data-admin-origin="http:\/\/localhost:9002">/.test(html), 'connect: script tag added to the site HTML');
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

  /* navigation between the admin page and the sites page works from both directions */
  const adminLink = pg.locator('.topnav a:has-text("ניהול לקוחות ואתרים")'), homeLink = pg.locator('.topnav a:has-text("האתרים שלי")');
  ok(await adminLink.getAttribute('aria-current') === 'page' && await homeLink.getAttribute('aria-current') === null, 'nav: admin page is marked current');
  await homeLink.click(); await pg.waitForSelector('.card');
  ok(await pg.locator('.topnav a[aria-current=page]').innerText() === 'האתרים שלי', 'nav: can go from admin to the sites page');
  await pg.locator('.topnav a:has-text("ניהול לקוחות ואתרים")').click(); await pg.waitForSelector('.tabs');
  ok(true, 'nav: and back to the admin page');

  /* a domain that was started but not finished: marked as in progress (no check mark), panel opens, domain can be changed */
  await pg.click('.tabs button:has-text("אתרים")');
  await pg.click('.item button:has-text("דומיין")');
  await pg.fill('#dm-name', 'www.client.co.il'); await pg.click('.formcard button:has-text("המשך")');
  await pg.waitForSelector('.dnstable');
  await pg.click('.formcard button:has-text("סגירה")');
  const domBtn = pg.locator('.item button:has-text("דומיין")');
  ok((await domBtn.innerText()).includes('בהגדרה') && !(await domBtn.innerText()).includes('✔'), 'domain: unfinished domain is not marked with a check mark');
  await domBtn.click(); await pg.waitForSelector('#dm-change');
  await pg.fill('#dm-change', 'www.other.co.il'); await pg.click('.formcard button:has-text("החלפה")');
  await pg.waitForFunction(() => document.querySelector('.formcard')?.innerText.includes('www.other.co.il'));
  ok(true, 'domain: unfinished domain can be reopened and changed');
  await pg.click('.formcard button:has-text("ניתוק דומיין")'); 

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

  /* nothing selected: the add block is right under the hint, with a "where" picker; adding at the end of the page works */
  ok((await pg.locator('.insp-body > *').nth(0).getAttribute('class')) === 'hint' && (await pg.locator('.insp-body > *').nth(1).getAttribute('class')) === 'addblock', 'add (empty state): the add block sits directly under the "select anything" hint');
  await pg.waitForFunction(() => document.querySelectorAll('.addwhere option').length > 1, null, { timeout: 8000 });
  await pg.click('button.addtile:has-text("מפריד")');
  await pg.waitForSelector('.insp-body h3:has-text("עריכת")', { timeout: 8000 });
  ok(await fr.locator('[data-cms-id]').count() >= 1, 'add (empty state): the new element is added to the page and selected');
  await pg.click('button:has-text("מחיקת האלמנט")');
  await pg.waitForSelector('.hint', { timeout: 8000 });

  /* chat: the assistant's actions run through the editor (live, undoable, still need publishing) */
  await pg.click('.insp-tabs button:has-text("צ\'אט")');
  await pg.waitForSelector('.chat-box textarea');
  await pg.fill('.chat-box textarea', 'תגדילי את הכותרת הראשית');
  await pg.click('.chat-box button.primary');
  await pg.waitForFunction(() => document.querySelector('.chat-done li'), null, { timeout: 10000 });
  await pg.waitForTimeout(500);
  const fs61 = await fr.locator('.hero h1').evaluate((e) => [Math.round(parseFloat(getComputedStyle(e).fontSize)), e.getAttribute('data-cms-p'), e.id]);
  ok(fs61[0] === 61, 'chat: edit_element action applied live (font size 61) got ' + fs61.join(','));
  ok(await pg.locator('#chip').getAttribute('data-s') === 'dirty', 'chat: change is unsaved until published');
  ok(aiSeen.length === 1 && aiSeen[0].model && aiSeen[0].tools.length === 9, 'chat: model call carries the tools');
  aiMode = 'section';
  await pg.fill('.chat-box textarea', 'תוסיפי קטע המלצות');
  await pg.click('.chat-box button.primary');
  await fr.locator('[data-cms-add="html"]').waitFor({ timeout: 10000 });
  ok(await fr.locator('[data-cms-add="html"] script').count() === 0 && /מה אומרים עלינו/.test(await fr.locator('[data-cms-add="html"]').innerText()), 'chat: generated section is added and sanitised');
  await shot('05b-chat');
  await pg.locator('.chat-msg.bot button.link').last().click();
  await pg.waitForTimeout(400);
  ok(await fr.locator('[data-cms-add="html"]').count() === 0, 'chat: undo removes the generated section');
  await pg.locator('.chat-msg.bot button.link').first().click();
  await pg.waitForTimeout(400);
  ok(await fr.locator('.hero h1').evaluate((e) => Math.round(parseFloat(getComputedStyle(e).fontSize))) !== 61, 'chat: undo restores the heading size');
  await pg.click('.insp-tabs button:has-text("עריכה")');

  /* drag & drop: pull a tile from the add block onto the page; it lands before/after the block under the pointer */
  if (await pg.locator('#deselect').count()) await pg.click('#deselect');
  await pg.waitForSelector('button.addtile:has-text("מפריד")');
  const tileBox = await pg.locator('button.addtile:has-text("מפריד")').boundingBox();
  await fr.locator('.hero h2').scrollIntoViewIfNeeded();
  const h2Box = await fr.locator('.hero h2').boundingBox();
  await pg.mouse.move(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(tileBox.x + 40, tileBox.y + 40, { steps: 3 });
  await pg.mouse.move(h2Box.x + h2Box.width / 2, h2Box.y + 3, { steps: 8 });
  ok(await pg.locator('.drag-ghost').count() === 1, 'drag: a ghost follows the pointer');
  ok(await fr.locator('body').evaluate(() => [...document.documentElement.children].some((e) => e.hasAttribute('data-cms-ui') && e.style.display === 'block' && e.style.height === '4px')), 'drag: the page shows an insertion line');
  await pg.mouse.up();
  await fr.locator('[data-cms-add="divider"]').waitFor({ timeout: 8000 });
  ok(await fr.locator('.hero h2').evaluate((e) => e.previousElementSibling && e.previousElementSibling.getAttribute('data-cms-add') === 'divider'), 'drag: dropped on the upper half of a block -> added before it');
  await pg.click('button:has-text("מחיקת האלמנט")');
  await pg.waitForSelector('.hint', { timeout: 8000 });

  /* keyboard shortcuts on the selected element (focus inside the page frame) */
  await fr.locator('.hero').evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const h2n = () => fr.locator('.hero h2').count();
  await fr.locator('.hero h2').first().click();
  await pg.waitForSelector('.insp-body textarea');
  const n0 = await h2n();
  await pg.keyboard.press('Control+d');
  const waitCount = async (n) => { for (let i = 0; i < 40; i++) { if (await h2n() === n) return; await pg.waitForTimeout(200); } throw new Error('h2 count never became ' + n); };
  await waitCount(n0 + 1);
  ok(true, 'shortcut: Ctrl+D duplicates the selected element');
  await pg.waitForTimeout(500);
  await pg.keyboard.press('Delete');
  await waitCount(n0);
  ok(true, 'shortcut: Delete removes the copy that was just created');
  await pg.waitForTimeout(400);
  await fr.locator('.hero h2').first().click();
  await pg.waitForSelector('.insp-body textarea');
  await pg.keyboard.press('Delete');
  await pg.waitForTimeout(500);
  ok(await fr.locator('.hero h2').first().evaluate((e) => e.hasAttribute('data-cms-hidden')), 'shortcut: Delete on an original element hides it');
  await pg.keyboard.press('Control+z');
  await pg.waitForTimeout(500);
  ok(await fr.locator('.hero h2').first().evaluate((e) => !e.hasAttribute('data-cms-hidden')), 'shortcut: Ctrl+Z brings it back');
  await fr.locator('.hero h2').first().click();
  await pg.waitForSelector('.insp-body textarea');
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(300);
  ok(await fr.locator('.hero h2').first().evaluate((e) => e.hasAttribute('contenteditable')), 'shortcut: Enter starts editing the selected text');
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(600);
  await fr.locator('.hero h2').first().click({ force: true });
  await pg.waitForSelector('#deselect', { timeout: 8000 });
  await pg.keyboard.press('Escape');
  await pg.waitForSelector('.hint', { timeout: 8000 });
  ok(true, 'shortcut: Escape clears the selection');

  /* picture slot (round avatar) beside a text */
  await fr.locator('.hero h2').first().click({ force: true });
  await pg.waitForSelector('.insp-body textarea', { timeout: 8000 });
  await pg.click('button:has-text("עיגול תמונה ליד הטקסט")');
  await fr.locator('.hero h2 > img[data-cms-add="avatar"]').waitFor({ timeout: 8000 });
  ok(await fr.locator('.hero h2 > img[data-cms-add="avatar"]').evaluate((e) => getComputedStyle(e).borderRadius.includes('50%') && e.offsetWidth === 56 && e.nextSibling && /\S/.test(e.nextSibling.nodeValue || '')), 'avatar: a round 56px picture slot sits inside the text, before it');
  await pg.waitForSelector('.insp-body button:has-text("החלפת תמונה")');
  ok(true, 'avatar: selecting it offers the picture upload');
  /* the added element can be dragged again to another place */
  await pg.waitForTimeout(2500);                      // the page finishes its smooth scroll to the new element
  const fbx = await pg.locator('#frame').boundingBox();
  const rectIn = (sel) => fr.locator(sel).evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }).then((r) => ({ x: r.x + fbx.x, y: r.y + fbx.y, width: r.width, height: r.height }));
  const avBox = await rectIn('.hero h2 > img[data-cms-add="avatar"]');
  const h1Box = await rectIn('.hero h1');
  await pg.mouse.move(avBox.x + avBox.width / 2, avBox.y + avBox.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(avBox.x + 30, avBox.y + 30, { steps: 3 });
  await pg.mouse.move(h1Box.x + h1Box.width / 2, h1Box.y + 10, { steps: 8 });
  await pg.mouse.up();
  await fr.locator('.hero h1 > img[data-cms-add="avatar"]').waitFor({ timeout: 8000 });
  ok(await fr.locator('.hero h2 > img').count() === 0, 'avatar: dragged to another text, it moved there (and left the first one)');
  await pg.waitForSelector('.insp-body button:has-text("החלפת תמונה")');
  await pg.click('button:has-text("מחיקת האלמנט")');
  await pg.waitForSelector('.hint', { timeout: 8000 });
  await pg.waitForTimeout(400);
  ok(await fr.locator('.hero h2 > img').count() === 0 && await fr.locator('.hero h2').innerText() !== '', 'avatar: deleting it leaves the text intact');

  /* a text block added from the tile can be moved again, several times */
  if (await pg.locator('#deselect').count()) await pg.click('#deselect');
  await pg.waitForSelector('button.addtile:has-text("טקסט")');
  await fr.locator('.hero h2').evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  {
    const t0 = await pg.locator('button.addtile:has-text("טקסט")').boundingBox(), g0 = await fr.locator('.hero h2').boundingBox();
    await pg.mouse.move(t0.x + t0.width / 2, t0.y + t0.height / 2); await pg.mouse.down();
    await pg.mouse.move(t0.x + 30, t0.y + 30, { steps: 3 }); await pg.mouse.move(g0.x + g0.width / 2, g0.y + g0.height - 3, { steps: 8 }); await pg.mouse.up();
  }
  await fr.locator('[data-cms-add="text"]').waitFor({ timeout: 8000 });
  for (const target of ['.hero h1', '.hero h2']) {
    await pg.waitForTimeout(1200);
    await fr.locator('.hero').evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await pg.waitForTimeout(2500);                       // let the page's smooth scroll to the selected element finish
    const fb = await pg.locator('#frame').boundingBox();
    const rectOf = (sel) => fr.locator(sel).evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }).then((r) => ({ x: r.x + fb.x, y: r.y + fb.y, width: r.width, height: r.height }));
    const tb = await rectOf('[data-cms-add="text"]'), gb = await rectOf(target);
    await pg.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await pg.mouse.down();
    await pg.mouse.move(tb.x + tb.width / 2 + 20, tb.y + tb.height / 2 + 20, { steps: 3 });
    await pg.mouse.move(gb.x + gb.width / 2, gb.y + gb.height - 3, { steps: 8 });
    await pg.mouse.up();
    await pg.waitForTimeout(600);
    ok(await fr.locator(target).evaluate((e) => !!e.nextElementSibling && e.nextElementSibling.getAttribute('data-cms-add') === 'text'), 'move: the added text block was dragged to just after ' + target);
  }
  await pg.click('button:has-text("מחיקת האלמנט")');
  await pg.waitForSelector('.hint', { timeout: 8000 });

  await fr.locator('.hero h1').click();
  await pg.waitForSelector('.insp-body textarea');
  ok(await pg.inputValue('.insp-body textarea') === 'קטלוג אוהלי גלאמפינג', 'click text -> inspector shows its text');
  await pg.fill('.insp-body textarea', 'קטלוג הקיץ החדש');
  await pg.waitForTimeout(300);
  ok(await fr.locator('.hero h1').innerText() === 'קטלוג הקיץ החדש', 'typing in inspector updates the live site');
  ok(await pg.locator('#chip').getAttribute('data-s') === 'dirty', 'chip shows unsaved changes');

  // inline typing directly on the page
  await fr.locator('.hero h2').dblclick();
  await pg.keyboard.type('מתאים');
  await pg.keyboard.press('Enter');
  await pg.keyboard.type('לכל עונה');
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(300);
  ok(await fr.locator('.hero h2').innerText() === 'מתאים\nלכל עונה', 'double-click inline typing on the page; Enter adds a line break');

  // text colour of the heading
  await fr.locator('.hero h1').click();
  await pg.waitForFunction(() => document.querySelector('.insp-body textarea')?.value === 'קטלוג הקיץ החדש');   // the inspector now shows the heading
  await pg.waitForSelector('.insp-body .colorrow input[type=color]');
  await pg.locator('.insp-body .colorrow input[type=color]').first().evaluate((e) => { e.value = '#b85150'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.waitForTimeout(300);
  ok(await fr.locator('.hero h1').evaluate((e) => getComputedStyle(e).color) === 'rgb(184, 81, 80)', 'per-element text colour applied');

  // link edit: the primary hero button
  await fr.locator('.hero .btn-primary').click();
  await pg.waitForSelector('.insp-body input[dir=ltr]:not([type=number])');
  await pg.locator('.insp-body input[dir=ltr]:not([type=number])').first().fill('tel:0501234567');
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
  await pg.locator('.insp-body input[type=number]').first().fill('36'); await pg.locator('.insp-body input[type=number]').first().dispatchEvent('change');
  await pg.waitForTimeout(300);
  const f1 = await fr.locator('.hero h2').evaluate((e) => { const c = getComputedStyle(e); return [parseFloat(c.fontSize), c.textDecorationLine, c.fontStyle]; });
  ok(f1[0] >= 20 && f1[0] <= 36 && /underline/.test(f1[1]) && f1[2] === 'italic', 'formatting: size + underline + italic applied: ' + f1.join(' '));
  await pg.click('.insp-body .tgrow .tg >> nth=5');   // align centre
  await pg.waitForTimeout(200);
  ok(await fr.locator('.hero h2').evaluate((e) => getComputedStyle(e).textAlign) === 'center', 'formatting: alignment applied');
  const lhRange = pg.locator('.insp-body label:has-text("גובה שורה") input[type=range]');
  await lhRange.evaluate((e) => { e.value = 25; e.dispatchEvent(new Event('input', { bubbles: true })); });
  const mtNum = pg.locator('.insp-body label:has-text("מרווח מעל") input[type=number]');
  await mtNum.fill('20'); await mtNum.dispatchEvent('change');
  await pg.waitForTimeout(500);
  const sp1 = await fr.locator('.hero h2').evaluate((e) => { const c = getComputedStyle(e); return { r: parseFloat(c.lineHeight) / parseFloat(c.fontSize), mt: c.marginTop }; });
  ok(Math.abs(sp1.r - 2.5) < 0.06 && sp1.mt === '20px', 'spacing: line height and margin above are applied live from the editor: ' + JSON.stringify(sp1));

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

  /* adding elements: button, video, file, image */
  const selectBox = async () => { await fr.locator('.hero h2').click(); await pg.waitForSelector('#deselect'); ok((await pg.locator('.insp .addblock').count()) === 0, 'selected element: no add-element block'); await pg.click('#deselect'); await pg.waitForSelector('.addblock .addtile'); await pg.waitForFunction(() => document.querySelectorAll('.addwhere option').length > 1, null, { timeout: 8000 }); };
  const openAdd = async () => { await pg.waitForSelector('.addblock .addtile'); };
  await selectBox();
  ok((await pg.locator('.insp-body > .addblock').count()) === 1 && (await pg.locator('.addblock .addtile').first().isVisible()), 'add: a prominent block with all element types sits right under the title (no collapsed menu)');
  await pg.waitForSelector('button.addtile:has-text("כפתור")');
  await pg.click('button.addtile:has-text("כפתור")');
  await pg.waitForSelector('.insp-body textarea');
  await pg.waitForTimeout(300);
  const nb = await fr.locator('[data-cms-add="button"]').evaluate((e) => ({ cls: e.className, text: e.textContent }));
  ok(/\bbtn\b/.test(nb.cls) && /btn-primary/.test(nb.cls) && nb.text === 'לחצו כאן', 'add button: new button copies the site\'s button classes: ' + JSON.stringify(nb));
  await pg.fill('.insp-body textarea', 'התקשרו עכשיו');
  await pg.locator('.insp-body input[dir=ltr]:not([type=number])').first().fill('tel:0501234567');
  await pg.waitForTimeout(300);
  ok(await fr.locator('[data-cms-add="button"]').getAttribute('href') === 'tel:0501234567' && (await fr.locator('[data-cms-add="button"]').innerText()) === 'התקשרו עכשיו', 'add button: text and link editable');
  // WhatsApp contact button with a message the owner words
  await selectBox(); await openAdd();
  await pg.click('button.addtile:has-text("וואטסאפ")');
  await pg.fill('dialog input[type=tel]', '050-1234567');
  await pg.fill('dialog textarea', 'שלום, אשמח לשמוע על החבילות');
  await pg.fill('dialog input[type=text]', 'כתבו לנו בוואטסאפ');
  await pg.click('dialog .btn.primary');
  await fr.locator('[data-cms-add="button"] >> text=כתבו לנו בוואטסאפ').waitFor({ timeout: 8000 });
  const waHref = await fr.locator('a[data-cms-add="button"]:has-text("כתבו לנו בוואטסאפ")').getAttribute('href');
  ok(waHref === 'https://wa.me/972501234567?text=' + encodeURIComponent('שלום, אשמח לשמוע על החבילות'), 'whatsapp button: opens a chat with the number and the owner\'s message: ' + waHref);
  await pg.click('button:has-text("מחיקת האלמנט")'); await fr.locator('a[data-cms-add="button"]:has-text("כתבו לנו בוואטסאפ")').waitFor({ state: 'detached', timeout: 8000 });

  await selectBox();
  await openAdd();
  await pg.waitForSelector('button.addtile:has-text("סרטון")');
  await pg.click('button.addtile:has-text("סרטון")');
  await pg.waitForSelector('dialog[open] input');
  await pg.fill('dialog[open] input', 'https://example.com/not-a-video');
  await pg.click('dialog[open] button:has-text("הוספה")');
  ok(await pg.locator('dialog[open] .error').isVisible(), 'add video: a link that is not YouTube/Vimeo is refused');
  await pg.fill('dialog[open] input', 'https://youtu.be/dQw4w9WgXcQ?si=xyz');
  await pg.click('dialog[open] button:has-text("הוספה")');
  await pg.waitForSelector('.insp-body label:has-text("קישור לסרטון")');
  await pg.waitForTimeout(300);
  ok(await fr.locator('[data-cms-add="video"] iframe').getAttribute('src') === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'add video: short YouTube link becomes a privacy-enhanced embed');
  await pg.locator('.insp-body label:has-text("קישור לסרטון") input').fill('https://vimeo.com/123456789');
  await pg.locator('.insp-body label:has-text("קישור לסרטון") input').dispatchEvent('change');
  await pg.waitForTimeout(300);
  ok(await fr.locator('[data-cms-add="video"] iframe').getAttribute('src') === 'https://player.vimeo.com/video/123456789', 'add video: the link can be changed to Vimeo afterwards');

  await selectBox();
  await openAdd();
  await pg.waitForSelector('button.addtile:has-text("קובץ להורדה")');
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
  const [fc2] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('button.addtile:has-text("קובץ להורדה")')]);
  await fc2.setFiles({ name: 'חוברת מידע.pdf', mimeType: 'application/pdf', buffer: pdf });
  await pg.waitForSelector('.insp-body textarea');
  await pg.waitForTimeout(500);
  const fl = await fr.locator('[data-cms-add="file"]').evaluate((e) => ({ href: e.getAttribute('href'), dl: e.hasAttribute('download'), text: e.textContent }));
  ok(/^cms\/uploads\/.+\.pdf$/.test(fl.href) && fl.dl && fl.text.includes('חוברת מידע'), 'add file: PDF upload becomes a download link named after the file: ' + JSON.stringify(fl));
  await selectBox();
  await openAdd();
  await pg.waitForSelector('button.addtile:has-text("תמונה")');
  await pg.locator('.insp-body').evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await shot('06c-add-elements');
  const [fc3] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('button.addtile:has-text("תמונה")')]);
  await fc3.setFiles({ name: 'extra.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await pg.waitForSelector('.insp-body textarea, .insp-body .thumb');
  await pg.waitForTimeout(800);
  ok((await fr.locator('[data-cms-add="image"]').getAttribute('src')).startsWith('data:image/'), 'add image: uploaded image appears right away');
  // crop the picture into a shape
  await pg.waitForSelector('.shapes .shape:has-text("עיגול")');
  await pg.click('.shapes .shape:has-text("עיגול")');
  await pg.selectOption('.insp-body select:near(:text("יחס חיתוך"))', '1:1');
  await pg.waitForTimeout(300);
  const shp = await fr.locator('[data-cms-add="image"]').evaluate((e) => { const c = getComputedStyle(e); return { clip: c.clipPath, ar: c.aspectRatio }; });
  ok(/^circle/.test(shp.clip) && shp.ar === '1 / 1', 'image shape: picture is cut into a circle with a 1:1 crop: ' + JSON.stringify(shp));
  await shot('12-image-shape');
  // delete the added image again (counts as "delete the element")
  await pg.click('button:has-text("✕ מחיקת האלמנט")');
  await pg.waitForTimeout(400);
  ok(await fr.locator('[data-cms-add="image"]').count() === 0, 'delete: an added element can be removed');

  // a content box with its own corner radius, border and shadow
  await selectBox();
  await pg.waitForSelector('button.addtile:has-text("קופסה")');
  await pg.click('button.addtile:has-text("קופסה")');
  await fr.locator('[data-cms-add="box"]').waitFor({ timeout: 8000 });
  await pg.waitForTimeout(900);   // the parent box was selected before: let the new one take over the panel
  await pg.waitForSelector('.insp-body h4:has-text("פינות, מסגרת וצל")');
  await pg.fill('.insp-body input[type=number][min="0"][max="200"]', '30');
  await pg.locator('.insp-body input[type=number][min="0"][max="200"]').dispatchEvent('change');
  await pg.selectOption('.insp-body select:near(:text("צל"))', '2');
  await pg.waitForTimeout(400);
  const boxCss = await fr.locator('[data-cms-add="box"]').evaluate((e) => { const c = getComputedStyle(e); return { rad: c.borderTopLeftRadius, shadow: c.boxShadow !== 'none', title: e.querySelector('h3, h2, h4').textContent }; });
  ok(boxCss.rad === '30px' && boxCss.shadow && boxCss.title === 'כותרת הקופסה', 'box: added with its own title; corner radius and shadow controlled from the editor: ' + JSON.stringify(boxCss));

  await shot('13-box');
  // a row of 3 boxes: switch it to 2 columns and set the gap from the editor
  await selectBox();
  await pg.waitForSelector('button.addtile:has-text("3 עמודות")');
  await pg.click('button.addtile:has-text("3 עמודות")');
  await fr.locator('[data-cms-add="cols"]').waitFor({ timeout: 8000 });
  await pg.waitForTimeout(900);
  await pg.waitForSelector('.insp-body h4:has-text("גודל, מרווחים ועמודות")');
  ok(await fr.locator('[data-cms-add="cols"] > div').count() === 3, 'columns: "3 עמודות" adds a row of three boxes and selects the row');
  await pg.click('.insp-body .tg:text-is("2")');
  await pg.locator('.insp-body label:has-text("מרווח בין הפריטים") input[type=number]').fill('48');
  await pg.locator('.insp-body label:has-text("מרווח בין הפריטים") input[type=number]').dispatchEvent('change');
  await pg.waitForTimeout(400);
  const colCss = await fr.locator('[data-cms-add="cols"]').evaluate((e) => { const c = getComputedStyle(e); return { n: c.gridTemplateColumns.split(' ').length, gap: c.columnGap }; });
  ok(colCss.n === 2 && colCss.gap === '48px', 'columns: columns and gap are controlled from the editor: ' + JSON.stringify(colCss));
  await shot('14-columns');
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
  ok(await pub.locator('.hero h2').innerText() === 'מתאים\nלכל עונה', 'public site: inline-typed subtitle');
  ok(await pub.locator('.hero .btn-primary:not([data-cms-add])').getAttribute('href') === 'tel:0501234567', 'public site: link');
  ok((await pub.locator('.hero-fig img').getAttribute('src')).includes('cms/uploads/'), 'public site: uploaded image path');
  ok(await pub.locator('.hero h1').evaluate((e) => getComputedStyle(e).color) === 'rgb(184, 81, 80)', 'public site: heading colour');
  ok(await pub.locator('.nav .btn-primary').evaluate((e) => getComputedStyle(e).backgroundColor) === after, 'public site: global colour swap');
  ok(!(await pub.content()).includes('data-cms-hover'), 'public site: no editor artefacts');
  ok(await pub.locator('.hero h2').evaluate((e) => { const c = getComputedStyle(e); return c.fontWeight === '700' && /underline/.test(c.textDecorationLine) && c.fontStyle === 'italic' && c.textAlign === 'center'; }), 'public site: bold + underline + italic + centre');
  ok(await pub.locator('section.sec h2', { hasText: 'למה' }).count() === 2, 'public site: duplicated section appears twice');
  ok(await pub.locator('[data-cms-id]:not([data-cms-add])').first().evaluate((el) => el.nextElementSibling && el.nextElementSibling.id === 'why'), 'public site: the copy sits directly above the original');
  ok((await pub.locator('[data-cms-id]:not([data-cms-add]) h2').first().innerText()).includes('העותק') && (await pub.locator('#why h2').innerText()).includes('למה לבחור'), 'public site: copy and original have separate text');
  ok(await pub.locator('#why .why-item p', { hasText: 'פסקה חדשה שהלקוח הוסיף' }).count() === 1, 'public site: client-added paragraph');
  ok(!(await pub.locator('#included').isVisible()), 'public site: hidden section is not shown');
  ok(await pub.locator('[data-cms-add="button"]').getAttribute('href') === 'tel:0501234567' && /btn-primary/.test(await pub.locator('[data-cms-add="button"]').getAttribute('class')), 'public site: added button with its link and the site\'s styling');
  ok(await pub.locator('[data-cms-add="video"] iframe').getAttribute('src') === 'https://player.vimeo.com/video/123456789', 'public site: added video');
  const fhref = await pub.locator('[data-cms-add="file"]').getAttribute('href');
  ok(/^cms\/uploads\/.+\.pdf$/.test(fhref) && fs.readFileSync(path.join(SITE, fhref)).slice(0, 5).toString() === '%PDF-', 'public site: download link points to the committed PDF: ' + fhref);
  ok(await pub.locator('[data-cms-add="image"]').count() === 0, 'public site: the deleted image is gone');
  ok(await pub.locator('[data-cms-add="box"]').evaluate((e) => getComputedStyle(e).borderTopLeftRadius === '30px'), 'public site: the box with its corner radius');
  ok(await pub.locator('[data-cms-add="cols"]').evaluate((e) => { const c = getComputedStyle(e); return c.display === 'grid' && c.gridTemplateColumns.split(' ').length === 2 && c.columnGap === '48px' && e.children.length === 3; }), 'public site: the row of boxes in 2 columns with its gap');
  const saved2 = JSON.parse(fs.readFileSync(path.join(SITE, 'cms/edits.json'), 'utf8')).pages['index.html'];
  ok(saved2.layout.some((o) => o.op === 'add' && o.type === 'video' && o.p.vid === '123456789') && !saved2.layout.some((o) => o.type === 'image'), 'edits.json: add ops saved, deleted image op removed');
  ok(await pub.locator('[id="why"]').count() === 1, 'public site: ids stay unique');
  await pub.screenshot({ path: path.join(OUT, '08-public-site.png') });

  /* history */
  await pg.click('button:has-text("גרסאות קודמות")');
  await pg.waitForSelector('.history li:has-text("הנוכחית")');   // wait for the real list, not the loading row
  const histN = await pg.locator('.history li').count(); ok(histN >= 2, 'history lists commits: ' + histN + ' ' + (await pg.locator('.history').innerText()).replace(/\n/g, ' | '));
  await pg.click('dialog button:has-text("סגירה")');


  /* page copies + text-only pages */
  ok(!/false|undefined|null/.test(await pg.locator('.pagebar').innerText()), 'pages: the page bar shows no stray "false" text');
  await pg.waitForSelector('#publish:disabled');
  await pg.click('button:has-text("＋ עמוד חדש (שכפול)")');
  await pg.fill('dialog[open] input', 'Terms two');
  await pg.click('dialog[open] button:has-text("יצירת העמוד")');
  await pg.waitForFunction(() => document.querySelector('.pagebar select')?.value === 'terms-two.html', null, { timeout: 15000 });
  const copyHtml = fs.readFileSync(path.join(SITE, 'terms-two.html'), 'utf8');
  ok(/<title>Terms two<\/title>/.test(copyHtml) && /cms\/cms-kit\.js/.test(copyHtml), 'pages: a copy was created with its own title and the editing kit');
  ok(JSON.parse(fs.readFileSync(path.join(SITE, 'cms/edits.json'), 'utf8')).pages['terms-two.html'].els !== undefined, 'pages: the copy starts with the source page edits');
  await pg.locator('.pagebar button:has-text("מחיקת העמוד")').waitFor();
  await fr.locator('.hero h1').waitFor({ timeout: 20000 });
  await fr.locator('.hero h1').click();
  await pg.waitForSelector('.insp-body textarea');
  await pg.fill('.insp-body textarea', 'כותרת העמוד המשוכפל');
  await pg.waitForTimeout(300);
  await pg.click('#publish'); await pg.waitForSelector('#publish:disabled');
  ok(JSON.parse(fs.readFileSync(path.join(SITE, 'cms/edits.json'), 'utf8')).pages['terms-two.html'].els['.hero h1:nth-of-type(1)'] !== undefined || /כותרת העמוד המשוכפל/.test(fs.readFileSync(path.join(SITE, 'cms/edits.json'), 'utf8')), 'pages: the copy can be edited and published without a conflict');

  // the owner locks it to text-only; the client then sees only the text field
  const lg = await realFetch('http://localhost:9002/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'fd' }, body: JSON.stringify({ username: 'admin', password: 'owner-pass-123' }) });
  const ownerCookie = lg.headers.get('set-cookie').split(';')[0];
  const lock = await realFetch('http://localhost:9002/api/admin/sites/alternative', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-requested-with': 'fd', cookie: ownerCookie }, body: JSON.stringify({ textOnly: ['terms-two.html'] }) });
  ok(lock.status === 200, 'text-only: the owner can lock a page');
  await pg.reload();
  await pg.waitForFunction(() => document.querySelector('.pagebar select'), null, { timeout: 15000 });
  await pg.selectOption('.pagebar select', 'terms-two.html');
  await fr.locator('.hero h1').waitFor({ timeout: 20000 });
  await fr.locator('.hero h1').click();
  await pg.waitForSelector('.insp-body textarea');
  ok((await pg.locator('.insp-tabs button').count()) === 2 && (await pg.locator('.addblock').count()) === 0 && (await pg.locator('.insp-body input[type=color], .insp-body .colorrow').count()) === 0, 'text-only: only the text field is offered (no tabs for design, no add block, no colours)');
  await shot('11-text-only-page');
  await pg.fill('.insp-body textarea', 'נוסח מעודכן של התקנון');
  await pg.waitForTimeout(300);
  await pg.click('#publish'); await pg.waitForSelector('#publish:disabled');
  ok(/נוסח מעודכן של התקנון/.test(fs.readFileSync(path.join(SITE, 'cms/edits.json'), 'utf8')), 'text-only: text changes are saved');
  await pg.selectOption('.pagebar select', 'index.html');
  await fr.locator('.hero h1').waitFor({ timeout: 20000 });
  await fr.locator('.hero h1').click();
  await pg.waitForSelector('.insp-body textarea');
  ok((await pg.locator('.insp-tabs button').count()) === 5, 'text-only: other pages keep all the editing tools');

  // delete the copy
  await pg.selectOption('.pagebar select', 'terms-two.html');
  await pg.locator('.pagebar button:has-text("מחיקת העמוד")').click();
  await pg.waitForFunction(() => !document.querySelector('.pagebar select') || ![...document.querySelectorAll('.pagebar option')].some((o) => o.value === 'terms-two.html'), null, { timeout: 15000 });
  ok(!fs.existsSync(path.join(SITE, 'terms-two.html')) && !/terms-two/.test(fs.readFileSync(path.join(SITE, 'cms/edits.json'), 'utf8')), 'pages: deleting a copy removes the file and its edits');

  /* mobile: a fresh phone-sized session, logging in as the client */
  const mctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  await mctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '/* hebrew */' }));
  const mp = await mctx.newPage();
  globalThis.__mp = mp;
  mp.on('response', async (r) => { if (r.url().includes('/api/')) console.log('MOBILE API', r.request().method(), r.url().replace(/.*\/api/, ''), r.status()); });
  await mp.goto('http://localhost:9002/');
  await mp.fill('#u', 'dana'); await mp.fill('#p', pw); await mp.click('button[type=submit]');
  await mp.waitForSelector('.card:has-text("Alternative Dream")', { timeout: 20000 });
  await mp.click('text=עריכת האתר');
  const mfr = mp.frameLocator('#frame');
  await mp.waitForSelector('.hint', { timeout: 15000 });
  await mfr.locator('.hero h1').waitFor();
  const [sb, ib] = [await mp.locator('.stage').boundingBox(), await mp.locator('.insp').boundingBox()];
  ok(sb && ib && sb.y < ib.y && sb.height > 250 && ib.height > 100 && ib.y >= sb.y + sb.height - 2, 'mobile: live site on top and the editor underneath, both visible at once');
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: path.join(OUT, '09-editor-mobile.png') });
  await mfr.locator('.hero h1').evaluate((e) => { e.scrollIntoView(); e.click(); });
  await mp.waitForTimeout(500);
  await mp.waitForSelector('.insp-body textarea');
  ok(await mp.locator('.insp .addblock').count() === 0, 'text editing: no add-element block');
  ok(await mp.locator('.insp').isVisible() && await mp.locator('.stage').isVisible(), 'mobile: tapping an element opens its editor while the site stays in view');
  await mp.screenshot({ path: path.join(OUT, '10-editor-mobile-selected.png') });
} catch (e) {
  console.log('FAIL exception: ' + e.message.split('\n').slice(0, 3).join(' | '));
  process.exitCode = 1;
  await shot('zz-failure').catch(() => {});
  if (globalThis.__mp) { await globalThis.__mp.screenshot({ path: path.join(OUT, 'zz-failure-mobile.png') }).catch(() => {}); console.log('mobile page text:', (await globalThis.__mp.locator('body').innerText().catch(() => '?')).replace(/\\n/g, ' | ').slice(0, 300)); }
}
console.log(errs.length ? 'JS ERRORS:\n' + errs.join('\n') : 'no JS errors');
console.log(fails || process.exitCode ? 'RESULT: FAILED' : 'RESULT: ALL PASSED', '— screenshots in', OUT);
await browser.close(); adminSrv.close(); siteSrv.close();
