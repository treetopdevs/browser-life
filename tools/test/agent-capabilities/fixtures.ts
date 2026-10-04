import { Broker } from '../../agent-capabilities/broker.ts';
import { MemoryAudit } from '../../agent-capabilities/audit.ts';
import { OPERATION } from '../../agent-capabilities/contracts.ts';
import type { Provider, CredentialRegistration, Task } from '../../agent-capabilities/contracts.ts';
export const req = { operation: OPERATION, owner: 'test', repository: 'repo', base: 'main', head: 'reviewed',
  expectedHeadSha: 'a'.repeat(40), title: 'Approved draft', body: 'Approved body', draft: true as const };
export const registration: Task = { agentId: 'alpha', taskId: 'task_alpha', workspaceId: 'stage_alpha',
  sourceRevision: { changeId: 'jj_change', commit: 'a'.repeat(40), tree: 'b'.repeat(40) } };
export const cred: CredentialRegistration = { handle: 'internal', owner: 'test', repository: 'repo',
  expiresAt: 1_000_000, permissions: ['pull_requests:write', 'contents:read'] };
export function setup(audit = new MemoryAudit(), provider?: Provider) {
  let now = 0; let resolves = 0; let writes = 0;
  const p: Provider = provider ?? { validateHead: async () => req.expectedHeadSha,
    createDraft: async () => { writes++; return { id: 1, number: 1, url: 'https://github.com/test/repo/pull/1' }; } };
  const broker = new Broker(audit, { resolve: async () => { resolves++; return 'synthetic'; } }, p, () => now, 50);
  const channel = broker.register(registration);
  const lease = broker.issue(registration.taskId, req, cred, 'approval', 'request');
  return { broker, channel, lease, audit, p, setNow: (v: number) => { now = v; }, resolves: () => resolves, writes: () => writes };
}
