/* Accessibility widget (Femme Digital): a round button + a small menu. Self-contained, no dependencies, no cookies.
 * Settings are kept in localStorage on the visitor's device only.
 * Usage: <script src="a11y-widget.js" defer data-color="#52725a" data-statement="accessibility.html" data-bottom="16"></script>
 *   data-color      button colour (the site's brand colour); the icon colour is picked for contrast
 *   data-statement  link to the site's accessibility statement (omit to hide the link)
 *   data-bottom     distance from the bottom in px (raise it above a fixed bottom bar)
 *   data-side       "start" (default, the reading-start side) or "end"
 */
(function () {
  if (window.__fdA11y) return; window.__fdA11y = 1;
  if (/[?&]cms-edit=1\b/.test(location.search)) return;   // never inside the editor's preview
  var me = document.currentScript;
  var cfg = function (k, d) { return (me && me.getAttribute('data-' + k)) || d; };
  var color = cfg('color', '#47454D'), statement = cfg('statement', ''), bottom = parseInt(cfg('bottom', '16'), 10) || 16, side = cfg('side', 'start');
  var K = 'fd-a11y', root = document.documentElement;

  function lum(hex) {
    var h = hex.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&');
    var c = [0, 2, 4].map(function (i) { var v = parseInt(h.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  var L = /^#[0-9a-f]{3,6}$/i.test(color) ? lum(color) : 0.1;
  var ink = (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.074) ? '#fff' : '#2b2a2f';   // whichever contrasts more

  var get = function () { try { return JSON.parse(localStorage.getItem(K)); } catch (e) { return null; } };
  var set = function (v) { try { localStorage.setItem(K, JSON.stringify(v)); } catch (e) {} };
  var DEF = { size: 0, contrast: false, gray: false, links: false, font: false, nomotion: false, cursor: false };
  var st = Object.assign({}, DEF, get() || {});
  var FLAGS = ['contrast', 'gray', 'links', 'font', 'nomotion', 'cursor'];
  var apply = function () {
    root.style.setProperty('--fda-z', String(1 + st.size * 0.1));
    FLAGS.forEach(function (f) { root.classList.toggle('fda-' + f, !!st[f]); });
    set(st);
  };

  var css = '' +
    '.fda-btn{all:initial;position:fixed;inset-inline-' + (side === 'end' ? 'end' : 'start') + ':12px;bottom:' + bottom + 'px;z-index:45;width:44px;height:44px;border-radius:50%;border:2px solid #fff;background:' + color + ';color:' + ink + ';cursor:pointer;box-shadow:0 6px 16px rgba(0,0,0,.28);display:grid;place-items:center;box-sizing:border-box}' +
    '.fda-btn svg{width:27px;height:27px;display:block}.fda-btn:focus-visible{outline:3px solid #ffd6bc;outline-offset:3px}' +
    '.fda-panel{all:initial;position:fixed;inset-inline-' + (side === 'end' ? 'end' : 'start') + ':12px;bottom:' + (bottom + 54) + 'px;z-index:100;width:min(300px,calc(100vw - 24px));max-height:70vh;overflow:auto;background:#fff;color:#2b2a2f;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:14px;display:none;font:16px/1.5 Arial,"Helvetica Neue",sans-serif;direction:rtl;text-align:right;box-sizing:border-box}' +
    '.fda-panel.open{display:block}.fda-panel *{box-sizing:border-box}' +
    '.fda-panel h2{font:700 18px/1.3 Arial,sans-serif;margin:0 0 10px;display:flex;justify-content:space-between;align-items:center;color:#2b2a2f}' +
    '.fda-panel h2 button{all:unset;cursor:pointer;font-size:22px;padding:2px 8px;color:#2b2a2f}' +
    '.fda-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    '.fda-grid button{all:unset;box-sizing:border-box;text-align:center;font:700 14px/1.25 Arial,sans-serif;padding:10px 6px;border-radius:10px;border:2px solid #e3dedb;background:#faf7f5;color:#2b2a2f;cursor:pointer;min-height:48px;display:flex;align-items:center;justify-content:center}' +
    '.fda-grid button[aria-pressed=true]{background:' + color + ';border-color:#2b2a2f;color:' + ink + '}' +
    '.fda-grid button:focus-visible,.fda-foot button:focus-visible,.fda-foot a:focus-visible{outline:3px solid #2b2a2f;outline-offset:2px}' +
    '.fda-foot{display:flex;gap:8px;margin-top:10px}.fda-foot button,.fda-foot a{all:unset;box-sizing:border-box;flex:1;text-align:center;font:700 14px/1.2 Arial,sans-serif;padding:9px;border-radius:10px;border:2px solid #2b2a2f;background:#fff;color:#2b2a2f;cursor:pointer}' +
    'body>*:not(.fda-btn):not(.fda-panel):not(script):not(style):not(dialog){zoom:var(--fda-z,1)}' +
    'html.fda-contrast body{background:#000!important}' +
    'html.fda-contrast body *:not(img):not(svg):not(picture):not(video):not(.fda-panel):not(.fda-panel *):not(.fda-btn):not(.fda-btn *){background-color:#000!important;color:#fff!important;border-color:#fff!important;box-shadow:none!important;text-shadow:none!important;background-image:none!important}' +
    'html.fda-contrast a,html.fda-contrast a *{color:#ffeb3b!important;text-decoration:underline!important}' +
    'html.fda-gray body>*:not(.fda-btn):not(.fda-panel){filter:grayscale(1)}' +
    'html.fda-links a:not(.fda-foot a){text-decoration:underline!important;outline:2px solid #b85150;outline-offset:2px;background:#fff3a8!important;color:#000!important}' +
    'html.fda-font body,html.fda-font body *:not(.fda-panel):not(.fda-panel *){font-family:Arial,"Helvetica Neue",sans-serif!important;letter-spacing:.02em}' +
    'html.fda-nomotion *,html.fda-nomotion *::before,html.fda-nomotion *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}' +
    'html.fda-cursor,html.fda-cursor *{cursor:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'48\' height=\'48\'%3E%3Cpath d=\'M6 3l30 20-13 3-6 13z\' fill=\'%23000\' stroke=\'%23fff\' stroke-width=\'3\'/%3E%3C/svg%3E") 4 2,auto!important}' +
    '@media print{.fda-btn,.fda-panel{display:none!important}}';

  apply();
  function build() {
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    var btn = document.createElement('button');
    btn.className = 'fda-btn'; btn.type = 'button'; btn.setAttribute('aria-label', 'פתיחת תפריט נגישות'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="16" cy="16" r="13"/><circle cx="16" cy="9.3" r="1.7" fill="currentColor"/><path d="M8.5 13.3c5 1.6 10 1.6 15 0M16 14.4v5M16 19.4l-3.6 6M16 19.4l3.6 6"/></svg>';
    var p = document.createElement('div');
    p.className = 'fda-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'תפריט נגישות'); p.dir = 'rtl';
    p.innerHTML = '<h2>נגישות <button type="button" aria-label="סגירה">✕</button></h2><div class="fda-grid">' +
      '<button data-a="bigger" type="button">א+ הגדלת טקסט</button><button data-a="smaller" type="button">א- הקטנת טקסט</button>' +
      '<button data-f="contrast" type="button" aria-pressed="false">ניגודיות גבוהה</button><button data-f="gray" type="button" aria-pressed="false">גווני אפור</button>' +
      '<button data-f="links" type="button" aria-pressed="false">הדגשת קישורים</button><button data-f="font" type="button" aria-pressed="false">גופן קריא</button>' +
      '<button data-f="nomotion" type="button" aria-pressed="false">עצירת אנימציות</button><button data-f="cursor" type="button" aria-pressed="false">סמן גדול</button></div>' +
      '<div class="fda-foot"><button data-a="reset" type="button">איפוס</button>' + (statement ? '<a href="' + statement.replace(/"/g, '') + '">הצהרת נגישות</a>' : '') + '</div>';
    document.body.appendChild(btn); document.body.appendChild(p);
    var sync = function () { p.querySelectorAll('[data-f]').forEach(function (b) { b.setAttribute('aria-pressed', !!st[b.dataset.f]); }); };
    sync();
    var toggle = function (open) { p.classList.toggle('open', open); btn.setAttribute('aria-expanded', open); if (open) p.querySelector('button').focus(); else btn.focus(); };
    btn.addEventListener('click', function () { toggle(!p.classList.contains('open')); });
    p.querySelector('h2 button').addEventListener('click', function () { toggle(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && p.classList.contains('open')) toggle(false); });
    p.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.f) st[b.dataset.f] = !st[b.dataset.f];
      else if (b.dataset.a === 'bigger') st.size = Math.min(st.size + 1, 5);
      else if (b.dataset.a === 'smaller') st.size = Math.max(st.size - 1, -2);
      else if (b.dataset.a === 'reset') st = Object.assign({}, DEF);
      else return;
      apply(); sync();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
