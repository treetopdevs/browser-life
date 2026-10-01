// The small CPU history the lineage tests share (tools/test/lineage.test.ts, and the lineage panel's
// tests in tools/test/report-html/lineage.test.ts): an M3 world with a raised mutation rate, run for 200
// steps on the CPU reference and written out as an in-memory run bundle. Not a test file itself.
import { G, cellCount, defaultConfig, initWorld, stateHash, type InitParams } from "@bl/schema";
import { RefSim, type MutationEvent } from "@bl/sim-ref";
import { genomesOf, wordsHex, type BundleSource } from "../lib/lineage.ts";

export async function* rows(ls: string[]): AsyncGenerator<string> {
  for (const l of ls) yield l;
}
export const MUT_HEADER = "childHi\tchildLo\tparentHi\tparentLo";

/** A small CPU history with a raised mutation rate, written out as an in-memory run bundle. */
export function cpuBundle() {
  const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 23, mutRate: 429_497 * 80 });
  const init: InitParams = { kind: "m3", founders: 13, nutrient: 256, biomass: 256 };
  const s0 = initWorld(cfg, init);
  const initHash = stateHash(s0);
  const initial = genomesOf(s0, cfg);
  const sim = new RefSim(s0);
  const n = cellCount(cfg);
  const events: MutationEvent[] = [];
  const lineages = ["step\tlineage\tcells"];
  const genomes = ["lineage\tfirstStep\twords"];
  const seen = new Set<string>();
  for (let t = 1; t <= 200; t++) {
    for (const e of sim.step().events) events.push(e);
    if (t % 50) continue;
    const count = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const hi = sim.state.genome[G.LIN_HI * n + i], lo = sim.state.genome[G.LIN_LO * n + i];
      if (hi || lo) count.set(`${hi}:${lo}`, (count.get(`${hi}:${lo}`) ?? 0) + 1);
    }
    for (const [k, c] of count) lineages.push(`${t}\t${k}\t${c}`);
    for (const [k, w] of genomesOf(sim.state, cfg)) {
      if (seen.has(k)) continue;
      seen.add(k);
      genomes.push(`${k}\t${t}\t${wordsHex(w)}`);
    }
  }
  const mutations = [MUT_HEADER, ...events.map((e) => `${e.childHi}\t${e.childLo}\t${e.parentHi}\t${e.parentLo}`)];
  const manifest = { runId: "cpu/test", ruleVersion: cfg.ruleVersion, cfg, spec: { condition: "treatment", censusEvery: 50, deepEvery: 1 }, init, initHash, startStep: 0, summary: { mutations: events.length, finalHash: "x" } };
  const files: Record<string, string[]> = { "lineages.tsv": lineages, "mutations.tsv": mutations, "genomes.tsv": genomes };
  const source = (over: Partial<Record<string, string[] | null>> = {}, m: any = manifest): BundleSource => ({
    dir: "cpu",
    manifest: m,
    open: (f) => {
      const ls = f in over ? over[f] : files[f];
      return ls ? rows(ls) : null;
    },
  });
  return { cfg, sim, n, events, initial, files, manifest, source };
}

let shared: ReturnType<typeof cpuBundle> | undefined;
/** One `cpuBundle()` per test process. */
export const cpu = (): ReturnType<typeof cpuBundle> => (shared ??= cpuBundle());
