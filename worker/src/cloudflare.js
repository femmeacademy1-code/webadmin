/* Cloudflare Pages API client (paid hosting). Uses the same API token as the deploy, which needs
 * the "Cloudflare Pages: Edit" permission. Secrets: CF_API_TOKEN, CF_ACCOUNT_ID. */
import { HttpError } from './validate.js';

export const projectName = (siteId) => ('fd-' + siteId).slice(0, 58).replace(/-+$/, '');

export class Cloudflare {
  constructor(env) {
    this.token = env.CF_API_TOKEN; this.account = env.CF_ACCOUNT_ID;
    this.base = env.CF_API || 'https://api.cloudflare.com/client/v4';
  }

  async req(method, path, body, okCodes = []) {
    if (!this.token || !this.account) throw new HttpError(500, 'חסרים CF_API_TOKEN / CF_ACCOUNT_ID בהגדרות השרת (ראו README)');
    const r = await fetch(`${this.base}/accounts/${this.account}/pages/projects${path}`, {
      method,
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || (j && j.success === false)) {
      if (okCodes.includes(r.status)) return null;
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

  deleteProject(name) { return this.req('DELETE', '/' + name, null, [404]); }
  listDomains(name) { return this.req('GET', `/${name}/domains`); }
  addDomain(name, domain) { return this.req('POST', `/${name}/domains`, { name: domain }); }
  deleteDomain(name, domain) { return this.req('DELETE', `/${name}/domains/${domain}`, null, [404]); }
}
