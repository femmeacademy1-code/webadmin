/* Femme Digital CMS — admin app (login, sites, visual editor, agency admin). */

/* ======================= helpers ======================= */
const $ = (s, r = document) => r.querySelector(s);
const root = $('#app');

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  (function add(c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    e.append(c.nodeType ? c : document.createTextNode(c));
  })(kids);
  return e;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let toastTimer;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), err ? 6000 : 3500);
}

async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fd' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) {
    const err = new Error((data && data.error) || 'שגיאה ' + r.status);
    err.status = r.status;
    if (r.status === 401 && path !== '/login') { me = null; location.hash = '#/login'; }
    throw err;
  }
  return data;
}

const doodle = (name, cls) => h('img', { src: `brand/${name}.png`, alt: '', class: cls, 'aria-hidden': 'true' });

/* ======================= state & router ======================= */
let me = null;       // {user, sites}
let dirtyGuard = null;   // reserved

async function loadMe() { me = await api('GET', '/me'); return me; }

async function go() {
  dirtyGuard = null;
  root.className = '';
  if (!me) await loadMe();
  const route = location.hash.replace(/^#\/?/, '');
  if (!me.user) return viewLogin();
  if (route.startsWith('site/')) return viewEditor(route.slice(5));
  if (route === 'admin' && me.user.role === 'owner') return viewAdmin();
  return viewDashboard();
}
window.addEventListener('hashchange', go);

function shell(content, { editor } = {}) {
  root.replaceChildren(
    h('div', { class: editor ? 'ed' : 'shell', id: 'shell' },
      content));
}
function topbar(extra) {
  return h('header', { class: 'top' },
    h('img', { class: 'brand', src: 'brand/logo.png', alt: 'Femme Digital', onclick: () => { location.hash = '#/'; } }),
    extra,
    h('span', { class: 'spacer' }),
    me.user.role === 'owner' && h('a', { class: 'btn ghost small', href: '#/admin' }, 'ניהול לקוחות ואתרים'),
    h('span', { class: 'who' }, me.user.name),
    h('button', { class: 'btn ghost small', onclick: logout }, 'יציאה'));
}
async function logout() {
  await api('POST', '/logout');
  me = null; location.hash = '#/login'; go();
}

/* ======================= login ======================= */
function viewLogin() {
  const err = h('p', { class: 'error', hidden: true });
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'בבדיקה…';
      try {
        await api('POST', '/login', { username: $('#u').value, password: $('#p').value });
        await loadMe();
        location.hash = '#/';
        go();
      } catch (x) {
        err.textContent = x.message; err.hidden = false;
        btn.disabled = false; btn.textContent = 'כניסה';
      }
    },
  },
  h('h1', {}, 'היכנסו ', h('span', { class: 'hl' }, 'לניהול האתר')),
  h('p', { class: 'muted' }, 'עריכת טקסטים, תמונות, צבעים ופונטים – בלי לגעת בקוד.'),
  h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'שם משתמש'),
    h('input', { id: 'u', type: 'text', autocomplete: 'username', required: true, dir: 'ltr' })),
  h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'סיסמה'),
    h('input', { id: 'p', type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' })),
  err,
  h('button', { class: 'btn primary', type: 'submit' }, 'כניסה'));

  root.replaceChildren(h('main', { class: 'login' },
    h('section', { class: 'login-form' }, form),
    h('section', { class: 'login-art' },
      h('div', { class: 'art-card' },
        doodle('butterfly-cream', 'doodle d1'), doodle('sparkles-cream', 'doodle d2'), doodle('flower-cream', 'doodle d3'), doodle('heart-cream', 'doodle d4'),
        h('img', { class: 'logo', src: 'brand/logo-cream.png', alt: 'Femme Digital' })))));
  setTimeout(() => $('#u') && $('#u').focus(), 50);
}

/* ======================= dashboard ======================= */
function viewDashboard() {
  const sites = me.sites;
  shell([
    topbar(),
    h('main', { class: 'page' },
      doodle('sparkles', 'deco'),
      h('h1', {}, 'שלום ', h('span', { class: 'hl' }, me.user.name)),
      h('p', { class: 'sub' }, sites.length ? 'בחרו אתר לעריכה.' : ''),
      sites.length
        ? h('div', { class: 'grid' }, sites.map((s) => h('article', { class: 'card' },
          h('h3', {}, s.name),
          h('div', { class: 'url' }, s.url.replace(/^https?:\/\//, '')),
          h('div', { class: 'row' },
            h('a', { class: 'btn primary', href: '#/site/' + s.id }, 'עריכת האתר'),
            h('a', { class: 'btn mint', href: s.url, target: '_blank', rel: 'noopener' }, 'צפייה באתר ↗')))))
        : h('div', { class: 'empty' }, h('h3', {}, 'עדיין לא חוברו אתרים'),
          h('p', {}, me.user.role === 'owner' ? 'הוסיפו אתר ראשון במסך הניהול.' : 'הסוכנות תחבר את האתר שלכם בקרוב.'),
          me.user.role === 'owner' && h('a', { class: 'btn primary', href: '#/admin' }, 'למסך הניהול'))),
  ]);
  const deco = $('.deco'); if (deco) Object.assign(deco.style, { width: '70px', top: '34px', left: '40px' });
}

/* ======================= agency admin ======================= */
async function viewAdmin() {
  let tab = sessionStorage.getItem('adm-tab') || 'sites';
  let state;
  const refresh = async () => { state = await api('GET', '/admin/state'); draw(); };
  const content = h('div');
  const origin = location.origin;

  const randPw = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');

  function siteForm(site) {
    const isNew = !site;
    const f = site || { id: '', name: '', repo: '', branch: 'main', url: '', pages: ['index.html'], root: '' };
    const val = (id) => $('#' + id, form).value.trim();
    const form = h('div', { class: 'formcard' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'שם האתר / הלקוח'), h('input', { id: 'sf-name', type: 'text', value: f.name })),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'מזהה (אנגלית קטנה)'), h('input', { id: 'sf-id', type: 'text', value: f.id, dir: 'ltr', disabled: !isNew })),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ריפו ב-GitHub'), h('input', { id: 'sf-repo', type: 'text', value: f.repo, dir: 'ltr', placeholder: 'owner/name' })),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ענף'), h('input', { id: 'sf-branch', type: 'text', value: f.branch, dir: 'ltr' })),
      h('label', { class: 'field full' }, h('span', { class: 'lbl' }, 'כתובת האתר המפורסם'), h('input', { id: 'sf-url', type: 'text', value: f.url, dir: 'ltr', placeholder: 'https://www.client.co.il/' }),
        h('span', { class: 'help' }, 'הדומיין של הלקוח כפי שמוגדר ב-GitHub Pages (או כתובת github.io).')),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'עמודים (מופרדים בפסיק)'), h('input', { id: 'sf-pages', type: 'text', value: f.pages.join(', '), dir: 'ltr' })),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'תיקיית שורש בריפו (אם יש)'), h('input', { id: 'sf-root', type: 'text', value: f.root || '', dir: 'ltr', placeholder: 'ריק = שורש הריפו' })),
      h('div', { class: 'full', style: 'display:flex;gap:10px' },
        h('button', { class: 'btn primary', onclick: async () => {
          const body = { id: val('sf-id'), name: val('sf-name'), repo: val('sf-repo'), branch: val('sf-branch') || 'main', url: val('sf-url'),
            pages: val('sf-pages').split(',').map((x) => x.trim()).filter(Boolean), root: val('sf-root') };
          try { await api(isNew ? 'POST' : 'PUT', '/admin/sites' + (isNew ? '' : '/' + f.id), body); toast('נשמר'); showForm = null; await refresh(); }
          catch (e) { toast(e.message, true); }
        } }, isNew ? 'הוספת אתר' : 'שמירה'),
        h('button', { class: 'btn ghost', onclick: () => { showForm = null; draw(); } }, 'ביטול')));
    return form;
  }

  /* Domain wizard: enter domain → DNS records to copy → "check" moves it forward step by step. */
  function domainPanel(site) {
    const box = h('div', { class: 'formcard' });
    let st = { domain: site.domain || null };
    const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast('הועתק'); } catch { /* ignore */ } };
    const STEPS = [['dns', 'הגדרת רשומות DNS'], ['cert', 'GitHub מנפיק תעודת HTTPS'], ['live', 'הדומיין באוויר']];
    /* Paid hosting: move the site from GitHub Pages to Cloudflare Pages. */
    function hostingBlock() {
      const hb = h('div', { class: 'full', style: 'border-top:1px solid var(--line);padding-top:14px;margin-top:6px' });
      const HS = { building: 'Cloudflare בונה את האתר…', dns: 'ממתינים שה-DNS יצביע ל-Cloudflare', live: 'האתר מתארח ב-Cloudflare ✔' };
      const draw2 = (r) => {
        const hst = (r && r.status) || (site.hosting && site.hosting.status);
        hb.replaceChildren(h('h4', {}, 'אחסון בתשלום (Cloudflare)'));
        if (!hst) hb.append(h('p', { class: 'muted' }, 'האתר כרגע ב-GitHub Pages (חינם). ללקוח שמשלם על אחסון – אפשר להעביר ל-Cloudflare Pages.'));
        else hb.append(h('div', {}, HS[hst] || hst));
        if (r && r.error) hb.append(h('div', { style: 'color:var(--red)' }, r.error));
        if (hst === 'dns' && r && r.records) hb.append(h('div', {}, h('p', { class: 'muted' }, 'שנו אצל הרשם את הרשומה:'),
          h('div', { dir: 'ltr' }, r.records.map((x) => `${x.type}  ${x.name}  →  ${x.value}`).join('\n')), h('p', { class: 'muted' }, r.note), autoDnsBtn()));
        const run = async (ev) => {
          const b = ev.currentTarget; b.disabled = true; b.textContent = 'עובד…';
          try { const x = await api('POST', `/admin/sites/${site.id}/host`); site.hosting = x.hosting; draw2(x); if (x.status === 'live') await refresh(); }
          catch (e) { toast(e.message, true); b.disabled = false; b.textContent = hst ? 'בדיקה' : 'העברה ל-Cloudflare'; }
        };
        if (hst !== 'live') hb.append(h('button', { class: 'btn mint', onclick: run }, hst ? 'בדיקה' : 'העברה ל-Cloudflare'));
        if (hst) hb.append(h('button', { class: 'btn danger', style: 'margin-inline-start:8px', onclick: async () => {
          if (!confirm('להחזיר את האתר ל-GitHub Pages? יהיה צורך להחזיר את רשומות ה-DNS של GitHub.')) return;
          try { const x = await api('DELETE', `/admin/sites/${site.id}/host`); delete site.hosting; toast('הוחזר ל-GitHub Pages. עדכנו את ה-DNS לפי האשף.'); await refresh(); draw2(); }
          catch (e) { toast(e.message, true); }
        } }, 'החזרה ל-GitHub Pages'));
      };
      draw2();
      return hb;
    }
    const autoDnsBtn = () => h('button', { class: 'btn small', title: 'יוצר את הרשומות בחשבון ה-Cloudflare שלכם (הדומיין חייב להיות שם)', onclick: async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'מגדיר…';
      try {
        const r = await api('POST', `/admin/sites/${site.id}/dns`);
        const n = r.changes.filter((c) => c.action !== 'kept').length;
        toast(n ? `הוגדרו ${n} שינויים ב-DNS (${r.zone}). לחצו "בדיקה" בעוד רגע.` : 'ה-DNS כבר מוגדר נכון.');
      } catch (e) { toast(e.message, true); }
      b.disabled = false; b.textContent = 'הגדרת DNS אוטומטית ב-Cloudflare';
    } }, 'הגדרת DNS אוטומטית ב-Cloudflare');
    function paint(res) {
      box.replaceChildren(h('div', { class: 'full' }, h('h3', {}, 'חיבור דומיין – ' + site.name)));
      const d = st.domain;
      if (!d) {
        box.append(h('label', { class: 'field full' }, h('span', { class: 'lbl' }, 'הדומיין שהלקוח רכש'),
          h('input', { id: 'dm-name', type: 'text', dir: 'ltr', placeholder: 'www.client.co.il' }),
          h('span', { class: 'help' }, 'אפשר דומיין ראשי (client.co.il) או תת-דומיין (www.client.co.il). הרכישה עצמה אצל רשם הדומיינים.')),
          h('div', { class: 'full', style: 'display:flex;gap:10px' },
            h('button', { class: 'btn primary', onclick: async () => {
              try { st = await api('POST', `/admin/sites/${site.id}/domain`, { domain: $('#dm-name', box).value }); paint(); } catch (e) { toast(e.message, true); }
            } }, 'המשך'),
            h('button', { class: 'btn ghost', onclick: () => { showForm = null; draw(); } }, 'סגירה')));
        return;
      }
      const status = (res && res.status) || d.status;
      const idx = Math.max(0, STEPS.findIndex((x) => x[0] === status));
      box.append(h('div', { class: 'full', dir: 'ltr', style: 'font-weight:700' }, d.name),
        h('div', { class: 'full chips' }, STEPS.map((x, i) => h('span', { style: 'padding:4px 10px;border-radius:99px;background:' + (i < idx || status === 'live' ? 'var(--mint)' : i === idx ? 'var(--peach)' : 'transparent') }, (i + 1) + '. ' + x[1]))));
      if (status !== 'live') {
        box.append(h('div', { class: 'full' }, h('p', { class: 'muted' }, 'אצל רשם הדומיין (או ב-DNS שלו) מגדירים את הרשומות הבאות:'),
          h('table', { dir: 'ltr', class: 'dnstable' }, h('tbody', {}, st.records.map((r) => h('tr', {},
            h('td', {}, r.type), h('td', {}, r.name), h('td', {}, r.value), h('td', { class: 'muted' }, r.optional ? 'מומלץ' : ''),
            h('td', {}, h('button', { class: 'btn small', onclick: () => copy(r.value) }, 'העתקה')))))),
          autoDnsBtn(),
          h('p', { class: 'muted' }, 'עדכון DNS יכול לקחת מכמה דקות ועד כמה שעות. אם הדומיין ב-Cloudflare – כבו את הענן הכתום (DNS only).')));
      }
      if (res && res.dns && !res.dns.ok) box.append(h('div', { class: 'full', style: 'color:var(--red)' }, res.dns.hint));
      if (res && res.error) box.append(h('div', { class: 'full', style: 'color:var(--red)' }, res.error));
      if (status === 'cert') box.append(h('div', { class: 'full muted' }, 'ה-DNS תקין והדומיין הוגדר ב-GitHub. התעודה מונפקת בדרך כלל תוך דקות עד שעה. לחצו "בדיקה" שוב בהמשך.'));
      if (status === 'live') box.append(h('div', { class: 'full' }, 'הדומיין פעיל ✔  ', h('a', { href: 'https://' + d.name + '/', target: '_blank', rel: 'noopener', dir: 'ltr' }, 'https://' + d.name + '/')));
      box.append(hostingBlock());
      box.append(h('div', { class: 'full', style: 'display:flex;gap:10px' },
        status !== 'live' && h('button', { class: 'btn primary', onclick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true; b.textContent = 'בודק…';
          try { const r = await api('POST', `/admin/sites/${site.id}/domain/check`); st = r; paint(r); if (r.status === 'live') await refresh(true); }
          catch (e) { toast(e.message, true); b.disabled = false; b.textContent = 'בדיקה'; }
        } }, 'בדיקה'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!confirm('לנתק את הדומיין מהאתר?')) return;
          try { await api('DELETE', `/admin/sites/${site.id}/domain`); st = { domain: null }; await refresh(true); paint(); } catch (e) { toast(e.message, true); }
        } }, 'ניתוק דומיין'),
        h('button', { class: 'btn ghost', onclick: () => { showForm = null; draw(); } }, 'סגירה')));
    }
    if (site.domain) api('POST', `/admin/sites/${site.id}/domain`, { domain: site.domain.name }).then((r) => { st = r; paint(); }, () => paint());
    paint();
    return box;
  }

  function userForm(user) {
    const isNew = !user;
    const f = user || { username: '', name: '', sites: [] };
    const form = h('div', { class: 'formcard' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'שם הלקוח'), h('input', { id: 'uf-name', type: 'text', value: f.name })),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'שם משתמש'), h('input', { id: 'uf-user', type: 'text', value: f.username, dir: 'ltr', disabled: !isNew })),
      h('label', { class: 'field full' }, h('span', { class: 'lbl' }, isNew ? 'סיסמה (לפחות 8 תווים)' : 'סיסמה חדשה (השאירו ריק כדי לא לשנות)'),
        h('div', { style: 'display:flex;gap:8px' }, h('input', { id: 'uf-pass', type: 'text', dir: 'ltr', value: isNew ? randPw() : '' }),
          h('button', { class: 'btn small', onclick: () => { $('#uf-pass', form).value = randPw(); } }, 'יצירת סיסמה'))),
      h('div', { class: 'field full' }, h('span', { class: 'lbl' }, 'אתרים שהלקוח יכול לערוך'),
        h('div', { class: 'chips' }, state.sites.length ? state.sites.map((s) => h('label', {},
          h('input', { type: 'checkbox', value: s.id, checked: f.sites.includes(s.id) }), s.name)) : h('span', { class: 'muted' }, 'עוד לא הוגדרו אתרים'))),
      h('div', { class: 'full', style: 'display:flex;gap:10px' },
        h('button', { class: 'btn primary', onclick: async () => {
          const sites = [...form.querySelectorAll('.chips input:checked')].map((i) => i.value);
          const password = $('#uf-pass', form).value;
          const body = { name: $('#uf-name', form).value.trim(), username: $('#uf-user', form).value.trim(), sites, password };
          try {
            await api(isNew ? 'POST' : 'PUT', '/admin/users' + (isNew ? '' : '/' + f.username), body);
            showForm = null;
            creds = password ? { name: body.name, username: body.username || f.username, password } : null;
            await refresh();
          } catch (e) { toast(e.message, true); }
        } }, isNew ? 'יצירת לקוח' : 'שמירה'),
        h('button', { class: 'btn ghost', onclick: () => { showForm = null; draw(); } }, 'ביטול')));
    return form;
  }

  let showForm = null;   // {type:'site'|'user', item}
  let creds = null;

  function draw() {
    sessionStorage.setItem('adm-tab', tab);
    const tabs = h('div', { class: 'tabs' },
      h('button', { 'aria-selected': tab === 'sites', onclick: () => { tab = 'sites'; showForm = null; draw(); } }, 'אתרים'),
      h('button', { 'aria-selected': tab === 'users', onclick: () => { tab = 'users'; showForm = null; draw(); } }, 'לקוחות'));
    const body = [];

    if (tab === 'sites') {
      body.push(h('div', { style: 'margin-bottom:16px' }, h('button', { class: 'btn primary', onclick: () => { showForm = { type: 'site' }; draw(); } }, '＋ הוספת אתר')));
      if (showForm && showForm.type === 'site') body.push(siteForm(showForm.item));
      if (showForm && showForm.type === 'domain') body.push(domainPanel(showForm.item));
      body.push(h('div', { class: 'list' }, state.sites.map((s) => h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, s.name), h('div', { class: 's' }, s.url + '  ·  ' + s.repo)),
        h('button', { class: 'btn small mint', title: 'מוסיף לאתר את ערכת העריכה (פעם אחת)', onclick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true; b.textContent = 'מחבר…';
          try { await api('POST', `/admin/sites/${s.id}/connect`); toast('האתר חובר למערכת העריכה. ייקח כדקה עד שהשינוי יתפרסם.'); }
          catch (e) { toast(e.message, true); }
          b.disabled = false; b.textContent = 'חיבור לעריכה';
        } }, 'חיבור לעריכה'),
        h('button', { class: 'btn small', onclick: () => { showForm = { type: 'domain', item: s }; draw(); scrollTo(0, 0); } }, s.domain ? 'דומיין ✔' : 'דומיין'),
        h('a', { class: 'btn small', href: '#/site/' + s.id }, 'פתיחה'),
        h('button', { class: 'btn small', onclick: () => { showForm = { type: 'site', item: s }; draw(); scrollTo(0, 0); } }, 'עריכה'),
        h('button', { class: 'btn small danger', onclick: async () => {
          if (!confirm(`למחוק את "${s.name}" מהמערכת?\n(האתר עצמו ב-GitHub לא נמחק)`)) return;
          try { await api('DELETE', '/admin/sites/' + s.id); await refresh(); } catch (e) { toast(e.message, true); }
        } }, 'מחיקה')))));
      if (!state.sites.length) body.push(h('div', { class: 'empty' }, h('p', {}, 'עוד אין אתרים. הוסיפו אתר, לחצו "חיבור לעריכה", ואז צרו לקוח.')));
    } else {
      body.push(h('div', { style: 'margin-bottom:16px' }, h('button', { class: 'btn primary', onclick: () => { showForm = { type: 'user' }; creds = null; draw(); } }, '＋ לקוח חדש')));
      if (creds) {
        const text = `שלום ${creds.name} 👋\nהנה הכניסה לעריכת האתר שלך:\n${origin}\nשם משתמש: ${creds.username}\nסיסמה: ${creds.password}`;
        body.push(h('div', { class: 'formcard' }, h('div', { class: 'full' }, h('h3', {}, 'פרטי הכניסה מוכנים לשליחה'),
          h('p', { class: 'muted' }, 'הסיסמה מוצגת רק עכשיו – העתיקו ושלחו ללקוח.'), h('div', { class: 'creds' }, text),
          h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn mint', onclick: async () => { await navigator.clipboard.writeText(text); toast('הועתק'); } }, 'העתקה')))));
      }
      if (showForm && showForm.type === 'user') body.push(userForm(showForm.item));
      body.push(h('div', { class: 'list' }, state.users.map((u) => h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, u.name), h('div', { class: 's' }, u.username + '  ·  ' + (u.sites.length ? u.sites.join(', ') : 'ללא אתרים'))),
        h('button', { class: 'btn small', onclick: () => { showForm = { type: 'user', item: u }; creds = null; draw(); scrollTo(0, 0); } }, 'עריכה / סיסמה'),
        h('button', { class: 'btn small danger', onclick: async () => {
          if (!confirm(`למחוק את ${u.name}? הגישה תיחסם מיד.`)) return;
          try { await api('DELETE', '/admin/users/' + u.username); await refresh(); } catch (e) { toast(e.message, true); }
        } }, 'מחיקה')))));
      if (!state.users.length) body.push(h('div', { class: 'empty' }, h('p', {}, 'עוד אין לקוחות.')));
    }
    content.replaceChildren(h('h1', {}, 'ניהול ', h('span', { class: 'hl' }, 'לקוחות ואתרים')),
      h('p', { class: 'sub' }, 'כאן מגדירים אתרים, מחברים אותם לעריכה ויוצרים כניסה ללקוחות.'), tabs, ...body);
  }

  shell([topbar(), h('main', { class: 'page' }, doodle('rocket', 'deco'), content)]);
  Object.assign($('.deco').style, { width: '64px', top: '30px', left: '40px' });
  try { await refresh(); } catch (e) { toast(e.message, true); }
}

/* ======================= visual editor ======================= */
const FONTS = [
  // Hebrew-capable
  'Heebo', 'Assistant', 'Rubik', 'Alef', 'Secular One', 'Varela Round', 'Frank Ruhl Libre', 'David Libre', 'Suez One', 'Karantina',
  'Miriam Libre', 'Noto Sans Hebrew', 'Noto Serif Hebrew', 'Open Sans', 'Amatic SC', 'Bellefair', 'Playpen Sans Hebrew', 'Tinos', 'Arimo', 'Gveret Levin',
  // Latin
  'Poppins', 'Montserrat', 'Roboto', 'Lato', 'Inter', 'Nunito', 'Raleway', 'Oswald', 'Playfair Display', 'Merriweather', 'Lora', 'DM Sans',
  'Work Sans', 'Cormorant Garamond', 'Bebas Neue', 'Pacifico', 'Dancing Script', 'Quicksand', 'Josefin Sans', 'Libre Baskerville',
];

async function resolveFont(family) {
  const fam = family.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9 ]{1,60}$/.test(fam)) return { error: 'שם פונט לא תקין (אנגלית בלבד, כפי שמופיע ב-Google Fonts).' };
  const q = fam.replace(/ /g, '+');
  const variants = [':wght@300;400;500;600;700;800', ':wght@400;700', ''];
  let network = false;
  for (const v of variants) {
    const url = `https://fonts.googleapis.com/css2?family=${q}${v}&display=swap`;
    try {
      const r = await fetch(url);
      if (r.ok) return { family: fam, url, hebrew: /\/\*\s*hebrew\s*\*\//.test(await r.text()) };
    } catch { network = true; break; }
  }
  if (network) return { family: fam, url: `https://fonts.googleapis.com/css2?family=${q}${variants[1]}&display=swap`, unverified: true };
  return { error: `הפונט "${fam}" לא נמצא ב-Google Fonts.` };
}
function previewFont(f) {
  const id = 'pf-' + f.family.replace(/\W/g, '_');
  if (!document.getElementById(id)) document.head.append(h('link', { id, rel: 'stylesheet', href: f.url }));
}

function slug(name) { return name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'img'; }

async function processImage(file) {
  if (!/^image\//.test(file.type)) throw new Error('הקובץ שנבחר אינו תמונה.');
  if (file.size > 30e6) throw new Error('התמונה גדולה מדי (מעל 30MB).');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('לא ניתן לקרוא את התמונה. השתמשו בקובץ JPG או PNG.'); }
  const sc = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  let png = false;
  if (file.type === 'image/png') {
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < px.length; i += 4 * 17) if (px[i] < 250) { png = true; break; }
  }
  if (!png) { const t = document.createElement('canvas'); t.width = cv.width; t.height = cv.height; const c2 = t.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, t.width, t.height); c2.drawImage(cv, 0, 0); ctx.drawImage(t, 0, 0); }
  const dataUrl = cv.toDataURL(png ? 'image/png' : 'image/jpeg', 0.86);
  const path = `cms/uploads/${Date.now().toString(36)}-${slug(file.name)}.${png ? 'png' : 'jpg'}`;
  return { path, dataUrl, base64: dataUrl.split(',')[1], uploaded: false };
}
const DOC_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip'];
const MAX_DOC = 10 * 1024 * 1024;

async function processDocument(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!DOC_EXT.includes(ext)) throw new Error('סוג הקובץ לא נתמך. אפשר: PDF, Word, Excel, PowerPoint או ZIP.');
  if (file.size > MAX_DOC) throw new Error('הקובץ גדול מדי (עד 10MB). אפשר לדחוס אותו או להעלות אותו לשירות אחסון ולהדביק קישור.');
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const name = file.name.replace(/\.[^.]+$/, '');
  return { path: `cms/uploads/${Date.now().toString(36)}-${slug(file.name)}.${ext}`, base64, dataUrl: null, uploaded: false, name };
}

// YouTube / Vimeo links in any common form -> {provider, vid}; anything else is refused.
function parseVideoUrl(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  let id = null;
  if (host === 'youtu.be') id = seg[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = u.searchParams.get('v') || (['embed', 'shorts', 'live', 'v'].includes(seg[0]) ? seg[1] : null);
  if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) return { provider: 'youtube', vid: id };
  let vid = null;
  if (host === 'vimeo.com') vid = seg.find((x) => /^\d{5,12}$/.test(x));
  else if (host === 'player.vimeo.com' && seg[0] === 'video') vid = seg[1];
  if (vid && /^\d{5,12}$/.test(vid)) return { provider: 'vimeo', vid };
  return null;
}
const videoUrlOf = (v) => (v.provider === 'vimeo' ? `https://vimeo.com/${v.vid}` : `https://www.youtube.com/watch?v=${v.vid}`);

const pickFile = (accept = 'image/*') => new Promise((res) => {
  const i = h('input', { type: 'file', accept });
  i.addEventListener('change', () => res(i.files[0] || null));
  i.click();
});

async function viewEditor(siteId) {
  const site = me.sites.find((s) => s.id === siteId);
  if (!site) { toast('האתר לא נמצא', true); location.hash = '#/'; return; }
  const siteOrigin = new URL(site.url).origin;

  const E = {
    site, edits: null, loaded: '', baseSha: null, pending: new Map(), undo: [], redo: [], lastPush: 0,
    page: site.pages[0], palette: [], origFonts: {}, unit: null, tab: 'sel', ready: false, device: 'desktop', liveToken: 0,
    sections: [], kitVersion: 0,
  };

  let data;
  try { data = await api('GET', `/sites/${siteId}/edits`); } catch (e) { toast(e.message, true); location.hash = '#/'; return; }
  E.edits = data.edits; E.baseSha = data.sha; E.loaded = JSON.stringify(E.edits);

  /* ---- state helpers ---- */
  const els = () => ((E.edits.pages[E.page] ||= { els: {} }).els);
  const layoutOps = () => ((E.edits.pages[E.page] ||= { els: {} }).layout ||= []);
  const specOf = (key) => els()[key] || {};
  const isDirty = () => JSON.stringify(E.edits) !== E.loaded;

  // Snapshots are taken only when something really changed; typing bursts coalesce into one step.
  function record(before, force) {
    const now = Date.now();
    if (force || now - E.lastPush > 800) { E.undo.push(before); if (E.undo.length > 60) E.undo.shift(); E.redo = []; }
    E.lastPush = now;
  }
  function cleanup() {
    for (const [k, s] of Object.entries(els())) {
      if (s.n && !Object.keys(s.n).length) delete s.n;
      if (!Object.keys(s).length) delete els()[k];
    }
    const pg = E.edits.pages[E.page];
    if (pg && pg.layout && !pg.layout.length) delete pg.layout;
  }
  function mutate(fn, opts = {}) {
    const before = JSON.stringify(E.edits);
    fn();
    cleanup();
    if (JSON.stringify(E.edits) === before) return;
    record(before, opts.force);
    changed(opts);
  }
  function setSpec(key, patch, opts = {}) {
    mutate(() => {
      const s = { ...(els()[key] || {}) };
      for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete s[k]; else s[k] = v; }
      els()[key] = s;
    }, opts);
  }
  function setNode(key, idx, text) {
    mutate(() => { const s = { ...(els()[key] || {}) }; s.n = { ...(s.n || {}), [idx]: text }; els()[key] = s; });
  }
  function setGlobal(fn) { mutate(() => fn((E.edits.global ||= {})), { force: true }); }

  /* ---- structure: move / duplicate / hide / delete a copy ---- */
  const frameSend = (msg) => { const f = $('#frame'); if (f && f.contentWindow) f.contentWindow.postMessage(msg, siteOrigin); };
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  const waiters = new Map();   // reqId -> resolve, for answers from the site frame

  function moveEl(key, dir) {
    mutate(() => {
      const ops = layoutOps();
      const last = ops[ops.length - 1];
      if (last && last.op === 'move' && last.key === key && last.dir === -dir) ops.pop();   // up then down cancels out
      else ops.push({ op: 'move', key, dir });
    }, { force: true });
  }
  function toggleHide(key) {
    mutate(() => {
      const ops = layoutOps();
      const i = ops.findIndex((o) => o.op === 'hide' && o.key === key);
      if (i >= 0) ops.splice(i, 1); else ops.push({ op: 'hide', key });
    }, { force: true });
  }
  async function duplicateEl(key, { newText } = {}) {
    const id = newId();
    mutate(() => { layoutOps().push({ op: 'dup', src: key, id }); }, { force: true });
    // Ask the site which element in the copy corresponds to which original, then copy the existing edits over
    // so the copy starts out looking exactly like the original and can be edited independently.
    sendToFrame();
    const reqId = Math.random();
    const answer = new Promise((res) => { waiters.set(reqId, res); setTimeout(() => res(null), 2500); });
    await sleep(120);
    frameSend({ type: 'cms-subtree-map', src: key, id, reqId });
    const map = await answer;
    mutate(() => {
      const cur = els();
      for (const [from, to] of (map ? map.pairs : [])) if (cur[from] && from !== to) cur[to] = JSON.parse(JSON.stringify(cur[from]));
      if (newText != null) cur['@' + id] = { ...(cur['@' + id] || {}), t: newText };
    }, { force: true });
    sendToFrame();
    await sleep(120);
    frameSend({ type: 'cms-select-key', key: '@' + id });
    return id;
  }
  // Add a new element (image, button, video, file, text, heading, divider) right after `afterKey`.
  async function addElement(afterKey, type, { p, spec } = {}) {
    const id = newId();
    mutate(() => {
      layoutOps().push({ op: 'add', after: afterKey, id, type, ...(p ? { p } : {}) });
      if (spec) els()['@' + id] = spec;
    }, { force: true });
    sendToFrame();
    await sleep(150);
    frameSend({ type: 'cms-select-key', key: '@' + id });
    return id;
  }
  function askVideoUrl() {
    return new Promise((resolve) => {
      const input = h('input', { type: 'text', dir: 'ltr', placeholder: 'https://www.youtube.com/watch?v=…' });
      const err = h('p', { class: 'error', hidden: true });
      const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
      const dlg = h('dialog', {}, h('h2', {}, 'הוספת סרטון'),
        h('p', { class: 'muted' }, 'הדביקו קישור לסרטון מ-YouTube או מ-Vimeo.'), input, err,
        h('menu', {}, h('button', { class: 'btn ghost', onclick: () => done(null) }, 'ביטול'),
          h('button', { class: 'btn primary', onclick: () => {
            const v = parseVideoUrl(input.value);
            if (!v) { err.textContent = 'הקישור לא תקין. אפשר רק YouTube או Vimeo.'; err.hidden = false; return; }
            done(v);
          } }, 'הוספה')));
      dlg.addEventListener('cancel', () => done(null));
      document.body.append(dlg); dlg.showModal(); input.focus();
    });
  }
  // Removing a copy / an added element = removing its op, plus everything that referred to it (nested copies, edits, moves).
  function deleteCopy(id) {
    mutate(() => {
      const gone = new Set([id]);
      const ops = layoutOps();
      const copyOf = (k) => { const m = /^@([a-z0-9]+)/.exec(k || ''); return m ? m[1] : null; };
      const inGone = (k) => gone.has(copyOf(k));
      const creates = (o) => o.op === 'dup' || o.op === 'add';
      let grew = true;
      while (grew) {
        grew = false;
        for (const o of ops) if (creates(o) && !gone.has(o.id) && inGone(o.src || o.after)) { gone.add(o.id); grew = true; }
      }
      const pg = E.edits.pages[E.page];
      pg.layout = ops.filter((o) => !(creates(o) && gone.has(o.id)) && !inGone(o.key));
      for (const k of Object.keys(pg.els)) if (inGone(k)) delete pg.els[k];
    }, { force: true });
    E.unit = null;
    frameSend({ type: 'cms-deselect' });
    renderInsp();
  }

  let sendTimer;
  function sendToFrame() {
    const f = $('#frame');
    if (!E.ready || !f || !f.contentWindow) return;
    const assets = {};
    E.pending.forEach((v, k) => { if (v.dataUrl) assets[k] = v.dataUrl; });
    f.contentWindow.postMessage({ type: 'cms-edits', edits: E.edits, assets }, siteOrigin);
  }
  function changed(opts = {}) {
    refreshChip();
    if (!opts.live) { clearTimeout(sendTimer); sendTimer = setTimeout(sendToFrame, 60); }
  }

  function undo() { if (!E.undo.length) return; E.redo.push(JSON.stringify(E.edits)); E.edits = JSON.parse(E.undo.pop()); afterTimeTravel(); }
  function redo() { if (!E.redo.length) return; E.undo.push(JSON.stringify(E.edits)); E.edits = JSON.parse(E.redo.pop()); afterTimeTravel(); }
  function afterTimeTravel() { changed(); renderInsp(); }

  /* ---- chip / publish ---- */
  const CHIP = { clean: 'אין שינויים', dirty: 'יש שינויים שלא פורסמו', publishing: 'מפרסם… האתר יתעדכן בעוד כדקה', live: 'האתר מעודכן ✓', slow: 'פורסם – העדכון מתעכב, רעננו בעוד רגע', error: 'הפרסום נכשל' };
  function setChip(s) { const c = $('#chip'); if (c) { c.dataset.s = s === 'slow' ? 'live' : s; c.textContent = CHIP[s]; } }
  function refreshChip() {
    const d = isDirty();
    const pb = $('#publish'); if (pb) pb.disabled = !d;
    const ub = $('#undo'); if (ub) ub.disabled = !E.undo.length;
    const rb = $('#redo'); if (rb) rb.disabled = !E.redo.length;
    const c = $('#chip');
    if (d) setChip('dirty'); else if (c && c.dataset.s === 'dirty') setChip('clean');
  }
  const leave = () => { if (!isDirty() || confirm('יש שינויים שלא פורסמו. לעזוב בכל זאת?')) location.hash = '#/'; };
  window.onbeforeunload = () => (isDirty() ? true : undefined);

  async function publish() {
    if (!isDirty()) return;
    const btn = $('#publish'); btn.disabled = true; btn.textContent = 'מפרסם…';
    const snapshot = clone(E.edits), snapJson = JSON.stringify(snapshot);
    const used = JSON.stringify(snapshot);
    const images = [...E.pending].filter(([path, v]) => !v.uploaded && used.includes(`"${path}"`)).map(([path, v]) => ({ path, base64: v.base64 }));
    try {
      let res;
      try { res = await api('PUT', `/sites/${siteId}/edits`, { edits: snapshot, baseSha: E.baseSha, images }); }
      catch (e) {
        if (e.status !== 409 || !confirm(e.message + '\nלפרסם בכל זאת ולדרוס את העדכון שלהם?')) throw e;
        res = await api('PUT', `/sites/${siteId}/edits`, { edits: snapshot, baseSha: E.baseSha, images, force: true });
      }
      E.baseSha = res.sha; E.loaded = snapJson;
      const published = res.edits || snapshot;
      E.pending.forEach((v, k) => { if (images.some((i) => i.path === k)) v.uploaded = true; });
      refreshChip();
      toast('נשמר! האתר מתעדכן – בדרך כלל תוך דקה.');
      waitLive(published);
    } catch (e) { setChip('error'); toast(e.message, true); }
    btn.textContent = 'פרסום באתר'; btn.disabled = !isDirty();
  }
  // Key order must not matter: the server rebuilds the document field by field.
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  async function waitLive(published) {
    const token = ++E.liveToken;
    setChip('publishing');
    const expected = JSON.stringify(canon(published));
    for (let i = 0; i < 45; i++) {
      await sleep(i < 3 ? 4000 : 8000);
      if (token !== E.liveToken) return;
      try {
        const r = await fetch(new URL('cms/edits.json', site.url).href + '?_=' + Date.now(), { cache: 'no-store' });
        if (r.ok && JSON.stringify(canon(await r.json())) === expected) { if (!isDirty()) setChip('live'); return; }
      } catch { /* keep polling */ }
    }
    if (token === E.liveToken && !isDirty()) setChip('slow');
  }

  async function showHistory() {
    const list = h('ul', { class: 'history' }, h('li', {}, 'טוען…'));
    const dlg = h('dialog', {}, h('h2', {}, 'גרסאות קודמות'),
      h('p', { class: 'muted' }, 'טעינה של גרסה תכניס אותה לעורך. היא לא תפורסם עד שתלחצו "פרסום באתר".'), list,
      h('menu', {}, h('button', { class: 'btn', onclick: () => dlg.close() }, 'סגירה')));
    document.body.append(dlg); dlg.showModal(); dlg.addEventListener('close', () => dlg.remove());
    try {
      const { commits } = await api('GET', `/sites/${siteId}/history`);
      list.replaceChildren(...(commits.length ? commits.map((c, i) => h('li', {},
        h('div', {}, new Date(c.date).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' }) + (i === 0 ? ' · הנוכחית' : ''), h('small', {}, c.message)),
        i > 0 && h('button', { class: 'btn small', onclick: async () => {
          if (isDirty() && !confirm('השינויים הנוכחיים שלא פורסמו יוחלפו. להמשיך?')) return;
          try { const v = await api('GET', `/sites/${siteId}/version/${c.sha}`); const before = JSON.stringify(E.edits); E.edits = v.edits; record(before, true); dlg.close(); changed(); renderInsp(); toast('הגרסה נטענה. לחצו "פרסום באתר" כדי להחזיר אותה.'); }
          catch (e) { toast(e.message, true); }
        } }, 'טעינה'))) : [h('li', {}, 'אין עדיין גרסאות קודמות.')]));
    } catch (e) { list.replaceChildren(h('li', { class: 'error' }, e.message)); }
  }

  /* ---- inspector ---- */
  const insp = h('div', { class: 'insp-body' });
  const tabsEl = h('div', { class: 'insp-tabs' });

  function setTab(t) { E.tab = t; renderInsp(); }

  function colorField(label, current, isSet, onSet, onReset) {
    const input = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#ffffff' });
    input.addEventListener('input', () => onSet(input.value));
    return h('div', { class: 'field' }, h('span', { class: 'lbl' }, label),
      h('div', { class: 'colorrow' }, input, h('code', {}, current || 'שקוף'),
        isSet && h('button', { class: 'link', onclick: onReset }, 'איפוס')));
  }

  function fontPicker(label, current, onPick, onReset, hintOriginal) {
    const dl = 'fl-' + Math.random().toString(36).slice(2);
    const input = h('input', { type: 'text', list: dl, dir: 'ltr', placeholder: hintOriginal ? `כרגע: ${hintOriginal}` : 'שם פונט מ-Google Fonts', value: current ? current.family : '' });
    const status = h('div', { class: 'help' });
    const prev = h('div', { class: 'fontprev', hidden: !current }, 'אבגד הוז – The quick brown fox');
    if (current) { previewFont(current); prev.style.fontFamily = `"${current.family}", sans-serif`; }
    let last = current ? current.family : null;   // re-picking the same font (e.g. on blur) must not count as a new edit
    const apply = async () => {
      if (!input.value.trim() || input.value.trim() === last) return;
      status.textContent = 'בבדיקה…';
      const f = await resolveFont(input.value);
      if (f.error) { status.replaceChildren(h('span', { class: 'error' }, f.error)); return; }
      last = f.family;
      previewFont(f); prev.hidden = false; prev.style.fontFamily = `"${f.family}", sans-serif`;
      status.replaceChildren(f.unverified ? h('span', { class: 'badge warn' }, 'לא ניתן לאמת כרגע') : f.hebrew ? h('span', { class: 'badge' }, 'תומך עברית ✓') : h('span', { class: 'badge warn' }, 'ללא עברית – מתאים לטקסט באנגלית'));
      onPick({ family: f.family, url: f.url });
    };
    input.addEventListener('change', apply);
    return h('div', { class: 'field' }, h('span', { class: 'lbl' }, label), input,
      h('datalist', { id: dl }, FONTS.map((f) => h('option', { value: f }))), prev, status,
      current && h('div', {}, h('button', { class: 'link', onclick: onReset }, 'איפוס לפונט המקורי')));
  }

  const NEED_KIT = 2;      // first kit version that supports formatting and structure edits (see kit/cms-kit.js)
  const ADD_KIT = 4;       // first kit version that can add elements
  const LATEST_KIT = 4;    // newest kit; older sites keep working, the owner is just offered the update
  const kitTooOld = () => E.ready && E.kitVersion < NEED_KIT;
  const oldKitNote = () => h('p', { class: 'help warnbox' }, 'האפשרות הזו תעבוד אחרי עדכון ערכת העריכה באתר (פעולה חד-פעמית של הסוכנות).');

  function tgBtn(label, title, on, onclick, extraClass) {
    return h('button', { type: 'button', class: 'tg ' + (extraClass || ''), title, 'aria-pressed': !!on, onclick }, label);
  }

  function fmtSection(u, spec) {
    const cur = (k, fallback) => (spec[k] != null ? spec[k] : fallback);
    const size = cur('fs', u.fs);
    const num = h('input', { type: 'number', min: 8, max: 200, value: size, style: 'width:84px', dir: 'ltr' });
    const range = h('input', { type: 'range', min: 10, max: 120, value: Math.min(120, Math.max(10, size)), style: 'flex:1' });
    const current = () => +num.value || size;
    const setFs = (v) => { v = Math.round(Math.min(200, Math.max(8, +v || current()))); num.value = v; range.value = Math.min(120, Math.max(10, v)); setSpec(u.key, { fs: v }); };
    range.addEventListener('input', () => setFs(range.value));
    num.addEventListener('change', () => setFs(num.value));
    const set = (patch) => { setSpec(u.key, patch, { force: true }); renderInsp(); };
    const aligns = [['right', 'ימין', '☰'], ['center', 'מרכז', '≡'], ['left', 'שמאל', '☷']];
    const al = cur('al', u.al);
    return h('div', { class: 'sect' }, h('h4', {}, 'עיצוב טקסט'), kitTooOld() && oldKitNote(),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'גודל (פיקסלים בדסקטופ; בנייד מתכווץ אוטומטית)'),
        h('div', { class: 'colorrow' },
          h('button', { class: 'tg', type: 'button', onclick: () => setFs(current() - 2) }, '−'), range, h('button', { class: 'tg', type: 'button', onclick: () => setFs(current() + 2) }, '+'), num)),
      h('div', { class: 'tgrow' },
        tgBtn('B', 'מודגש', cur('b', u.b), () => set({ b: !cur('b', u.b) }), 'b'),
        tgBtn('I', 'נטוי', cur('i', u.i), () => set({ i: !cur('i', u.i) }), 'i'),
        tgBtn('U', 'קו תחתון', cur('u', u.u), () => set({ u: !cur('u', u.u) }), 'u'),
        tgBtn('S', 'קו חוצה', cur('st', u.st), () => set({ st: !cur('st', u.st) }), 's'),
        h('span', { class: 'sep' }),
        ...aligns.map(([v, t, ic]) => tgBtn(ic, 'יישור ' + t, al === v, () => set({ al: v })))),
      u.kind === 'node' && h('span', { class: 'help' }, 'העיצוב חל על כל הפסקה שהטקסט הזה נמצא בה.'),
      (spec.fs || spec.b != null || spec.i != null || spec.u != null || spec.st != null || spec.al) &&
        h('div', {}, h('button', { class: 'link', onclick: () => set({ fs: undefined, b: undefined, i: undefined, u: undefined, st: undefined, al: undefined }) }, 'איפוס העיצוב')));
  }

  function elementSection(u) {
    const old = kitTooOld();
    const isText = u.kind === 'text';
    return h('div', { class: 'sect' }, h('h4', {}, 'מיקום והוספה'), old && oldKitNote(),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn small', disabled: old || !u.canUp, onclick: () => moveEl(u.key, -1) }, '↑ הזזה למעלה'),
        h('button', { class: 'btn small', disabled: old || !u.canDown, onclick: () => moveEl(u.key, 1) }, '↓ הזזה למטה'),
        h('button', { class: 'btn small mint', disabled: old, title: 'יוצר עותק זהה מיד אחרי האלמנט הזה', onclick: () => duplicateEl(u.key) }, '⎘ שכפול'),
        isText && h('button', { class: 'btn small mint', disabled: old, onclick: () => duplicateEl(u.key, { newText: 'טקסט חדש' }) }, '＋ הוספת טקסט כזה מתחת'),
        h('button', { class: 'btn small', disabled: old, onclick: () => { toggleHide(u.key); } }, u.hidden ? '👁 הצגה' : '🚫 הסתרה'),
        u.clone && h('button', { class: 'btn small danger', onclick: () => deleteCopy(u.clone) }, u.added ? '✕ מחיקת האלמנט' : '✕ מחיקת העותק')),
      h('button', { class: 'link', onclick: () => frameSend({ type: 'cms-select-parent' }) }, '⬆ בחירת האלמנט שמעל (למשל כל הקטע)'),
      h('span', { class: 'help' }, 'להזיז או לשכפל קטע שלם: לחצו "בחירת האלמנט שמעל" עד שהקטע כולו מסומן, או השתמשו בלשונית "מבנה".'));
  }

  function addSection(u) {
    const old = E.ready && E.kitVersion < ADD_KIT;
    const guard = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message, true); } };
    const btn = (label, title, fn) => h('button', { class: 'btn small', disabled: old, title, onclick: guard(fn) }, label);
    return h('div', { class: 'sect' }, h('h4', {}, 'הוספת אלמנט מתחת'),
      old && h('p', { class: 'help warnbox' }, 'הוספת אלמנטים תעבוד אחרי עדכון ערכת העריכה באתר (פעולה חד-פעמית של הסוכנות).'),
      h('div', { class: 'btnrow' },
        btn('🖼 תמונה', 'העלאת תמונה מהמחשב', async () => {
          const f = await pickFile(); if (!f) return;
          toast('מעבד תמונה…');
          const im = await processImage(f); E.pending.set(im.path, im);
          await addElement(u.key, 'image', { spec: { src: im.path, alt: '' } });
          toast('התמונה נוספה. לחצו "פרסום באתר" כדי לשמור.');
        }),
        btn('🔘 כפתור', 'כפתור עם קישור, בעיצוב הכפתורים של האתר', () => addElement(u.key, 'button', { spec: { t: 'לחצו כאן', href: '#' } })),
        btn('▶ סרטון', 'סרטון מ-YouTube או Vimeo', async () => {
          const v = await askVideoUrl(); if (!v) return;
          await addElement(u.key, 'video', { p: v });
        }),
        btn('📄 קובץ להורדה', 'PDF, Word, Excel, PowerPoint או ZIP (עד 10MB)', async () => {
          const f = await pickFile('.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip'); if (!f) return;
          toast('מכין את הקובץ…');
          const d = await processDocument(f); E.pending.set(d.path, d);
          await addElement(u.key, 'file', { spec: { t: 'הורדה: ' + d.name, href: d.path } });
          toast('הקובץ נוסף. לחצו "פרסום באתר" כדי לשמור.');
        }),
        btn('T טקסט', 'פסקה חדשה', () => addElement(u.key, 'text')),
        btn('H כותרת', 'כותרת חדשה', () => addElement(u.key, 'heading')),
        btn('— מפריד', 'קו מפריד', () => addElement(u.key, 'divider'))),
      h('span', { class: 'help' }, 'האלמנט החדש מופיע מיד אחרי האלמנט הנבחר ומקבל את העיצוב של האתר.'));
  }

  function videoField(u) {
    const cur = u.vid ? { provider: u.vid.split(':')[0], vid: u.vid.split(':')[1] } : null;
    const input = h('input', { type: 'text', dir: 'ltr', value: cur ? videoUrlOf(cur) : '' });
    const msg = h('span', { class: 'help' }, 'YouTube או Vimeo בלבד.');
    input.addEventListener('change', () => {
      const v = parseVideoUrl(input.value);
      if (!v) { msg.textContent = 'הקישור לא תקין. אפשר רק YouTube או Vimeo.'; msg.className = 'help error'; return; }
      msg.textContent = 'הסרטון עודכן.'; msg.className = 'help';
      mutate(() => { const op = layoutOps().find((o) => o.op === 'add' && o.id === u.clone); if (op) op.p = v; }, { force: true });
    });
    return h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'קישור לסרטון'), input, msg);
  }

  function inspStructure() {
    const list = E.sections || [];
    const old = kitTooOld();
    return [h('h3', {}, 'מבנה ', h('span', { class: 'hl' }, 'הדף')),
      h('p', { class: 'muted' }, 'סידור מחדש, שכפול והסתרה של קטעים שלמים. לחיצה על שם קטע מסמנת אותו בדף.'),
      old && oldKitNote(),
      !list.length ? h('p', { class: 'muted' }, E.ready ? 'לא נמצאו קטעים בדף.' : 'הקטעים נטענים…') :
        h('div', { class: 'list' }, list.map((x, i) => h('div', { class: 'item sec' + (x.hidden ? ' off' : '') },
          h('button', { class: 'grow secname', onclick: () => frameSend({ type: 'cms-select-key', key: x.key }) },
            (x.label || x.tag), x.clone && h('span', { class: 'badge' }, 'עותק'), x.hidden && h('span', { class: 'badge warn' }, 'מוסתר')),
          h('button', { class: 'tg', title: 'הזזה למעלה', disabled: old || !x.up, onclick: () => moveEl(x.key, -1) }, '↑'),
          h('button', { class: 'tg', title: 'הזזה למטה', disabled: old || !x.down, onclick: () => moveEl(x.key, 1) }, '↓'),
          h('button', { class: 'tg', title: 'שכפול הקטע', disabled: old, onclick: () => duplicateEl(x.key) }, '⎘'),
          h('button', { class: 'tg', title: x.hidden ? 'הצגה' : 'הסתרה', disabled: old, onclick: () => toggleHide(x.key) }, x.hidden ? '👁' : '🚫'),
          x.clone && h('button', { class: 'tg del', title: 'מחיקת העותק', onclick: () => deleteCopy(x.clone) }, '✕'))))];
  }

  function inspSelection() {
    const u = E.unit;
    if (!u) return [h('div', { class: 'hint' }, doodle('butterfly'), h('div', {}, h('b', {}, 'לחצו על כל דבר באתר'), h('div', {}, 'טקסט, תמונה או כפתור – ותוכלו לערוך אותו כאן. לחיצה כפולה על טקסט מאפשרת להקליד ישירות על הדף.')))];
    const out = [];
    const spec = specOf(u.key);
    const kindName = { text: 'טקסט', node: 'טקסט', image: 'תמונה', bg: 'תמונת רקע', box: 'אלמנט' }[u.kind];
    out.push(h('h3', {}, 'עריכת ', h('span', { class: 'hl' }, kindName)));

    if (u.added === 'video') out.push(videoField(u));
    if (u.kind === 'text' || u.kind === 'node') {
      const cur = u.kind === 'text' ? (spec.t ?? u.text) : ((spec.n || {})[u.idx] ?? u.text);
      const ta = h('textarea', { rows: 4 }); ta.value = cur;
      ta.addEventListener('input', () => (u.kind === 'text' ? setSpec(u.key, { t: ta.value }) : setNode(u.key, u.idx, ta.value)));
      out.push(h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'הטקסט'), ta,
        u.kind === 'text' && h('span', { class: 'help' }, 'Enter מוסיף שורה חדשה.')));
    }
    if (u.kind === 'image' || u.kind === 'bg') {
      const src = spec.src || spec.bgimg;
      const shown = src ? (E.pending.get(src)?.dataUrl || new URL(src, site.url).href) : (u.currentSrc || '');
      out.push(h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'התמונה'),
        h('div', { class: 'thumb', style: shown ? `background-image:url("${shown.replace(/["\\()\s]/g, encodeURIComponent)}")` : '' }),
        h('div', { style: 'display:flex;gap:10px;align-items:center' },
          h('button', { class: 'btn mint small', onclick: async () => {
            const f = await pickFile(); if (!f) return;
            toast('מעבד תמונה…');
            try {
              const im = await processImage(f); E.pending.set(im.path, im);
              setSpec(u.key, u.kind === 'image' ? { src: im.path } : { bgimg: im.path }, { force: true });
              renderInsp(); toast('התמונה הוחלפה בתצוגה. לחצו "פרסום באתר" כדי לשמור.');
            } catch (e) { toast(e.message, true); }
          } }, 'החלפת תמונה'),
          src && h('button', { class: 'link', onclick: () => { setSpec(u.key, { src: undefined, bgimg: undefined }, { force: true }); renderInsp(); } }, 'איפוס')),
        h('span', { class: 'help' }, 'התמונה מוקטנת אוטומטית לטעינה מהירה.')));
      if (u.kind === 'image') {
        const alt = h('input', { type: 'text', value: spec.alt ?? u.alt });
        alt.addEventListener('input', () => setSpec(u.key, { alt: alt.value }));
        out.push(h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'תיאור התמונה (לנגישות וגוגל)'), alt));
      }
    }
    if (u.linkKey) {
      const lspec = specOf(u.linkKey);
      const inp = h('input', { type: 'text', dir: 'ltr', value: lspec.href ?? u.href });
      inp.addEventListener('input', () => setSpec(u.linkKey, { href: inp.value }));
      out.push(h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'לאן הכפתור/הקישור מוביל'), inp,
        h('span', { class: 'help' }, 'https://… לאתר, tel:0501234567 לחיוג, mailto:name@mail.com למייל, או #חלק לגלילה בדף.')));
    }

    const style = [];
    if (u.kind !== 'image') {
      style.push(colorField('צבע טקסט', spec.color || u.color, !!spec.color, (v) => setSpec(u.key, { color: v }), () => { setSpec(u.key, { color: undefined }, { force: true }); renderInsp(); }));
      style.push(colorField('צבע רקע', spec.bgc || u.bgc, !!spec.bgc, (v) => setSpec(u.key, { bgc: v }), () => { setSpec(u.key, { bgc: undefined }, { force: true }); renderInsp(); }));
      if (u.kind === 'text' || u.kind === 'node' || u.kind === 'box') {
        style.push(fontPicker('פונט לאלמנט הזה', spec.font, (f) => setSpec(u.key, { font: f }, { force: true }), () => { setSpec(u.key, { font: undefined }, { force: true }); renderInsp(); }, u.font));
      }
    }
    const plainBox = u.added === 'video' || u.added === 'divider';   // nothing to format on these
    if (u.kind !== 'image' && u.kind !== 'bg' && !plainBox) out.push(fmtSection(u, spec));
    if (style.length && !plainBox) out.push(h('div', { class: 'sect' }, h('h4', {}, 'צבעים ופונט'), ...style));
    out.push(elementSection(u));
    out.push(addSection(u));
    if (Object.keys(spec).length || (u.linkKey && Object.keys(specOf(u.linkKey)).length)) {
      out.push(h('button', { class: 'btn small danger', onclick: () => { setSpec(u.key, Object.fromEntries(Object.keys(spec).map((k) => [k, undefined])), { force: true }); if (u.linkKey) setSpec(u.linkKey, { href: undefined }, { force: true }); renderInsp(); } }, 'ביטול כל השינויים באלמנט הזה'));
    }
    return out;
  }

  function inspColors() {
    const colors = (E.edits.global || {}).colors || {};
    if (!E.palette.length) return [h('p', { class: 'muted' }, E.ready ? 'לא נמצאו צבעים באתר.' : 'צבעי האתר נטענים…')];
    return [
      h('h3', {}, 'צבעי ', h('span', { class: 'hl' }, 'האתר')),
      h('p', { class: 'muted' }, 'שינוי צבע כאן מחליף אותו בכל האתר בבת אחת – כפתורים, כותרות, רקעים.'),
      ...E.palette.map((p) => {
        const cur = colors[p.hex] || p.hex;
        const input = h('input', { type: 'color', value: cur });
        input.addEventListener('input', () => {
          setGlobal((g) => { g.colors = { ...(g.colors || {}) }; if (input.value === p.hex) delete g.colors[p.hex]; else g.colors[p.hex] = input.value; });
          dot.style.background = input.value; code.textContent = input.value;
        });
        const dot = h('span', { class: 'dot', style: `background:${cur}` });
        const code = h('code', {}, cur);
        return h('div', { class: 'swatch' }, dot, h('div', { class: 'grow' }, h('div', { class: 'colorrow' }, input, code), `משמש ב-${p.count} מקומות`),
          colors[p.hex] && h('button', { class: 'link', onclick: () => { setGlobal((g) => { delete g.colors[p.hex]; }); renderInsp(); } }, 'איפוס'));
      }),
    ];
  }

  function inspFonts() {
    const fonts = (E.edits.global || {}).fonts || {};
    const mk = (role, label) => fontPicker(label, fonts[role], (f) => setGlobal((g) => { g.fonts = { ...(g.fonts || {}), [role]: f }; }),
      () => { setGlobal((g) => { delete g.fonts[role]; }); renderInsp(); }, E.origFonts[role]);
    return [h('h3', {}, 'פונטים של ', h('span', { class: 'hl' }, 'האתר')),
      h('p', { class: 'muted' }, 'בחרו מהרשימה או הקלידו כל שם מ-Google Fonts. ההחלפה חלה על כל האתר.'),
      mk('heading', 'פונט כותרות'), mk('body', 'פונט טקסט')];
  }

  function renderInsp() {
    tabsEl.replaceChildren(...[['sel', 'עריכה'], ['struct', 'מבנה'], ['colors', 'צבעים'], ['fonts', 'פונטים']].map(([k, l]) =>
      h('button', { 'aria-selected': E.tab === k, onclick: () => setTab(k) }, l)));
    insp.replaceChildren(...(E.tab === 'sel' ? inspSelection() : E.tab === 'struct' ? inspStructure() : E.tab === 'colors' ? inspColors() : inspFonts()).filter(Boolean));
  }

  /* ---- frame messaging ---- */
  const onMessage = (e) => {
    const f = $('#frame');
    if (!f || e.source !== f.contentWindow || e.origin !== siteOrigin || !e.data) return;
    const d = e.data;
    if (d.type === 'cms-ready') {
      E.ready = true; E.palette = d.palette || []; E.origFonts = d.fonts || {};
      E.sections = d.sections || []; E.kitVersion = d.version || 1;
      $('#notice') && $('#notice').remove();
      sendToFrame();
      if (E.tab !== 'sel' || kitTooOld()) renderInsp();
      if (kitTooOld() || (me.user.role === 'owner' && E.kitVersion < LATEST_KIT)) kitUpdateNotice();
    } else if (d.type === 'cms-sections') {
      E.sections = d.sections || [];
      if (E.tab === 'struct') renderInsp();
    } else if (d.type === 'cms-subtree-map-result') {
      const w = waiters.get(d.reqId); if (w) { waiters.delete(d.reqId); w(d); }
    } else if (d.type === 'cms-select') {
      E.unit = d.unit;
      if (!d.refresh) {
        if (!(d.programmatic && E.tab === 'struct')) E.tab = 'sel';   // picking from the structure list keeps that list open
        renderInsp();
        if (d.unit && matchMedia('(max-width:900px)').matches) setMobileView('edit');
      }
    } else if (d.type === 'cms-text') {
      if (E.unit && E.unit.key === d.key) E.unit.text = d.value;
      setSpec(d.key, { t: d.value }, { live: d.live });
      if (!d.live) renderInsp();
    }
  };
  window.addEventListener('message', onMessage);
  const cleanupFns = () => { window.removeEventListener('message', onMessage); window.onbeforeunload = null; };
  window.addEventListener('hashchange', cleanupFns, { once: true });

  function kitUpdateNotice() {
    if ($('#notice')) return;
    $('#frame-wrap').append(h('div', { class: 'notice', id: 'notice' },
      h('div', {}, h('b', {}, 'יש גרסה חדשה של ערכת העריכה. '), me.user.role === 'owner' ? 'עדכנו אותה באתר כדי לקבל את כל האפשרויות והתיקונים האחרונים.' : 'פנו לסוכנות כדי לעדכן אותה באתר.'),
      me.user.role === 'owner' && h('button', { class: 'btn primary small', onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        try { await api('POST', `/admin/sites/${siteId}/connect`); toast('עודכן. האתר יתפרסם בעוד כדקה – אז רעננו את העורך.'); $('#notice') && $('#notice').remove(); }
        catch (e) { toast(e.message, true); }
      } }, 'עדכון עכשיו'),
      !kitTooOld() && h('button', { class: 'btn ghost small', onclick: () => $('#notice') && $('#notice').remove() }, 'אחר כך')));
  }

  function loadFrame() {
    E.ready = false; E.unit = null; E.palette = [];
    const f = $('#frame');
    // The unique parameter bypasses stale CDN/browser caches (GitHub Pages caches pages for ~10 minutes).
    f.src = new URL(E.page, site.url).href + '?cms-edit=1&_=' + Date.now();
    $('#notice') && $('#notice').remove();
    setTimeout(() => {
      if (E.ready || !$('#frame-wrap')) return;
      $('#frame-wrap').append(h('div', { class: 'notice', id: 'notice' },
        h('div', {}, h('b', {}, 'האתר עדיין לא מחובר למערכת העריכה. '), me.user.role === 'owner' ? 'חברו אותו כדי להתחיל לערוך.' : 'פנו לסוכנות כדי לחבר אותו.'),
        me.user.role === 'owner' && h('button', { class: 'btn primary small', onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { await api('POST', `/admin/sites/${siteId}/connect`); toast('חובר. ממתינים לפרסום האתר (כדקה), ואז נטען מחדש.'); await sleep(45000); loadFrame(); }
          catch (e) { toast(e.message, true); }
        } }, 'חיבור עכשיו')));
    }, 9000);
  }

  /* ---- layout ---- */
  const deviceBtn = (d, l) => h('button', { 'aria-pressed': d === 'desktop', 'data-d': d, onclick: (ev) => {
    $('#frame-wrap').dataset.w = d;
    ev.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === ev.currentTarget));
  } }, l);

  shell([
    h('header', { class: 'top' },
      h('img', { class: 'brand', src: 'brand/logo.png', alt: 'Femme Digital', onclick: () => leave() }),
      h('span', { class: 'title' }, site.name),
      h('span', { class: 'chip', id: 'chip', 'data-s': 'clean' }, CHIP.clean),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost small', id: 'undo', title: 'ביטול פעולה', disabled: true, onclick: undo }, '↶ ביטול'),
      h('button', { class: 'btn ghost small', id: 'redo', title: 'חזרה על פעולה', disabled: true, onclick: redo }, '↷ שחזור'),
      h('button', { class: 'btn ghost small', onclick: showHistory }, 'גרסאות קודמות'),
      h('a', { class: 'btn ghost small', href: site.url, target: '_blank', rel: 'noopener' }, 'צפייה באתר ↗'),
      h('button', { class: 'btn primary', id: 'publish', disabled: true, onclick: publish }, 'פרסום באתר'),
      h('button', { class: 'btn ghost small', onclick: () => leave() }, 'יציאה')),
    h('div', { class: 'ed-main' },
      h('aside', { class: 'insp' }, tabsEl, insp),
      h('section', { class: 'stage' },
        h('div', { class: 'stage-bar' },
          site.pages.length > 1 && h('select', { style: 'width:auto', onchange: (ev) => { E.page = ev.target.value; loadFrame(); } }, site.pages.map((p) => h('option', { value: p }, p))),
          h('span', { class: 'muted' }, 'תצוגה חיה'),
          h('span', { class: 'spacer' }),
          h('div', { class: 'seg' }, deviceBtn('desktop', 'מחשב'), deviceBtn('tablet', 'טאבלט'), deviceBtn('mobile', 'נייד'))),
        h('div', { class: 'frame-wrap', id: 'frame-wrap', 'data-w': 'desktop' }, h('iframe', { id: 'frame', title: 'תצוגה מקדימה של האתר' })))),
    h('nav', { class: 'mobile-switch' },
      h('button', { 'aria-pressed': true, onclick: (ev) => mv('edit', ev) }, '✏️ עריכה'),
      h('button', { 'aria-pressed': false, onclick: (ev) => mv('preview', ev) }, '👁 תצוגה')),
  ], { editor: true });
  function setMobileView(v) {
    $('#shell').dataset.view = v;
    document.querySelectorAll('.mobile-switch button').forEach((b, i) => b.setAttribute('aria-pressed', (i === 0) === (v === 'edit')));
  }
  function mv(v) { setMobileView(v); }
  $('#shell').dataset.view = 'edit';

  document.addEventListener('keydown', function ks(e) {
    if (!$('#frame')) { document.removeEventListener('keydown', ks); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); publish(); }
    else if (mod && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  });

  renderInsp();
  loadFrame();
}

/* ======================= boot ======================= */
go().catch((e) => { console.error(e); toast(e.message, true); });
