/* Cloudflare Pages API client (paid hosting). Uses the same API token as the deploy, which needs
 * the "Cloudflare Pages: Edit" permission. Secrets: CF_API_TOKEN, CF_ACCOUNT_ID. */
import { HttpError } from './validate.js';

export const projectName = (siteId) => ('fd-' + siteId).slice(0, 58).replace(/-+$/, '');

export class Cloudflare {
  constructor(env) {
    this.token = env.CF_API_TOKEN; this.account = env.CF_ACCOUNT_ID;
    this.base = env.CF_API || 'https://api.cloudflare.com/client/v4';
  }

  req(method, path, body, okCodes = []) { return this.call(method, `/accounts/${this.account}/pages/projects${path}`, body, okCodes); }

  async call(method, path, body, okCodes = []) {
    if (!this.token || !this.account) throw new HttpError(500, 'חסרים CF_API_TOKEN / CF_ACCOUNT_ID בהגדרות השרת (ראו README)');
    const r = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || (j && j.success === false)) {
      if (okCodes.includes(r.status)) return null;
      if (r.status === 401 || r.status === 403) throw new HttpError(403, 'לטוקן של Cloudflare חסרה הרשאה (נדרש Zone ← Zone: Read ו-DNS: Edit, ו-Cloudflare Pages: Edit)');
      const msg = (j && j.errors && j.errors[0] && j.errors[0].message) || `Cloudflare ${r.status}`;
      const e = new HttpError(r.status === 404 ? 404 : 502, msg);
      e.cf = r.status;
      throw e;
    }
    return j ? j.result : null;
  }

  getProject(name) { return this.req('GET', '/' + name, null, [404]); }

  createProject(name, site) {
    const [owner, repo] = site.repo.split('/');
    return this.req('POST', '', {
      name, production_branch: site.branch,
      build_config: { build_command: '', destination_dir: site.root || '', root_dir: '' },
      source: { type: 'github', config: { owner, repo_name: repo, production_branch: site.branch, pr_comments_enabled: false, deployments_enabled: true, production_deployments_enabled: true, preview_deployment_setting: 'none' } },
    });
  }

  /** The zone that contains `domain` (tries the domain itself, then its parents). */
  async zoneFor(domain) {
    const labels = domain.split('.');
    for (let i = 0; i <= labels.length - 2; i++) {
      const cand = labels.slice(i).join('.');
      const z = await this.call('GET', `/zones?name=${encodeURIComponent(cand)}`);
      if (z && z[0]) return z[0];
    }
    return null;
  }

  /** Make `fqdn` carry exactly the wanted A/AAAA/CNAME records (other record types, e.g. MX/TXT, are never touched). */
  async setRecords(zoneId, wanted) {
    const changes = [];
    for (const fqdn of [...new Set(wanted.map((w) => w.name))]) {
      const existing = ((await this.call('GET', `/zones/${zoneId}/dns_records?name=${encodeURIComponent(fqdn)}&per_page=100`)) || [])
        .filter((r) => ['A', 'AAAA', 'CNAME'].includes(r.type));
      const want = wanted.filter((w) => w.name === fqdn);
      const keep = new Set();
      for (const w of want) {
        const hit = existing.find((r) => r.type === w.type && r.content.toLowerCase() === w.content.toLowerCase());
        if (hit) { keep.add(hit.id); changes.push({ action: 'kept', ...w }); }
      }
      for (const r of existing) {
        if (keep.has(r.id)) continue;
        await this.call('DELETE', `/zones/${zoneId}/dns_records/${r.id}`);
        changes.push({ action: 'removed', type: r.type, name: fqdn, content: r.content });
      }
      for (const w of want) {
        if (changes.some((c) => c.action === 'kept' && c.type === w.type && c.name === w.name && c.content === w.content)) continue;
        await this.call('POST', `/zones/${zoneId}/dns_records`, { type: w.type, name: w.name, content: w.content, proxied: !!w.proxied, ttl: 1 });
        changes.push({ action: 'created', ...w });
      }
    }
    return changes;
  }

  deleteProject(name) { return this.req('DELETE', '/' + name, null, [404]); }
  listDomains(name) { return this.req('GET', `/${name}/domains`); }
  addDomain(name, domain) { return this.req('POST', `/${name}/domains`, { name: domain }); }
  deleteDomain(name, domain) { return this.req('DELETE', `/${name}/domains/${domain}`, null, [404]); }
}
