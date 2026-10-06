/* shared: accessibility widget + cookie consent. Choices are kept in localStorage only (no tracking). */
(function () {
  var K = 'fd-a11y', C = 'fd-cookies', root = document.documentElement;
  var get = function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  var set = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  var st = Object.assign({ size: 0, contrast: false, gray: false, links: false, font: false, nomotion: false, cursor: false }, get(K) || {});
  var apply = function () {
    root.style.setProperty('--a11y-z', String(1 + st.size * 0.1));
    ['contrast', 'gray', 'links', 'font', 'nomotion', 'cursor'].forEach(function (f) { root.classList.toggle('a11y-' + (f === 'gray' ? 'gray' : f), !!st[f]); });
    set(K, st);
  };
  apply();

  function build() {
    var btn = document.createElement('button');
    btn.className = 'a11y-btn'; btn.type = 'button'; btn.setAttribute('aria-label', 'פתיחת תפריט נגישות'); btn.setAttribute('aria-expanded', 'false'); btn.textContent = '♿';
    var p = document.createElement('div');
    p.className = 'a11y-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'תפריט נגישות');
    p.innerHTML = '<h2>נגישות <button type="button" aria-label="סגירה">✕</button></h2><div class="a11y-grid">' +
      '<button data-a="bigger" type="button">א+ הגדלת טקסט</button>' +
      '<button data-a="smaller" type="button">א- הקטנת טקסט</button>' +
      '<button data-f="contrast" type="button" aria-pressed="false">ניגודיות גבוהה</button>' +
      '<button data-f="gray" type="button" aria-pressed="false">גווני אפור</button>' +
      '<button data-f="links" type="button" aria-pressed="false">הדגשת קישורים</button>' +
      '<button data-f="font" type="button" aria-pressed="false">גופן קריא</button>' +
      '<button data-f="nomotion" type="button" aria-pressed="false">עצירת אנימציות</button>' +
      '<button data-f="cursor" type="button" aria-pressed="false">סמן גדול</button></div>' +
      '<div class="a11y-foot"><button data-a="reset" type="button">איפוס</button><a href="terms.html#accessibility">הצהרת נגישות</a></div>';
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
      else if (b.dataset.a === 'reset') st = { size: 0, contrast: false, gray: false, links: false, font: false, nomotion: false, cursor: false };
      else return;
      apply(); sync();
    });
  }

  function cookies() {
    if (get(C)) return;
    var bar = document.createElement('div');
    bar.className = 'cookiebar'; bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-label', 'הסכמה לעוגיות');
    bar.innerHTML = '<p>האתר משתמש בעוגיות הכרחיות לתפקודו (למשל זכירת בחירות הנגישות שלך), ובאישורך גם בעוגיות סטטיסטיקה ושיווק. אפשר לבחור, והבחירה נשמרת במכשיר שלך. <a href="terms.html#cookies">מדיניות עוגיות ופרטיות</a></p>' +
      '<div class="cb"><button type="button" data-c="essential">רק הכרחיות</button><button type="button" class="pri" data-c="all">אישור הכל</button></div>';
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.classList.add('show'); });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      set(C, { level: b.dataset.c, at: new Date().toISOString() });
      bar.classList.remove('show'); setTimeout(function () { bar.remove(); }, 300);
    });
  }

  var go = function () { build(); cookies(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  window.fdCookieLevel = function () { var c = get(C); return c ? c.level : null; };
})();
