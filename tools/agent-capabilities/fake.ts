import { check } from './contracts.ts';
import type { HttpRequest, HttpResponse, Transport } from './github.ts';

export type FakeFault = 'none' | 'redirect' | 'error' | 'oversize' | 'accepted_timeout' | 'before_submit' | 'rejected';
export class FakeGitHub implements Transport {
  #credential: string;
  #pulls: Record<string, unknown>[] = [];
  writes = 0;
  reads = 0;
  fault: FakeFault = 'none';
  constructor(credential: string, private readonly owner: string, private readonly repository: string, private readonly headSha: string) {
    this.#credential = credential;
  }
  async send(req: HttpRequest): Promise<HttpResponse> {
    check(req.headers.Authorization === `Bearer ${this.#credential}`);
    check(req.redirect === 'error' && req.retries === 0 && req.url.startsWith(`https://api.github.com/repos/${this.owner}/${this.repository}/`));
    if (req.signal.aborted) throw new Error('CANCELLED');
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname.includes('/git/ref/heads/')) {
      this.reads++;
      return { status: 200, body: JSON.stringify({ ref: `refs/heads/${decodeURIComponent(url.pathname.split('/git/ref/heads/')[1])}`, object: { type: 'commit', sha: this.headSha } }) };
    }
    if (req.method === 'GET' && url.pathname.endsWith('/pulls')) {
      this.reads++; check(url.searchParams.get('state') === 'all');
      const page = Number(url.searchParams.get('page'));
      return { status: 200, body: JSON.stringify(this.#pulls.slice((page - 1) * 100, page * 100)) };
    }
    check(req.method === 'POST' && url.pathname.endsWith('/pulls') && req.body);
    if (this.fault === 'before_submit') throw new Error(this.#credential);
    if (this.fault === 'rejected') return { status: 422, body: this.#credential };
    if (this.fault === 'redirect') return { status: 307, body: this.#credential };
    if (this.fault === 'error') return { status: 500, body: this.#credential };
    if (this.fault === 'oversize') return { status: 201, body: this.#credential + 'x'.repeat(req.maxResponseBytes) };
    const payload = JSON.parse(req.body); check(payload.draft === true);
    const number = ++this.writes;
    const pr = { id: number, number, html_url: `https://github.com/${this.owner}/${this.repository}/pull/${number}`,
      draft: true, state: 'open', head: { ref: payload.head, repo: { full_name: `${this.owner}/${this.repository}` } },
      base: { ref: payload.base, repo: { full_name: `${this.owner}/${this.repository}` } } };
    this.#pulls.push(pr);
    if (this.fault === 'accepted_timeout') return await new Promise(() => {});
    return { status: 201, body: JSON.stringify(pr) };
  }
  /** Test-only provider-side fixtures; recovery must include closed objects too. */
  seedPulls(pulls: Record<string, unknown>[]): void { this.#pulls = structuredClone(pulls); }
}
