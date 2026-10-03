/*! Femme Digital CMS kit
 * One small script that makes any static page editable without touching its code.
 *
 *  - Public mode:  loads /cms/edits.json and applies the saved edits (text, images, links,
 *                  colours, fonts) on top of the original page. The page's HTML is never changed.
 *  - Edit mode:    only inside the admin app's iframe (?cms-edit=1 + data-admin-origin match).
 *                  Lets the editor click any text / image / box and live-preview changes via postMessage.
 *
 * Edits are keyed by a stable DOM path (body>main:nth-of-type(1)>h1:nth-of-type(1)).
 * Every element is stamped with its ORIGINAL path on load, so edits stay attached to the right
 * element even after blocks are moved or duplicated. Structure changes are limited to three safe
 * operations — duplicate, move up/down among siblings, hide — stored as an ordered list.
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
  var KIT_VERSION = 6;   // 2: formatting + structure edits · 3: copies of scroll-reveal elements stay visible · 4: add elements · 5: boxes, corner radius, borders, shadows, image shapes + crop · 6: columns, gap, padding, size
  var STAMP = 'data-cms-p', CID = 'data-cms-id';   // original-path stamp / id of a duplicated block
  var stamped = false;
  var layoutDone = {};                              // op index -> applied
  var origOrder = new Map();                        // parent -> original child order (to undo moves)
  var mirrors = [];                                 // observers keeping a copy's classes in sync with its original

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

  function seg(el) {
    var i = 1;
    for (var s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) i++;
    return el.tagName.toLowerCase() + ':nth-of-type(' + i + ')';
  }
  // Path of an element in the page as first loaded (used for stamping).
  function rawPath(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (el === document.body) { parts.unshift('body'); break; }
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && document.querySelectorAll('#' + el.id).length === 1) { parts.unshift('#' + el.id); break; }
      parts.unshift(seg(el));
      el = el.parentElement;
    }
    return parts.join('>');
  }
  // Stable key of an element: its original-path stamp, or @cloneId[>segments] inside a duplicated block.
  function pathOf(el) {
    for (var a = el; a && a.nodeType === 1 && a !== document.documentElement; a = a.parentElement) {
      var base = a.getAttribute(CID) ? '@' + a.getAttribute(CID) : a.getAttribute(STAMP);
      if (base) {
        var segs = [];
        for (var n = el; n !== a; n = n.parentElement) segs.unshift(seg(n));
        return segs.length ? base + '>' + segs.join('>') : base;
      }
    }
    return rawPath(el);
  }
  function stampAll() {
    if (stamped || !document.body) return;
    stamped = true;
    var list = [document.body].concat(Array.prototype.slice.call(document.body.querySelectorAll('*')));
    var paths = list.map(rawPath);          // computed first: stamping never changes the structure
    list.forEach(function (el, i) { if (!el.closest('[data-cms-ui]')) el.setAttribute(STAMP, paths[i]); });
  }
  function q(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function resolve(key) {
    if (key.charAt(0) === '@') {
      var parts = key.slice(1).split('>');
      var root = q('[' + CID + '="' + parts[0] + '"]');
      return !root || parts.length === 1 ? root : q(':scope>' + parts.slice(1).join('>'), root);
    }
    var hit = q('[' + STAMP + '="' + key + '"]');
    if (hit) return hit;
    var p = key.split('>');                  // element created later by the page's own JS under a stamped ancestor
    for (var i = p.length - 1; i >= 1; i--) {
      var base = q('[' + STAMP + '="' + p.slice(0, i).join('>') + '"]');
      if (base) return q(':scope>' + p.slice(i).join('>'), base);
    }
    return q(key);
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
  // Many sites reveal elements on scroll by adding a class (is-visible, aos-animate…) to the elements that
  // existed at load. A copy made later is never observed by that script, so it would stay invisible.
  // Mirror the original's class list onto the copy, and as a last resort un-hide copies after a few seconds.
  function mirrorClasses(a, b) {
    var pairs = [];
    (function walk(x, y) {
      pairs.push([x, y]);
      for (var i = 0; i < x.children.length && i < y.children.length; i++) walk(x.children[i], y.children[i]);
    })(a, b);
    if (window.MutationObserver) {
      pairs.forEach(function (p) {
        var mo = new MutationObserver(function () {
          var cls = p[0].getAttribute('class');
          if (cls !== p[1].getAttribute('class')) cls == null ? p[1].removeAttribute('class') : p[1].setAttribute('class', cls);
        });
        mo.observe(p[0], { attributes: true, attributeFilter: ['class'] });
        mirrors.push(mo);
      });
    }
    var REVEAL = /reveal|fade|anim|aos|appear|enter|in-view|scroll/i;
    function unhide(y) {
      if (!y.isConnected || !REVEAL.test(y.getAttribute('class') || '')) return;
      if (getComputedStyle(y).opacity === '0' && !isHidden(y)) { y.style.setProperty('opacity', '1', 'important'); y.style.setProperty('transform', 'none', 'important'); }
    }
    if (window.IntersectionObserver) {       // the page's own observer never saw the copy, so watch it ourselves
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { setTimeout(function () { unhide(en.target); }, 350); io.unobserve(en.target); } });
      }, { threshold: 0.05 });
      pairs.forEach(function (p) { if (REVEAL.test(p[1].getAttribute('class') || '')) io.observe(p[1]); });
      mirrors.push({ disconnect: function () { io.disconnect(); } });
    }
    setTimeout(function () { pairs.forEach(function (p) { unhide(p[1]); }); }, 2500);
  }
  function revertLayout() {
    mirrors.forEach(function (mo) { mo.disconnect(); });
    mirrors = [];
    Array.prototype.forEach.call(document.querySelectorAll('[' + CID + ']'), function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
    origOrder.forEach(function (nodes, p) {
      var known = new Set(nodes);
      var extras = Array.prototype.filter.call(p.childNodes, function (n) { return !known.has(n); });   // added later by the page's own JS
      nodes.forEach(function (n) { if (n.parentNode === p) p.appendChild(n); });
      extras.forEach(function (n) { p.appendChild(n); });
    });
    origOrder.clear();
    layoutDone = {};
  }
  function revertAll() {
    revertLayout();
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
    // Text formatting. Font size scales down with the viewport so big headings don't overflow on phones.
    if (spec.fs) setStyle(el, 'font-size', 'clamp(' + Math.min(11, spec.fs) + 'px, ' + (spec.fs / 12).toFixed(3) + 'vw, ' + spec.fs + 'px)');
    if (spec.b != null) setStyle(el, 'font-weight', spec.b ? '700' : '400');
    if (spec.i != null) setStyle(el, 'font-style', spec.i ? 'italic' : 'normal');
    if (spec.u != null || spec.st != null) {
      var deco = (spec.u ? 'underline ' : '') + (spec.st ? 'line-through' : '');
      setStyle(el, 'text-decoration', deco.trim() || 'none');
    }
    if (spec.al) setStyle(el, 'text-align', spec.al);
    applyShape(el, spec);
  }

  /* Boxes and pictures: corner radius, shadow, border, and (pictures) a cut-out shape, crop ratio and focal point. */
  var SHADOWS = ['none', '0 2px 10px rgba(0,0,0,.12)', '0 8px 24px rgba(0,0,0,.18)', '0 16px 48px rgba(0,0,0,.28)'];
  var CLIPS = {
    circle: 'circle(closest-side at 50% 50%)', arch: 'inset(0 round 999px 999px 0 0)',
    triangle: 'polygon(50% 0, 100% 100%, 0 100%)', diamond: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
    pentagon: 'polygon(50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%)', hexagon: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
    star: 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)'
  };
  var SHAPE_RADIUS = { rounded: '24px', blob: '63% 37% 54% 46% / 55% 48% 52% 45%' };
  function applyShape(el, spec) {
    var isImg = el.tagName === 'IMG';
    // size and spacing
    if (spec.cols != null) { snapAttr(el, 'data-cms-cols'); el.setAttribute('data-cms-cols', String(spec.cols)); ensureColsStyle(); }
    if (spec.gap != null) setStyle(el, 'gap', spec.gap + 'px');
    if (spec.pad != null) setStyle(el, 'padding', spec.pad + 'px');
    if (spec.mb != null) setStyle(el, 'margin-bottom', spec.mb + 'px');
    if (spec.w != null) { setStyle(el, 'box-sizing', 'border-box'); setStyle(el, 'width', spec.w + '%'); if (spec.w < 100) { setStyle(el, 'margin-left', 'auto'); setStyle(el, 'margin-right', 'auto'); } }
    if (spec.mh != null) setStyle(el, 'min-height', spec.mh + 'px');
    if (spec.rad != null) { setStyle(el, 'border-radius', spec.rad + 'px'); if (!isImg && spec.rad > 0) setStyle(el, 'overflow', 'hidden'); }
    if (spec.sh != null) setStyle(el, 'box-shadow', SHADOWS[spec.sh] || 'none');
    if (spec.bw != null) setStyle(el, 'border', spec.bw ? spec.bw + 'px solid ' + (spec.bc || '#47454D') : 'none');
    else if (spec.bc) setStyle(el, 'border-color', spec.bc);
    if (!isImg) return;
    if (spec.shape && spec.shape !== 'none') {
      if (CLIPS[spec.shape]) setStyle(el, 'clip-path', CLIPS[spec.shape]);
      else if (SHAPE_RADIUS[spec.shape]) setStyle(el, 'border-radius', SHAPE_RADIUS[spec.shape]);
      setStyle(el, 'object-fit', 'cover');
    }
    if (spec.ar && spec.ar !== 'orig') { setStyle(el, 'aspect-ratio', spec.ar.replace(':', ' / ')); setStyle(el, 'height', 'auto'); setStyle(el, 'object-fit', 'cover'); }
    if (spec.fx != null || spec.fy != null) { setStyle(el, 'object-position', (spec.fx != null ? spec.fx : 50) + '% ' + (spec.fy != null ? spec.fy : 50) + '%'); setStyle(el, 'object-fit', 'cover'); }
  }

  /* ---------- layout operations: duplicate / move / hide ---------- */
  var SKIP_SIBLING = /^(SCRIPT|STYLE|LINK|TEMPLATE|NOSCRIPT)$/;
  function visibleSibling(el, dir) {
    var s = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    while (s && (SKIP_SIBLING.test(s.tagName) || s.hasAttribute('data-cms-ui'))) s = dir < 0 ? s.previousElementSibling : s.nextElementSibling;
    return s;
  }
  function remember(p) { if (!origOrder.has(p)) origOrder.set(p, Array.prototype.slice.call(p.childNodes)); }
  function isHidden(el) { return el.hasAttribute('data-cms-hidden') || el.style.getPropertyValue('display') === 'none'; }
  /* ---------- adding elements (a fixed list of safe templates; the page's own styling is reused) ---------- */
  var REVEAL_TOKEN = /reveal|fade|aos|animate|appear|in-view|^is-/i;
  function cleanClass(c) { return String(c || '').split(/\s+/).filter(function (x) { return x && !REVEAL_TOKEN.test(x); }).join(' '); }
  function shown(e) { return !!(e.offsetWidth || e.offsetHeight) && !e.closest('[data-cms-ui]') && !e.hasAttribute(CID); }
  // The closest existing element of a kind, preferring one in the same section, so the new one looks native.
  function findModel(selector, near, avoid) {
    var scope = near.closest('section, main') || document.body;
    var pick = function (root) {
      var list = Array.prototype.filter.call(root.querySelectorAll(selector), function (e) { return shown(e) && !(avoid && e.closest(avoid)); });
      return list[0] || null;
    };
    return pick(scope) || pick(document.body);
  }
  function blockOf(el) {
    while (el.parentElement && el !== document.body) {
      var d = getComputedStyle(el).display;
      if (d === 'inline' || d === 'contents') el = el.parentElement; else break;
    }
    return el;
  }
  // An existing "card" (a box with its own background / border / shadow and some text) to copy the look from.
  function findCard(near) {
    var look = function (root) {
      var list = root.querySelectorAll('div[class], article[class], li[class]');
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!shown(c) || c.closest('nav, footer, header')) continue;
        var w = c.offsetWidth, hh = c.offsetHeight;
        if (w < 160 || w > 700 || hh < 80 || hh > 700) continue;
        if (c.querySelector('iframe, video, form, section') || !c.querySelector('h2, h3, h4, p')) continue;
        var cs = getComputedStyle(c);
        if (!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0 || (cs.boxShadow && cs.boxShadow !== 'none')) return c;
      }
      return null;
    };
    return look(near.closest('section, main') || document.body) || look(document.body);
  }
  var BTN_SEL = 'a.btn, a[class*="btn"], a[class*="button"], a[class*="cta"], button[class*="btn"], button[class*="button"]';
  function make(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // A content box: copies the look of an existing card (or a clean default) and holds a heading and a paragraph.
  function makeBox(model, standalone) {
    var box = make('div', model ? cleanClass(model.className) : '');
    if (!model) box.setAttribute('style', 'padding:24px;background:#fff;border:1px solid rgba(0,0,0,.12);border-radius:16px' + (standalone ? ';margin:16px 0' : ''));
    var hm = model && model.querySelector('h2, h3, h4'), pm = model && model.querySelector('p');
    box.appendChild(make(hm ? hm.tagName.toLowerCase() : 'h3', hm ? cleanClass(hm.className) : '', 'כותרת הקופסה'));
    box.appendChild(make('p', pm ? cleanClass(pm.className) : '', 'כאן כותבים את תוכן הקופסה.'));
    return box;
  }
  // Columns: attribute-driven rules, so the page collapses to one column on phones (inline styles cannot do media queries).
  function ensureColsStyle() {
    if (document.getElementById('cms-cols')) return;
    var st = document.createElement('style'); st.id = 'cms-cols';
    st.textContent = '[data-cms-cols]{display:grid !important;gap:24px !important;align-items:stretch}' +
      '[data-cms-cols="1"]{grid-template-columns:minmax(0,1fr) !important}[data-cms-cols="2"]{grid-template-columns:repeat(2,minmax(0,1fr)) !important}' +
      '[data-cms-cols="3"]{grid-template-columns:repeat(3,minmax(0,1fr)) !important}[data-cms-cols="4"]{grid-template-columns:repeat(4,minmax(0,1fr)) !important}' +
      '@media (max-width:720px){[data-cms-cols]{grid-template-columns:minmax(0,1fr) !important}}';
    document.head.appendChild(st);
  }
  function buildAdded(op, after) {
    var t = op.type, target = blockOf(after), el, m;
    if (t === 'button' || t === 'file') {
      m = findModel(BTN_SEL, after, 'nav, footer');
      el = make('a', m ? cleanClass(m.className) : '', t === 'file' ? 'הורדת קובץ' : 'לחצו כאן');
      el.setAttribute('href', '#');
      if (t === 'file') el.setAttribute('download', '');
      if (!m) el.setAttribute('style', 'display:inline-block;padding:10px 22px;border-radius:8px;background:#47454D;color:#fff;text-decoration:none;font-weight:700;margin:8px 0');
      if (after.matches('a, button')) target = after;          // next to an existing button, in the same row
    } else if (t === 'text') {
      var inList = target.parentNode && /^(UL|OL)$/.test(target.parentNode.tagName);
      m = findModel(inList ? 'li' : 'p', after, 'nav, footer, header');
      el = make(inList ? 'li' : 'p', m ? cleanClass(m.className) : '', 'טקסט חדש');
    } else if (t === 'heading') {
      m = findModel('h2, h3', after);
      el = make(m ? m.tagName.toLowerCase() : 'h2', m ? cleanClass(m.className) : '', 'כותרת חדשה');
    } else if (t === 'image') {
      el = document.createElement('img');
      el.setAttribute('alt', '');
      el.setAttribute('style', 'display:block;max-width:100%;height:auto;margin:16px auto');
    } else if (t === 'box') {
      el = makeBox(findCard(after), true);
    } else if (t === 'cols' && op.p && op.p.n >= 2 && op.p.n <= 4) {
      // a row of N equal boxes (stacks on narrow screens); the row itself is a grid whose columns and gap can be changed later
      el = make('div', '');
      el.setAttribute('data-cms-cols', String(op.p.n));
      el.setAttribute('style', 'margin:16px 0');
      ensureColsStyle();
      m = findCard(after);
      for (var ci = 0; ci < op.p.n; ci++) el.appendChild(makeBox(m, false));
    } else if (t === 'divider') {
      m = findModel('hr', after);
      el = make('hr', m ? cleanClass(m.className) : '');
      if (!m) el.setAttribute('style', 'border:0;border-top:1px solid rgba(0,0,0,.2);margin:24px 0');
    } else if (t === 'video' && op.p) {
      var src = op.p.provider === 'vimeo' ? 'https://player.vimeo.com/video/' + op.p.vid : 'https://www.youtube-nocookie.com/embed/' + op.p.vid;
      el = make('div', '');
      el.setAttribute('style', 'position:relative;width:100%;max-width:800px;aspect-ratio:16/9;margin:16px auto');
      el.setAttribute('data-cms-vid', op.p.provider + ':' + op.p.vid);
      var f = document.createElement('iframe');
      f.setAttribute('src', src);
      f.setAttribute('title', 'סרטון');
      f.setAttribute('loading', 'lazy');
      f.setAttribute('allow', 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen');
      f.setAttribute('allowfullscreen', '');
      f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      f.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;border:0');
      el.appendChild(f);
    } else return null;
    el.setAttribute(CID, op.id);
    el.setAttribute('data-cms-add', t);
    return { el: el, target: target };
  }

  function doOp(op) {
    if (op.op === 'add') {
      var base = resolve(op.after);
      if (!base || !base.parentNode) return false;
      if (q('[' + CID + '="' + op.id + '"]')) return true;
      var made = buildAdded(op, base);
      if (!made || !made.target.parentNode) return false;
      remember(made.target.parentNode);
      made.target.parentNode.insertBefore(made.el, made.target.nextSibling);
      return true;
    }
    if (op.op === 'dup') {
      var src = resolve(op.src);
      if (!src || !src.parentNode) return false;
      if (q('[' + CID + '="' + op.id + '"]')) return true;
      remember(src.parentNode);
      var c = src.cloneNode(true);
      [c].concat(Array.prototype.slice.call(c.querySelectorAll('*'))).forEach(function (n) {
        n.removeAttribute(STAMP); n.removeAttribute('id'); n.removeAttribute('data-cms-sel');
        n.removeAttribute('data-cms-hover'); n.removeAttribute('contenteditable'); n.removeAttribute('data-cms-hidden');
      });
      c.setAttribute(CID, op.id);
      src.parentNode.insertBefore(c, src.nextSibling);
      mirrorClasses(src, c);
      return true;
    }
    var el = resolve(op.key);
    if (!el || !el.parentNode) return false;
    if (op.op === 'move') {
      var sib = visibleSibling(el, op.dir);
      if (!sib) return true;
      remember(el.parentNode);
      el.parentNode.insertBefore(el, op.dir < 0 ? sib : sib.nextSibling);
    } else if (op.op === 'hide') {
      if (EDIT) { snapAttr(el, 'data-cms-hidden'); el.setAttribute('data-cms-hidden', ''); }   // dimmed, still clickable, so it can be shown again
      else setStyle(el, 'display', 'none');
    }
    return true;
  }
  function applyLayout(ops) {
    ops.forEach(function (op, i) { if (!layoutDone[i] && doOp(op)) layoutDone[i] = true; });
  }

  function applyAll(revert) {
    applying = true;
    if (observer) observer.disconnect();
    try {
      if (revert) revertAll();
      var pg = (edits.pages || {})[pageKey] || {};
      applyLayout(pg.layout || []);
      var els = pg.els || {};
      Object.keys(els).forEach(function (p) {
        var el = resolve(p);
        if (el && el !== editingEl) applyEl(el, els[p]);
      });
      applyColors((edits.global || {}).colors);
      applyFonts((edits.global || {}).fonts);
    } finally {
      applying = false;
      if (observer) observe();
    }
    if (EDIT) sendSections();
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
      stampAll();
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
    '[contenteditable]{outline:3px solid #47454D!important;outline-offset:2px;cursor:text!important}' +
    '[data-cms-hidden]{opacity:.28!important;outline:2px dashed #837D82!important;outline-offset:2px}' +
    'iframe{pointer-events:none!important}';
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
      font: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(),
      fs: Math.round(parseFloat(cs.fontSize)) || 16, b: (parseInt(cs.fontWeight, 10) || 400) >= 600, i: cs.fontStyle === 'italic',
      u: /underline/.test(cs.textDecorationLine), st: /line-through/.test(cs.textDecorationLine),
      al: /^(left|right|center|justify)$/.test(cs.textAlign) ? cs.textAlign : 'right',
      canUp: !!visibleSibling(el, -1), canDown: !!visibleSibling(el, 1),
      clone: el.getAttribute(CID) || null, hidden: isHidden(el),
      disp: cs.display, cols: +el.getAttribute('data-cms-cols') || 0, gap: Math.round(parseFloat(cs.columnGap)) || 0, pad: Math.round(parseFloat(cs.paddingTop)) || 0,
      mb: Math.round(parseFloat(cs.marginBottom)) || 0, mh: Math.round(parseFloat(cs.minHeight)) || 0,
      w: el.parentElement && el.parentElement.clientWidth ? Math.min(100, Math.round(el.offsetWidth / el.parentElement.clientWidth * 100)) : 100,
      rad: Math.round(parseFloat(cs.borderTopLeftRadius)) || 0, bw: Math.round(parseFloat(cs.borderTopWidth)) || 0, bc: cssColorToHex(cs.borderTopColor),
      added: el.getAttribute('data-cms-add') || null, vid: el.getAttribute('data-cms-vid') || null
    };
    if (u.kind === 'text') info.text = getText(el);
    if (u.kind === 'node') info.text = el.childNodes[u.idx].nodeValue;
    if (u.kind === 'image') { info.src = el.getAttribute('src') || ''; info.alt = el.getAttribute('alt') || ''; info.currentSrc = el.currentSrc || el.src; }
    if (u.kind === 'bg') { var m = getComputedStyle(el).backgroundImage.match(/url\(["']?([^"')]+)/); info.currentSrc = m ? m[1] : ''; }
    if (a) { info.href = a.getAttribute('href') || ''; info.linkKey = pathOf(a); }
    return info;
  }

  // programmatic = selection requested by the editor (e.g. from the structure list), not a click on the page
  function select(u, programmatic) {
    if (selEl) selEl.removeAttribute('data-cms-sel');
    selEl = u ? u.el : null;
    if (selEl) selEl.setAttribute('data-cms-sel', '');
    send({ type: 'cms-select', unit: u ? describe(u) : null, programmatic: !!programmatic });
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
    } else if (d.type === 'cms-select-key') {
      var t = resolve(String(d.key));
      if (t) { select({ kind: kindOf(t), el: t }, true); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    } else if (d.type === 'cms-select-parent') {
      var par = selEl && selEl.parentElement;
      if (par && par !== document.body && par !== document.documentElement) select({ kind: kindOf(par), el: par }, true);
    } else if (d.type === 'cms-subtree-map') {
      send({ type: 'cms-subtree-map-result', reqId: d.reqId, pairs: subtreeMap(String(d.src), String(d.id)) });
    }
  });
  var lastUnit = null;
  function kindOf(el) { return el.tagName === 'IMG' ? 'image' : (isTextOnly(el) ? 'text' : 'box'); }
  function describeSelected() {
    if (!selEl) return null;
    return lastUnit && lastUnit.el === selEl ? describe(lastUnit) : describe({ kind: kindOf(selEl), el: selEl });
  }

  // Top-level sections of the page (what the editor shows in its "Structure" list).
  function listSections() {
    var all = Array.prototype.slice.call(document.querySelectorAll('section, header, footer, nav'))
      .filter(function (el) { return !el.closest('[data-cms-ui]'); });
    return all.filter(function (el) { return !all.some(function (o) { return o !== el && o.contains(el); }); }).map(function (el) {
      var h = el.querySelector('h1,h2,h3');
      var NAMES = { nav: 'תפריט עליון', footer: 'תחתית האתר', header: 'ראש הדף', section: 'קטע' };
      var label = (h && getText(h)) || el.getAttribute('aria-label') || NAMES[el.tagName.toLowerCase()] || el.tagName.toLowerCase();
      return { key: pathOf(el), label: label.slice(0, 48), tag: el.tagName.toLowerCase(), clone: el.getAttribute(CID) || null,
        hidden: isHidden(el), up: !!visibleSibling(el, -1), down: !!visibleSibling(el, 1) };
    });
  }
  var sectionsTimer;
  function sendSections() { clearTimeout(sectionsTimer); sectionsTimer = setTimeout(function () { send({ type: 'cms-sections', sections: listSections() }); }, 30); }

  // Pairs [original key, clone key] for a duplicated block, so the editor can copy existing edits to the copy.
  function subtreeMap(srcKey, id) {
    var a = resolve(srcKey), b = resolve('@' + id), pairs = [];
    (function walk(x, y) {
      if (!x || !y) return;
      pairs.push([pathOf(x), pathOf(y)]);
      for (var i = 0; i < x.children.length && i < y.children.length; i++) walk(x.children[i], y.children[i]);
    })(a, b);
    return pairs;
  }
  var origSelect = select;
  select = function (u, programmatic) { lastUnit = u; origSelect(u, programmatic); };

  domReady().then(function () {
    stampAll();
    palette = scanPalette();
    var h1 = document.querySelector('h1,h2');
    send({
      type: 'cms-ready', page: pageKey, palette: palette, version: KIT_VERSION, sections: listSections(),
      fonts: {
        heading: h1 ? getComputedStyle(h1).fontFamily.split(',')[0].replace(/["']/g, '').trim() : '',
        body: getComputedStyle(document.body).fontFamily.split(',')[0].replace(/["']/g, '').trim()
      }
    });
  });
})();
