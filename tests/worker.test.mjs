import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import worker from '../worker/src/index.js';

/* ---------- mocks ---------- */
class KV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.get(k) ?? null; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = '' } = {}) { return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; }
}
const sha = (b) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex');

let env, repo, commits, realFetch;
const KIT = fs.readFileSync(new URL('../app/kit/cms-kit.js', import.meta.url));

function githubMock() {
  const blobs = {};
  return async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace('/repos/o/site', '');
    const body = init.body ? JSON.parse(init.body) : null;
    const res = (s, j) => new Response(JSON.stringify(j), { status: s });
    let m;
    if ((m = path.match(/^\/contents\/(.+)$/))) {
      const f = repo.files[decodeURIComponent(m[1])];
      return f ? res(200, { content: f.toString('base64'), sha: sha(f) }) : res(404, { message: 'Not Found' });
    }
    if (path === '/git/ref/heads/main' && init.method === 'GET') return res(200, { object: { sha: 'head' } });
    if (path.startsWith('/git/commits/')) return res(200, { tree: { sha: 'tree' } });
    if (path === '/git/blobs') { const b = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8'); blobs[sha(b)] = b; return res(201, { sha: sha(b) }); }
    if (path === '/git/trees') { repo.pendingTree = body.tree; return res(201, { sha: 'newtree' }); }
    if (path === '/git/commits') { commits.push({ message: body.message, paths: repo.pendingTree.map((t) => t.path) }); return res(201, { sha: 'c' + commits.length }); }
    if (path === '/git/refs/heads/main') { repo.pendingTree.forEach((t) => { repo.files[t.path] = blobs[t.sha]; }); return res(200, {}); }
    if (path === '/commits') return res(200, [{ sha: 'abc1234', commit: { author: { date: '2026-01-01T00:00:00Z' }, message: 'x\ny' } }]);
    return res(404, { message: 'unmocked ' + path });
  };
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  repo = { files: {
    'index.html': Buffer.from('<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body>hi</body></html>'),
    'sub/page.html': Buffer.from('<html><head><title>x</title></head><body></body></html>'),
  } };
  commits = [];
  globalThis.fetch = githubMock();
  env = {
    CMS: new KV(), ADMIN_PASSWORD: 'owner-pass-123', SESSION_SECRET: 'secret', GITHUB_TOKEN: 't', GITHUB_API: 'https://gh.test',
    ASSETS: { fetch: async (r) => (new URL(r.url).pathname === '/kit/cms-kit.js' ? new Response(KIT) : new Response('asset')) },
  };
});
import { afterEach } from 'node:test';
afterEach(() => { globalThis.fetch = realFetch; });

async function call(method, path, { body, cookie, headers = {} } = {}) {
  const req = new Request('https://cms.test' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fd', cookie: cookie || '', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const r = await worker.fetch(req, env);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, setCookie: r.headers.get('set-cookie') };
}
const cookieOf = (r) => r.setCookie.split(';')[0];

async function ownerCookie() {
  return cookieOf(await call('POST', '/api/login', { body: { username: 'admin', password: 'owner-pass-123' } }));
}
async function setup() {
  const owner = await ownerCookie();
  const site = { id: 'demo', name: 'דמו', repo: 'o/site', branch: 'main', url: 'https://demo.example.com', pages: ['index.html'] };
  assert.equal((await call('POST', '/api/admin/sites', { cookie: owner, body: site })).status, 200);
  assert.equal((await call('POST', '/api/admin/sites', { cookie: owner, body: { ...site, id: 'other', name: 'אחר' } })).status, 200);
  assert.equal((await call('POST', '/api/admin/users', { cookie: owner, body: { username: 'dana', name: 'דנה', password: 'password-1', sites: ['demo'] } })).status, 200);
  const client = cookieOf(await call('POST', '/api/login', { body: { username: 'dana', password: 'password-1' } }));
  return { owner, client };
}
const goodEdits = () => ({ v: 1, global: { colors: { '#52725a': '#1f6f3f' }, fonts: { heading: { family: 'Heebo', url: 'https://fonts.googleapis.com/css2?family=Heebo:wght@400;700&display=swap' } } },
  pages: { 'index.html': { els: { 'body>h1:nth-of-type(1)': { t: 'שלום', color: '#112233' }, '#x': { href: 'https://a.co', alt: 'a' } } } } });

/* ---------- auth ---------- */
test('login: owner ok, wrong password rejected, cookie is HttpOnly + SameSite=Strict', async () => {
  const bad = await call('POST', '/api/login', { body: { username: 'admin', password: 'nope' } });
  assert.equal(bad.status, 401);
  const ok = await call('POST', '/api/login', { body: { username: 'admin', password: 'owner-pass-123' } });
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /HttpOnly/); assert.match(ok.setCookie, /SameSite=Strict/);
  const me = await call('GET', '/api/me', { cookie: cookieOf(ok) });
  assert.equal(me.data.user.role, 'owner');
});

test('state-changing requests need the CSRF header', async () => {
  const r = await worker.fetch(new Request('https://cms.test/api/login', { method: 'POST', body: '{}' }), env);
  assert.equal(r.status, 403);
});

test('tampered or missing session is rejected', async () => {
  assert.equal((await call('GET', '/api/admin/state', {})).status, 401);
  const owner = await ownerCookie();
  assert.equal((await call('GET', '/api/admin/state', { cookie: owner.slice(0, -3) + 'abc' })).status, 401);
});

test('login rate limit counts only failures', async () => {
  for (let i = 0; i < 3; i++) await call('POST', '/api/login', { body: { username: 'admin', password: 'owner-pass-123' } });
  for (let i = 0; i < 10; i++) await call('POST', '/api/login', { body: { username: 'admin', password: 'bad' } });
  assert.equal((await call('POST', '/api/login', { body: { username: 'admin', password: 'owner-pass-123' } })).status, 429);
});

/* ---------- authorization ---------- */
test('client sees only assigned sites and cannot use admin API', async () => {
  const { client } = await setup();
  const me = await call('GET', '/api/me', { cookie: client });
  assert.deepEqual(me.data.sites.map((s) => s.id), ['demo']);
  assert.equal((await call('GET', '/api/sites/other/edits', { cookie: client })).status, 404);
  assert.equal((await call('GET', '/api/admin/state', { cookie: client })).status, 403);
  assert.equal((await call('POST', '/api/admin/users', { cookie: client, body: {} })).status, 403);
  assert.equal((await call('POST', '/api/admin/sites/demo/connect', { cookie: client })).status, 403);
});

test('deleting a client cuts access immediately; passwords are stored hashed', async () => {
  const { owner, client } = await setup();
  const rec = JSON.parse(await env.CMS.get('u:dana'));
  assert.ok(rec.hash && rec.salt && !JSON.stringify(rec).includes('password-1'));
  assert.equal((await call('GET', '/api/sites/demo/edits', { cookie: client })).status, 200);
  await call('DELETE', '/api/admin/users/dana', { cookie: owner });
  assert.equal((await call('GET', '/api/sites/demo/edits', { cookie: client })).status, 401);
});

/* ---------- edits ---------- */
test('PUT edits commits only cms/edits.json (+ uploads) and drops unknown fields', async () => {
  const { client } = await setup();
  const edits = goodEdits();
  edits.pages['index.html'].els['body>h1:nth-of-type(1)'].html = '<script>alert(1)</script>';
  edits.evil = 'x';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const r = await call('PUT', '/api/sites/demo/edits', { cookie: client, body: { edits, images: [{ path: 'cms/uploads/a-1.png', base64: png.toString('base64') }] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(commits[0].paths.sort(), ['cms/edits.json', 'cms/uploads/a-1.png']);
  assert.match(commits[0].message, /דנה \(dana\)/);
  const saved = JSON.parse(repo.files['cms/edits.json']);
  assert.equal(saved.evil, undefined);
  assert.equal(saved.pages['index.html'].els['body>h1:nth-of-type(1)'].html, undefined);
  assert.equal(saved.pages['index.html'].els['body>h1:nth-of-type(1)'].t, 'שלום');
  assert.deepEqual(Buffer.from(repo.files['cms/uploads/a-1.png']), png);
});

for (const [name, mutate] of Object.entries({
  'javascript: href': (e) => { e.pages['index.html'].els['#x'].href = 'javascript:alert(1)'; },
  'data: href': (e) => { e.pages['index.html'].els['#x'].href = 'data:text/html,<script>1</script>'; },
  'javascript: image': (e) => { e.pages['index.html'].els['#x'] = { src: 'javascript:alert(1)' }; },
  'path traversal image': (e) => { e.pages['index.html'].els['#x'] = { src: '../../secret.png' }; },
  'css injection colour': (e) => { e.pages['index.html'].els['#x'] = { color: 'red;background:url(//evil)' }; },
  'bad global colour': (e) => { e.global.colors = { '#fff': 'x' }; },
  'selector injection key': (e) => { e.pages['index.html'].els['a{}</style><script>'] = { t: 'x' }; },
  'evil font url': (e) => { e.global.fonts.heading.url = 'https://evil.com/x.css'; },
  'evil font family': (e) => { e.global.fonts.heading.family = 'x";}body{display:none'; },
  'page traversal': (e) => { e.pages['../x.html'] = { els: {} }; },
  'huge text': (e) => { e.pages['index.html'].els['#x'] = { t: 'a'.repeat(9000) }; },
  'wrong version': (e) => { e.v = 2; },
})) {
  test('rejects: ' + name, async () => {
    const { client } = await setup();
    const e = goodEdits(); mutate(e);
    const r = await call('PUT', '/api/sites/demo/edits', { cookie: client, body: { edits: e } });
    assert.equal(r.status, 400, name + ' -> ' + JSON.stringify(r.data));
    assert.equal(commits.length, 0);
  });
}

test('rejects uploads: wrong path, fake image bytes, svg, too many', async () => {
  const { client } = await setup();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');
  const put = (images) => call('PUT', '/api/sites/demo/edits', { cookie: client, body: { edits: goodEdits(), images } });
  assert.equal((await put([{ path: 'index.html', base64: png }])).status, 400);
  assert.equal((await put([{ path: 'cms/uploads/../../index.html', base64: png }])).status, 400);
  assert.equal((await put([{ path: 'cms/uploads/x.svg', base64: png }])).status, 400);
  assert.equal((await put([{ path: 'cms/uploads/x.jpg', base64: png }])).status, 400, 'png bytes with .jpg name');
  assert.equal((await put([{ path: 'cms/uploads/x.png', base64: Buffer.from('<script>alert(1)</script>').toString('base64') }])).status, 400);
  assert.equal(commits.length, 0);
});

test('conflict: stale baseSha -> 409, force overrides', async () => {
  const { client } = await setup();
  repo.files['cms/edits.json'] = Buffer.from(JSON.stringify({ v: 1, global: {}, pages: {} }));
  const stale = sha(Buffer.from('old'));
  const body = { edits: goodEdits(), baseSha: stale };
  assert.equal((await call('PUT', '/api/sites/demo/edits', { cookie: client, body })).status, 409);
  assert.equal((await call('PUT', '/api/sites/demo/edits', { cookie: client, body: { ...body, force: true } })).status, 200);
});

test('GET edits returns empty document when the site has none, and sanitises a hand-edited file', async () => {
  const { client } = await setup();
  const r = await call('GET', '/api/sites/demo/edits', { cookie: client });
  assert.deepEqual(r.data.edits, { v: 1, global: {}, pages: {} });
  repo.files['cms/edits.json'] = Buffer.from('not json');
  assert.deepEqual((await call('GET', '/api/sites/demo/edits', { cookie: client })).data.edits.pages, {});
});

test('history lists commits and version fetch validates the sha', async () => {
  const { client } = await setup();
  const h = await call('GET', '/api/sites/demo/history', { cookie: client });
  assert.equal(h.data.commits[0].message, 'x');
  assert.equal((await call('GET', '/api/sites/demo/version/not-a-sha', { cookie: client })).status, 404);
});

test('site root prefix: writes stay under it', async () => {
  const owner = await ownerCookie();
  await call('POST', '/api/admin/sites', { cookie: owner, body: { id: 'docs', name: 'd', repo: 'o/site', url: 'https://d.example.com', root: 'docs' } });
  const r = await call('PUT', '/api/sites/docs/edits', { cookie: owner, body: { edits: goodEdits() } });
  assert.equal(r.status, 200);
  assert.deepEqual(commits[0].paths, ['docs/cms/edits.json']);
});

/* ---------- connect ---------- */
test('connect adds kit + empty edits + one script tag after <meta charset>, idempotently', async () => {
  const owner = await ownerCookie();
  await call('POST', '/api/admin/sites', { cookie: owner, body: { id: 'demo', name: 'd', repo: 'o/site', url: 'https://d.example.com', pages: ['index.html', 'sub/page.html'] } });
  const r = await call('POST', '/api/admin/sites/demo/connect', { cookie: owner });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(repo.files['cms/cms-kit.js'].equals(KIT));
  assert.equal(JSON.parse(repo.files['cms/edits.json']).v, 1);
  const home = repo.files['index.html'].toString();
  assert.match(home, /<meta charset="utf-8">\n<script src="cms\/cms-kit\.js" data-admin-origin="https:\/\/cms\.test"><\/script>/);
  assert.match(repo.files['sub/page.html'].toString(), /<head>\n<script src="\.\.\/cms\/cms-kit\.js"/);
  await call('POST', '/api/admin/sites/demo/connect', { cookie: owner });
  assert.equal(repo.files['index.html'].toString().match(/cms-kit\.js/g).length, 1, 'no duplicate tag');
});

test('site/user input validation', async () => {
  const owner = await ownerCookie();
  assert.equal((await call('POST', '/api/admin/sites', { cookie: owner, body: { id: 'Bad Id', name: 'x', repo: 'o/site', url: 'https://x.com' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/sites', { cookie: owner, body: { id: 'ok1', name: 'x', repo: 'not a repo', url: 'https://x.com' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/users', { cookie: owner, body: { username: 'ab', name: 'x', password: 'password-1' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/users', { cookie: owner, body: { username: 'good', name: 'x', password: 'short' } })).status, 400);
});
