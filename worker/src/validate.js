/* Strict validation for everything a client can send.
 * The point of the whole system: clients can change CONTENT (text, images, links, colours, fonts)
 * but never structure or code — so edits are rebuilt field by field from an allow-list. */

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => { throw new HttpError(400, m); };

const PATH_KEY = /^[A-Za-z0-9_#:>().@\- ]{1,400}$/;          // DOM path used as the edit key (@id… = inside a duplicated block)
const OP_ID = /^[a-z0-9]{3,8}$/;
const ALIGN = new Set(['right', 'center', 'left', 'justify']);
const HEX = /^#[0-9a-f]{6}$/;
const FAMILY = /^[A-Za-z0-9 ]{1,60}$/;
const FONT_URL = /^https:\/\/fonts\.googleapis\.com\/css2\?family=[A-Za-z0-9+:;@.,=&%_-]{1,300}$/;
const PAGE_KEY = /^[\w./-]{1,120}\.html?$/;
const UPLOAD = /^cms\/uploads\/[a-z0-9][a-z0-9._-]{0,80}\.(jpg|png|webp)$/;                  // images
const FILE_UPLOAD = /^cms\/uploads\/[a-z0-9][a-z0-9._-]{0,80}\.(pdf|docx?|xlsx?|pptx?|zip)$/;     // downloadable files
const ADD_TYPES = new Set(['text', 'heading', 'image', 'button', 'video', 'file', 'divider', 'box']);
const SHAPES = new Set(['none', 'circle', 'rounded', 'arch', 'blob', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star']);
const RATIOS = new Set(['1:1', '4:3', '3:4', '16:9', '9:16']);
const VIDEO_ID = { youtube: /^[A-Za-z0-9_-]{6,20}$/, vimeo: /^\d{5,12}$/ };

export const LIMITS = { json: 400_000, els: 3000, pages: 30, text: 8000, image: 4_000_000, file: 10_000_000, images: 12, ops: 300 };

function str(v, max, what) {
  if (typeof v !== 'string') bad(`${what}: ערך לא תקין`);
  if (v.length > max) bad(`${what}: ארוך מדי`);
  return v;
}

function safeUrl(v, what) {
  str(v, 2000, what);
  if (/^\s*(javascript|data|vbscript|file):/i.test(v) || /[\u0000-\u001f]/.test(v)) bad(`${what}: כתובת לא מותרת`);
  return v;
}
function imageRef(v, what) {
  safeUrl(v, what);
  if (/^https:\/\//i.test(v) || UPLOAD.test(v)) return v;
  if (/^[\w./-]+$/.test(v) && !v.includes('..') && !v.startsWith('/')) return v;   // an existing asset of the site
  return bad(`${what}: נתיב תמונה לא מותר`);
}
function font(f, what) {
  if (!f || typeof f !== 'object') bad(`${what}: לא תקין`);
  if (!FAMILY.test(f.family || '')) bad(`${what}: שם פונט לא תקין`);
  if (!FONT_URL.test(f.url || '')) bad(`${what}: כתובת פונט לא תקינה`);
  return { family: f.family, url: f.url };
}

function element(spec, key) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) bad('פריט עריכה לא תקין');
  const out = {};
  if (spec.t != null) out.t = str(spec.t, LIMITS.text, 'טקסט');
  if (spec.n != null) {
    if (typeof spec.n !== 'object') bad('טקסט לא תקין');
    out.n = {};
    for (const [i, v] of Object.entries(spec.n)) {
      if (!/^\d{1,4}$/.test(i)) bad('אינדקס טקסט לא תקין');
      out.n[i] = str(v, LIMITS.text, 'טקסט');
    }
  }
  if (spec.src != null) out.src = imageRef(spec.src, 'תמונה');
  if (spec.bgimg != null) out.bgimg = imageRef(spec.bgimg, 'תמונת רקע');
  if (spec.alt != null) out.alt = str(spec.alt, 500, 'תיאור תמונה');
  if (spec.href != null) {
    const h = safeUrl(spec.href, 'קישור');
    if (!/^(https?:\/\/|mailto:|tel:|#|\/|\.\/|\.\.\/|[\w-]+(\/|\.html|$))/i.test(h)) bad('קישור לא מותר');
    out.href = h;
  }
  if (spec.color != null) { if (!HEX.test(spec.color)) bad('צבע לא תקין'); out.color = spec.color; }
  if (spec.bgc != null) { if (!HEX.test(spec.bgc)) bad('צבע רקע לא תקין'); out.bgc = spec.bgc; }
  if (spec.font != null) out.font = font(spec.font, 'פונט');
  if (spec.fs != null) {
    if (!Number.isInteger(spec.fs) || spec.fs < 8 || spec.fs > 200) bad('גודל טקסט לא תקין');
    out.fs = spec.fs;
  }
  for (const k of ['b', 'i', 'u', 'st']) {
    if (spec[k] != null) { if (typeof spec[k] !== 'boolean') bad('ערך עיצוב לא תקין'); out[k] = spec[k]; }
  }
  if (spec.al != null) { if (!ALIGN.has(spec.al)) bad('יישור לא תקין'); out.al = spec.al; }
  // boxes and pictures: corner radius, shadow, border, shape, crop ratio and focal point
  const int = (k, min, max, what) => { if (spec[k] != null) { if (!Number.isInteger(spec[k]) || spec[k] < min || spec[k] > max) bad(what + ' לא תקין'); out[k] = spec[k]; } };
  int('rad', 0, 200, 'רדיוס פינות'); int('sh', 0, 3, 'צל'); int('bw', 0, 12, 'עובי מסגרת'); int('fx', 0, 100, 'מיקום חיתוך'); int('fy', 0, 100, 'מיקום חיתוך');
  if (spec.bc != null) { if (!HEX.test(spec.bc)) bad('צבע מסגרת לא תקין'); out.bc = spec.bc; }
  if (spec.shape != null) { if (!SHAPES.has(spec.shape)) bad('צורה לא מותרת'); out.shape = spec.shape; }
  if (spec.ar != null) { if (spec.ar !== 'orig' && !RATIOS.has(spec.ar)) bad('יחס תמונה לא תקין'); out.ar = spec.ar; }
  return out;
}

function key(k) {
  if (typeof k !== 'string' || !PATH_KEY.test(k)) bad('מפתח אלמנט לא תקין');
  return k;
}

/** Structure operations: only duplicate / move up-down / hide — never anything that edits code. */
function layout(ops) {
  if (ops == null) return [];
  if (!Array.isArray(ops) || ops.length > LIMITS.ops) bad('יותר מדי פעולות מבנה');
  const ids = new Set();
  return ops.map((op) => {
    if (!op || typeof op !== 'object') bad('פעולת מבנה לא תקינה');
    if (op.op === 'dup') {
      if (typeof op.id !== 'string' || !OP_ID.test(op.id) || ids.has(op.id)) bad('מזהה שכפול לא תקין');
      ids.add(op.id);
      return { op: 'dup', src: key(op.src), id: op.id };
    }
    if (op.op === 'add') {
      if (typeof op.id !== 'string' || !OP_ID.test(op.id) || ids.has(op.id)) bad('מזהה אלמנט לא תקין');
      ids.add(op.id);
      if (!ADD_TYPES.has(op.type)) bad('סוג אלמנט לא מותר');
      const added = { op: 'add', after: key(op.after), id: op.id, type: op.type };
      if (op.type === 'video') {
        const v = op.p;
        if (!v || !VIDEO_ID[v.provider] || typeof v.vid !== 'string' || !VIDEO_ID[v.provider].test(v.vid)) bad('קישור הסרטון לא תקין (YouTube או Vimeo בלבד)');
        added.p = { provider: v.provider, vid: v.vid };
      } else if (op.p != null) bad('פרמטרים לא מותרים');
      return added;
    }
    if (op.op === 'move') {
      if (op.dir !== 1 && op.dir !== -1) bad('כיוון הזזה לא תקין');
      return { op: 'move', key: key(op.key), dir: op.dir };
    }
    if (op.op === 'hide') return { op: 'hide', key: key(op.key) };
    return bad('פעולת מבנה לא מוכרת');
  });
}

/** Rebuilds an edits document from an allow-list; throws HttpError(400) on anything unexpected. */
export function validateEdits(input) {
  if (!input || typeof input !== 'object' || input.v !== 1) bad('מבנה העריכות לא תקין');
  if (JSON.stringify(input).length > LIMITS.json) bad('העריכות גדולות מדי');
  const out = { v: 1, global: {}, pages: {} };

  const g = input.global || {};
  if (g.colors != null) {
    out.global.colors = {};
    for (const [from, to] of Object.entries(g.colors)) {
      if (!HEX.test(from) || !HEX.test(to)) bad('צבע לא תקין');
      if (from !== to) out.global.colors[from] = to;
    }
  }
  if (g.fonts != null) {
    out.global.fonts = {};
    for (const role of ['heading', 'body']) if (g.fonts[role]) out.global.fonts[role] = font(g.fonts[role], 'פונט');
  }

  const pages = input.pages || {};
  if (Object.keys(pages).length > LIMITS.pages) bad('יותר מדי עמודים');
  for (const [page, p] of Object.entries(pages)) {
    if (!PAGE_KEY.test(page) || page.includes('..')) bad('שם עמוד לא תקין');
    const els = (p && p.els) || {};
    if (Object.keys(els).length > LIMITS.els) bad('יותר מדי עריכות בעמוד');
    out.pages[page] = { els: {} };
    const ops = layout(p && p.layout);
    if (ops.length) out.pages[page].layout = ops;
    for (const [key, spec] of Object.entries(els)) {
      if (!PATH_KEY.test(key)) bad('מפתח אלמנט לא תקין');
      const clean = element(spec, key);
      if (Object.keys(clean).length) out.pages[page].els[key] = clean;
    }
  }
  return out;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
// First bytes of a file must match its extension, so a renamed page or script is never accepted as a document.
function magicOk(ext, head) {
  if (ext === 'jpg') return head.startsWith('\xff\xd8\xff');
  if (ext === 'png') return head.startsWith('\x89PNG');
  if (ext === 'webp') return head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
  if (ext === 'pdf') return head.startsWith('%PDF-');
  if (['docx', 'xlsx', 'pptx', 'zip'].includes(ext)) return head.startsWith('PK\x03\x04');
  if (['doc', 'xls', 'ppt'].includes(ext)) return head.startsWith('\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1');
  return false;
}

/** Images and downloadable documents uploaded alongside the edits. */
export function validateImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images) || images.length > LIMITS.images) bad('יותר מדי קבצים בבת אחת');
  return images.map((im) => {
    const p = im && im.path;
    const isImage = UPLOAD.test(p || '');
    if (!isImage && !FILE_UPLOAD.test(p || '')) bad('נתיב קובץ לא מותר');
    const limit = isImage ? LIMITS.image : LIMITS.file;
    if (typeof im.base64 !== 'string' || !B64.test(im.base64) || im.base64.length > limit * 1.4) bad(isImage ? 'התמונה גדולה מדי' : 'הקובץ גדול מדי (עד 10MB)');
    let head = '';
    try { head = atob(im.base64.slice(0, 16)); } catch { bad('קובץ לא תקין'); }
    const ext = p.split('.').pop();
    if (!magicOk(ext, head)) bad(isImage ? 'הקובץ אינו תמונה תקינה' : 'תוכן הקובץ אינו תואם לסוג שלו');
    return { path: p, base64: im.base64 };
  });
}

export function validateSite(s, partial = false) {
  const out = {};
  const need = (k) => { if (!partial && s[k] == null) bad(`חסר שדה: ${k}`); return s[k] != null; };
  if (need('id')) { if (!/^[a-z0-9-]{2,40}$/.test(s.id)) bad('מזהה אתר: אותיות קטנות באנגלית, ספרות ומקף בלבד'); out.id = s.id; }
  if (need('name')) out.name = str(s.name, 80, 'שם האתר').trim() || bad('שם האתר ריק');
  if (need('repo')) { if (!/^[\w.-]+\/[\w.-]+$/.test(s.repo)) bad('ריפו: owner/name'); out.repo = s.repo; }
  if (s.branch != null || !partial) { out.branch = s.branch || 'main'; if (!/^[\w./-]{1,100}$/.test(out.branch)) bad('ענף לא תקין'); }
  if (need('url')) { if (!/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(s.url)) bad('כתובת האתר חייבת להתחיל ב-https://'); out.url = s.url.replace(/\/?$/, '/'); }
  if (s.pages != null || !partial) {
    const pages = s.pages && s.pages.length ? s.pages : ['index.html'];
    if (!Array.isArray(pages) || pages.length > 30) bad('רשימת עמודים לא תקינה');
    pages.forEach((p) => { if (!PAGE_KEY.test(p) || p.includes('..') || p.startsWith('/')) bad('שם עמוד לא תקין: ' + p); });
    out.pages = pages;
  }
  if (s.textOnly != null) {
    if (!Array.isArray(s.textOnly) || s.textOnly.length > 30) bad('רשימת עמודי טקסט בלבד לא תקינה');
    s.textOnly.forEach((p) => { if (!PAGE_KEY.test(p) || p.includes('..') || p.startsWith('/')) bad('שם עמוד לא תקין: ' + p); });
    out.textOnly = s.textOnly;
  }
  if (s.root != null || !partial) {
    out.root = (s.root || '').replace(/^\/+|\/+$/g, '');
    if (out.root && !/^[\w./-]+$/.test(out.root) || out.root.includes('..')) bad('תיקיית שורש לא תקינה');
  }
  return out;
}

export function validateUser(u, partial = false) {
  const out = {};
  if (u.username != null || !partial) { if (!/^[a-z0-9._-]{3,40}$/.test(u.username || '')) bad('שם משתמש: אותיות קטנות באנגלית, ספרות . _ - (3–40)'); out.username = u.username; }
  if (u.name != null || !partial) out.name = str(u.name || '', 80, 'שם').trim() || bad('שם ריק');
  if (u.password != null && u.password !== '') { if (typeof u.password !== 'string' || u.password.length < 8) bad('סיסמה: לפחות 8 תווים'); out.password = u.password; }
  else if (!partial) bad('חסרה סיסמה');
  if (u.sites != null || !partial) {
    if (!Array.isArray(u.sites || [])) bad('רשימת אתרים לא תקינה');
    out.sites = (u.sites || []).filter((x) => typeof x === 'string' && /^[a-z0-9-]{2,40}$/.test(x));
  }
  return out;
}
export { PAGE_KEY };
export const PATHS = { UPLOAD, FILE_UPLOAD };
