/* Cookie consent — remembers the visitor's choice and only loads optional third-party
   content (marked with data-consent-src) after "accept all". The page works without it. */
(function () {
  var KEY = 'cookie-consent';
  var TEXT = window.COOKIE_TEXT || 'האתר משתמש בעוגיות ובאחסון מקומי הכרחיים לתפעולו, ובאישורך גם בעוגיות ובשירותי צד שלישי.';
  var read = function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  var write = function (v) { try { localStorage.setItem(KEY, v); } catch (e) {} };
  var listeners = [];

  // Hook for future analytics/marketing tags: SiteConsent.onAccept(function () { ...load pixel... });
  window.SiteConsent = {
    onAccept: function (fn) { if (read() === 'all') fn(); else listeners.push(fn); }
  };

  // Optional embeds (e.g. Google Maps) load only after consent, or when the visitor asks for them.
  var loadEmbed = function (el) {
    if (el.getAttribute('src')) return;
    el.setAttribute('src', el.getAttribute('data-consent-src'));
    var ph = el.parentNode && el.parentNode.querySelector('.consent-placeholder');
    if (ph) ph.remove();
  };
  var embeds = document.querySelectorAll('[data-consent-src]');
  embeds.forEach(function (el) {
    var ph = el.parentNode && el.parentNode.querySelector('.consent-placeholder button');
    if (ph) ph.addEventListener('click', function () { loadEmbed(el); });
  });
  window.SiteConsent.onAccept(function () { embeds.forEach(loadEmbed); });

  var banner;
  var close = function () { if (banner) { banner.classList.remove('is-open'); banner.hidden = true; } };
  var choose = function (v) {
    write(v);
    close();
    if (v === 'all') listeners.splice(0).forEach(function (fn) { fn(); });
  };
  var open = function () {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'cookie-banner';
      banner.setAttribute('role', 'dialog');
      banner.setAttribute('aria-live', 'polite');
      banner.setAttribute('aria-label', 'הסכמה לשימוש בעוגיות');
      banner.innerHTML =
        '<p><strong>עוגיות באתר</strong> · ' + TEXT + ' <a href="privacy.html#cookies">למידע נוסף</a></p>' +
        '<div class="cookie-actions">' +
        '<button type="button" class="btn btn-primary cookie-accept" data-choice="all">אישור הכול</button>' +
        '<button type="button" class="btn cookie-essential" data-choice="essential">הכרחיות בלבד</button>' +
        '</div>';
      banner.addEventListener('click', function (e) {
        var b = e.target.closest('[data-choice]');
        if (b) choose(b.getAttribute('data-choice'));
      });
      document.body.appendChild(banner);
    }
    banner.hidden = false;
    requestAnimationFrame(function () { banner.classList.add('is-open'); });
  };

  document.querySelectorAll('[data-cookie-settings]').forEach(function (b) { b.addEventListener('click', open); });
  if (!read()) setTimeout(open, 800);
})();
