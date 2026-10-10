// The lab worker on real storage that refuses chosen files on demand: a test posts
// { type: "test-fault", pattern, times, ops } and the next `times` operations in `ops` on a file whose name matches
// `pattern` fail. "open" and "remove" (the default ops) fail as WebKit's do ("UnknownError"). "write" and "flush"
// fail after the truncate, as a store that runs out of room or loses its data does: a write lands its first half
// and then reports the quota exceeded, and a flush loses what was written and then fails. The worker itself ignores
// that message.
import "../../../apps/lab/src/sim.worker.ts";

type Op = "open" | "remove" | "write" | "flush";
let fault: { pattern: RegExp; times: number; ops: Op[] } | null = null;
const refuse = (op: Op, name: string) => {
  if (!fault || !fault.ops.includes(op) || !fault.pattern.test(name)) return false;
  if (--fault.times <= 0) fault = null;
  return true;
};
const unknown = () => new DOMException("The operation failed for an unknown transient reason (e.g. out of memory).", "UnknownError");
const quota = () => new DOMException("The operation failed because it would cause the application to exceed its storage quota.", "QuotaExceededError");

type SyncHandle = {
  write(this: SyncHandle, buf: ArrayBufferView, opts?: { at?: number }): number;
  truncate(this: SyncHandle, n: number): void;
  flush(this: SyncHandle): void;
};
/** The file each open sync handle is on: the handle itself does not say. */
const names = new WeakMap<SyncHandle, string>();

type SyncOpen = (this: FileSystemFileHandle) => Promise<SyncHandle>;
const proto = FileSystemFileHandle.prototype as unknown as { createSyncAccessHandle: SyncOpen };
const open = proto.createSyncAccessHandle;
proto.createSyncAccessHandle = async function () {
  if (refuse("open", this.name)) throw unknown();
  const handle = await open.call(this);
  names.set(handle, this.name);
  return handle;
};
const remove = FileSystemDirectoryHandle.prototype.removeEntry;
FileSystemDirectoryHandle.prototype.removeEntry = function (name: string, options?: FileSystemRemoveOptions) {
  return refuse("remove", name) ? Promise.reject(unknown()) : remove.call(this, name, options);
};
const sync = (globalThis as unknown as { FileSystemSyncAccessHandle: { prototype: SyncHandle } }).FileSystemSyncAccessHandle.prototype;
const write = sync.write;
sync.write = function (buf, opts) {
  if (!refuse("write", names.get(this) ?? "")) return write.call(this, buf, opts);
  write.call(this, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength >> 1), opts);
  throw quota();
};
const flush = sync.flush;
sync.flush = function () {
  if (!refuse("flush", names.get(this) ?? "")) return flush.call(this);
  this.truncate(0);
  throw unknown();
};

self.addEventListener("message", (ev: MessageEvent<{ type?: string; pattern?: string; times?: number; ops?: Op[] }>) => {
  if (ev.data?.type === "test-fault") fault = ev.data.pattern ? { pattern: new RegExp(ev.data.pattern), times: ev.data.times ?? 1, ops: ev.data.ops ?? ["open", "remove"] } : null;
});
