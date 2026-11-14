// EXPLORATORY screen of the optional trail-use rule (docs/mycelium-trail-use-2026-11-13/SCREEN.md). Not a pre-registered test.
//
//   deno run -A --no-lock tools/mycelium/trail-screen.ts --out <dir> --table      (markdown tables of the finished runs)
//   deno run -A --no-lock tools/mycelium/trail-screen.ts --out <dir> [--steps 100000] [--jobs 3] [--seeds 8001,8002,8003,8004] [--only <id-substring>]
//
// Runs every (variant, arm, seed) listed in VARIANTS on the GPU, checks both ledgers every 100 steps, takes R2b's scalar (every 100) and
// heavy (every 500) censuses with R2b's own observer, and writes <out>/runs/<id>.json (series + window values) and one line per start and
// finish to <out>/run-log.jsonl. A run already finished (its json exists) is skipped, so an interrupted screen resumes. World seeds are
// refused if they fall under R2/R2b's embargo. Arms: inherit uses the world seed, blocked uses seed + 100000 (no shared founders).
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { GpuMycelium, myceliumDevice } from "./gpu.ts";
import { R2bObserver, runValues } from "./observe-r2b.ts";
import { embargoReason } from "./r2b-seeds.ts";
import { createWorld, defaultConfig, energyTotal, matterTotal, type MyceliumConfig, validateState } from "./world.ts";

export interface Variant { id: string; moveCost: number; td?: number; mode?: "public" | "toll" }
/** The screen. moveCost 2 is the default world; moveCost 12 is a labelled departure (movement is expensive), each with its own keyless baseline. */
export const VARIANTS: Variant[] = [
  { id: "mc2-base", moveCost: 2 },
  { id: "mc2-pub128", moveCost: 2, td: 128, mode: "public" },
  { id: "mc2-toll256", moveCost: 2, td: 256, mode: "toll" },
  { id: "mc12-base", moveCost: 12 },
  { id: "mc12-pub16", moveCost: 12, td: 16, mode: "public" },
  { id: "mc12-pub64", moveCost: 12, td: 64, mode: "public" },
  { id: "mc12-pub256", moveCost: 12, td: 256, mode: "public" },
  { id: "mc12-toll16", moveCost: 12, td: 16, mode: "toll" },
  { id: "mc12-toll64", moveCost: 12, td: 64, mode: "toll" },
  { id: "mc12-toll256", moveCost: 12, td: 256, mode: "toll" },
];
export const ARMS = ["inherit", "blocked"] as const;
const ARM_OFFSET = { inherit: 0, blocked: 100_000 } as const;

export function screenConfig(v: Variant, arm: (typeof ARMS)[number], seed: number): MyceliumConfig {
  return defaultConfig({
    seed: seed + ARM_OFFSET[arm], heredity: arm, moveCost: v.moveCost,
    ...(v.td !== undefined ? { trailMoveDiscount: v.td, trailDiscountMode: v.mode } : {}),
  });
}

/** `--table`: print the markdown tables (every run listed) from <out>/runs. Needs no GPU. */
async function printTables(out: string): Promise<void> {
  const rows: any[] = [];
  for await (const e of Deno.readDir(`${out}/runs`)) if (e.name.endsWith(".json")) rows.push(JSON.parse(await Deno.readTextFile(`${out}/runs/${e.name}`)));
  const f = (v: number | null | undefined, d = 3) => (v === null || v === undefined ? "-" : v.toFixed(d));
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
  console.log("Per variant and arm: TM = trail per particle, mean over the window's 100-step censuses; per-seed values in seed order; medians over seeds.\n");
  console.log("| variant | arm | TM early (10k,20k] | TM late seeds (50k,100k] | TM late median | d late | n late | sum P late | median age late | min n | ledger |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const v of VARIANTS) for (const arm of ARMS) {
    const rs = rows.filter((r) => r.variant.id === v.id && r.arm === arm).sort((x, y) => x.seed - y.seed);
    if (!rs.length) continue;
    const col = (g: (r: any) => number | null) => rs.map(g).filter((x): x is number => x !== null);
    const bad = rs.reduce((t, r) => t + r.ledgerBadChecks, 0), checks = rs.reduce((t, r) => t + r.ledgerChecks, 0);
    console.log(`| ${v.id} | ${arm} | ${f(med(col((r) => r.early.TM)))} | ${rs.map((r) => f(r.late.TM, 2)).join(" / ")} | ${f(med(col((r) => r.late.TM)))} | ${f(med(col((r) => r.late.d)), 4)} | ${f(med(col((r) => r.late.meanN)), 0)} | ${f(med(col((r) => r.late.meanSumP)), 0)} | ${f(med(col((r) => r.late.AGE)), 0)} | ${Math.min(...rs.map((r) => r.minN))} | ${checks - bad}/${checks} exact |`);
  }
  console.log("\nEvery run (nothing dropped): id, world seed, late TM, late d, late n, late median age, early TM, ledger checks exact.\n");
  console.log("| run | world seed | TM late | d late | n late | age late | TM early | ledger |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const r of rows.sort((x, y) => (x.id < y.id ? -1 : 1))) console.log(`| ${r.id} | ${r.worldSeed} | ${f(r.late.TM)} | ${f(r.late.d, 4)} | ${f(r.late.meanN, 0)} | ${f(r.late.AGE, 0)} | ${f(r.early.TM)} | ${r.ledgerChecks - r.ledgerBadChecks}/${r.ledgerChecks} |`);
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, { string: ["out", "steps", "jobs", "seeds", "only"], boolean: ["table"] });
  if (a.table && a.out) { await printTables(a.out); Deno.exit(0); }
  if (!a.out) { console.error("--out <dir> is required"); Deno.exit(2); }
  const out = a.out, steps = Number(a.steps ?? 100_000), jobs = Number(a.jobs ?? 3);
  const seeds = (a.seeds ?? "8001,8002,8003,8004").split(",").map(Number);
  for (const s of seeds) {
    const why = [s, s + ARM_OFFSET.blocked].map((w) => embargoReason(w, { r2b: true, r2: true })).find((x) => x);
    if (why || s < 8001 || s > 8099) { console.error(`seed ${s} refused: ${why ?? "screen seeds are 8001-8099 only"}`); Deno.exit(2); }
  }
  await Deno.mkdir(`${out}/runs`, { recursive: true });
  const exists = async (p: string) => { try { await Deno.stat(p); return true; } catch { return false; } };
  const todo: { v: Variant; arm: (typeof ARMS)[number]; seed: number; id: string }[] = [];
  for (const seed of seeds) for (const v of VARIANTS) for (const arm of ARMS) {
    const id = `${v.id}.${arm}.${seed}`;
    if (a.only && !id.includes(a.only)) continue;
    if (!(await exists(`${out}/runs/${id}.json`))) { todo.push({ v, arm, seed, id }); continue; }
    // A finished run is skipped, but only if it ran for the same number of steps (the windows derive from it).
    const done = JSON.parse(await Deno.readTextFile(`${out}/runs/${id}.json`));
    if (done.steps !== steps) { console.error(`${id} exists with ${done.steps} steps, not ${steps}; use a fresh --out`); Deno.exit(2); }
  }
  const device = await myceliumDevice();
  const log = async (o: Record<string, unknown>) => await Deno.writeTextFile(`${out}/run-log.jsonl`, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n", { append: true });
  let next = 0, failures = 0;
  const worker = async () => {
    while (next < todo.length) {
      const { v, arm, seed, id } = todo[next++];
      const cfg = screenConfig(v, arm, seed);
      await log({ id, state: "started", steps, worldSeed: cfg.seed, config: { moveCost: v.moveCost, td: v.td ?? null, mode: v.mode ?? null } });
      const t0 = performance.now();
      const gpu = await GpuMycelium.create(device, createWorld(cfg));
      const obs = new R2bObserver(true);
      let checks = 0, residual = 0, minN = Infinity;
      for (let t = 100; t <= steps; t += 100) {
        gpu.step(100);
        const s = await gpu.read();
        checks++;
        const dm = matterTotal(s) - s.matter0, de = energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat);
        if (dm !== 0 || de !== 0 || validateState(s).length) residual++;
        minN = Math.min(minN, s.n);
        obs.scalar(s);
        if (t % 500 === 0) obs.heavy(s);
      }
      gpu.destroy();
      const ser = obs.series();
      const early = runValues(ser, 10_000, 20_000, null), mid = runValues(ser, 25_000, 50_000, null) /* a 100k-step screen: the (25k, 50k] window is stored, not tabled */, late = runValues(ser, steps / 2, steps, null);
      await Deno.writeTextFile(`${out}/runs/${id}.json.tmp`, JSON.stringify({ id, variant: v, arm, seed, worldSeed: cfg.seed, steps, ledgerChecks: checks, ledgerBadChecks: residual, minN, early, mid, late, series: ser }));
      await Deno.rename(`${out}/runs/${id}.json.tmp`, `${out}/runs/${id}.json`);
      if (residual) failures++;
      await log({ id, state: "finished", seconds: +((performance.now() - t0) / 1000).toFixed(1), ledgerChecks: checks, ledgerBadChecks: residual, minN, lateTM: late.TM, lateN: late.meanN });
      console.error(`${id} done in ${((performance.now() - t0) / 1000).toFixed(0)}s: ledger bad ${residual}/${checks}, n(late) ${late.meanN?.toFixed(0)}, TM(late) ${late.TM?.toFixed(3)}`);
    }
  };
  console.error(`${todo.length} runs, ${steps} steps, jobs ${jobs}`);
  await Promise.all(Array.from({ length: jobs }, worker));
  console.error(failures ? `${failures} runs had ledger residuals` : "all ledgers exact");
  Deno.exit(failures ? 1 : 0);
}
