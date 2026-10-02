/* GitHub REST client used server-side. The token never leaves the Worker. */
import { HttpError } from './validate.js';

const enc = encodeURIComponent;

export class GitHub {
  constructor(env) {
    this.token = env.GITHUB_TOKEN;
    this.base = env.GITHUB_API || 'https://api.github.com';
  }

  async req(method, path, body) {
    if (!this.token) throw new HttpError(500, 'חסר GITHUB_TOKEN בהגדרות השרת');
    const r = await fetch(this.base + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + this.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'femme-digital-cms',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!r.ok) {
      const e = new HttpError(r.status === 404 ? 404 : 502, (json && json.message) || `GitHub ${r.status}`);
      e.github = r.status;
      throw e;
    }
    return json;
  }

  /** {text, sha} or null when the file does not exist. */
  async getFile(repo, path, ref) {
    try {
      const r = await this.req('GET', `/repos/${repo}/contents/${path.split('/').map(enc).join('/')}?ref=${enc(ref)}`);
      const bin = atob(r.content.replace(/\s/g, ''));
      return { text: new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))), sha: r.sha };
    } catch (e) {
      if (e.github === 404) return null;
      throw e;
    }
  }

  /** One atomic commit. files: [{path, text} | {path, base64}] → {commit, blobs:{path:sha}} */
  async commit(repo, branch, files, message) {
    const ref = await this.req('GET', `/repos/${repo}/git/ref/heads/${enc(branch)}`);
    const headSha = ref.object.sha;
    const head = await this.req('GET', `/repos/${repo}/git/commits/${headSha}`);
    const blobs = await Promise.all(files.map((f) => this.req('POST', `/repos/${repo}/git/blobs`,
      f.base64 != null ? { content: f.base64, encoding: 'base64' } : { content: f.text, encoding: 'utf-8' })));
    const tree = await this.req('POST', `/repos/${repo}/git/trees`, {
      base_tree: head.tree.sha,
      tree: files.map((f, i) => ({ path: f.path, mode: '100644', type: 'blob', sha: blobs[i].sha })),
    });
    const commit = await this.req('POST', `/repos/${repo}/git/commits`, { message, tree: tree.sha, parents: [headSha] });
    await this.req('PATCH', `/repos/${repo}/git/refs/heads/${enc(branch)}`, { sha: commit.sha });
    const shas = {};
    files.forEach((f, i) => { shas[f.path] = blobs[i].sha; });
    return { commit: commit.sha, blobs: shas };
  }

  /** GitHub Pages settings: {cname, https_enforced, https_certificate:{state}, html_url} */
  getPages(repo) { return this.req('GET', `/repos/${repo}/pages`); }
  setPages(repo, settings) { return this.req('PUT', `/repos/${repo}/pages`, settings); }

  history(repo, branch, path, n = 30) {
    return this.req('GET', `/repos/${repo}/commits?sha=${enc(branch)}&path=${enc(path)}&per_page=${n}`);
  }
}
