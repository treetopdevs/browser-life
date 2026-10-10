// The lab worker on real storage that refuses chosen files on demand: a test posts
// { type: "test-fault", pattern, times } and the next `times` opens or removals of a file whose name matches
// `pattern` fail as WebKit's do ("UnknownError"). The worker itself ignores that message.
import "../../../apps/lab/src/sim.worker.ts";

let fault: { pattern: RegExp; times: number } | null = null;
const refuse = (name: string) => {
  if (!fault || !fault.pattern.test(name)) return false;
  if (--fault.times <= 0) fault = null;
  return true;
};
const unknown = () => new DOMException("The operation failed for an unknown transient reason (e.g. out of memory).", "UnknownError");

type SyncOpen = (this: FileSystemFileHandle) => Promise<unknown>;
const proto = FileSystemFileHandle.prototype as unknown as { createSyncAccessHandle: SyncOpen };
const open = proto.createSyncAccessHandle;
proto.createSyncAccessHandle = function () {
  return refuse(this.name) ? Promise.reject(unknown()) : open.call(this);
};
const remove = FileSystemDirectoryHandle.prototype.removeEntry;
FileSystemDirectoryHandle.prototype.removeEntry = function (name: string, options?: FileSystemRemoveOptions) {
  return refuse(name) ? Promise.reject(unknown()) : remove.call(this, name, options);
};

self.addEventListener("message", (ev: MessageEvent<{ type?: string; pattern?: string; times?: number }>) => {
  if (ev.data?.type === "test-fault") fault = ev.data.pattern ? { pattern: new RegExp(ev.data.pattern), times: ev.data.times ?? 1 } : null;
});
