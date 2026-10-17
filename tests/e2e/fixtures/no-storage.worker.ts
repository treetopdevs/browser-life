// The lab worker in a browser that keeps no files for the page, as WebKit's ephemeral sessions (Safari Private
// Browsing among them) do: navigator.storage.getDirectory() rejects with "UnknownError". Engines that do keep
// files get the same refusal here, so the lab's no-storage path runs everywhere.
import "../../../apps/lab/src/sim.worker.ts";

Object.defineProperty(StorageManager.prototype, "getDirectory", {
  configurable: true,
  value: () => Promise.reject(new DOMException("The operation failed for an unknown transient reason (e.g. out of memory).", "UnknownError")),
});
