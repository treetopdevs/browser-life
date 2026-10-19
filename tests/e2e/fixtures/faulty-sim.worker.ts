// The lab worker on a GPU simulation that fails on demand: a test posts { type: "test-sim-fault", method } and the next call of
// that GpuSim method throws a plain Error, not a refusal. "feed" fails as a feed the device lost would; "drainLedger" fails a
// census readback, which marks the world failed (execution.ts `fail`). The call that fails posts { type: "test-sim-fault-hit",
// method }, so a test knows the patch fired. The worker itself ignores both messages.
import { GpuSim } from "@bl/sim-gpu";
import "../../../apps/lab/src/sim.worker.ts";

type Method = "feed" | "drainLedger";
const armed = new Set<Method>();
const proto = GpuSim.prototype as unknown as Record<Method, (this: GpuSim, ...args: unknown[]) => Promise<unknown>>;
for (const method of ["feed", "drainLedger"] as const) {
  const real = proto[method];
  proto[method] = function (...args: unknown[]) {
    if (!armed.delete(method)) return real.apply(this, args);
    (self as unknown as { postMessage(message: unknown): void }).postMessage({ type: "test-sim-fault-hit", method });
    return Promise.reject(new Error(`test: ${method} failed on the device`));
  };
}

self.addEventListener("message", (ev: MessageEvent<{ type?: string; method?: Method }>) => {
  if (ev.data?.type === "test-sim-fault" && ev.data.method) armed.add(ev.data.method);
});
