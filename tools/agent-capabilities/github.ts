import { check, providerObject, request, scope, ProviderRejected } from './contracts.ts';
import type { Scope, DraftRequest, Provider, ProviderObject } from './contracts.ts';

export interface HttpRequest {
  method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: string;
  redirect: 'error'; retries: 0; maxResponseBytes: number; signal: AbortSignal;
}
export interface HttpResponse { status: number; body: string }
/** Trusted implementation must honor size, timeout, redirect and zero retry constraints. No live implementation is shipped. */
export interface Transport { send(request: HttpRequest): Promise<HttpResponse> }
export interface RecoveryProvider { list(scope: Scope, page: number, credential: string, signal: AbortSignal): Promise<{ items: ProviderObject[]; more: boolean }> }
const LIMIT = 65_536;
function repositoryPath(s: Scope): string { return `/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repository)}`; }
function plain(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_PROVIDER_RESULT');
  return value as Record<string, unknown>;
}
/** Fixed-host adapter exercised with fake HTTP only. Never forwards provider bodies, headers or errors. */
export class GitHubDraftProvider implements Provider, RecoveryProvider {
  constructor(private readonly transport: Transport) {}
  private async send(method: HttpRequest['method'], path: string, credential: string, signal: AbortSignal, body?: string): Promise<unknown> {
    const response = await this.transport.send({ method, url: 'https://api.github.com' + path,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${credential}`, 'X-GitHub-Api-Version': '2026-03-10' },
      ...(body === undefined ? {} : { body }), redirect: 'error', retries: 0, maxResponseBytes: LIMIT, signal });
    if (method === 'POST' && [401, 403, 404, 422].includes(response.status)) throw new ProviderRejected();
    check(response.status === (method === 'POST' ? 201 : 200), 'PROVIDER_UNAVAILABLE');
    check(typeof response.body === 'string' && Buffer.byteLength(response.body) <= LIMIT, 'INVALID_PROVIDER_RESULT');
    try { return JSON.parse(response.body); } catch { throw new Error('INVALID_PROVIDER_RESULT'); }
  }
  async validateHead(s: Scope, credential: string, signal: AbortSignal): Promise<string> {
    const o = plain(await this.send('GET', repositoryPath(s) + '/git/ref/heads/' + encodeURIComponent(s.head), credential, signal));
    check(o.ref === `refs/heads/${s.head}`, 'HEAD_CHANGED');
    const obj = plain(o.object); check(obj.type === 'commit' && typeof obj.sha === 'string' && /^[a-f0-9]{40}$/.test(obj.sha), 'INVALID_PROVIDER_RESULT');
    return obj.sha as string;
  }
  private pull(value: unknown, s: Scope): ProviderObject {
    const o = plain(value); const head = plain(o.head); const base = plain(o.base);
    const headRepo = plain(head.repo); const baseRepo = plain(base.repo);
    check(head.ref === s.head && base.ref === s.base &&
      typeof headRepo.full_name === 'string' && typeof baseRepo.full_name === 'string' &&
      headRepo.full_name.toLowerCase() === `${s.owner}/${s.repository}`.toLowerCase() &&
      baseRepo.full_name.toLowerCase() === `${s.owner}/${s.repository}`.toLowerCase(), 'INVALID_PROVIDER_RESULT');
    return providerObject({ id: o.id, number: o.number, url: o.html_url }, s);
  }
  async createDraft(raw: DraftRequest, credential: string, signal: AbortSignal): Promise<ProviderObject> {
    const req = request(raw);
    const s = scope(req);
    const body = JSON.stringify({ title: req.title, body: req.body, head: req.head, base: req.base, draft: true });
    const response = await this.send('POST', repositoryPath(s) + '/pulls', credential, signal, body);
    const o = plain(response); check(o.draft === true, 'INVALID_PROVIDER_RESULT');
    return this.pull(response, s);
  }
  async list(s: Scope, page: number, credential: string, signal: AbortSignal): Promise<{ items: ProviderObject[]; more: boolean }> {
    check(Number.isSafeInteger(page) && page >= 1 && page <= 100, 'RECOVERY_DENIED');
    const query = new URLSearchParams({ state: 'all', head: `${s.owner}:${s.head}`, base: s.base, per_page: '100', page: String(page) });
    const result = await this.send('GET', repositoryPath(s) + '/pulls?' + query, credential, signal);
    check(Array.isArray(result) && result.length <= 100, 'INVALID_PROVIDER_RESULT');
    // Request the next page whenever this page is full; never follow provider-supplied URLs.
    return { items: result.map(value => this.pull(value, s)), more: result.length === 100 };
  }
}
