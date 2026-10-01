/*! Femme Digital CMS kit
 * One small script that makes any static page editable without touching its code.
 *
 *  - Public mode:  loads /cms/edits.json and applies the saved edits (text, images, links,
 *                  colours, fonts) on top of the original page. The page's HTML is never changed.
 *  - Edit mode:    only inside the admin app's iframe (?cms-edit=1 + data-admin-origin match).
 *                  Lets the editor click any text / image / box and live-preview changes via postMessage.
 *
 * Edits are keyed by a stable DOM path (body>main:nth-of-type(1)>h1:nth-of-type(1)), so only
 * content can change — never structure.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script || !script.src) return;

  var CMS_BASE = new URL('./', script.src);
  var SITE_BASE = new URL('../', CMS_BASE);
  var ADMIN = script.getAttribute('data-admin-origin') || '';
  var EDIT = !!ADMIN && window.parent !== window && /[?&]cms-edit=1\b/.test(location.search);

  var pageKey = (function () {
    var rel = location.pathname.indexOf(SITE_BASE.pathname) === 0 ? location.pathname.slice(SITE_BASE.pathname.length) : location.pathname.replace(/^\//, '');
    if (!rel || rel.charAt(rel.length - 1) === '/') rel += 'index.html';
    return rel;
  })();

  /* ---------- hide the page until edits are applied (avoids a flash of the original) ---------- */
  var hideStyle = document.createElement('style');
  hideStyle.id = 'cms-hide';
  hideStyle.textContent = 'html{visibility:hidden!important}';
  if (!EDIT) {
    (document.head || document.documentElement).appendChild(hideStyle);
    setTimeout(reveal, 1500);
  }
  function reveal() { if (hideStyle.parentNode) hideStyle.parentNode.removeChild(hideStyle); }

  /* ---------- state ---------- */
  var edits = { v: 1, global: {}, pages: {} };
  var assets = {};            // preview-only: uploaded image path -> data URL
  var touched = new Map();    // element -> snapshot of everything we changed
  var editingEl = null;       // element currently being typed in (never re-applied)
  var applying = false;
  var palette = [];

  /* ---------- helpers ---------- */
  function safeHref(u) { return /^(https?:\/\/|mailto:|tel:|#|\/|\.\/|\.\.\/|[\w-]+(\/|\.html|$))/i.test(u) && !/^\s*(javascript|data|vbscript):/i.test(u); }
  function resolveSrc(s) {
    if (assets[s]) return assets[s];
    if (/^https?:\/\//i.test(s)) return s;
    if (/^(javascript|data|vbscript):/i.test(s)) return '';
    return new URL(s, SITE_BASE).href;
  }
  var FONT_URL = /^https:\/\/fonts\.googleapis\.com\/css2\?family=[A-Za-z0-9+:;@.,=&%_-]+$/;
  var FAMILY = /^[A-Za-z0-9 ]{1,60}$/;

  function pathOf(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (el === document.body) { parts.unshift('body'); break; }
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && document.querySelectorAll('#' + el.id).length === 1) { parts.unshift('#' + el.id); break; }
      var i = 1;
      for (var s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) i++;
      parts.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
      el = el.parentElement;
    }
    return parts.join('>');
  }

  function isTextOnly(el) {
    var has = false;
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) has = true; }
      else if (n.nodeType === 1 && n.tagName === 'BR') continue;
      else if (n.nodeType !== 8) return false;
    }
    return has;
  }
  function getText(el) {
    var out = '';
    for (var n = el.firstChild; n; n = n.nextSibling) out += n.nodeType === 3 ? n.nodeValue : (n.tagName === 'BR' ? '\n' : '');
    return out.replace(/^\s+|\s+$/g, '').replace(/[ \t]*\n[ \t]*/g, '\n');
  }
  function setText(el, val) {
    while (el.firstChild) el.removeChild(el.firstChild);
    String(val).split('\n').forEach(function (line, i) {
      if (i) el.appendChild(document.createElement('br'));
      el.appendChild(document.createTextNode(line));
    });
  }

  /* ---------- colour parsing / replacing ---------- */
  var COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*[\d.]+\s*[, ]\s*[\d.]+\s*[, ]\s*[\d.]+(?:\s*[,/]\s*[\d.]+%?)?\s*\)/gi;
  function hex2(n) { return ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2); }
  function parseColor(lit) {
    var m;
    if (lit.charAt(0) === '#') {
      var h = lit.slice(1);
      if (h.length === 3) h = h.replace(/./g, '$&$&');
      return { hex: '#' + h.slice(0, 6).toLowerCase(), alpha: h.length === 8 ? h.slice(6).toLowerCase() : null, fmt: 'hex' };
    }
    m = lit.match(/[\d.]+%?/g);
    if (!m || m.length < 3) return null;
    var a = m.length > 3 ? parseFloat(m[3]) / (/%/.test(m[3]) ? 100 : 1) : null;
    return { hex: '#' + hex2(m[0]) + hex2(m[1]) + hex2(m[2]), alpha: a, fmt: 'rgb' };
  }
  function replaceColors(text, map) {
    return text.replace(COLOR_RE, function (lit) {
      var c = parseColor(lit);
      var to = c && map[c.hex];
      if (!to) return lit;
      if (c.fmt === 'hex') return to + (c.alpha || '');
      var n = parseInt(to.slice(1), 16);
      var rgb = (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
      return c.alpha == null ? 'rgb(' + rgb + ')' : 'rgba(' + rgb + ', ' + c.alpha + ')';
    });
  }
  function cssColorToHex(v) {
    if (!v || v === 'transparent') return null;
    var c = parseColor(v);
    if (!c || (c.alpha != null && parseFloat(c.alpha) === 0)) return null;
    return c.hex;
  }

  function eachRule(rules, fn) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.cssRules && r.type !== 1) eachRule(r.cssRules, fn);
      fn(r);
    }
  }
  function ownSheet(s) { return s.ownerNode && /^cms-/.test(s.ownerNode.id || ''); }
  function scanPalette() {
    var count = {};
    function add(text) {
      (text.match(COLOR_RE) || []).forEach(function (lit) {
        var c = parseColor(lit);
        if (!c || (c.alpha != null && parseFloat(c.alpha) === 0)) return;
        count[c.hex] = (count[c.hex] || 0) + 1;
      });
    }
    Array.prototype.forEach.call(document.styleSheets, function (sh) {
      if (ownSheet(sh)) return;
      var rules; try { rules = sh.cssRules; } catch (e) { return; }
      eachRule(rules, function (r) {
        if (r.type !== 1) return;
        for (var i = 0; i < r.style.length; i++) add(r.style.getPropertyValue(r.style[i]));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[style],[fill],[stroke]'), function (el) {
      add((el.getAttribute('style') || '') + ' ' + (el.getAttribute('fill') || '') + ' ' + (el.getAttribute('stroke') || ''));
    });
    return Object.keys(count).map(function (h) { return { hex: h, count: count[h] }; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, 16);
  }

  function ruleCss(rules, map) {
    var s = '';
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.type === 1) {
        var d = '';
        for (var j = 0; j < r.style.length; j++) {
          var name = r.style[j], val = r.style.getPropertyValue(name), rep = replaceColors(val, map);
          if (rep !== val) d += name + ':' + rep + ' !important;';
        }
        if (d) s += r.selectorText + '{' + d + '}';
      } else if (r.type === 4 || r.type === 12) {
        var inner = ruleCss(r.cssRules, map);
        if (inner) s += (r.type === 4 ? '@media ' : '@supports ') + r.conditionText + '{' + inner + '}';
      }
    }
    return s;
  }
  function applyColors(map) {
    var st = document.getElementById('cms-colors');
    if (!map || !Object.keys(map).length) { if (st) st.remove(); return; }
    var css = '';
    Array.prototype.forEach.call(document.styleSheets, function (sh) {
      if (ownSheet(sh)) return;
      var rules; try { rules = sh.cssRules; } catch (e) { return; }
      css += ruleCss(rules, map);
    });
    if (!st) { st = document.createElement('style'); st.id = 'cms-colors'; document.head.appendChild(st); }
    st.textContent = css;
    // inline style / SVG presentation attributes
    Array.prototype.forEach.call(document.querySelectorAll('[style],[fill],[stroke]'), function (el) {
      ['style', 'fill', 'stroke'].forEach(function (a) {
        var v = el.getAttribute(a);
        if (!v) return;
        var rep = replaceColors(v, map);
        if (rep !== v) { snapAttr(el, a); el.setAttribute(a, rep); }
      });
    });
  }

  /* ---------- fonts ---------- */
  function loadFont(f) {
    if (!f || !FAMILY.test(f.family || '') || !FONT_URL.test(f.url || '')) return false;
    var id = 'cms-font-' + f.family.replace(/\W/g, '_');
    if (!document.getElementById(id)) {
      var l = document.createElement('link');
      l.id = id; l.rel = 'stylesheet'; l.href = f.url;
      document.head.appendChild(l);
    }
    return true;
  }
  var BODY_SEL = 'body,p,li,a,span,button,input,textarea,select,label,td,th,small,strong,em,b,blockquote,div';
  var NOT_ICON = ':not([class*="icon"]):not([class*="fa-"]):not(i)';
  function applyFonts(fonts) {
    var st = document.getElementById('cms-fonts');
    fonts = fonts || {};
    var css = '';
    if (loadFont(fonts.body)) css += BODY_SEL.split(',').map(function (s) { return s + NOT_ICON; }).join(',') + '{font-family:"' + fonts.body.family + '",sans-serif!important}';
    if (loadFont(fonts.heading)) css += 'h1,h2,h3,h4,h5,h6,h1 *,h2 *,h3 *,h4 *,h5 *,h6 *{font-family:"' + fonts.heading.family + '",sans-serif!important}';
    if (!css) { if (st) st.remove(); return; }
    if (!st) { st = document.createElement('style'); st.id = 'cms-fonts'; document.head.appendChild(st); }
    st.textContent = css;
  }

  /* ---------- snapshots (so edits can be undone live in the editor) ---------- */
  function snapOf(el) {
    var s = touched.get(el);
    if (!s) { s = { attrs: {}, nodes: {}, children: null, style: {} }; touched.set(el, s); }
    return s;
  }
  function snapAttr(el, name) {
    var s = snapOf(el);
    if (!(name in s.attrs)) s.attrs[name] = el.getAttribute(name);
  }
  function snapChildren(el) {
    var s = snapOf(el);
    if (!s.children) s.children = Array.prototype.map.call(el.childNodes, function (n) { return n.cloneNode(true); });
  }
  function snapStyle(el, prop) {
    var s = snapOf(el);
    if (!(prop in s.style)) s.style[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
  }
  function revertAll() {
    touched.forEach(function (s, el) {
      if (el === editingEl) return;
      Object.keys(s.attrs).forEach(function (a) { s.attrs[a] == null ? el.removeAttribute(a) : el.setAttribute(a, s.attrs[a]); });
      Object.keys(s.nodes).forEach(function (i) { if (el.childNodes[i]) el.childNodes[i].nodeValue = s.nodes[i]; });
      if (s.children) { while (el.firstChild) el.removeChild(el.firstChild); s.children.forEach(function (c) { el.appendChild(c.cloneNode(true)); }); }
      Object.keys(s.style).forEach(function (p) { s.style[p][0] ? el.style.setProperty(p, s.style[p][0], s.style[p][1]) : el.style.removeProperty(p); });
    });
    touched.clear();
  }

  /* ---------- applying edits ---------- */
  function setStyle(el, prop, val) { snapStyle(el, prop); el.style.setProperty(prop, val, 'important'); }
  function applyEl(el, spec) {
    if (spec.t != null) { snapChildren(el); setText(el, spec.t); }
    if (spec.n) {
      Object.keys(spec.n).forEach(function (i) {
        var node = el.childNodes[i];
        if (node && node.nodeType === 3) { var s = snapOf(el); if (!(i in s.nodes)) s.nodes[i] = node.nodeValue; node.nodeValue = spec.n[i]; }
      });
    }
    if (spec.src != null) {
      var u = resolveSrc(spec.src);
      if (u) {
        snapAttr(el, 'src'); snapAttr(el, 'srcset');
        el.setAttribute('src', u); el.removeAttribute('srcset');
        if (el.parentNode && el.parentNode.tagName === 'PICTURE') {
          Array.prototype.forEach.call(el.parentNode.querySelectorAll('source'), function (so) { snapAttr(so, 'srcset'); so.removeAttribute('srcset'); });
        }
      }
    }
    if (spec.bgimg != null) { var b = resolveSrc(spec.bgimg); if (b) setStyle(el, 'background-image', 'url("' + b.replace(/"/g, '%22') + '")'); }
    if (spec.alt != null) { snapAttr(el, 'alt'); el.setAttribute('alt', spec.alt); }
    if (spec.href != null && safeHref(spec.href)) { snapAttr(el, 'href'); el.setAttribute('href', spec.href); }
    if (spec.color) setStyle(el, 'color', spec.color);
    if (spec.bgc) setStyle(el, 'background-color', spec.bgc);
    if (spec.font && loadFont(spec.font)) setStyle(el, 'font-family', '"' + spec.font.family + '", sans-serif');
  }

  function applyAll(revert) {
    applying = true;
    if (observer) observer.disconnect();
    try {
      if (revert) revertAll();
      var els = ((edits.pages || {})[pageKey] || {}).els || {};
      Object.keys(els).forEach(function (p) {
        var el; try { el = document.querySelector(p); } catch (e) { return; }
        if (el && el !== editingEl) applyEl(el, els[p]);
      });
      applyColors((edits.global || {}).colors);
      applyFonts((edits.global || {}).fonts);
    } finally {
      applying = false;
      if (observer) observe();
    }
  }

  /* ---------- keep applying while the page renders itself with JS ---------- */
  var observer = null, obsTimer, obsUntil = Date.now() + (EDIT ? 20000 : 8000);
  function observe() { if (Date.now() < obsUntil) observer.observe(document.documentElement, { childList: true, subtree: true }); }
  if (window.MutationObserver) {
    observer = new MutationObserver(function () {
      if (applying) return;
      clearTimeout(obsTimer);
      obsTimer = setTimeout(function () { applyAll(false); }, 80);
    });
  }

  /* ---------- boot ---------- */
  function domReady() {
    return document.readyState !== 'loading' ? Promise.resolve() : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r); });
  }

  if (!EDIT) {
    Promise.all([
      fetch(new URL('edits.json', CMS_BASE).href, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      domReady()
    ]).then(function (res) {
      if (res[0] && res[0].v === 1) edits = res[0];
      applyAll(false);
      reveal();
      if (observer) observe();
    });
    return;
  }

  /* ================== EDIT MODE (inside the admin iframe) ================== */
  var ui = document.createElement('style');
  ui.id = 'cms-ui';
  ui.setAttribute('data-cms-ui', '');
  ui.textContent = '[data-cms-hover]{outline:2px dashed #B85150!important;outline-offset:2px;cursor:pointer!important}' +
    '[data-cms-sel]{outline:3px solid #B85150!important;outline-offset:2px;box-shadow:0 0 0 6px rgba(184,81,80,.18)!important}' +
    '[contenteditable]{outline:3px solid #47454D!important;outline-offset:2px;cursor:text!important}';
  document.head.appendChild(ui);

  var hoverEl = null, selEl = null;

  function send(msg) { parent.postMessage(msg, ADMIN); }

  function caretNode(x, y) {
    var node = null;
    if (document.caretRangeFromPoint) { var r = document.caretRangeFromPoint(x, y); node = r && r.startContainer; }
    else if (document.caretPositionFromPoint) { var p = document.caretPositionFromPoint(x, y); node = p && p.offsetNode; }
    if (!node || node.nodeType !== 3 || !node.nodeValue.trim()) return null;
    var range = document.createRange(); range.selectNodeContents(node);
    var rects = range.getClientRects();
    for (var i = 0; i < rects.length; i++) {
      var q = rects[i];
      if (x >= q.left - 3 && x <= q.right + 3 && y >= q.top - 3 && y <= q.bottom + 3) return node;
    }
    return null;
  }

  function unitAt(ev) {
    var t = ev.target;
    if (!(t instanceof Element) || t.closest('[data-cms-ui]') || t === document.documentElement) return null;
    var node = caretNode(ev.clientX, ev.clientY);
    if (node) {
      var par = node.parentElement;
      if (isTextOnly(par)) return { kind: 'text', el: par };
      return { kind: 'node', el: par, idx: Array.prototype.indexOf.call(par.childNodes, node) };
    }
    var img = t.closest('img');
    if (img) return { kind: 'image', el: img };
    for (var e = t, i = 0; e && i < 4; e = e.parentElement, i++) {
      var bg = getComputedStyle(e).backgroundImage;
      if (bg && bg !== 'none' && /url\(/.test(bg)) return { kind: 'bg', el: e };
    }
    if (t.tagName !== 'BODY' && isTextOnly(t)) return { kind: 'text', el: t };
    return { kind: 'box', el: t };
  }

  function describe(u) {
    var el = u.el, cs = getComputedStyle(el), a = el.closest('a');
    var info = {
      kind: u.kind, key: pathOf(el), idx: u.idx, tag: el.tagName.toLowerCase(), page: pageKey,
      color: cssColorToHex(cs.color), bgc: cssColorToHex(cs.backgroundColor),
      font: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim()
    };
    if (u.kind === 'text') info.text = getText(el);
    if (u.kind === 'node') info.text = el.childNodes[u.idx].nodeValue;
    if (u.kind === 'image') { info.src = el.getAttribute('src') || ''; info.alt = el.getAttribute('alt') || ''; info.currentSrc = el.currentSrc || el.src; }
    if (u.kind === 'bg') { var m = getComputedStyle(el).backgroundImage.match(/url\(["']?([^"')]+)/); info.currentSrc = m ? m[1] : ''; }
    if (a) { info.href = a.getAttribute('href') || ''; info.linkKey = pathOf(a); }
    return info;
  }

  function select(u) {
    if (selEl) selEl.removeAttribute('data-cms-sel');
    selEl = u ? u.el : null;
    if (selEl) selEl.setAttribute('data-cms-sel', '');
    send({ type: 'cms-select', unit: u ? describe(u) : null });
  }

  function stopEditing(commit) {
    if (!editingEl) return;
    var el = editingEl;
    el.removeAttribute('contenteditable');
    editingEl = null;
    if (commit) send({ type: 'cms-text', key: pathOf(el), value: getText(el) });
  }

  document.addEventListener('mouseover', function (e) {
    var u = unitAt(e);
    if (hoverEl) hoverEl.removeAttribute('data-cms-hover');
    hoverEl = u && u.el !== selEl ? u.el : null;
    if (hoverEl) hoverEl.setAttribute('data-cms-hover', '');
  }, true);

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-cms-ui]')) return;
    if (editingEl && editingEl.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    stopEditing(true);
    select(unitAt(e));
  }, true);

  document.addEventListener('dblclick', function (e) {
    var u = unitAt(e);
    if (!u || u.kind !== 'text') return;
    e.preventDefault();
    select(u);
    editingEl = u.el;
    u.el.setAttribute('contenteditable', 'plaintext-only');
    if (u.el.contentEditable !== 'plaintext-only') u.el.setAttribute('contenteditable', 'true');
    u.el.focus();
    var r = document.createRange(); r.selectNodeContents(u.el);
    var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }, true);

  document.addEventListener('input', function () {
    if (editingEl) send({ type: 'cms-text', key: pathOf(editingEl), value: getText(editingEl), live: true });
  }, true);
  document.addEventListener('keydown', function (e) {
    if (!editingEl) return;
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); stopEditing(true); }
  }, true);
  document.addEventListener('focusout', function (e) { if (editingEl && e.target === editingEl) stopEditing(true); }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);

  window.addEventListener('message', function (e) {
    if (e.origin !== ADMIN || e.source !== parent || !e.data) return;
    var d = e.data;
    if (d.type === 'cms-edits') {
      edits = d.edits && d.edits.v === 1 ? d.edits : edits;
      assets = d.assets || {};
      obsUntil = Date.now() + 20000;
      applyAll(true);
      if (selEl) send({ type: 'cms-select', unit: describeSelected(), refresh: true });
    } else if (d.type === 'cms-deselect') {
      select(null);
    }
  });
  var lastUnit = null;
  function describeSelected() {
    if (!selEl) return null;
    var kind = selEl.tagName === 'IMG' ? 'image' : (isTextOnly(selEl) ? 'text' : 'box');
    return lastUnit && lastUnit.el === selEl ? describe(lastUnit) : describe({ kind: kind, el: selEl });
  }
  var origSelect = select;
  select = function (u) { lastUnit = u; origSelect(u); };

  domReady().then(function () {
    palette = scanPalette();
    var h1 = document.querySelector('h1,h2');
    send({
      type: 'cms-ready', page: pageKey, palette: palette,
      fonts: {
        heading: h1 ? getComputedStyle(h1).fontFamily.split(',')[0].replace(/["']/g, '').trim() : '',
        body: getComputedStyle(document.body).fontFamily.split(',')[0].replace(/["']/g, '').trim()
      }
    });
  });
})();
