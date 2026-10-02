/* Custom-domain support for GitHub Pages sites: validation, the DNS records to show, a DNS check
 * (DNS-over-HTTPS) so the domain is only switched on in GitHub once it points at GitHub. */
import { HttpError } from './validate.js';

export const GH_IPV4 = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
export const GH_IPV6 = ['2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153'];
const SECOND_LEVEL = new Set(['co.il', 'org.il', 'net.il', 'ac.il', 'muni.il', 'gov.il', 'co.uk', 'org.uk', 'com.au', 'co.nz', 'com.br', 'co.za', 'co.jp']);
const BLOCKED = /(^|\.)(github\.io|github\.com|workers\.dev|pages\.dev|localhost|local|internal|example)$/;

/** "https://WWW.Client.co.il/path" → "www.client.co.il"; throws HttpError on anything that is not a plain hostname. */
export function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  if (!s) throw new HttpError(400, 'הזינו דומיין');
  try { s = new URL('http://' + s).hostname; } catch { throw new HttpError(400, 'דומיין לא תקין'); }   // also converts IDN to punycode
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s) && !/^(?=.{4,253}$)([a-z0-9-]+\.)+xn--[a-z0-9-]+$/.test(s)) throw new HttpError(400, 'דומיין לא תקין. דוגמה: www.client.co.il');
  if (s.includes('*')) throw new HttpError(400, 'דומיין לא תקין');
  if (BLOCKED.test(s)) throw new HttpError(400, 'אי אפשר לחבר כתובת של github.io / workers.dev. הזינו דומיין שרכשתם.');
  return s;
}

export function isApex(domain) {
  const labels = domain.split('.');
  const tail2 = labels.slice(-2).join('.');
  return labels.length === (SECOND_LEVEL.has(tail2) ? 3 : 2);
}

export const ghHost = (repo) => repo.split('/')[0].toLowerCase() + '.github.io';

/** The DNS records the owner has to create at the registrar. */
export function dnsRecords(domain, repo) {
  const host = ghHost(repo);
  if (isApex(domain)) {
    return {
      apex: true,
      records: [
        ...GH_IPV4.map((v) => ({ type: 'A', name: '@', value: v })),
        ...GH_IPV6.map((v) => ({ type: 'AAAA', name: '@', value: v, optional: true })),
        { type: 'CNAME', name: 'www', value: host, optional: true },
      ],
    };
  }
  return { apex: false, records: [{ type: 'CNAME', name: domain.split('.')[0], value: host }] };
}

async function doh(env, name, type) {
  const base = env.DOH_URL || 'https://cloudflare-dns.com/dns-query';
  const r = await fetch(`${base}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
  if (!r.ok) throw new HttpError(502, 'בדיקת ה-DNS נכשלה, נסו שוב בעוד רגע');
  const j = await r.json();
  return (j.Answer || []).filter((a) => a.type === (type === 'A' ? 1 : type === 'AAAA' ? 28 : 5)).map((a) => String(a.data).toLowerCase().replace(/\.$/, ''));
}

/** → {ok, found:[…], expected, hint}. The apex needs A records at GitHub; a subdomain needs a CNAME to <owner>.github.io. */
export async function checkDns(env, domain, repo) {
  const host = ghHost(repo);
  if (isApex(domain)) {
    const a = await doh(env, domain, 'A');
    const bad = a.filter((ip) => !GH_IPV4.includes(ip));
    const ok = a.length > 0 && !bad.length;
    let hint = '';
    if (!a.length) hint = 'עוד לא נמצאו רשומות A לדומיין. ייתכן שעדיין לא הוגדרו, או שה-DNS עוד מתעדכן (עד כמה שעות).';
    else if (bad.length) hint = 'נמצאו רשומות A שאינן של GitHub (' + bad.join(', ') + '). מחקו אותן. אם הדומיין מנוהל ב-Cloudflare, כבו את הענן הכתום (DNS only).';
    let www = null;
    try { www = (await doh(env, 'www.' + domain, 'CNAME')).includes(host); } catch { /* optional */ }
    return { ok, found: a, expected: GH_IPV4, www, hint };
  }
  const c = await doh(env, domain, 'CNAME');
  const ok = c.includes(host);
  return { ok, found: c, expected: [host], hint: ok ? '' : c.length ? `ה-CNAME מצביע ל-${c[0]} ולא ל-${host}.` : 'עוד לא נמצאה רשומת CNAME. ייתכן שה-DNS עוד מתעדכן.' };
}
