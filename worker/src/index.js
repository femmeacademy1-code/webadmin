/* Femme Digital CMS — Cloudflare Worker.
 *
 *  - Serves the branded admin app (static assets) and a JSON API under /api.
 *  - Users log in with username + password; the GitHub token stays here, in the Worker.
 *  - Clients can only read/write each of their sites' cms/edits.json and cms/uploads/* —
 *    every field is validated against an allow-list (see validate.js).
 *  - The agency owner (env.ADMIN_USER / env.ADMIN_PASSWORD) manages clients and sites.
 *
 * Bindings:  CMS (KV), ASSETS (static assets).
 * Secrets:   ADMIN_PASSWORD, SESSION_SECRET, GITHUB_TOKEN.
 */
import { hashPassword, verifyPassword, secretEquals, signToken, verifyToken } from './auth.js';
import { GitHub } from './github.js';
import { HttpError, validateEdits, validateImages, validateSite, validateUser, LIMITS } from './validate.js';

const SESSION_DAYS = 14;
const COOKIE = 'fd_session';
const EMPTY_EDITS = { v: 1, global: {}, pages: {} };

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'שגיאת שרת' }, 500);
    }
  },
};

/* ---------------- helpers ---------------- */
async function body(req) {
  if (+req.headers.get('content-length') > 20_000_000) throw new HttpError(413, 'הבקשה גדולה מדי');
  try { return await req.json(); } catch { throw new HttpError(400, 'בקשה לא תקינה'); }
}
const getKV = async (env, key) => { const v = await env.CMS.get(key); return v ? JSON.parse(v) : null; };
const putKV = (env, key, val) => env.CMS.put(key, JSON.stringify(val));
async function listKV(env, prefix) {
  const out = [];
  let cursor;
  do {
    const r = await env.CMS.list({ prefix, cursor });
    for (const k of r.keys) out.push(await getKV(env, k.name));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out.filter(Boolean);
}
const publicSite = (s) => ({ id: s.id, name: s.name, url: s.url, pages: s.pages });
const publicUser = (u) => ({ username: u.username, name: u.name, sites: u.sites || [] });

function cookie(env, req, value, maxAge) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}
function readCookie(req) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

async function session(req, env) {
  const p = await verifyToken(readCookie(req), env.SESSION_SECRET || '');
  if (!p) return null;
  if (p.r === 'owner') return { role: 'owner', username: p.u, name: 'הנהלה', sites: null };
  const u = await getKV(env, 'u:' + p.u);          // re-checked every request, so deleting a client cuts access at once
  return u ? { role: 'client', username: u.username, name: u.name, sites: u.sites || [] } : null;
}
const requireSession = async (req, env) => (await session(req, env)) || (() => { throw new HttpError(401, 'יש להתחבר'); })();
const requireOwner = async (req, env) => {
  const s = await requireSession(req, env);
  if (s.role !== 'owner') throw new HttpError(403, 'אין הרשאה');
  return s;
};

async function siteFor(env, s, id) {
  const site = await getKV(env, 's:' + id);
  if (!site || (s.role !== 'owner' && !s.sites.includes(id))) throw new HttpError(404, 'האתר לא נמצא');
  return site;
}
const p = (site, rel) => (site.root ? `${site.root}/${rel}` : rel);
const EDITS_PATH = 'cms/edits.json';

const rlKey = (req) => 'rl:' + (req.headers.get('cf-connecting-ip') || 'local');
async function checkRateLimit(env, req) {
  if ((+(await env.CMS.get(rlKey(req))) || 0) >= 10) throw new HttpError(429, 'יותר מדי ניסיונות כניסה. נסו שוב בעוד כמה דקות.');
}
async function countFailure(env, req) {
  const n = +(await env.CMS.get(rlKey(req))) || 0;
  await env.CMS.put(rlKey(req), String(n + 1), { expirationTtl: 900 });   // only failed logins count
}

/* ---------------- router ---------------- */
async function route(req, env, url) {
  const { pathname } = url;
  const method = req.method;

  if (method !== 'GET' && req.headers.get('x-requested-with') !== 'fd') throw new HttpError(403, 'בקשה לא מורשית');

  if (pathname === '/api/login' && method === 'POST') return login(req, env);
  if (pathname === '/api/logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie(env, req, '', 0) });
  if (pathname === '/api/me' && method === 'GET') return me(req, env);

  let m;
  if ((m = pathname.match(/^\/api\/sites\/([a-z0-9-]+)\/(edits|history)$/))) {
    const s = await requireSession(req, env);
    const site = await siteFor(env, s, m[1]);
    if (m[2] === 'edits' && method === 'GET') return getEdits(env, site);
    if (m[2] === 'edits' && method === 'PUT') return putEdits(req, env, s, site);
    if (m[2] === 'history' && method === 'GET') return history(env, site);
  }
  if ((m = pathname.match(/^\/api\/sites\/([a-z0-9-]+)\/version\/([0-9a-f]{7,40})$/)) && method === 'GET') {
    const s = await requireSession(req, env);
    return getEdits(env, await siteFor(env, s, m[1]), m[2]);
  }

  if (pathname.startsWith('/api/admin/')) {
    await requireOwner(req, env);
    if (pathname === '/api/admin/state' && method === 'GET') return adminState(env);
    if (pathname === '/api/admin/sites' && method === 'POST') return saveSite(req, env, null);
    if ((m = pathname.match(/^\/api\/admin\/sites\/([a-z0-9-]+)$/))) {
      if (method === 'PUT') return saveSite(req, env, m[1]);
      if (method === 'DELETE') return deleteSite(env, m[1]);
    }
    if ((m = pathname.match(/^\/api\/admin\/sites\/([a-z0-9-]+)\/connect$/)) && method === 'POST') return connectSite(req, env, url, m[1]);
    if (pathname === '/api/admin/users' && method === 'POST') return saveUser(req, env, null);
    if ((m = pathname.match(/^\/api\/admin\/users\/([a-z0-9._-]+)$/))) {
      if (method === 'PUT') return saveUser(req, env, m[1]);
      if (method === 'DELETE') { await env.CMS.delete('u:' + m[1]); return json({ ok: true }); }
    }
  }
  throw new HttpError(404, 'לא נמצא');
}

/* ---------------- auth ---------------- */
async function login(req, env) {
  await checkRateLimit(env, req);
  const { username = '', password = '' } = await body(req);
  const name = String(username).trim().toLowerCase();
  let who = null;

  const ownerUser = (env.ADMIN_USER || 'admin').toLowerCase();
  if (name === ownerUser && env.ADMIN_PASSWORD && await secretEquals(String(password), env.ADMIN_PASSWORD)) who = { r: 'owner', u: ownerUser };
  else {
    const rec = await getKV(env, 'u:' + name);
    if (await verifyPassword(String(password), rec) && rec) who = { r: 'client', u: rec.username };
  }
  if (!who) { await countFailure(env, req); throw new HttpError(401, 'שם משתמש או סיסמה שגויים'); }

  const token = await signToken({ ...who, e: Date.now() + SESSION_DAYS * 864e5 }, env.SESSION_SECRET || '');
  return json({ ok: true }, 200, { 'set-cookie': cookie(env, req, token, SESSION_DAYS * 86400) });
}

async function me(req, env) {
  const s = await session(req, env);
  if (!s) return json({ user: null });
  const sites = (await listKV(env, 's:')).filter((x) => s.role === 'owner' || s.sites.includes(x.id));
  return json({ user: { username: s.username, name: s.name, role: s.role }, sites: sites.map(publicSite) });
}

/* ---------------- edits ---------------- */
async function getEdits(env, site, ref) {
  const gh = new GitHub(env);
  const f = await gh.getFile(site.repo, p(site, EDITS_PATH), ref || site.branch);
  if (!f) {
    if (ref) throw new HttpError(404, 'הגרסה לא נמצאה');
    return json({ edits: EMPTY_EDITS, sha: null, site: publicSite(site) });
  }
  let edits;
  try { edits = validateEdits(JSON.parse(f.text)); } catch { edits = EMPTY_EDITS; }
  return json({ edits, sha: f.sha, site: publicSite(site) });
}

async function putEdits(req, env, s, site) {
  const b = await body(req);
  const edits = validateEdits(b.edits);
  const images = validateImages(b.images);
  const gh = new GitHub(env);
  const path = p(site, EDITS_PATH);

  const cur = await gh.getFile(site.repo, path, site.branch);
  if (cur && b.baseSha && cur.sha !== b.baseSha && !b.force) {
    throw new HttpError(409, 'מישהו אחר עדכן את האתר בזמן שערכתם.');
  }
  const files = [{ path, text: JSON.stringify(edits, null, 2) + '\n' }];
  images.forEach((im) => files.push({ path: p(site, im.path), base64: im.base64 }));

  // Defence in depth: whatever happens above, only these two locations may ever be written.
  for (const f of files) {
    const rel = site.root ? f.path.slice(site.root.length + 1) : f.path;
    if (rel !== EDITS_PATH && !rel.startsWith('cms/uploads/')) throw new HttpError(403, 'כתיבה לנתיב זה אסורה');
  }
  const res = await gh.commit(site.repo, site.branch, files, `עדכון תוכן מהמערכת – ${s.name} (${s.username})`);
  return json({ ok: true, sha: res.blobs[path], edits });   // the normalised document, so the editor can verify the live site against it
}

async function history(env, site) {
  const list = await new GitHub(env).history(site.repo, site.branch, p(site, EDITS_PATH), 30);
  return json({ commits: list.map((c) => ({ sha: c.sha, date: c.commit.author.date, message: c.commit.message.split('\n')[0] })) });
}

/* ---------------- admin: sites & users ---------------- */
async function adminState(env) {
  const [users, sites] = await Promise.all([listKV(env, 'u:'), listKV(env, 's:')]);
  return json({ users: users.map(publicUser), sites });
}

async function saveSite(req, env, id) {
  const input = await body(req);
  const clean = validateSite(id ? { ...input, id } : input, !!id);
  if (!id && await getKV(env, 's:' + clean.id)) throw new HttpError(409, 'כבר קיים אתר עם המזהה הזה');
  const prev = id ? await getKV(env, 's:' + id) : null;
  if (id && !prev) throw new HttpError(404, 'האתר לא נמצא');
  const site = { ...(prev || { createdAt: new Date().toISOString() }), ...clean, id: id || clean.id };
  await putKV(env, 's:' + site.id, site);
  return json({ site });
}

async function deleteSite(env, id) {
  await env.CMS.delete('s:' + id);
  for (const u of await listKV(env, 'u:')) {
    if ((u.sites || []).includes(id)) await putKV(env, 'u:' + u.username, { ...u, sites: u.sites.filter((x) => x !== id) });
  }
  return json({ ok: true });
}

async function saveUser(req, env, username) {
  const input = await body(req);
  const clean = validateUser(username ? { ...input, username } : input, !!username);
  const key = 'u:' + (username || clean.username);
  const prev = await getKV(env, key);
  if (!username && prev) throw new HttpError(409, 'שם המשתמש תפוס');
  if (username && !prev) throw new HttpError(404, 'המשתמש לא נמצא');
  const rec = { ...(prev || {}), username: username || clean.username };
  if (clean.name != null) rec.name = clean.name;
  if (clean.sites != null) rec.sites = clean.sites;
  if (clean.password) Object.assign(rec, await hashPassword(clean.password));
  await putKV(env, key, rec);
  return json({ user: publicUser(rec) });
}

/* ---------------- connect a site: add the kit + one script tag, once ---------------- */
// `ver` (a hash of the kit file) is part of the URL, so a new kit is never served from an old browser/CDN cache.
function addKitTag(html, prefix, origin, ver) {
  const tag = `<script src="${prefix}cms/cms-kit.js?v=${ver}" data-admin-origin="${origin}"></script>`;
  const existing = /<script[^>]*cms\/cms-kit\.js[^>]*><\/script>/i;
  if (existing.test(html)) return html.replace(existing, tag);
  const charset = html.match(/<meta[^>]*charset[^>]*>/i);
  if (charset) return html.replace(charset[0], charset[0] + '\n' + tag);
  const head = html.match(/<head[^>]*>/i);
  if (head) return html.replace(head[0], head[0] + '\n' + tag);
  throw new HttpError(422, 'לא נמצא תג <head> בעמוד');
}

async function connectSite(req, env, url, id) {
  const site = await getKV(env, 's:' + id);
  if (!site) throw new HttpError(404, 'האתר לא נמצא');
  const origin = env.ADMIN_ORIGIN || url.origin;
  const gh = new GitHub(env);

  const kit = await env.ASSETS.fetch(new Request(new URL('/kit/cms-kit.js', url)));
  if (!kit.ok) throw new HttpError(500, 'קובץ ערכת העריכה לא נמצא בשרת');
  const kitText = await kit.text();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(kitText));
  const ver = [...new Uint8Array(digest)].slice(0, 5).map((b) => b.toString(16).padStart(2, '0')).join('');
  const files = [{ path: p(site, 'cms/cms-kit.js'), text: kitText }];

  if (!(await gh.getFile(site.repo, p(site, EDITS_PATH), site.branch))) {
    files.push({ path: p(site, EDITS_PATH), text: JSON.stringify(EMPTY_EDITS, null, 2) + '\n' });
  }
  for (const page of site.pages) {
    const f = await gh.getFile(site.repo, p(site, page), site.branch);
    if (!f) throw new HttpError(422, `העמוד ${page} לא נמצא בריפו`);
    const depth = page.split('/').length - 1;
    files.push({ path: p(site, page), text: addKitTag(f.text, '../'.repeat(depth), origin, ver) });
  }
  await gh.commit(site.repo, site.branch, files, 'חיבור מערכת העריכה לאתר');
  return json({ ok: true, files: files.map((f) => f.path) });
}

export { LIMITS };
