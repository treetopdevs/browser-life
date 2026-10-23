// Byte identity of 2D run bundles. runExperiment on a RefSim-backed stand-in for GpuSim writes small 2D bundles through
// an in-memory sink; every written file is hashed (manifest.json without its wall-clock fields). The literals below were
// captured on the tree before the slab runner (rung 1b M5) existed and must never be edited: a failure means a 2D bundle
// changed. (A 2D run on the real GPU is diffed against a baseline checkout by hand; see docs/3d-rung1b-m5-plan.md section 0.)
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runExperiment, specConfig, type RunSpec, type Sink } from "@bl/runner";

vi.mock("@bl/sim-gpu", async () => {
  const { SunRefSim, applyLesion } = await import("@bl/sim-ref");
  const { applyFeed, cellCount, clampLesionRadius, cloneState, totalsOf, G } = await import("@bl/schema");
  type Light = { lightBase: number; lightAmp: number; seasonAmp: number } | null;
  type WS = import("@bl/schema").WorldState;
  class FakeGpuSim {
    private ref: InstanceType<typeof SunRefSim>;
    private pending: { childHi: number; childLo: number; parentHi: number; parentLo: number }[] = [];
    private constructor(state: WS) {
      this.ref = new SunRefSim(state);
    }
    static async create(device: GPUDevice, state: WS) {
      (device as unknown as { createBuffer(): void }).createBuffer();
      return new FakeGpuSim(cloneState(state));
    }
    get cfg() { return this.ref.cfg; }
    get step() { return this.ref.state.step; }
    async setLight(l: Light) { await this.ref.setLight(l); }
    run(count: number) { this.pending.push(...this.ref.run(count)); }
    lesion(x: number, y: number, r: number) {
      applyLesion(this.ref, x, y, r);
      return clampLesionRadius(this.ref.cfg, r);
    }
    async feed(x: number, y: number, r: number, amount: number) { return applyFeed(this.ref.state, x, y, r, amount); }
    async drainLedger() {
      const events = this.pending;
      this.pending = [];
      const s = this.ref.state;
      return { step: s.step, lightIn: s.lightIn, heatOut: s.heatOut, events, dropped: 0 };
    }
    async readSnapshot(withRoles = false) {
      const s = this.ref.state, n = cellCount(s.cfg);
      return { step: s.step, cells: s.cells.slice(), genomeHead: s.genome.slice(0, (G.PARAM1 + 1) * n), roles: withRoles ? this.ref.roles.slice() : undefined, flux: s.flux.slice() };
    }
    async readStats() {
      const s = this.ref.state, t = totalsOf(s.cfg, s.cells);
      return { step: s.step, A: t.A, B: t.B, C: t.C, P: t.P, E: t.E, S: t.S, living: 0, dense: 0, lightIn: s.lightIn, heatOut: s.heatOut, flux: s.flux.slice() };
    }
    async readState() { return cloneState(this.ref.state); }
    async readGenomeChannels(first: number, count: number) {
      const s = this.ref.state, n = cellCount(s.cfg);
      return s.genome.slice(first * n, (first + count) * n);
    }
    upload(state: WS) {
      const l = this.ref.activeLight;
      this.ref = new SunRefSim(cloneState(state));
      this.ref.setLightNow(l);
    }
    destroy() {}
  }
  return { GpuSim: FakeGpuSim };
});

const host = { host: "test", adapter: "test" };
const device = { createBuffer() {}, queue: { onSubmittedWorkDone: async () => {} } } as unknown as GPUDevice;
const SLOW = 600_000;

const WALL = ["startedAt", "finishedAt", "host"];
function memorySink() {
  const files = new Map<string, string | Uint8Array>();
  const sink: Sink = {
    async writeText(path, text) { files.set(path, text); },
    async appendText(path, text) { files.set(path, ((files.get(path) as string | undefined) ?? "") + text); },
    async writeBytes(path, b) { files.set(path, b); },
  };
  return { sink, files };
}

/** SHA-256 over the sorted `path\0bytes` of every written file; manifest.json without its wall-clock fields. */
function digest(files: Map<string, string | Uint8Array>): { digest: string; names: string[] } {
  const h = createHash("sha256");
  const names = [...files.keys()].sort();
  for (const p of names) {
    let v = files.get(p)!;
    if (p === "manifest.json") {
      const m = JSON.parse(v as string);
      for (const k of WALL) delete m[k];
      if (m.summary) {
        delete m.summary.wallSeconds;
        delete m.summary.stepsPerSecond;
      }
      v = JSON.stringify(m, null, 2);
    }
    h.update(p).update("\0").update(v).update("\0");
  }
  return { digest: h.digest("hex"), names };
}

const base: RunSpec = { experiment: "pin", presetId: "spots", condition: "treatment", seed: 7, steps: 60, censusEvery: 10, deepEvery: 2, checkpointEvery: 20, overrides: { tileW: 32, tileH: 32, kernelRadius: 4 } };
const SPECS: Record<string, RunSpec> = {
  spots: base,
  "spots-lineage-species": { ...base, lineageObs: true, speciesCensus: true },
  archipelago: { ...base, presetId: "archipelago", overrides: { tileW: 32, tileH: 32, kernelRadius: 4, migrationPeriod: 20, migrantCount: 2 } },
  "ponds-small": { ...base, presetId: "ponds-small", steps: 40, checkpointEvery: 20, overrides: { pondPeriod: 20, pondK: 2 } },
  interventions: { ...base, interventions: [{ step: 20, kind: "lesion", x: 10, y: 10, r: 3 }, { step: 30, kind: "feed", x: 20, y: 20, r: 3, amount: 2 }] },
};

// Captured on the unedited tree.
const PINNED: Record<string, string> = {
  "spots": "67e9984de1f17f1acb932fbdb204c6751b9d3565039375f8233dacd159f0187f",
  "spots-lineage-species": "7f50b604bff845cd7769b5d4afae76db566441ea4486a5608a44167731edea4c",
  "archipelago": "3721f7d02adfe7575f13541c3915fb0e2f14752bf2afe7bd8f0ed5874b48372e",
  "ponds-small": "a96eba895b670522998d69a059d64276de77991d45ede2aba6251202e5fcac21",
  "interventions": "c6d3af0b86543a2bcb72c82376dc01940d92c70a3443713120270a8b1f6a6c79",
};

describe("2D run bundles are byte-identical to the pinned digests", () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    it(name, async () => {
      specConfig(spec);
      const out = memorySink();
      await runExperiment(device, spec, out.sink, host, () => {});
      const d = digest(out.files);
      if (process.env.PIN_PRINT) console.log(`PIN ${name} ${d.digest} ${d.names.join(",")}`);
      else expect(d.digest).toBe(PINNED[name]);
    }, SLOW);
  }
});
