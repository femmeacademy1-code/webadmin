/* HTML sanitiser for "section" blocks that the editor's chat (Claude) writes.
 * The result is stored in cms/edits.json and rendered on a client's public site, so it is rebuilt from an allow-list:
 * only a few layout/text tags, only a few attributes, and only harmless inline-style properties. No scripts, no event
 * handlers, no images/iframes, no external resources. The kit sanitises again with the same lists before it renders. */
import { HttpError } from './validate.js';

export const MAX_HTML_IN = 24000;
export const MAX_HTML_OUT = 14000;
const MAX_NODES = 400, MAX_DEPTH = 12;

const TAGS = new Set(['section', 'div', 'span', 'p', 'h2', 'h3', 'h4', 'h5', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'br', 'hr',
  'blockquote', 'figure', 'figcaption', 'small', 'a', 'q', 'cite', 'time']);
const VOID = new Set(['br', 'hr']);
// elements whose whole content is dropped, not just the tag
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript', 'template', 'textarea',
  'title', 'select', 'option', 'head', 'link', 'meta', 'base', 'frame', 'frameset', 'applet', 'audio', 'video', 'canvas']);

const CLASS_OK = /^[\w -]{1,200}$/;
const TEXT_ATTR = /^[^<>"\u0000-\u001f]{0,200}$/;
const ROLES = new Set(['list', 'listitem', 'group', 'article', 'region', 'presentation', 'img']);
const SIMPLE_ATTRS = { dir: /^(rtl|ltr)$/, lang: /^[a-z]{2}(-[A-Za-z]{2,4})?$/, title: TEXT_ATTR, 'aria-label': TEXT_ATTR, 'aria-hidden': /^(true|false)$/, datetime: /^[\d\-:TZ+. ]{4,30}$/ };

const STYLE_PROPS = new Set(['color', 'background', 'background-color', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-decoration', 'text-transform', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'margin-inline', 'margin-block',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'padding-inline', 'padding-block', 'border', 'border-top', 'border-bottom',
  'border-left', 'border-right', 'border-color', 'border-width', 'border-style', 'border-radius', 'box-shadow', 'display', 'flex', 'flex-direction',
  'flex-wrap', 'flex-grow', 'justify-content', 'align-items', 'align-self', 'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'width', 'max-width',
  'min-width', 'min-height', 'max-height', 'height', 'aspect-ratio', 'opacity', 'list-style', 'direction', 'white-space', 'position', 'overflow', 'quotes']);
const DISPLAY_OK = /^(block|inline|inline-block|flex|inline-flex|grid)$/;
const BAD_VALUE = /url\s*\(|expression|javascript|@import|\\|<|>|behavior|-moz-binding|image-set|attr\s*\(/i;

export function cleanStyle(css) {
  const out = [];
  for (const decl of String(css || '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 1) continue;
    const prop = decl.slice(0, i).trim().toLowerCase(), val = decl.slice(i + 1).trim().replace(/\s*!important\s*$/i, '');
    if (!STYLE_PROPS.has(prop) || !val || val.length > 200 || BAD_VALUE.test(val)) continue;
    if (prop === 'display' && !DISPLAY_OK.test(val)) continue;
    if (prop === 'position' && val !== 'relative') continue;
    if (prop === 'overflow' && val !== 'hidden') continue;
    out.push(prop + ':' + val);
  }
  return out.join(';');
}

function safeHref(v) {
  const s = v.trim();
  if (/[\u0000-\u001f\s]/.test(s) || s.length > 500) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(s) || /^#[\w-]*$/.test(s) || /^\/(?!\/)[\w./?=&%#-]*$/.test(s)) return s;
  return null;
}

const escAttr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (t) => t.replace(/&(?!(#\d{1,6}|#x[0-9a-f]{1,5}|[a-z]{2,8});)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>|[^<]+|</g;
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attrsOf(tag, raw) {
  const out = [];
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(raw))) {
    const name = m[1].toLowerCase();
    const val = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (name === 'class') { if (CLASS_OK.test(val)) out.push(['class', val]); }
    else if (name === 'style') { const s = cleanStyle(val); if (s) out.push(['style', s]); }
    else if (name === 'href' && tag === 'a') { const h = safeHref(val); if (h) out.push(['href', h]); }
    else if (name === 'role') { if (ROLES.has(val)) out.push(['role', val]); }
    else if (name === 'data-cms-todo') out.push(['data-cms-todo', '']);
    else if (SIMPLE_ATTRS[name] && SIMPLE_ATTRS[name].test(val)) out.push([name, val]);
  }
  if (tag === 'a' && out.some((a) => a[0] === 'href')) out.push(['rel', 'noopener']);
  return out;
}

/** Returns clean HTML (a string) or throws HttpError(400). */
export function sanitizeHtml(input) {
  if (typeof input !== 'string') throw new HttpError(400, 'תוכן הקטע לא תקין');
  if (input.length > MAX_HTML_IN) throw new HttpError(400, 'הקטע ארוך מדי');
  const out = [], stack = [];
  let nodes = 0, text = 0, skip = null, skipDepth = 0, tops = 0, topText = false;
  const tokens = input.match(TOKEN) || [];
  for (const t of tokens) {
    if (t.startsWith('<!--')) continue;
    const m = t.match(/^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/);
    if (skip) {                                           // inside <script>…: drop until its matching close tag
      if (m && m[2].toLowerCase() === skip) { if (m[1]) { if (--skipDepth === 0) skip = null; } else if (!/\/>$/.test(t)) skipDepth++; }
      continue;
    }
    if (!m) {
      if (t === '<') { out.push('&lt;'); continue; }
      if (!stack.length) { if (!t.trim()) { if (out.length) out.push(' '); continue; } topText = true; }     // text outside any element: wrapped below
      const e = escText(t);
      out.push(e); text += t.trim().length;
      continue;
    }
    const closing = !!m[1], tag = m[2].toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) { if (!closing && !/\/>$/.test(t)) { skip = tag; skipDepth = 1; } continue; }
    if (!TAGS.has(tag)) continue;                         // unknown tag: unwrap, keep the text
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at < 0 || VOID.has(tag)) continue;
      while (stack.length > at) out.push('</' + stack.pop() + '>');
      continue;
    }
    if (++nodes > MAX_NODES) throw new HttpError(400, 'הקטע מורכב מדי');
    if (!stack.length) tops++;
    const attrs = attrsOf(tag, t.slice(m[0].length));
    const open = '<' + tag + attrs.map(([k, v]) => ' ' + k + (v === '' && k === 'data-cms-todo' ? '' : '="' + escAttr(v) + '"')).join('') + '>';
    out.push(open);
    if (!VOID.has(tag)) { stack.push(tag); if (stack.length > MAX_DEPTH) throw new HttpError(400, 'הקטע מקונן יותר מדי'); }
  }
  while (stack.length) out.push('</' + stack.pop() + '>');
  let html = out.join('').trim();
  if (!text || !html) throw new HttpError(400, 'הקטע ריק');
  if (tops !== 1 || topText || !/^<(section|div)[\s>]/.test(html)) html = '<div>' + html + '</div>';   // always exactly one root element
  if (html.length > MAX_HTML_OUT) throw new HttpError(400, 'הקטע ארוך מדי');
  return html;
}
