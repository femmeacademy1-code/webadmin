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

let dns, pages, pagesCalls, cf, cfCalls, zones, records, rid;
function githubMock() {
  const blobs = {};
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.host === 'doh.test') {
      const t = { A: 1, AAAA: 28, CNAME: 5 }[u.searchParams.get('type')];
      const list = (dns[u.searchParams.get('name') + '/' + u.searchParams.get('type')] || []).map((data) => ({ type: t, data }));
      return new Response(JSON.stringify({ Answer: list }));
    }
    if (u.host === 'cf.test') {
      if (u.pathname === '/zones') { const n = u.searchParams.get('name'); return new Response(JSON.stringify({ success: true, result: zones[n] ? [{ id: 'z1', name: n }] : [] })); }
      let zm = u.pathname.match(/^\/zones\/z1\/dns_records(?:\/(.+))?$/);
      if (zm) {
        if (init.method === 'GET') { const n = u.searchParams.get('name'); return new Response(JSON.stringify({ success: true, result: records.filter((r) => r.name === n) })); }
        if (init.method === 'DELETE') { records = records.filter((r) => r.id !== zm[1]); return new Response(JSON.stringify({ success: true, result: {} })); }
        const b = JSON.parse(init.body); records.push({ id: 'r' + (++rid), ...b }); return new Response(JSON.stringify({ success: true, result: {} }));
      }
      const m = u.pathname.match(/\/pages\/projects(?:\/([^/]+))?(?:\/domains(?:\/(.+))?)?$/);
      const ok = (r) => new Response(JSON.stringify({ success: true, result: r }));
      cfCalls.push(init.method + ' ' + u.pathname.replace(/.*projects/, ''));
      if (!m[1] && init.method === 'POST') { cf.project = { name: JSON.parse(init.body).name, body: JSON.parse(init.body), latest_deployment: null }; return ok(cf.project); }
      if (!cf.project) return new Response(JSON.stringify({ success: false, errors: [{ message: 'not found' }] }), { status: 404 });
      if (u.pathname.endsWith('/domains') && init.method === 'GET') return ok(cf.domains);
      if (u.pathname.endsWith('/domains') && init.method === 'POST') { const d = { name: JSON.parse(init.body).name, status: 'pending' }; cf.domains.push(d); return ok(d); }
      if (m[2]) { cf.domains = cf.domains.filter((x) => x.name !== m[2]); return ok(null); }
      if (init.method === 'DELETE') { cf.project = null; return ok(null); }
      return ok(cf.project);
    }
    if (u.pathname === '/repos/o/site/pages') {
      if (pages === 'forbidden') return new Response('{"message":"Resource not accessible by personal access token"}', { status: 403 });
      if (!pages) return new Response('{"message":"Not Found"}', { status: 404 });
      if (init.method === 'PUT') { const b = JSON.parse(init.body); pagesCalls.push(b); Object.assign(pages, b); return new Response(null, { status: 204 }); }
      return new Response(JSON.stringify(pages));
    }
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
    if (path === '/git/refs/heads/main') { repo.pendingTree.forEach((t) => { if (t.sha === null) delete repo.files[t.path]; else repo.files[t.path] = blobs[t.sha]; }); return res(200, {}); }
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
  zones = { 'client.com': 1 }; records = []; rid = 0;
  cf = { project: null, domains: [] }; cfCalls = [];
  dns = {}; pagesCalls = []; pages = { cname: null, https_enforced: false, https_certificate: null };
  globalThis.fetch = githubMock();
  env = {
    CMS: new KV(), ADMIN_PASSWORD: 'owner-pass-123', SESSION_SECRET: 'secret', GITHUB_TOKEN: 't', GITHUB_API: 'https://gh.test', DOH_URL: 'https://doh.test/q', CF_API: 'https://cf.test', CF_API_TOKEN: 'cft', CF_ACCOUNT_ID: 'acc',
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
  assert.match(home, /<meta charset="utf-8">\n<script src="cms\/cms-kit\.js\?v=[0-9a-f]{10}" data-admin-origin="https:\/\/cms\.test"><\/script>/);
  assert.match(repo.files['sub/page.html'].toString(), /<head>\n<script src="\.\.\/cms\/cms-kit\.js\?v=[0-9a-f]{10}"/);
  await call('POST', '/api/admin/sites/demo/connect', { cookie: owner });
  assert.equal(repo.files['index.html'].toString().match(/cms-kit\.js/g).length, 1, 'no duplicate tag');
  // a tag written by an older connect (no ?v=) is upgraded in place, and the version changes when the kit changes
  const old = repo.files['index.html'].toString().replace(/\?v=[0-9a-f]{10}/, '');
  repo.files['index.html'] = Buffer.from(old);
  await call('POST', '/api/admin/sites/demo/connect', { cookie: owner });
  assert.match(repo.files['index.html'].toString(), /cms-kit\.js\?v=[0-9a-f]{10}"/);
  assert.equal(repo.files['index.html'].toString().match(/cms-kit\.js/g).length, 1);
});

test('site/user input validation', async () => {
  const owner = await ownerCookie();
  assert.equal((await call('POST', '/api/admin/sites', { cookie: owner, body: { id: 'Bad Id', name: 'x', repo: 'o/site', url: 'https://x.com' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/sites', { cookie: owner, body: { id: 'ok1', name: 'x', repo: 'not a repo', url: 'https://x.com' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/users', { cookie: owner, body: { username: 'ab', name: 'x', password: 'password-1' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/users', { cookie: owner, body: { username: 'good', name: 'x', password: 'short' } })).status, 400);
});

/* ---------- text formatting + structure operations ---------- */
const withPage = (page) => ({ v: 1, global: {}, pages: { 'index.html': page } });
const putEditsBody = (client, edits) => call('PUT', '/api/sites/demo/edits', { cookie: client, body: { edits } });

test('accepts text formatting and keeps only known formatting fields', async () => {
  const { client } = await setup();
  const r = await putEditsBody(client, withPage({ els: { '#t': { fs: 32, b: true, i: false, u: true, st: false, al: 'center', evil: 'x' } } }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const saved = JSON.parse(repo.files['cms/edits.json']).pages['index.html'].els['#t'];
  assert.deepEqual(saved, { fs: 32, b: true, i: false, u: true, st: false, al: 'center' });
});

for (const [name, spec] of Object.entries({
  'font size too small': { fs: 3 }, 'font size too large': { fs: 500 }, 'font size not an integer': { fs: 12.5 },
  'font size as string': { fs: '20px' }, 'bold as string': { b: 'yes' }, 'underline as number': { u: 1 },
  'align with css injection': { al: 'center;background:url(//evil)' }, 'unknown align': { al: 'start' },
})) {
  test('rejects formatting: ' + name, async () => {
    const { client } = await setup();
    assert.equal((await putEditsBody(client, withPage({ els: { '#t': spec } }))).status, 400);
    assert.equal(commits.length, 0);
  });
}

test('accepts duplicate / move / hide operations and edits inside a copy', async () => {
  const { client } = await setup();
  const page = {
    layout: [
      { op: 'dup', src: 'body>main:nth-of-type(1)>section:nth-of-type(2)', id: 'cp1' },
      { op: 'dup', src: '@cp1', id: 'cp2' },
      { op: 'move', key: '#a', dir: 1 },
      { op: 'move', key: '@cp1', dir: -1 },
      { op: 'hide', key: 'body>main:nth-of-type(1)>section:nth-of-type(3)' },
      { op: 'delete-everything', key: '#a', extra: 1 },
    ],
    els: { '@cp1>h2:nth-of-type(1)': { t: 'עותק' } },
  };
  assert.equal((await putEditsBody(client, withPage(page))).status, 400, 'unknown op rejected');
  page.layout.pop();
  const r = await putEditsBody(client, withPage(page));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const saved = JSON.parse(repo.files['cms/edits.json']).pages['index.html'];
  assert.equal(saved.layout.length, 5);
  assert.deepEqual(saved.layout[0], { op: 'dup', src: 'body>main:nth-of-type(1)>section:nth-of-type(2)', id: 'cp1' });
  assert.equal(saved.els['@cp1>h2:nth-of-type(1)'].t, 'עותק');
});

for (const [name, op] of Object.entries({
  'duplicate id too short': { op: 'dup', src: '#a', id: 'x' },
  'duplicate id with symbols': { op: 'dup', src: '#a', id: 'a"b<' },
  'duplicate id uppercase': { op: 'dup', src: '#a', id: 'ABC1' },
  'move direction 2': { op: 'move', key: '#a', dir: 2 },
  'move direction string': { op: 'move', key: '#a', dir: '1' },
  'hide with selector injection': { op: 'hide', key: 'a{}</style><script>' },
  'move without key': { op: 'move', dir: 1 },
  'op not an object': 'dup',
  'remove op (not allowed)': { op: 'remove', key: '#a' },
  'html op (not allowed)': { op: 'html', key: '#a', value: '<script>1</script>' },
})) {
  test('rejects structure op: ' + name, async () => {
    const { client } = await setup();
    assert.equal((await putEditsBody(client, withPage({ layout: [op] }))).status, 400);
    assert.equal(commits.length, 0);
  });
}

test('rejects duplicate ids used twice and too many operations', async () => {
  const { client } = await setup();
  assert.equal((await putEditsBody(client, withPage({ layout: [{ op: 'dup', src: '#a', id: 'cp1' }, { op: 'dup', src: '#b', id: 'cp1' }] }))).status, 400);
  const many = Array.from({ length: 301 }, () => ({ op: 'move', key: '#a', dir: 1 }));
  assert.equal((await putEditsBody(client, withPage({ layout: many }))).status, 400);
});

test('structure ops never widen what can be written: still only edits.json + uploads', async () => {
  const { client } = await setup();
  await putEditsBody(client, withPage({ layout: [{ op: 'dup', src: '#a', id: 'cp1' }, { op: 'hide', key: '#b' }] }));
  assert.deepEqual(commits[0].paths, ['cms/edits.json']);
});

/* ---------- adding elements and uploading documents ---------- */
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const PDF = b64('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
const ZIP = b64([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);
const OLE = b64([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
const putWith = (client, edits, images) => call('PUT', '/api/sites/demo/edits', { cookie: client, body: { edits, images } });
const addOp = (o) => withPage({ layout: [{ op: 'add', after: '#a', id: 'n1', type: 'button', ...o }] });

test('accepts every element type that can be added, and keeps the video parameters', async () => {
  const { client } = await setup();
  const types = ['text', 'heading', 'image', 'button', 'file', 'divider'];
  const layout = types.map((type, i) => ({ op: 'add', after: '#a', id: 'e' + i + 'xyz', type }));
  layout.push({ op: 'add', after: '@e0xyz', id: 'yt1', type: 'video', p: { provider: 'youtube', vid: 'dQw4w9WgXcQ' } });
  layout.push({ op: 'add', after: '#a', id: 'vm1', type: 'video', p: { provider: 'vimeo', vid: '123456789', evil: '<script>' } });
  const r = await putWith(client, withPage({ layout, els: { '@e3xyz': { t: 'לחצו', href: 'tel:0501234567' } } }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const saved = JSON.parse(repo.files['cms/edits.json']).pages['index.html'].layout;
  assert.equal(saved.length, 8);
  assert.deepEqual(saved[7].p, { provider: 'vimeo', vid: '123456789' }, 'unknown video parameters dropped');
  assert.equal(saved[0].type, 'text');
});

for (const [name, o] of Object.entries({
  'unknown type (script)': { type: 'script' }, 'unknown type (html)': { type: 'html' }, 'type missing': { type: undefined },
  'video without parameters': { type: 'video' },
  'video from another site': { type: 'video', p: { provider: 'evil', vid: 'abcdefghij' } },
  'youtube id with injection': { type: 'video', p: { provider: 'youtube', vid: 'a"onload=alert(1)' } },
  'youtube id as url': { type: 'video', p: { provider: 'youtube', vid: 'https://youtu.be/abc' } },
  'vimeo id not numeric': { type: 'video', p: { provider: 'vimeo', vid: '12ab34' } },
  'parameters on a button': { type: 'button', p: { href: 'javascript:alert(1)' } },
  'id too short': { id: 'a' }, 'id with symbols': { id: 'x"y>' },
  'after key with injection': { after: 'a{}</style>' },
})) {
  test('rejects add op: ' + name, async () => {
    const { client } = await setup();
    assert.equal((await putWith(client, addOp(o))).status, 400);
    assert.equal(commits.length, 0);
  });
}

test('accepts documents (pdf, zip-based office files, legacy office files) and commits them under cms/uploads', async () => {
  const { client } = await setup();
  const images = [
    { path: 'cms/uploads/brochure.pdf', base64: PDF }, { path: 'cms/uploads/list.xlsx', base64: ZIP },
    { path: 'cms/uploads/old.doc', base64: OLE }, { path: 'cms/uploads/bundle.zip', base64: ZIP },
  ];
  const r = await putWith(client, withPage({ els: { '@f': { href: 'cms/uploads/brochure.pdf' } } }), images);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(commits[0].paths.sort(), ['cms/edits.json', 'cms/uploads/bundle.zip', 'cms/uploads/brochure.pdf', 'cms/uploads/list.xlsx', 'cms/uploads/old.doc'].sort());
  assert.equal(Buffer.from(repo.files['cms/uploads/brochure.pdf']).toString().slice(0, 5), '%PDF-');
});

for (const [name, im] of Object.entries({
  'html page renamed to .pdf': { path: 'cms/uploads/a.pdf', base64: b64('<html><script>alert(1)</script></html>') },
  'script renamed to .docx': { path: 'cms/uploads/a.docx', base64: b64('alert(1);') },
  'pdf bytes with a .zip name': { path: 'cms/uploads/a.zip', base64: PDF },
  'zip bytes with a .pdf name': { path: 'cms/uploads/a.pdf', base64: ZIP },
  'html file': { path: 'cms/uploads/a.html', base64: b64('<html>') },
  'svg file': { path: 'cms/uploads/a.svg', base64: b64('<svg onload=alert(1)>') },
  'javascript file': { path: 'cms/uploads/a.js', base64: b64('alert(1)') },
  'executable': { path: 'cms/uploads/a.exe', base64: b64('MZ') },
  'double extension': { path: 'cms/uploads/a.pdf.html', base64: PDF },
  'path traversal': { path: 'cms/uploads/../../index.html', base64: PDF },
  'outside uploads': { path: 'docs/a.pdf', base64: PDF },
  'not base64': { path: 'cms/uploads/a.pdf', base64: '%PDF-1.4 <script>' },
  'too large (11MB)': { path: 'cms/uploads/a.pdf', base64: PDF + 'A'.repeat(Math.ceil(11_000_000 * 1.4)) },
})) {
  test('rejects upload: ' + name, async () => {
    const { client } = await setup();
    const r = await putWith(client, withPage({}), [im]);
    assert.equal(r.status, 400, name + ' -> ' + JSON.stringify(r.data));
    assert.equal(commits.length, 0);
  });
}

test('too many uploads in one go is rejected', async () => {
  const { client } = await setup();
  const images = Array.from({ length: 13 }, (_, i) => ({ path: `cms/uploads/f${i}.pdf`, base64: PDF }));
  assert.equal((await putWith(client, withPage({}), images)).status, 400);
});

/* ---------- custom domain ---------- */
import { normalizeDomain, isApex } from '../worker/src/domain.js';
const IPS = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];

test('normalizeDomain cleans input and rejects junk', () => {
  assert.equal(normalizeDomain(' HTTPS://WWW.Client.co.il/path?x '), 'www.client.co.il');
  assert.equal(normalizeDomain('client.com.'), 'client.com');
  for (const bad of ['', 'nodot', 'a b.com', 'x.github.io', 'foo.workers.dev', '1.2.3.4', 'a..com', '-a.com', 'localhost']) assert.throws(() => normalizeDomain(bad), bad);
  assert.ok(isApex('client.co.il') && !isApex('www.client.co.il'));
  assert.ok(isApex('client.com') && !isApex('www.client.com'));
});

test('domain: records shown, DNS not ready -> nothing changes in GitHub', async () => {
  const { owner, client } = await setup();
  const r = await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'Client.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.records.filter((x) => x.type === 'A').length, 4);
  assert.equal(r.data.domain.status, 'dns');
  const c = await call('POST', '/api/admin/sites/demo/domain/check', { cookie: owner });
  assert.equal(c.data.status, 'dns'); assert.equal(c.data.dns.ok, false);
  assert.equal((await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'client.com' } })).data.domain.prevUrl, 'https://demo.example.com/');
  assert.deepEqual(pagesCalls, []);
  assert.equal((await call('POST', '/api/admin/sites/demo/domain', { cookie: client, body: { domain: 'x.com' } })).status, 403);
});

test('domain: apex goes live after DNS, certificate and HTTPS enforcement', async () => {
  const { owner } = await setup();
  await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'client.com' } });
  dns['client.com/A'] = IPS;
  let c = await call('POST', '/api/admin/sites/demo/domain/check', { cookie: owner });
  assert.equal(c.data.status, 'cert');
  assert.deepEqual(pagesCalls, [{ cname: 'client.com' }]);
  pages.https_certificate = { state: 'approved' };
  c = await call('POST', '/api/admin/sites/demo/domain/check', { cookie: owner });
  assert.equal(c.data.status, 'live');
  assert.equal((await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'client.com' } })).data.domain.status, 'live');   // reopening the panel keeps progress
  assert.deepEqual(pagesCalls[1], { https_enforced: true });
  const st = (await call('GET', '/api/admin/state', { cookie: owner })).data.sites.find((x) => x.id === 'demo');
  assert.equal(st.url, 'https://client.com/');
  // removing restores the old URL and clears the cname
  await call('DELETE', '/api/admin/sites/demo/domain', { cookie: owner });
  const st2 = (await call('GET', '/api/admin/state', { cookie: owner })).data.sites.find((x) => x.id === 'demo');
  assert.equal(st2.url, 'https://demo.example.com/'); assert.equal(st2.domain, undefined);
  assert.deepEqual(pagesCalls.at(-1), { cname: null });
});

test('domain: "issued" is not live yet; HTTPS must really be enforced', async () => {
  const { owner } = await setup();
  await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'client.com' } });
  dns['client.com/A'] = IPS;
  pages.https_certificate = { state: 'issued' };
  let c = await call('POST', '/api/admin/sites/demo/domain/check', { cookie: owner });
  assert.equal(c.data.status, 'cert');
  assert.ok(!pagesCalls.some((x) => x.https_enforced));
  pages.https_certificate = { state: 'approved' };
  c = await call('POST', '/api/admin/sites/demo/domain/check', { cookie: owner });
  assert.equal(c.data.status, 'live');
  assert.equal(pages.https_enforced, true);
});

test('domain: "issued" is not live yet; HTTPS must really be enforced', async () => {
  const { owner } = await setup();
  await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'client.com' } });
  dns['client.com/A'] = IPS;
  pages.https_certificate = { state: 'issued' };
  let c = await call('POST', '/api/admin/sites/demo/domain/check', { cookie: owner });
  assert.equal(c.data.status, 'cert');
  assert.ok(!pagesCalls.some((x) => x.https_enforced));
  pages.https_certificate = { state: 'approved' };
  c = await call('POST', '/api/admin/sites/demo/domain/check', { cookie: owner });
  assert.equal(c.data.status, 'live');
  assert.equal(pages.https_enforced, true);
});

test('domain: subdomain needs a CNAME to <owner>.github.io; foreign A records are explained', async () => {
  const { owner } = await setup();
  await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'www.client.com' } });
  dns['www.client.com/CNAME'] = ['other.example.net.'];
  assert.equal((await call('POST', '/api/admin/sites/demo/domain/check', { cookie: owner })).data.dns.ok, false);
  dns['www.client.com/CNAME'] = ['O.github.io.'];
  assert.equal((await call('POST', '/api/admin/sites/demo/domain/check', { cookie: owner })).data.status, 'cert');
  await call('POST', '/api/admin/sites/other/domain', { cookie: owner, body: { domain: 'apex.com' } });
  dns['apex.com/A'] = [...IPS, '104.21.1.1'];
  const bad = await call('POST', '/api/admin/sites/other/domain/check', { cookie: owner });
  assert.equal(bad.data.dns.ok, false); assert.match(bad.data.dns.hint, /104\.21\.1\.1/);
});

test('domain: unique per site; Pages not enabled gives a clear error', async () => {
  const { owner } = await setup();
  await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'client.com' } });
  assert.equal((await call('POST', '/api/admin/sites/other/domain', { cookie: owner, body: { domain: 'client.com' } })).status, 409);
  dns['client.com/A'] = IPS; pages = null;
  const r = await call('POST', '/api/admin/sites/demo/domain/check', { cookie: owner });
  assert.equal(r.status, 422);
});

/* ---------- move to Cloudflare Pages (paid hosting) ---------- */
test('hosting: needs a domain first; client cannot use it', async () => {
  const { owner, client } = await setup();
  assert.equal((await call('POST', '/api/admin/sites/demo/host', { cookie: owner })).status, 400);
  assert.equal((await call('POST', '/api/admin/sites/demo/host', { cookie: client })).status, 403);
});

test('hosting: build -> domain -> DNS -> live, GitHub domain released only at the end; and back', async () => {
  const { owner } = await setup();
  await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'www.client.com' } });
  let r = await call('POST', '/api/admin/sites/demo/host', { cookie: owner });
  assert.equal(r.data.status, 'building');
  assert.equal(cf.project.body.source.config.repo_name, 'site');
  assert.equal(cf.domains.length, 0);
  cf.project.latest_deployment = { latest_stage: { name: 'deploy', status: 'success' } };
  r = await call('POST', '/api/admin/sites/demo/host/check', { cookie: owner });
  assert.equal(r.data.status, 'dns');
  assert.equal(r.data.records[0].value, 'fd-demo.pages.dev');
  assert.deepEqual(pagesCalls, []);                      // GitHub keeps serving until Cloudflare is active
  cf.domains[0].status = 'active';
  r = await call('POST', '/api/admin/sites/demo/host/check', { cookie: owner });
  assert.equal(r.data.status, 'live');
  assert.deepEqual(pagesCalls, [{ cname: null }]);
  assert.equal((await call('GET', '/api/admin/state', { cookie: owner })).data.sites.find((x) => x.id === 'demo').hosting.status, 'live');
  const back = await call('DELETE', '/api/admin/sites/demo/host', { cookie: owner });
  assert.equal(back.status, 200);
  assert.deepEqual(pagesCalls.at(-1), { cname: 'www.client.com' });
  assert.equal(cf.project, null);
  assert.equal((await call('GET', '/api/admin/state', { cookie: owner })).data.sites.find((x) => x.id === 'demo').hosting, undefined);
});

test('hosting: failed first build is reported; missing Cloudflare secrets give a clear error', async () => {
  const { owner } = await setup();
  await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'www.client.com' } });
  await call('POST', '/api/admin/sites/demo/host', { cookie: owner });
  cf.project.latest_deployment = { latest_stage: { name: 'build', status: 'failure' } };
  assert.match((await call('POST', '/api/admin/sites/demo/host/check', { cookie: owner })).data.error, /נכשלה/);
  delete env.CF_API_TOKEN;
  assert.equal((await call('POST', '/api/admin/sites/demo/host/check', { cookie: owner })).status, 500);
});

/* ---------- automatic DNS in Cloudflare ---------- */
test('auto DNS: GitHub records for an apex, replaces conflicting A/CNAME, never touches MX/TXT', async () => {
  const { owner, client } = await setup();
  await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'client.com' } });
  records.push({ id: 'old', type: 'A', name: 'client.com', content: '1.2.3.4' }, { id: 'mx', type: 'MX', name: 'client.com', content: 'mail' });
  assert.equal((await call('POST', '/api/admin/sites/demo/dns', { cookie: client })).status, 403);
  const r = await call('POST', '/api/admin/sites/demo/dns', { cookie: owner });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.target, 'github');
  assert.equal(records.filter((x) => x.type === 'A' && x.name === 'client.com').length, 4);
  assert.ok(!records.some((x) => x.content === '1.2.3.4'));
  assert.ok(records.some((x) => x.id === 'mx'));
  assert.ok(records.some((x) => x.type === 'CNAME' && x.name === 'www.client.com' && x.content === 'o.github.io' && x.proxied === false));
  const again = await call('POST', '/api/admin/sites/demo/dns', { cookie: owner });   // idempotent
  assert.ok(again.data.changes.every((c) => c.action === 'kept'));
});

test('auto DNS: subdomain finds the parent zone; Cloudflare hosting points at the pages.dev project; unknown zone is explained', async () => {
  const { owner } = await setup();
  await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'www.client.com' } });
  await call('POST', '/api/admin/sites/demo/dns', { cookie: owner });
  assert.deepEqual(records.map((x) => [x.type, x.name, x.content]), [['CNAME', 'www.client.com', 'o.github.io']]);
  await call('POST', '/api/admin/sites/demo/host', { cookie: owner });
  await call('POST', '/api/admin/sites/demo/dns', { cookie: owner });
  assert.deepEqual(records.map((x) => [x.type, x.name, x.content, x.proxied]), [['CNAME', 'www.client.com', 'fd-demo.pages.dev', true]]);
  await call('POST', '/api/admin/sites/other/domain', { cookie: owner, body: { domain: 'elsewhere.co.il' } });
  const r = await call('POST', '/api/admin/sites/other/dns', { cookie: owner });
  assert.equal(r.status, 422); assert.match(r.data.error, /Cloudflare/);
});

test('domain: a token without Pages access to the repo gives an actionable message', async () => {
  const { owner } = await setup();
  await call('POST', '/api/admin/sites/demo/domain', { cookie: owner, body: { domain: 'www.client.com' } });
  dns['www.client.com/CNAME'] = ['o.github.io'];
  pages = 'forbidden';
  const r = await call('POST', '/api/admin/sites/demo/domain/check', { cookie: owner });
  assert.equal(r.status, 422); assert.match(r.data.error, /Repository access/); assert.match(r.data.error, /o\/site/);
});

/* ---------- page copies + text-only pages ---------- */
async function pagesSetup(extra = {}) {
  const owner = await ownerCookie();
  repo.files['terms.html'] = Buffer.from('<html><head><meta charset="utf-8"><title>תקנון</title><script src="cms/cms-kit.js"></script></head><body><h1>תקנון</h1><p>סעיף</p></body></html>');
  await call('POST', '/api/admin/sites', { cookie: owner, body: { id: 'demo', name: 'דמו', repo: 'o/site', branch: 'main', url: 'https://demo.example.com', pages: ['index.html', 'terms.html'], ...extra } });
  await call('POST', '/api/admin/users', { cookie: owner, body: { username: 'dana', name: 'דנה', password: 'password-1', sites: ['demo'] } });
  const client = cookieOf(await call('POST', '/api/login', { body: { username: 'dana', password: 'password-1' } }));
  return { owner, client };
}
const putPage = (cookie, edits) => call('PUT', '/api/sites/demo/edits', { cookie, body: { edits } });

test('pages: a client duplicates a page; the copy keeps the source edits and gets its own title', async () => {
  const { client } = await pagesSetup();
  await putPage(client, { v: 1, global: {}, pages: { 'terms.html': { els: { 'body>h1:nth-of-type(1)': { t: 'כותרת חדשה', color: '#112233' } } } } });
  const r = await call('POST', '/api/sites/demo/pages', { cookie: client, body: { title: 'Privacy policy', from: 'terms.html' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.file, 'privacy-policy.html');
  assert.ok(r.data.site.pages.includes('privacy-policy.html'));
  assert.match(repo.files['privacy-policy.html'].toString(), /<title>Privacy policy<\/title>/);
  assert.match(repo.files['privacy-policy.html'].toString(), /cms-kit\.js/);
  const saved = JSON.parse(repo.files['cms/edits.json'].toString());
  assert.equal(saved.pages['privacy-policy.html'].els['body>h1:nth-of-type(1)'].t, 'כותרת חדשה');
  assert.equal(commits.at(-1).paths.length, 2);
});

test('pages: Hebrew-only title gets a safe generated name; same title twice gets a suffix; sub-folder pages stay in their folder', async () => {
  const { client } = await pagesSetup();
  const a = await call('POST', '/api/sites/demo/pages', { cookie: client, body: { title: 'מדיניות פרטיות', from: 'terms.html' } });
  assert.match(a.data.file, /^page-[0-9a-f]{4}\.html$/);
  const b1 = await call('POST', '/api/sites/demo/pages', { cookie: client, body: { title: 'About', from: 'terms.html' } });
  const b2 = await call('POST', '/api/sites/demo/pages', { cookie: client, body: { title: 'About', from: 'terms.html' } });
  assert.equal(b1.data.file, 'about.html'); assert.equal(b2.data.file, 'about-2.html');
  const { owner } = { owner: await ownerCookie() };
  const sub = await call('POST', '/api/admin/sites', { cookie: owner, body: { id: 'sub', name: 'x', repo: 'o/site', url: 'https://x.test', pages: ['sub/page.html'] } });
  assert.equal(sub.status, 200);
  const r = await call('POST', '/api/sites/sub/pages', { cookie: owner, body: { title: 'Two', from: 'sub/page.html' } });
  assert.equal(r.data.file, 'sub/two.html');
});

test('pages: at most 10 copies; only registered pages can be copied; bad input is refused', async () => {
  const { client } = await pagesSetup();
  assert.equal((await call('POST', '/api/sites/demo/pages', { cookie: client, body: { title: 'x', from: 'secret.html' } })).status, 400);
  assert.equal((await call('POST', '/api/sites/demo/pages', { cookie: client, body: { title: 'x', from: '../index.html' } })).status, 400);
  assert.equal((await call('POST', '/api/sites/demo/pages', { cookie: client, body: { title: '', from: 'terms.html' } })).status, 400);
  for (let i = 1; i <= 10; i++) assert.equal((await call('POST', '/api/sites/demo/pages', { cookie: client, body: { title: 'Copy ' + i, from: 'terms.html' } })).status, 200);
  const eleventh = await call('POST', '/api/sites/demo/pages', { cookie: client, body: { title: 'Copy 11', from: 'terms.html' } });
  assert.equal(eleventh.status, 409);
  assert.equal(commits.length, 10);
  // another client without access cannot use it
  const owner = await ownerCookie();
  await call('POST', '/api/admin/users', { cookie: owner, body: { username: 'noa', name: 'נועה', password: 'password-2', sites: [] } });
  const noa = cookieOf(await call('POST', '/api/login', { body: { username: 'noa', password: 'password-2' } }));
  assert.equal((await call('POST', '/api/sites/demo/pages', { cookie: noa, body: { title: 'x', from: 'terms.html' } })).status, 404);
});

test('pages: only copies can be deleted (file and its edits); original pages never', async () => {
  const { client } = await pagesSetup();
  const r = await call('POST', '/api/sites/demo/pages', { cookie: client, body: { title: 'Temp', from: 'terms.html' } });
  assert.equal((await call('DELETE', '/api/sites/demo/pages?file=terms.html', { cookie: client })).status, 403);
  assert.equal((await call('DELETE', '/api/sites/demo/pages?file=index.html', { cookie: client })).status, 403);
  assert.equal((await call('DELETE', '/api/sites/demo/pages?file=cms/edits.json', { cookie: client })).status, 403);
  const d = await call('DELETE', '/api/sites/demo/pages?file=' + r.data.file, { cookie: client });
  assert.equal(d.status, 200);
  assert.ok(!repo.files[r.data.file]);
  assert.ok(!d.data.site.pages.includes(r.data.file));
  assert.ok(repo.files['terms.html']);
});

test('text-only pages: a client can change text but not colours, fonts, links, layout; the owner can; copies inherit the lock', async () => {
  const { owner, client } = await pagesSetup({ textOnly: ['terms.html'] });
  const key = 'body>h1:nth-of-type(1)';
  // the owner sets the design first
  const r0 = await putPage(owner, { v: 1, global: {}, pages: { 'terms.html': { els: { [key]: { t: 'תקנון האתר', color: '#112233', b: true } } } } }); assert.equal(r0.status, 200, JSON.stringify(r0.data));
  // the client tries to change colour, font size, hide a block, add an element and the text
  const sneaky = { v: 1, global: {}, pages: { 'terms.html': { els: { [key]: { t: 'נוסח חדש', color: '#ff0000', fs: 40 }, 'body>p:nth-of-type(1)': { href: 'https://evil.example', t: 'סעיף 1' } },
    layout: [{ op: 'hide', key: 'body>p:nth-of-type(1)' }, { op: 'add', after: key, id: 'abc1', type: 'divider' }] } } };
  assert.equal((await putPage(client, sneaky)).status, 200);
  const saved = JSON.parse(repo.files['cms/edits.json'].toString()).pages['terms.html'];
  assert.equal(saved.els[key].t, 'נוסח חדש');
  assert.equal(saved.els[key].color, '#112233');         // design untouched
  assert.equal(saved.els[key].b, true);
  assert.equal(saved.els[key].fs, undefined);
  assert.equal(saved.els['body>p:nth-of-type(1)'].href, undefined);
  assert.equal(saved.els['body>p:nth-of-type(1)'].t, 'סעיף 1');
  assert.equal(saved.layout, undefined);
  // other pages stay fully editable
  assert.equal((await putPage(client, { v: 1, global: {}, pages: { 'terms.html': saved, 'index.html': { els: { 'h1': { color: '#abcdef' } } } } })).status, 200);
  assert.equal(JSON.parse(repo.files['cms/edits.json'].toString()).pages['index.html'].els.h1.color, '#abcdef');
  // a copy of a locked page is locked too
  const c = await call('POST', '/api/sites/demo/pages', { cookie: client, body: { title: 'Copy', from: 'terms.html' } });
  assert.deepEqual(c.data.site.textOnly.sort(), ['copy.html', 'terms.html']);
  await putPage(client, { v: 1, global: {}, pages: { 'copy.html': { els: { [key]: { t: 'x', color: '#00ff00' } } } } });
  assert.equal(JSON.parse(repo.files['cms/edits.json'].toString()).pages['copy.html'].els[key].color, '#112233');
});
