// Calibration: a bounded, predeclared grid on seeds 1..3 (never reused as evidence seeds). Every attempted setting is logged;
// the first setting in cost order that meets the attainability criteria is selected. FLOOR_DIV and the thresholds are not tuned.
import { writeFileSync } from "node:fs";
import { schedule, summarize, type AssayConfig, type JobSpec, type RunRec } from "../../packages/metrics/src/opponents/evidence.ts";
import { checkpointSteps } from "../../packages/metrics/src/opponents/arena.ts";
import { buildPanel } from "../../packages/metrics/src/opponents/panel.ts";

export const GRID = { tiles: [32, 40], radii: [2, 3, 4], steps: [300, 400, 600], weaken: [25, 50, 75], maxAttempts: 36 } as const;
export const CAL_SEEDS = [1, 2, 3];
export const DEPLETION_CANDIDATES: Record<string, number | string>[] = [
  { lightBase: 0, lightAmp: 0 },
  { lightBase: 0, lightAmp: 0, kBDecay: 200 },
  { lightBase: 0, lightAmp: 0, kBDecay: 600, kELeak: 1000 },
];
export const DEPLETION_PAIR: [string, string] = ["G", "F1"];

type Runner = (cfg: AssayConfig, jobs: JobSpec[], hex: Record<string, string>, n: number) => Promise<RunRec[]>;

export async function calibrate(dir: string, nWorkers: number, runJobs: Runner): Promise<void> {
  const attempts: Record<string, unknown>[] = [];
  const cache = new Map<string, RunRec>();
  let selected: Record<string, unknown> | null = null;
  let n = 0;
  outer: for (const tile of GRID.tiles) for (const radius of GRID.radii) for (const steps of GRID.steps) for (const weaken of GRID.weaken) {
    if (n >= GRID.maxAttempts) break outer;
    n++;
    const cfg: AssayConfig = { arena: { tile, radius, steps }, depletion: null, weakenPercent: weaken, ids: ["G", "F1", "F2", "F3", "W"], seeds: CAL_SEEDS, rareSeeds: CAL_SEEDS, rarePositions: 0, twinG: true, effectTarget: 1 };
    const P = buildPanel(weaken);
    const all = schedule(cfg);
    const ck = (j: JobSpec) => `${tile}|${radius}|${steps}|${j.key}|${/\bW\b/.test(j.key) ? weaken : ""}`;
    const todo = all.filter((j) => !cache.has(ck(j)));
    const res = await runJobs(cfg, todo, { ...P.hex }, nWorkers);
    todo.forEach((j, i) => cache.set(ck(j), res[i]));
    const runs = all.map((j) => cache.get(ck(j))!);
    const s = summarize(cfg, runs, checkpointSteps(steps));
    const P3 = s.primary;
    const gw = s.balanced["G|W"][P3];
    const meanW = gw.mean === null ? null : 1 - gw.mean;
    const margin = meanW === null ? null : 0.5 - meanW;
    const meanAbs = s.twin!.meanAbs;
    const bothFloor: Record<string, number> = {};
    let floorOk = true;
    for (const [pr, arms] of Object.entries(s.floor)) { const c = arms.bal[P3]; bothFloor[pr] = c.bothFloor / c.total; if (pr !== "G|G'" && c.bothFloor / c.total > 0.2) floorOk = false; }
    const soloOk = s.weakened!.soloAboveFloor;
    const wLoses = meanW !== null && meanW <= 0.4;
    const twinOk = margin !== null && meanAbs !== null && meanAbs < margin / 2;
    const meets = wLoses && soloOk && twinOk && floorOk;
    const rec = { n, tile, radius, steps, weaken, meanPayoffW: meanW, margin, twinMeanAbs: meanAbs, twinPositionAdvantage: s.twin!.positionAdvantage, bothFloorShare: bothFloor, wSoloAboveFloor: soloOk, wLoses, twinOk, floorOk, meets, meanPayoffByPair: Object.fromEntries(Object.entries(s.balanced).map(([k, v]) => [k, v[P3].mean])) };
    attempts.push(rec);
    console.log(`attempt ${n}: tile ${tile} R ${radius} T ${steps} weaken ${weaken}% -> W ${meanW?.toFixed(3)} twinAbs ${meanAbs?.toFixed(3)} floor ${floorOk} solo ${soloOk} meets ${meets}`);
    writeFileSync(`${dir}/calibration.partial.json`, JSON.stringify({ attempts }, null, 1));
    if (meets && !selected) { selected = rec; break outer; }
  }
  const depAttempts: Record<string, unknown>[] = [];
  let depSel: Record<string, unknown> | null = null;
  if (selected) {
    const sel = selected as { tile: number; radius: number; steps: number; weaken: number; margin: number };
    const P = buildPanel(sel.weaken);
    for (const override of DEPLETION_CANDIDATES) {
      const cfg: AssayConfig = { arena: { tile: sel.tile, radius: sel.radius, steps: sel.steps }, depletion: { override, pair: DEPLETION_PAIR }, weakenPercent: sel.weaken, ids: ["G", "F1"], seeds: CAL_SEEDS, rareSeeds: CAL_SEEDS, rarePositions: 0, twinG: false, effectTarget: 1 };
      const jobs = schedule(cfg).filter((j) => j.depletion);
      const runs = await runJobs(cfg, jobs, { ...P.hex }, nWorkers);
      const fr = runs.map((r) => ({ key: r.key, fracA: r.cp[3][0] / r.b0[0], fracB: r.cp[3][1] / r.b0[1] }));
      const ok = fr.every((f) => f.fracA < 1 / 16 && f.fracB < 1 / 16);
      const rec = { override, pair: DEPLETION_PAIR, fractions: fr, bothBelowFloorEveryRun: ok };
      depAttempts.push(rec);
      console.log(`depletion ${JSON.stringify(override)} -> ${ok}`, fr.map((f) => `${f.fracA.toFixed(2)}/${f.fracB.toFixed(2)}`).join(" "));
      if (ok && !depSel) { depSel = rec; break; }
    }
  }
  const effectTarget = selected ? Math.floor(((selected as { margin: number }).margin / 2) * 1000) / 1000 : null;
  writeFileSync(`${dir}/calibration.json`, `${JSON.stringify({ kind: "historical-opponents-calibration", seeds: CAL_SEEDS, grid: GRID, thresholds: { wMeanMax: 0.4, bothFloorMax: 0.2, floorDiv: 16, effectTarget: "half the W-versus-G margin on the calibration seeds, floored to 3 decimals" }, attempts, selected, effectTarget, depletionCandidates: DEPLETION_CANDIDATES, depletionAttempts: depAttempts, depletionSelected: depSel, outcome: selected ? "selected" : "assay cannot be made informative on these arenas" }, null, 1)}\n`);
  console.log(selected ? "selected" : "NONE meets the criteria");
}
