import type { Readable, Writable } from 'node:stream';
import { object, check } from './contracts.ts';
import type { Channel } from './broker.ts';

// Worst case is < 101 KiB: 16,384 body code units escaped as six ASCII bytes each, plus bounded metadata.
const MAX_FRAME = 128 * 1024;
/** Trusted supervisor binds private inherited pipes to an already registered task. No listening/bearer socket. */
export function bindPipes(channel: Channel, input: Readable, output: Writable): () => void {
  let buffer = Buffer.alloc(0); let closed = false; let serial = Promise.resolve(); let pending = 0;
  const send = (frame: string) => {
    if (closed) return;
    try { if (!output.write(frame)) { close(); output.destroy(); } } catch { close(); }
  };
  const deny = () => send('{"ok":false,"code":"INVALID_REQUEST"}\n');
  const close = () => {
    if (closed) return; closed = true;
    input.removeListener('data', data); output.removeListener('error', close); output.removeListener('close', close); input.removeListener('close', close); input.removeListener('end', close); input.removeListener('error', close);
    try { channel.close(); } catch { /* supervisor owns cleanup; no diagnostic payload */ }
  };
  const data = (chunk: Buffer | string) => {
    if (closed) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buffer.length + bytes.length > MAX_FRAME) { deny(); close(); input.destroy(); return; }
    buffer = Buffer.concat([buffer, bytes]);
    let newline: number;
    while ((newline = buffer.indexOf(10)) >= 0) {
      if (pending >= 8) { deny(); close(); input.destroy(); return; }
      pending++;
      const line = buffer.subarray(0, newline).toString('utf8'); buffer = buffer.subarray(newline + 1);
      serial = serial.then(async () => {
        if (closed) return;
        try {
          const o = object(JSON.parse(line), ['leaseId', 'request']); check(typeof o.leaseId === 'string');
          const result = await channel.execute(o.leaseId, o.request);
          send(JSON.stringify(result) + '\n');
        } catch { deny(); }
      }).finally(() => { pending--; });
    }
  };
  input.on('data', data); input.on('end', close); input.on('error', close); input.on('close', close); output.on('error', close); output.on('close', close);
  return close;
}
