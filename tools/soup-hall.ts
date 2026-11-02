// Hall-of-fame soups for the Red Queen test (docs/soup-redqueen-2026-11-01.md,
// Part C), on the GPU.
//
//   deno run -A tools/soup-hall.ts pilot [--out runs/soup/rq/pilot] [--sizes 256,1024]
//       plant P winner copies in a soup of the loser; prints the chosen P (or STOP)
//   deno run -A tools/soup-hall.ts run --runs wm6:HALL:1,wm6:CTRL:1,... --plant P [--parallel 3]
//       [--out runs/soup/rq/hall] runs, in this one process -> <out>/<lineage>-<arm>-<rep>/{log.jsonl,summary.json}
//
// A run checkpoints after every interval (state.json naming soup-<epoch>.bin) and resumes
// from there; all randomness is keyed on seed and epoch, so a resumed run
// equals a continuous one.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { DEFAULT_MUTATION, TAPE } from "./soup/bff.ts";
import { type AssayJob, assayIntruder, classify, COPIER, TypeRef, typeCensus, unhex } from "./soup/evo.ts";
import { type Arm, ARMS, History, type LeaderRow, plant, plantGroups } from "./soup/hall.ts";
import { soupDevice } from "./soup/device.ts";
import { GpuSoup } from "./soup/gpu.ts";

const a = parseArgs(Deno.args, { string: ["out", "runs", "parallel", "plant", "sizes"] });
const cmd = String(a._[0] ?? "");
const NUM = 131072, INTERVAL = 512, LENGTH = 16384;

/** Branch points: the snapshot each run-1 well-mixed lineage starts at (doc: Runs). */
export const BRANCH: Record<string, { file: string; epoch: number }> = {
  wm2: { file: "runs/soup/noheads/seed-2/soup-12609.bin", epoch: 12609 },
  wm6: { file: "runs/soup/noheads/seed-6/soup-4609.bin", epoch: 4609 },
  wm8: { file: "runs/soup/noheads/seed-8/soup-3265.bin", epoch: 3265 },
};
/** Soup seeds, distinct for every run (doc: Runs): wm2 HALL 2501-2503, CTRL 2511-2513, and so on. */
export const runSeed = (L: string, arm: Arm, rep: number) => ({ wm2: 2500, wm6: 6500, wm8: 8500 } as Record<string, number>)[L] + (arm === "HALL" ? 0 : 10) + rep;

/** The interval census: copy tests on types >= 0.5%, at most 16; the leader is the largest copier type. */
function census(programs: Uint8Array, epoch: number) {
  const c = typeCensus(programs, epoch, { top: 16, testShare: 0.005, maxTests: 16 });
  const lead = c.types.find((t) => t.selfRep !== null && t.selfRep >= COPIER) ?? null;
  return { c, lead: lead ? { id: lead.id, rep: lead.rep, mirror: lead.mirror } as LeaderRow : null };
}

const exists = async (p: string) => { try { await Deno.stat(p); return true; } catch { return false; } };
/** A run is done only when its summary parses, has the expected P and a final leader with forms. */
async function validSummary(path: string, P: number): Promise<boolean> {
  try { const s = JSON.parse(await Deno.readTextFile(path)); return s.P === P && typeof s.final?.id === "string" && Array.isArray(s.final?.forms) && s.final.forms.length > 0; } catch { return false; }
}

if (cmd === "pilot") {
  const out = String(a.out ?? "runs/soup/rq/pilot");
  await Deno.mkdir(out, { recursive: true });
  const plan = JSON.parse(await Deno.readTextFile("runs/soup/evo/plan.json"));
  const rowOf = (L: string, id: string) => plan.lineages.find((l: { key: string }) => l.key === L).competitors.find((c: { id: string }) => c.id === id).row;
  const formsOf = (r: LeaderRow) => r.mirror ? [r.rep, r.mirror] : [r.rep];
  // Doc: Plant size P: pilot (winner over loser, resolved in run 1).
  const pairs = [{ L: "wm2", win: "989bcdcb", lose: "e858e219" }, { L: "wm6", win: "a240625b", lose: "bd6f64ad" }];
  const device = await soupDevice();
  const sizes = String(a.sizes ?? "256,1024").split(",").map(Number);
  const rows = [];
  let chosen: number | null = null;
  for (const P of [...sizes, 2048]) {
    if (P === 2048 && (chosen !== null || sizes.includes(2048))) break;
    let pass = true;
    for (const p of pairs) for (const seed of [951, 952]) {
      const win = formsOf(rowOf(p.L, p.win)), lose = formsOf(rowOf(p.L, p.lose));
      const g = await GpuSoup.create(device, { num: NUM, seed, mutation: DEFAULT_MUTATION });
      const lb = lose.map(unhex);
      for (let i = 0; i < NUM; i++) g.cpu.programs.set(lb[i % lb.length], i * TAPE);
      plant(g.cpu.programs, [win], P, seed, 0);
      // Doc: Counting. The race classification, winner as the rare side.
      const job = { kind: "pair" } as AssayJob;
      const wr = new TypeRef(win.map(unhex)), lr = new TypeRef(lose.map(unhex));
      const k0 = classify(g.cpu.programs, job, wr, lr);
      if (k0.rare !== P) throw new Error(`pilot: ${k0.rare} winners at epoch 0, not ${P}`);
      g.upload();
      await g.advance(512);
      const k = classify(g.cpu.programs, job, wr, lr);
      const intruder = assayIntruder(g.cpu.programs, 512, { epoch: 512, ...k, f: NaN }, wr, lr);
      g.destroy();
      const ok = k.rare >= 2 * P && intruder === null;
      pass &&= ok;
      rows.push({ P, pair: `${p.L} ${p.win}>${p.lose}`, seed, winner: k.rare, loser: k.common, other: k.other, valid: intruder === null, ok });
      console.log(JSON.stringify(rows.at(-1)));
    }
    if (pass && chosen === null) chosen = P;
    if (chosen !== null) break;
  }
  await Deno.writeTextFile(`${out}/pilot.json`, JSON.stringify({ rows, P: chosen }, null, 1) + "\n");
  console.log(chosen === null ? "P = STOP" : `P = ${chosen}`);
} else if (cmd === "run") {
  // --runs wm2:HALL:1,wm2:CTRL:1,... run in this one process, --parallel at a time (one GPU process at a time is
  // the rule, tools/soup/device.ts; several soups inside one process are exact).
  const P = Number(a.plant), par = Number(a.parallel ?? 3);
  if (!Number.isInteger(P) || P < 1) throw new Error("--plant must be a positive integer");
  if (!Number.isInteger(par) || par < 1) throw new Error("--parallel must be a positive integer");
  const specs = String(a.runs ?? "").split(",").filter(Boolean).map((r) => {
    const [L, arm, rep] = r.split(":");
    if (!BRANCH[L]) throw new Error(`${r}: lineage must be wm2, wm6 or wm8`);
    if (!ARMS.includes(arm as Arm)) throw new Error(`${r}: arm must be HALL or CTRL`);
    if (!["1", "2", "3"].includes(rep)) throw new Error(`${r}: rep must be 1, 2 or 3`);
    return { L, arm: arm as Arm, rep: Number(rep) };
  });
  if (!specs.length) throw new Error("--runs is empty");
  const device = await soupDevice();
  const queue = specs.slice();
  const failures: string[] = [];
  await Promise.all(Array.from({ length: Math.min(par, specs.length) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try { await runOne(s.L, s.arm, s.rep, P, device); } catch (e) { failures.push(`${s.L}:${s.arm}:${s.rep}: ${e}`); console.error(failures.at(-1)); }
    }
  }));
  if (failures.length) { console.error(`${failures.length} run(s) failed`); Deno.exit(1); }
} else {
  throw new Error("usage: soup-hall.ts pilot|run (see the header comment)");
}

function logLine(c: ReturnType<typeof typeCensus>, lead: LeaderRow | null, h: History, planted: number) {
  return {
    epoch: c.epoch, leader: lead?.id ?? null, sustained: h.members[h.current]?.id ?? null, history: h.members.map((m) => m.id), planted,
    copierShare: c.copierShare, diversity: c.diversity, typesAbove: c.typesAbove, distinct: c.distinct,
    top: c.types.slice(0, 8).map((t) => [t.id, Number(t.share.toFixed(5)), t.selfRep]),
    // Shares of tested types (copy-tested = share >= 0.5%, at most 16) and of every history member found among them.
    shares: Object.fromEntries(c.types.filter((t) => t.selfRep !== null).map((t) => [t.id, t.share])),
  };
}

async function runOne(L: string, arm: Arm, rep: number, P: number, device: GPUDevice) {
  const seed = runSeed(L, arm, rep);
  const dir = `${String(a.out ?? "runs/soup/rq/hall")}/${L}-${arm}-${rep}`;
  await Deno.mkdir(dir, { recursive: true });
  if (await validSummary(`${dir}/summary.json`, P)) { console.log(`${dir} done`); return; }
  const b = BRANCH[L];
  const g = await GpuSoup.create(device, { num: NUM, seed, mutation: DEFAULT_MUTATION });
  try {
    let h = new History();
    let planted = 0, retries = 0;
    if (await exists(`${dir}/state.json`)) {
      const st = JSON.parse(await Deno.readTextFile(`${dir}/state.json`));
      if (st.P !== P) throw new Error(`state has P ${st.P}, not ${P}`);
      h = History.load(st.history);
      planted = st.planted; retries = st.retries ?? 0;
      g.cpu.programs.set(await Deno.readFile(`${dir}/${st.soup}`));
      g.cpu.epoch = st.epoch;
      // Drop log lines past the checkpoint.
      // A line cut short by an interruption is dropped too.
      const parse = (l: string) => { try { return JSON.parse(l); } catch { return null; } };
      const lines = (await Deno.readTextFile(`${dir}/log.jsonl`)).split("\n").filter((l) => { const x = l && parse(l); return x && x.epoch <= st.epoch; });
      await Deno.writeTextFile(`${dir}/log.jsonl`, lines.map((l) => l + "\n").join(""));
    } else {
      g.cpu.programs.set(await Deno.readFile(b.file));
      g.cpu.epoch = b.epoch;
      const { c, lead } = census(g.cpu.programs, b.epoch);
      h.observe(lead, b.epoch);
      await Deno.writeTextFile(`${dir}/log.jsonl`, JSON.stringify(logLine(c, lead, h, 0)) + "\n");
    }
    g.upload();
    const end = b.epoch + LENGTH;
    while (g.cpu.epoch < end) {
      const t0 = performance.now();
      const r = await g.advance(INTERVAL); // checked: batches with dropped work are redone
      retries += r.retries;
      const { c, lead } = census(g.cpu.programs, g.cpu.epoch);
      h.observe(lead, g.cpu.epoch);
      let n = 0;
      if (g.cpu.epoch < end) {
        n = plant(g.cpu.programs, plantGroups(arm, h), P, seed, g.cpu.epoch);
        planted += n;
        g.upload();
      }
      await Deno.writeTextFile(`${dir}/log.jsonl`, JSON.stringify(logLine(c, lead, h, n)) + "\n", { append: true });
      // Checkpoint: the soup goes to a file named by its epoch, and state.json (renamed into place last) names it,
      // so an interruption anywhere leaves a consistent pair.
      const soupFile = `soup-${g.cpu.epoch}.bin`;
      await Deno.writeFile(`${dir}/${soupFile}.tmp`, g.cpu.programs);
      await Deno.rename(`${dir}/${soupFile}.tmp`, `${dir}/${soupFile}`);
      const prevState = await exists(`${dir}/state.json`) ? JSON.parse(await Deno.readTextFile(`${dir}/state.json`)) : null;
      await Deno.writeTextFile(`${dir}/state.json.tmp`, JSON.stringify({ epoch: g.cpu.epoch, P, planted, retries, soup: soupFile, history: h.save() }));
      await Deno.rename(`${dir}/state.json.tmp`, `${dir}/state.json`);
      if (prevState?.soup && prevState.soup !== soupFile) await Deno.remove(`${dir}/${prevState.soup}`).catch(() => {});
      console.log(`${L} ${arm} ${rep} epoch ${g.cpu.epoch}: leader ${lead?.id ?? "-"} sustained ${h.members[h.current]?.id} history ${h.members.length} planted ${n}${r.retries ? ` redone ${r.retries}` : ""} (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
    }
    const fin = h.members[h.current];
    // The final leader's share in the final soup, counted over every type (doc: Endpoints; "rare" below 0.5%).
    const all = typeCensus(g.cpu.programs, g.cpu.epoch, { top: Number.MAX_SAFE_INTEGER, testShare: 2, maxTests: 0 });
    const lastShare = all.types.find((t) => t.id === fin.id)?.share ?? 0;
    await Deno.writeTextFile(`${dir}/summary.json.tmp`, JSON.stringify({
      lineage: L, arm, rep, seed, P, from: b.epoch, to: end, changes: h.changes, history: h.members, planted, gpuBatchesRedone: retries,
      final: { ...fin, index: h.current, returned: h.returned, share: lastShare, rare: lastShare < 0.005 },
    }, null, 1) + "\n");
    await Deno.rename(`${dir}/summary.json.tmp`, `${dir}/summary.json`);
    console.log(`${dir}: final ${fin.id}, ${h.changes} changes, history ${h.members.length}`);
  } finally {
    g.destroy();
  }
}
