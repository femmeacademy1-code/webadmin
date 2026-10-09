/* Kit: text formatting and structure operations (duplicate / move / hide), in public mode and edit mode.
 *
 *   NODE_PATH=$(npm root -g) node tests/layout.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const KIT = new URL('../app/kit/cms-kit.js', import.meta.url).pathname;
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-'));
fs.mkdirSync(S + '/site/cms', { recursive: true }); fs.mkdirSync(S + '/admin', { recursive: true });
fs.copyFileSync(KIT, S + '/site/cms/cms-kit.js');

const page = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>p2</title>
<script src="cms/cms-kit.js" data-admin-origin="http://localhost:9002"></script></head>
<body><main>
<section id="a"><h2>סקשן א</h2><p>טקסט א</p></section>
<section><h2>סקשן ב</h2><p class="x">טקסט ב</p><a href="/b">קישור ב</a></section>
<section><h2>סקשן ג</h2><p>טקסט ג</p></section>
</main>
<script>setTimeout(function(){document.querySelector('main').insertAdjacentHTML('beforeend','<section id="dyn"><h2>דינמי</h2></section>')},300)</script>
</body></html>`;
fs.writeFileSync(S + '/site/page2.html', page);

const B = 'body>main:nth-of-type(1)>section:nth-of-type(2)';
const C = 'body>main:nth-of-type(1)>section:nth-of-type(3)';
const edits = { v: 1, global: {}, pages: { 'page2.html': {
  layout: [
    { op: 'dup', src: B, id: 'cp1' },
    { op: 'move', key: '#a', dir: 1 },
    { op: 'hide', key: C },
  ],
  els: {
    [B + '>h2:nth-of-type(1)']: { t: 'ב ערוך', b: true, fs: 40, u: true, al: 'center', lh: 25, ls: 3, mt: 24, fsm: 22 },
    '@cp1>h2:nth-of-type(1)': { t: 'סקשן ב (עותק)', i: true, st: true, color: '#aa0000' },
    '@cp1>p:nth-of-type(1)': { t: 'פסקה בעותק בלבד' },
    '#dyn>h2:nth-of-type(1)': { t: 'דינמי ערוך' },
  },
} } };
fs.writeFileSync(S + '/site/cms/edits.json', JSON.stringify(edits));
// A page that reveals elements on scroll by adding a class (the mechanism used by real client sites).
fs.writeFileSync(S + '/site/reveal.html', `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>r</title>
<script src="cms/cms-kit.js" data-admin-origin="http://localhost:9002"></script>
<style>.js .reveal{opacity:0;transition:opacity .3s}.js .reveal.is-visible{opacity:1}section{min-height:900px}</style>
<script>document.documentElement.classList.add('js')</script></head>
<body><main><section><h2 class="reveal">ראשון</h2></section><section id="two"><h2 class="reveal">שני</h2><p class="reveal">פסקה</p></section><section><h2 class="reveal">שלישי</h2></section></main>
<script>var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('is-visible');io.unobserve(e.target)}})},{threshold:.1});
document.querySelectorAll('.reveal').forEach(function(el){io.observe(el)});</script></body></html>`);
fs.writeFileSync(S + '/site/cms/edits.json', JSON.stringify({ ...edits, pages: { ...edits.pages, 'reveal.html': { layout: [{ op: 'dup', src: '#two', id: 'cp9' }], els: { '@cp9>h2:nth-of-type(1)': { t: 'שני – עותק' } } } } }));
// Adding elements: a page with a button, a paragraph, a heading and a list to take styling from.
fs.writeFileSync(S + '/site/add.html', `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>a</title>
<script src="cms/cms-kit.js" data-admin-origin="http://localhost:9002"></script>
<style>.btn{display:inline-block;padding:8px 20px;background:#52725a;color:#fff}.title{color:#123456}.lead{font-size:20px}.card{background:#f5eee6;border:2px solid #52725a;border-radius:6px;padding:20px;width:300px;height:140px}.ct{color:#52725a}</style></head>
<body><main><section id="s"><h2 class="title reveal">כותרת קיימת</h2><p class="lead reveal">פסקה קיימת עם טקסט ארוך מספיק</p><a class="btn primary" href="/go">לדף</a>
<div class="card reveal"><h3 class="ct">חבילה</h3><p class="cp">₪100 ללילה</p></div><ul id="list"><li class="item">פריט</li></ul></section></main></body></html>`);
fs.writeFileSync(S + '/site/box2.html', `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>b</title><script src="cms/cms-kit.js" data-admin-origin="http://localhost:9002"></script></head><body><main><section id="s"><p>רק פסקה</p></section></main></body></html>`);
const P = 'body>main:nth-of-type(1)>section:nth-of-type(1)';
fs.writeFileSync(S + '/site/cms/edits.json', JSON.stringify({ ...JSON.parse(fs.readFileSync(S + '/site/cms/edits.json', 'utf8')), pages: { ...JSON.parse(fs.readFileSync(S + '/site/cms/edits.json', 'utf8')).pages, 'add.html': {
  layout: [
    { op: 'add', after: '#s>p:nth-of-type(1)', id: 'b1', type: 'button' },
    { op: 'add', after: '@b1', id: 'f1', type: 'file' },
    { op: 'add', after: '#s>h2:nth-of-type(1)', id: 'v1', type: 'video', p: { provider: 'youtube', vid: 'dQw4w9WgXcQ' } },
    { op: 'add', after: '#s>p:nth-of-type(1)', id: 'im1', type: 'image' },
    { op: 'add', after: '#s>h2:nth-of-type(1)', id: 'h1x', type: 'heading' },
    { op: 'add', after: '#list>li:nth-of-type(1)', id: 'li1', type: 'text' },
    { op: 'add', after: '#s>p:nth-of-type(1)', id: 'd1', type: 'divider' },
    { op: 'add', after: '#s>p:nth-of-type(1)', id: 'vm1', type: 'video', p: { provider: 'vimeo', vid: '123456789' } },
    { op: 'add', after: '#s>p:nth-of-type(1)', id: 'bx1', type: 'box' },
    { op: 'add', after: '#s>p:nth-of-type(1)', id: 'cl1', type: 'cols', p: { n: 3 } },
  ],
  els: { '@b1': { t: 'התקשרו', href: 'tel:0501234567' }, '@f1': { t: 'חוברת', href: 'cms/uploads/a.pdf' }, '@im1': { src: 'https://example.com/x.png', alt: 'תיאור', shape: 'circle', ar: '1:1', fx: 30, fy: 70 }, '@h1x': { t: 'כותרת שהוספתי' },
    '@bx1': { rad: 20, sh: 2, bw: 4, bc: '#b85150', bgc: '#ddf5ee', w: 50, mb: 30, pad: 10, mh: 200 }, '@cl1': { gap: 40 }, '#list': { cols: 2, gap: 12 }, '@bx1>h3:nth-of-type(1)': { t: 'חבילת זהב' } },
} } }));
{ const j = JSON.parse(fs.readFileSync(S + '/site/cms/edits.json', 'utf8')); j.pages['box2.html'] = { layout: [{ op: 'add', after: '#s>p:nth-of-type(1)', id: 'bx2', type: 'box' }], els: {} }; fs.writeFileSync(S + '/site/cms/edits.json', JSON.stringify(j)); }

// Optional (ready-made) sections and html sections written by the chat
const sect = (n) => `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${n}</title><script src="cms/cms-kit.js" data-admin-origin="http://localhost:9002"></script></head>
<body><main><section id="s1" style="padding:20px;background:#f3ece2"><h2 style="color:#52725a">קטע ראשון</h2><p>טקסט ראשון עם מספיק מילים כדי להיות אמיתי</p></section>
<section id="rec" data-cms-optional="המלצות" hidden><h2>מה אומרים עלינו</h2><p data-cms-todo>המלצה לדוגמה, החליפו אותי</p><p data-cms-todo>עוד המלצה לדוגמה</p></section>
<section id="s3" style="padding:20px"><h2>קטע אחרון</h2><p>סוף הדף</p></section></main></body></html>`;
fs.writeFileSync(S + '/site/sect.html', sect('s'));
fs.writeFileSync(S + '/site/sect2.html', sect('s2'));
{ const j = JSON.parse(fs.readFileSync(S + '/site/cms/edits.json', 'utf8'));
  const S1 = '#s1', REC = '#rec';
  j.pages['sect.html'] = { els: {} };
  j.pages['sect2.html'] = { layout: [
    { op: 'show', key: REC },
    { op: 'add', after: S1, id: 'hs1', type: 'html', p: { label: 'יתרונות', html: '<section class="x" style="display:flex;gap:12px;color:#52725a;background:url(http://evil/x.png)" onclick="alert(1)"><h3>יתרון</h3><p data-cms-todo>הסבר</p><script>window.__pwned=1</script><img src=x onerror="window.__pwned=2"><a href="javascript:window.__pwned=3">רע</a><a href="https://ok.example">טוב</a></section>' } },
  ], els: { [REC + '>p:nth-of-type(1)']: { t: 'המלצה אמיתית של לקוחה' } } };
  fs.writeFileSync(S + '/site/cms/edits.json', JSON.stringify(j)); }
fs.writeFileSync(S + '/admin/opt.html', `<!DOCTYPE html><html><body><iframe id="f" style="width:900px;height:600px" src="http://localhost:9001/sect2.html?cms-edit=1"></iframe>
<script>window.__msgs=[];addEventListener('message',e=>{if(e.origin==='http://localhost:9001')window.__msgs.push(e.data)});
window.post=(m)=>document.getElementById('f').contentWindow.postMessage(m,'http://localhost:9001');</script></body></html>`);
fs.writeFileSync(S + '/admin/index.html', `<!DOCTYPE html><html><body><iframe id="f" style="width:900px;height:600px" src="http://localhost:9001/page2.html?cms-edit=1"></iframe>
<script>window.__msgs=[];addEventListener('message',e=>{if(e.origin==='http://localhost:9001')window.__msgs.push(e.data)});
window.post=(m)=>document.getElementById('f').contentWindow.postMessage(m,'http://localhost:9001');</script></body></html>`);

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };
const serve = (dir, port) => new Promise((r) => {
  const s = http.createServer((q, res) => {
    let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'x', 'cache-control': 'no-store' }); res.end(fs.readFileSync(f));
  });
  s.listen(port, () => r(s));
});
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

const s1 = await serve(S + '/site', 9001), s2 = await serve(S + '/admin', 9002);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
const texts = (sel = 'main h2', frame = pg) => frame.locator(sel).evaluateAll((els) => els.map((e) => e.textContent.trim()));

try {
  /* ---------- public mode ---------- */
  await pg.goto('http://localhost:9001/page2.html');
  await pg.waitForFunction(() => !document.getElementById('cms-hide') && document.querySelector('#dyn h2')?.textContent === 'דינמי ערוך', null, { timeout: 5000 });
  ok(JSON.stringify(await texts()) === JSON.stringify(['ב ערוך', 'סקשן א', 'סקשן ב (עותק)', 'סקשן ג', 'דינמי ערוך']),
    'public: duplicate + move applied in the right order, edits stay on the right elements: ' + JSON.stringify(await texts()));
  ok(await pg.locator('#a').count() === 1 && await pg.locator('[id="a"]').count() === 1, 'public: ids are not duplicated by the copy');
  const h = await pg.locator('main section').first().locator('h2').evaluate((e) => { const c = getComputedStyle(e); return [c.fontWeight, c.fontSize, c.textDecorationLine, c.textAlign]; });
  ok(h[0] === '700' && h[1] === '40px' && /underline/.test(h[2]) && h[3] === 'center', 'public: bold + size 40 + underline + centre: ' + h.join(' '));
  const cl = await pg.locator('[data-cms-id="cp1"] h2').evaluate((e) => { const c = getComputedStyle(e); return [c.fontStyle, c.textDecorationLine, c.color]; });
  ok(cl[0] === 'italic' && /line-through/.test(cl[1]) && cl[2] === 'rgb(170, 0, 0)', 'public: the copy has its own formatting: ' + cl.join(' '));
  ok(await pg.locator('[data-cms-id="cp1"] p').innerText() === 'פסקה בעותק בלבד', 'public: editing the copy does not touch the original');
  ok((await pg.locator('main > section:nth-of-type(2) p').innerText()) !== 'פסקה בעותק בלבד' && (await pg.locator('p.x').first().innerText()) === 'טקסט ב', 'public: original keeps its text');
  ok(!(await pg.locator('main section', { hasText: 'סקשן ג' }).isVisible()), 'public: hidden section is display:none');
  // wide screen: the size is exact; narrow screen: the phone size is used
  const wide = await pg.locator('main section').first().locator('h2').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  ok(wide === 40, 'public: exact font size on wide screens (' + wide + 'px)');
  await pg.setViewportSize({ width: 390, height: 800 });
  const small = await pg.locator('main section').first().locator('h2').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  ok(small === 22, 'public: a separate phone size (fsm) is applied exactly on phones (' + small + 'px)');
  await pg.setViewportSize({ width: 1280, height: 800 });

  /* ---------- adding elements ---------- */
  await pg.goto('http://localhost:9001/add.html');
  await pg.waitForFunction(() => !document.getElementById('cms-hide') && document.querySelector('[data-cms-add="button"]'), null, { timeout: 5000 });
  const btn = await pg.locator('[data-cms-add="button"]').evaluate((e) => ({ tag: e.tagName, cls: e.className, href: e.getAttribute('href'), text: e.textContent, prev: e.previousElementSibling && e.previousElementSibling.className }));
  ok(btn.tag === 'A' && btn.cls === 'btn primary' && btn.href === 'tel:0501234567' && btn.text === 'התקשרו', 'add button: takes the page\'s button styling, link and text: ' + JSON.stringify(btn));
  const file = await pg.locator('[data-cms-add="file"]').evaluate((e) => ({ cls: e.className, href: e.getAttribute('href'), dl: e.hasAttribute('download'), prev: e.previousElementSibling.getAttribute('data-cms-add') }));
  ok(file.cls === 'btn primary' && file.href === 'cms/uploads/a.pdf' && file.dl && file.prev === 'button', 'add file: download link next to the button, same styling: ' + JSON.stringify(file));
  const vid = await pg.locator('[data-cms-add="video"] iframe').first().evaluate((e) => ({ src: e.src, allow: e.getAttribute('allow'), rp: e.getAttribute('referrerpolicy') }));
  ok(vid.src === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' && /fullscreen/.test(vid.allow) && vid.rp === 'strict-origin-when-cross-origin', 'add video: privacy-enhanced YouTube embed: ' + JSON.stringify(vid));
  ok(await pg.locator('iframe[src="https://player.vimeo.com/video/123456789"]').count() === 1, 'add video: Vimeo embed');
  const img = await pg.locator('[data-cms-add="image"]').evaluate((e) => ({ src: e.getAttribute('src'), alt: e.alt }));
  ok(img.src === 'https://example.com/x.png' && img.alt === 'תיאור', 'add image: src and alt come from the edits');
  const hd = await pg.locator('[data-cms-add="heading"]').evaluate((e) => ({ tag: e.tagName, cls: e.className, text: e.textContent }));
  ok(hd.tag === 'H2' && hd.cls === 'title' && hd.text === 'כותרת שהוספתי', 'add heading: same tag/class as the page\'s heading, without the scroll-reveal class: ' + JSON.stringify(hd));
  ok(await pg.locator('#list [data-cms-add="text"]').evaluate((e) => e.tagName === 'LI' && e.className === 'item'), 'add text inside a list becomes a list item with the list\'s styling');
  ok(await pg.locator('[data-cms-add="divider"]').evaluate((e) => e.tagName === 'HR'), 'add divider');
  ok(await pg.locator('[data-cms-add="text"], [data-cms-add="heading"]').first().evaluate((e) => getComputedStyle(e).opacity === '1'), 'added elements are visible (no leftover reveal classes)');
  ok(await pg.locator('script, [onclick], [onload]').evaluateAll((els) => els.filter((e) => e.closest('[data-cms-id]')).length === 0), 'added elements contain no scripts or inline handlers');

  /* ---------- boxes and image shapes ---------- */
  const bx = await pg.locator('[data-cms-add="box"]').evaluate((e) => { const c = getComputedStyle(e); return { cls: e.className, h: e.querySelector('h3') && e.querySelector('h3').className, htext: e.querySelector('h3').textContent, hasP: !!e.querySelector('p'), rad: c.borderTopLeftRadius, shadow: c.boxShadow, bw: c.borderTopWidth, bc: c.borderTopColor, bg: c.backgroundColor, opacity: c.opacity }; });
  ok(bx.cls === 'card' && bx.h === 'ct' && bx.hasP, 'box: copies the look (classes) of an existing card on the page, without the scroll-reveal class: ' + JSON.stringify(bx));
  ok(bx.rad === '20px' && bx.shadow !== 'none' && bx.bw === '4px' && bx.bc === 'rgb(184, 81, 80)' && bx.bg === 'rgb(221, 245, 238)' && bx.opacity === '1', 'box: corner radius, shadow, border and background come from the edits');
  ok(bx.htext === 'חבילת זהב', 'box: its title is editable like any text');
  const colsInfo = await pg.locator('[data-cms-add="cols"]').evaluate((e) => { const c = getComputedStyle(e); return { disp: c.display, cols: c.gridTemplateColumns.split(' ').length, gap: c.columnGap, kids: e.children.length, cls: [...e.children].map((k) => k.className).join('|'), inner: [...e.children].every((k) => k.querySelector('h3') && k.querySelector('p')) }; });
  ok(colsInfo.disp === 'grid' && colsInfo.cols === 3 && colsInfo.kids === 3 && colsInfo.gap === '40px' && colsInfo.cls === 'card|card|card' && colsInfo.inner, 'columns: a row of 3 boxes (card look), grid with the chosen gap: ' + JSON.stringify(colsInfo));
  const sz = await pg.locator('[data-cms-add="box"]').evaluate((e) => { const c = getComputedStyle(e); return { w: Math.round(e.offsetWidth / e.parentElement.clientWidth * 100), mb: c.marginBottom, pad: c.paddingTop, mh: c.minHeight }; });
  ok(sz.w === 50 && sz.mb === '30px' && sz.pad === '10px' && sz.mh === '200px', 'size: width %, margin below, padding and min-height are applied: ' + JSON.stringify(sz));
  ok(await pg.locator('#list').evaluate((e) => { const c = getComputedStyle(e); return c.display === 'grid' && c.gridTemplateColumns.split(' ').length === 2 && c.columnGap === '12px'; }), 'columns: an existing container can be split into 2 columns with a gap');
  await pg.setViewportSize({ width: 600, height: 800 });
  await pg.waitForTimeout(200);
  ok(await pg.locator('[data-cms-add="cols"]').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length === 1) && await pg.locator('#list').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length === 1), 'columns: collapse to a single column on a phone-sized screen');
  await pg.setViewportSize({ width: 1280, height: 800 });
  const shape = await pg.locator('[data-cms-add="image"]').evaluate((e) => { const c = getComputedStyle(e); return { clip: c.clipPath, ar: c.aspectRatio, fit: c.objectFit, pos: c.objectPosition }; });
  ok(/^circle/.test(shape.clip) && shape.ar === '1 / 1' && shape.fit === 'cover' && shape.pos === '30% 70%', 'image: circle shape, 1:1 crop and focal point: ' + JSON.stringify(shape));
  await pg.goto('http://localhost:9001/box2.html');
  await pg.waitForFunction(() => !document.getElementById('cms-hide'), null, { timeout: 5000 });
  ok(await pg.locator('[data-cms-add="box"]').count() === 1 && await pg.locator('[data-cms-add="box"]').evaluate((e) => { const c = getComputedStyle(e); return c.borderTopLeftRadius === '16px' && c.paddingTop === '24px'; }), 'box: on a page without cards it gets a clean default style');
  await pg.goto('http://localhost:9001/add.html');
  await pg.waitForFunction(() => !document.getElementById('cms-hide'), null, { timeout: 5000 });

  /* ---------- scroll-reveal pages: a copy must not stay invisible ---------- */
  await pg.goto('http://localhost:9001/reveal.html');
  await pg.waitForFunction(() => !document.getElementById('cms-hide'), null, { timeout: 5000 });
  await pg.evaluate(() => document.querySelector('[data-cms-id="cp9"]').scrollIntoView());
  await pg.waitForTimeout(900);
  const copyOpacity = await pg.locator('[data-cms-id="cp9"] h2').evaluate((e) => getComputedStyle(e).opacity);
  ok(copyOpacity === '1', 'reveal pages: the copy becomes visible when it is scrolled into view (opacity ' + copyOpacity + ')');
  await pg.goto('http://localhost:9001/reveal.html');
  await pg.waitForFunction(() => !document.getElementById('cms-hide'), null, { timeout: 5000 });
  await pg.waitForTimeout(3000);
  const farOpacity = await pg.locator('[data-cms-id="cp9"] p').evaluate((e) => getComputedStyle(e).opacity);
  ok(farOpacity === '1', 'reveal pages: a copy far below the fold is not left invisible (fallback), opacity ' + farOpacity);


  /* ---------- optional sections, html sections ---------- */
  await pg.goto('http://localhost:9001/sect.html');
  await pg.waitForFunction(() => !document.getElementById('cms-hide'), null, { timeout: 5000 });
  ok(!(await pg.locator('#rec').isVisible()), 'optional section: stays hidden until it is switched on');
  await pg.goto('http://localhost:9001/sect2.html');
  await pg.waitForFunction(() => !document.getElementById('cms-hide'), null, { timeout: 5000 });
  ok(await pg.locator('#rec').isVisible() && (await pg.locator('#rec p').first().innerText()) === 'המלצה אמיתית של לקוחה', 'optional section: a "show" op turns it on (and its text can be edited)');
  const hs = pg.locator('[data-cms-add="html"]');
  ok(await hs.count() === 1 && (await pg.locator('main > *').evaluateAll((l) => l.map((e) => e.id || e.getAttribute('data-cms-add')))).join() === 's1,html,rec,s3', 'html section: added right after the chosen section');
  const hsAttrs = await hs.evaluate((e) => ({ onclick: e.hasAttribute('onclick'), style: e.getAttribute('style'), html: e.innerHTML, pwned: window.__pwned || 0 }));
  ok(!hsAttrs.onclick && !/url|evil/.test(hsAttrs.style) && !/<script|<img|onerror|javascript:/i.test(hsAttrs.html) && hsAttrs.pwned === 0 && /href="https:\/\/ok.example"/.test(hsAttrs.html), 'html section: scripts, handlers, images, url() and javascript: links are removed: ' + JSON.stringify(hsAttrs).slice(0, 220));

  /* ---------- edit mode ---------- */
  await pg.goto('http://localhost:9002/');
  await pg.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-ready'));
  const ready = await pg.evaluate(() => window.__msgs.find((m) => m.type === 'cms-ready'));
  ok(ready.version === 9, 'edit: kit reports its version');
  ok(JSON.stringify(ready.sections.map((x) => x.label)) === JSON.stringify(['סקשן א', 'סקשן ב', 'סקשן ג']), 'edit: sections list: ' + ready.sections.map((x) => x.label));
  const fr = pg.frameLocator('#f');
  await pg.evaluate((e) => window.post({ type: 'cms-edits', edits: e, assets: {} }), edits);
  await pg.waitForTimeout(500);
  ok(JSON.stringify(await texts('main h2', fr)) === JSON.stringify(['ב ערוך', 'סקשן א', 'סקשן ב (עותק)', 'סקשן ג', 'דינמי ערוך']), 'edit: same result when edits arrive from the editor');
  const spc = await fr.locator('main h2').first().evaluate((e) => { const c = getComputedStyle(e); return { r: parseFloat(c.lineHeight) / parseFloat(c.fontSize), ls: c.letterSpacing, mt: c.marginTop }; });
  ok(Math.abs(spc.r - 2.5) < 0.05 && spc.ls === '3px' && spc.mt === '24px', 'text spacing: line height, letter spacing and margin above are applied ' + JSON.stringify(spc));
  const sec = await pg.evaluate(() => window.__msgs.filter((m) => m.type === 'cms-sections').pop().sections);
  ok(sec.map((x) => x.label).join('|') === 'ב ערוך|סקשן א|סקשן ב (עותק)|סקשן ג|דינמי ערוך' && sec[2].clone === 'cp1' && sec[3].hidden, 'edit: section list reflects order, clone and hidden flag');
  ok(await fr.locator('[data-cms-hidden]').count() === 1 && await fr.locator('[data-cms-hidden]').isVisible(), 'edit: hidden section stays visible (dimmed) so it can be shown again');


  // edit mode: optional list, placeholder counter, outline for the chat
  { const pg2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await pg2.goto('http://localhost:9002/opt.html');
    await pg2.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-ready'));
    const r2 = await pg2.evaluate(() => window.__msgs.find((m) => m.type === 'cms-ready'));
    ok(JSON.stringify(r2.optional.map((x) => [x.label, x.shown])) === JSON.stringify([['המלצות', false]]), 'edit: ready-made sections are listed (not yet switched on): ' + JSON.stringify(r2.optional));
    await pg2.evaluate((e) => window.post({ type: 'cms-edits', edits: e, assets: {} }), JSON.parse(fs.readFileSync(S + '/site/cms/edits.json', 'utf8')));
    await pg2.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-sections' && m.optional && m.optional[0] && m.optional[0].shown));
    const sec2 = await pg2.evaluate(() => window.__msgs.filter((m) => m.type === 'cms-sections').pop());
    ok(sec2.todo === 2, 'edit: the editor is told how many placeholder texts were not replaced yet (1 replaced + 1 in the html section + 1 left = 2): ' + sec2.todo);
    ok(!sec2.sections.some((x) => x.label === 'מה אומרים עלינו') === false, 'edit: a switched-on optional section joins the structure list');
    await pg2.evaluate(() => { window.__msgs = []; window.post({ type: 'cms-outline', reqId: 5 }); });
    await pg2.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-outline-result'));
    const o = (await pg2.evaluate(() => window.__msgs.find((m) => m.type === 'cms-outline-result'))).outline;
    ok(o.elements.length >= 5 && o.elements.every((e) => e.key && e.text) && o.elements.some((e) => e.text === 'קטע ראשון' && e.tag === 'h2') && o.samples.length >= 1 && o.samples.every((h) => !/data-cms|<script/.test(h)), 'edit: outline for the chat lists texts with keys and compact sample sections: ' + o.elements.length + ' elements, ' + o.samples.length + ' samples');
    await pg2.close(); }

  // a click on the moved section returns its ORIGINAL key, not a position-based one
  await pg.evaluate(() => { window.__msgs = []; });
  await fr.locator('#a h2').click();
  await pg.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-select' && m.unit));
  let sel = await pg.evaluate(() => window.__msgs.filter((m) => m.type === 'cms-select').pop().unit);
  ok(sel.key === '#a>h2:nth-of-type(1)', 'edit: moved section keeps its original key ' + sel.key);
  ok(sel.canUp === false && sel.canDown === true, 'edit: reports whether it can move (first child: down only)');
  // inside the copy
  await pg.evaluate(() => { window.__msgs = []; });
  await fr.locator('[data-cms-id="cp1"] p').click();
  await pg.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-select' && m.unit));
  sel = await pg.evaluate(() => window.__msgs.filter((m) => m.type === 'cms-select').pop().unit);
  ok(sel.key === '@cp1>p:nth-of-type(1)', 'edit: element inside a copy gets a copy-relative key: ' + sel.key);
  // formatting values are reported
  await pg.evaluate(() => { window.__msgs = []; });
  await fr.locator('main section').first().locator('h2').click();
  await pg.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-select' && m.unit));
  sel = await pg.evaluate(() => window.__msgs.filter((m) => m.type === 'cms-select').pop().unit);
  ok(sel.fs === 40 && sel.b === true && sel.u === true && sel.al === 'center', 'edit: current formatting reported (exact size 40 in the 900px frame, bold, underline, centre): ' + JSON.stringify([sel.key, sel.fs, sel.b, sel.u, sel.al]));

  // parent selection and select-by-key
  await pg.evaluate(() => { window.__msgs = []; window.post({ type: 'cms-select-parent' }); });
  await pg.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-select' && m.unit));
  sel = await pg.evaluate(() => window.__msgs.filter((m) => m.type === 'cms-select').pop().unit);
  ok(sel.tag === 'section' && sel.key === B, 'edit: "select parent" jumps to the section: ' + sel.key);
  await pg.evaluate(() => { window.__msgs = []; window.post({ type: 'cms-select-key', key: '@cp1' }); });
  await pg.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-select' && m.unit));
  sel = await pg.evaluate(() => window.__msgs.filter((m) => m.type === 'cms-select').pop().unit);
  ok(sel.clone === 'cp1' && sel.key === '@cp1', 'edit: select a copy by key');

  // subtree map for copying edits to a new duplicate
  await pg.evaluate(() => { window.post({ type: 'cms-subtree-map', src: 'body>main:nth-of-type(1)>section:nth-of-type(2)', id: 'cp1', reqId: 7 }); });
  await pg.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-subtree-map-result'));
  const map = await pg.evaluate(() => window.__msgs.find((m) => m.type === 'cms-subtree-map-result'));
  ok(map.reqId === 7 && map.pairs.some((p) => p[0] === B + '>h2:nth-of-type(1)' && p[1] === '@cp1>h2:nth-of-type(1)') && map.pairs[0][1] === '@cp1', 'edit: subtree map pairs original and copy elements');

  // adding elements in edit mode
  await pg.evaluate(() => { window.__msgs = []; });
  const addEdits = (await (await fetch('http://localhost:9001/cms/edits.json')).json());
  await pg.evaluate((e) => { document.getElementById('f').src = 'http://localhost:9001/add.html?cms-edit=1'; window.__msgs = []; }, null);
  await pg.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-ready'));
  await pg.evaluate((e) => window.post({ type: 'cms-edits', edits: e, assets: {} }), addEdits);
  await pg.waitForTimeout(500);
  await pg.evaluate(() => { window.__msgs = []; });
  await fr.locator('[data-cms-add="video"]').first().click({ position: { x: 40, y: 40 } });
  await pg.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-select' && m.unit));
  sel = await pg.evaluate(() => window.__msgs.filter((m) => m.type === 'cms-select').pop().unit);
  ok(sel.added === 'video' && /^youtube:/.test(sel.vid) && sel.clone === 'v1', 'edit: an added video is selectable (iframes do not swallow clicks): ' + sel.vid);
  await pg.evaluate(() => { window.__msgs = []; window.post({ type: 'cms-edits', edits: { v: 1, global: {}, pages: {} }, assets: {} }); });
  await pg.waitForTimeout(400);
  ok(await fr.locator('[data-cms-add]').count() === 0, 'edit: clearing the layout removes every added element');
  await pg.evaluate(() => { document.getElementById('f').src = 'http://localhost:9001/page2.html?cms-edit=1'; window.__msgs = []; });
  await pg.waitForFunction(() => window.__msgs.some((m) => m.type === 'cms-ready'));

  // removing the layout restores the original page live
  await pg.evaluate(() => window.post({ type: 'cms-edits', edits: { v: 1, global: {}, pages: {} }, assets: {} }));
  await pg.waitForTimeout(400);
  ok(JSON.stringify(await texts('main h2', fr)) === JSON.stringify(['סקשן א', 'סקשן ב', 'סקשן ג', 'דינמי']), 'edit: clearing the layout restores the original order and removes copies: ' + JSON.stringify(await texts('main h2', fr)));
  ok(await fr.locator('[data-cms-id]').count() === 0 && await fr.locator('[data-cms-hidden]').count() === 0, 'edit: no leftovers after revert');
} catch (e) { console.log('FAIL exception', e.message.split('\n')[0]); process.exitCode = 1; }
console.log(errs.length ? 'JS ERRORS: ' + errs.join('|') : 'no JS errors');
await browser.close(); s1.close(); s2.close();
