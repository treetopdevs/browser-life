import { it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { bindPipes } from '../../agent-capabilities/ipc.ts';
import { setup, req } from './fixtures.ts';

const tick = () => new Promise(r => setTimeout(r, 5));
it('authenticates inherited channels without agent-provided identity strings', async () => {
  const s = setup(); const input = new PassThrough(); const output = new PassThrough(); let responses = '';
  output.on('data', data => { responses += data; }); const close = bindPipes(s.channel, input, output);
  const frame = JSON.stringify({ leaseId: s.lease.leaseId, request: req });
  input.write(frame.slice(0, 10)); input.write(frame.slice(10) + '\n'); await tick();
  expect(JSON.parse(responses.trim()).ok).toBe(true); close();
});
it('rejects launcher methods, unknown fields and oversized frames without resolution', async () => {
  for (const message of [JSON.stringify({ method: 'resolve', handle: 'internal' }) + '\n',
    JSON.stringify({ leaseId: 'stolen', request: req, agentId: 'alpha' }) + '\n', 'x'.repeat(128 * 1024 + 1)]) {
    const s = setup(); const input = new PassThrough(); const output = new PassThrough(); let responses = '';
    output.on('data', data => { responses += data; }); const close = bindPipes(s.channel, input, output);
    input.write(message); await tick(); expect(JSON.parse(responses.trim()).ok).toBe(false);
    expect(s.resolves()).toBe(0); close();
  }
});
it('closing a task pipe revokes unused lease', async () => {
  const s = setup(); const input = new PassThrough(); const output = new PassThrough(); bindPipes(s.channel, input, output);
  input.end(); await tick(); expect((await s.channel.execute(s.lease.leaseId, req)).ok).toBe(false); expect(s.resolves()).toBe(0);
});
it('pipe destruction and output peer disconnect revoke unused leases', async () => {
  for (const peer of ['input','output']) {
    const s = setup(); const input = new PassThrough(); const output = new PassThrough(); bindPipes(s.channel, input, output);
    (peer === 'input' ? input : output).destroy(); await tick();
    expect(s.broker.snapshot(s.lease.leaseId).status).toBe('revoked');
    expect((await s.channel.execute(s.lease.leaseId, req)).ok).toBe(false); expect(s.resolves()).toBe(0);
  }
});
it('bounded pending-frame queue cancels abusive channels', async () => {
  const s = setup(); const input = new PassThrough(); const output = new PassThrough(); bindPipes(s.channel, input, output);
  const frame = JSON.stringify({ leaseId: s.lease.leaseId, request: req }) + '\n';
  input.write(frame.repeat(9)); await tick(); expect(s.resolves()).toBe(0);
  expect(s.broker.snapshot(s.lease.leaseId).status).toBe('revoked');
});
it('applies the frame limit to each newline-delimited frame', async () => {
  const s = setup(); const input = new PassThrough(); const output = new PassThrough(); let responses = '';
  output.on('data', data => { responses += data; }); bindPipes(s.channel, input, output);
  const frame = JSON.stringify({ leaseId: s.lease.leaseId, request: req });
  const padded = frame + ' '.repeat(128 * 1024 - frame.length - 1) + '\n';
  input.write(padded.slice(0, -1));
  input.write('\n' + padded);
  await tick(); await tick();
  expect(input.destroyed).toBe(false);
  expect(responses.trim().split('\n').map(line => JSON.parse(line).ok)).toEqual([true, false]);
});
it('closes a channel when its peer does not consume responses', async () => {
  const { Writable } = await import('node:stream');
  const input = new PassThrough(); const output = new Writable({ highWaterMark: 1, write(_chunk, _encoding, _callback) {} });
  let calls = 0; let closed = false;
  bindPipes({ execute: async () => { calls++; return { ok: false, code: 'LEASE_USED' }; }, close: () => { closed = true; } }, input, output);
  for (let i = 0; i < 20; i++) { input.write(JSON.stringify({ leaseId: 'unused', request: req }) + '\n'); await tick(); }
  expect(closed).toBe(true); expect(calls).toBe(1); expect(output.destroyed).toBe(true);
});
