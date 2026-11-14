// Adversarial audit scratch: independent re-implementation of the rung 1b check, diffed against tools/slab-readout.ts (CLI, end to end).
// deno run -A --no-lock experiments/3d-slab/audit_readout_diff.ts [N] [baseSeed]
// Written from docs/3d-brainstorm-2026-10-22.md section 5 + plan 5.2 only; shares no code with tools/lib/slab-readout.ts.
const N = Number(Deno.args[0] ?? 200), BASE = Number(Deno.args[1] ?? 1);
const ROOT = new URL("../..", import.meta.url).pathname;
const WORK = Deno.makeTempDirSync({ dir: Deno.env.get("AUDIT_TMP") ?? undefined, prefix: "audit-readout-" });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Share = { pt: bigint; tt: bigint; pb: bigint; tb: bigint }; // photo/total of top group, of bottom group
type Seed = { kind: "absent" | "unfinished" | "ok"; s?: Share; breakWindow?: "missingStep" | "missingLayer"; badCfg?: boolean; extra?: boolean; junk?: boolean; sat?: boolean };
type Case = { neutral: Seed[]; evolving: Seed[]; label: string }; // index 0..5 = seeds 1..6

// ---------- reference decision (own code): unreduced fractions, common denominator
function D(s: Share): [bigint, bigint] | null {
  if (s.tt === 0n || s.tb === 0n) return null;
  return [s.pt * s.tb - s.pb * s.tt, s.tt * s.tb];
}
let PATH = "";
let TIES = 0;
function reference(c: Case): string {
  PATH = "";
  const loaded = (arm: Seed[]) => arm.map((x, i) => ({ x, i })).filter((o) => o.x.kind === "ok");
  for (const arm of [c.neutral, c.evolving]) for (const o of loaded(arm)) if (o.x.breakWindow || o.x.badCfg) return "INPUT_ERROR";
  const have = (arm: Seed[], i: number) => arm[i].kind === "ok";
  for (const arm of [c.neutral, c.evolving]) for (let i = 0; i < 3; i++) if (!have(arm, i)) return "INPUT_ERROR";
  const bar = (idx: number[]) => {
    const ds = idx.map((i) => D(c.neutral[i].s!));
    if (ds.some((d) => d === null)) return null;
    const dd = ds as [bigint, bigint][];
    const Q = dd.reduce((a, d) => a * d[1], 1n);
    const N_ = dd.map((d) => d[0] * (Q / d[1]));
    const sum = N_.reduce((a, b) => a + b, 0n);
    const mx = N_.reduce((a, b) => (b > a ? b : a)), mn = N_.reduce((a, b) => (b < a ? b : a));
    const n = BigInt(idx.length);
    return { num: sum + n * (mx - mn), den: n * Q }; // m + r = (sum + n*(max-min)) / (n*Q)
  };
  const passes = (idx: number[], b: { num: bigint; den: bigint }) =>
    idx.filter((i) => {
      const d = D(c.evolving[i].s!);
      if (d !== null && d[0] * b.den === b.num * d[1]) TIES++;
      return d !== null && d[0] * b.den > b.num * d[1];
    }).length;
  const b1 = bar([0, 1, 2]);
  if (!b1) return "pause: control undefined";
  const p1 = passes([0, 1, 2], b1);
  PATH = `p1=${p1}`;
  if (p1 === 3) return "go";
  if (p1 === 0) return "pause";
  for (const arm of [c.neutral, c.evolving]) for (let i = 3; i < 6; i++) if (!have(arm, i)) return "WAIT";
  const all = [0, 1, 2, 3, 4, 5];
  const b2 = bar(all);
  if (!b2) return "pause: control undefined";
  const p2 = passes(all, b2);
  PATH += ` ext p2=${p2}`;
  return p2 >= 5 ? "go" : "pause";
}

// ---------- case generation
function genCase(seed: number): Case {
  const R = rng(seed);
  const ri = (n: number) => Math.floor(R() * n);
  const mode = Deno.env.get("AUDIT_MODES") ? Number(Deno.env.get("AUDIT_MODES")!.split(",")[ri(Deno.env.get("AUDIT_MODES")!.split(",").length)]) : ri(8);
  const scale = mode === 5 ? BigInt(1 + ri(140_000_000)) : BigInt(1 + ri(50));
  const grid = 600n;
  const mk = (kind: Seed["kind"]): Seed => ({ kind });
  const randShare = (): Share => {
    const f = () => (mode === 1 && R() < 0.35 ? [0n, 0n] : [BigInt(ri(601)), grid]);
    const [kt, tt] = f(), [kb, tb] = f();
    return { pt: kt * scale, tt: tt * scale, pb: kb * scale, tb: tb * scale };
  };
  const present = (extN: number): Seed[] => {
    const a: Seed[] = [];
    for (let i = 0; i < 6; i++) {
      if (i < 3) a.push(mk("ok"));
      else a.push(extN === 0 ? mk("absent") : extN === 1 ? (R() < 0.5 ? mk("ok") : mk(R() < 0.5 ? "absent" : "unfinished")) : mk("ok"));
    }
    return a;
  };
  const extN = Deno.env.get("AUDIT_EXT") ? 2 : mode === 0 ? 0 : ri(3) === 0 ? 0 : 2;
  const neutral = present(extN), evolving = present(extN);
  if (mode === 6) for (const arm of [neutral, evolving]) for (let i = 0; i < 3; i++) if (R() < 0.12) arm[i] = mk(R() < 0.5 ? "absent" : "unfinished");
  for (const arm of [neutral, evolving]) for (const x of arm) if (x.kind === "ok") {
    x.s = randShare();
    if (arm === evolving && mode !== 1 && R() < 0.6) { const tilt = BigInt(ri(300)); x.s.pt = (x.s.pt / scale) > 300n ? x.s.pt : (x.s.pt / scale + tilt) * scale; x.s.pb = (x.s.pb / scale) > tilt ? x.s.pb - tilt * scale : 0n; }
  }
  // tie construction: evolving D == m + r exactly for some seeds; neutral Ds as multiples keeping sum divisible by n
  if (mode === 2 || mode === 3 || mode === 4) {
    for (const idx of [[0, 1, 2], [0, 1, 2, 3, 4, 5]]) {
      if (!idx.every((i) => neutral[i].kind === "ok")) continue;
      const n = idx.length;
      // all-nonzero totals: share = k/600; neutral D = (kt - kb)/600
      const ks = idx.map(() => [ri(601), ri(601)]);
      let diffs = ks.map(([a, b]) => a - b);
      const rem = ((diffs.reduce((a, b) => a + b, 0) % n) + n) % n;
      if (rem) { // fix divisibility by nudging first seed's top photo count
        const adj = (n - rem) % n; if (ks[0][0] + adj <= 600) ks[0][0] += adj; else ks[0][0] -= rem;
        diffs = ks.map(([a, b]) => a - b);
      }
      idx.forEach((i, j) => (neutral[i].s = { pt: BigInt(ks[j][0]) * scale, tt: grid * scale, pb: BigInt(ks[j][1]) * scale, tb: grid * scale }));
      const sum = diffs.reduce((a, b) => a + b, 0);
      const thr600 = sum / n + (Math.max(...diffs) - Math.min(...diffs)); // threshold in units of 1/600 (integer if divisible)
      if (!Number.isInteger(thr600)) continue;
      for (const i of idx) {
        if (evolving[i].kind !== "ok") continue;
        const delta = mode === 2 ? 0 : mode === 3 ? 1 : -1; // exact tie, just above, just below
        const target = thr600 + (R() < 0.5 ? delta : 0);
        // choose kt-kb = target with both in 0..600
        const lo = Math.max(0, target), hi = Math.min(600, 600 + target);
        if (lo > hi) continue;
        const kb = Math.max(0, -target) + ri(Math.min(600, 600 - Math.max(0, target)) - Math.max(0, -target) + 1);
        const kt = kb + target;
        if (kt < 0 || kt > 600) continue;
        evolving[i].s = { pt: BigInt(kt) * scale, tt: grid * scale, pb: BigInt(kb) * scale, tb: grid * scale };
      }
    }
  }
  // decoration flags
  for (const arm of [neutral, evolving]) for (const x of arm) if (x.kind === "ok") {
    x.extra = R() < 0.3; x.junk = R() < 0.5; x.sat = mode === 5 || R() < 0.2;
    if (mode === 7 && R() < 0.06) x.breakWindow = R() < 0.5 ? "missingStep" : "missingLayer";
  }
  if (mode === 7 && R() < 0.2) { const arm = R() < 0.5 ? neutral : evolving; const x = arm[ri(6)]; if (x.kind === "ok") x.badCfg = true; }
  return { neutral, evolving, label: `seed=${seed} mode=${mode}` };
}

// ---------- bundle writer
function split(total: bigint, parts: number, R: () => number): bigint[] {
  if (parts === 1) return [total];
  const cuts: bigint[] = [];
  for (let i = 0; i < parts - 1; i++) cuts.push(BigInt(Math.floor(R() * Number(total + 1n))) % (total + 1n));
  cuts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: bigint[] = [];
  let prev = 0n;
  for (const c of cuts) { out.push(c - prev); prev = c; }
  out.push(total - prev);
  return out;
}
function writeBundle(root: string, cond: string, seed: number, x: Seed, R: () => number) {
  const dir = `${root}/chk/slab-spots/${cond}/seed-${seed}`;
  Deno.mkdirSync(dir, { recursive: true });
  const cfg = { seed, neutral: cond === "neutral", tileW: 256, tileH: 256, tileD: 8, defaultMu: x.badCfg ? 61 : 60, defaultSigma: 20, lightK: 1024 };
  const manifest: Record<string, unknown> = { spec: { censusEvery: 1000, deepEvery: 1, overrides: { defaultMu: 60 } }, ruleVersion: 7, cfg };
  if (x.kind === "ok") manifest.summary = { steps: 300000 };
  Deno.writeTextFileSync(`${dir}/manifest.json`, JSON.stringify(manifest));
  if (x.kind === "absent") { Deno.removeSync(`${dir}/manifest.json`); return; }
  if (x.kind === "unfinished") { Deno.writeTextFileSync(`${dir}/layers.tsv`, "step\tz\tphoto\tgrow\tdecomp\tresp\tsaturated\n"); return; }
  const s = x.s!;
  const W = 10;
  // per group: split photo and (total-photo) over layers x censuses
  const rows = new Map<string, bigint[]>();
  const fill = (zs: number[], photo: bigint, total: bigint) => {
    const cells = zs.length * W;
    const ph = split(photo, cells, R), rest = split(total - photo, cells, R);
    let k = 0;
    for (let c = 0; c < W; c++) for (const z of zs) {
      const [g, d, r] = split(rest[k], 3, R);
      rows.set(`${291000 + 1000 * c}:${z}`, [ph[k], g, d, r]);
      k++;
    }
  };
  fill([0, 1], s.pt, s.tt);
  fill([6, 7], s.pb, s.tb);
  const lines = ["step\tz\tphoto\tgrow\tdecomp\tresp\tsaturated"];
  const early = x.extra ? 1 : 0;
  // early censuses outside the window (steps 0..290000 step 1000, only a few) and junk middle layers
  for (let st = early ? 280000 : 289000; st < 291000; st += 1000) for (let z = 0; z < 8; z++) lines.push(`${st}\t${z}\t${ri(R, 9999)}\t${ri(R, 99)}\t0\t0\t0`);
  for (let c = 0; c < W; c++) {
    const st = 291000 + 1000 * c;
    for (let z = 0; z < 8; z++) {
      let v = rows.get(`${st}:${z}`);
      if (!v) v = x.junk ? [BigInt(ri(R, 100000)), BigInt(ri(R, 1000)), BigInt(ri(R, 1000)), 0n] : [0n, 0n, 0n, 0n];
      if (x.breakWindow === "missingStep" && st === 295000) continue;
      if (x.breakWindow === "missingLayer" && st === 297000 && z === 6) continue;
      const sat = x.sat ? ri(R, 70000) : 0;
      lines.push(`${st}\t${z}\t${v[0]}\t${v[1]}\t${v[2]}\t${v[3]}\t${sat}`);
    }
  }
  if (x.extra) for (let st = 301000; st <= 305000; st += 1000) for (let z = 0; z < 8; z++) lines.push(`${st}\t${z}\t99999999\t0\t0\t0\t7`);
  Deno.writeTextFileSync(`${dir}/layers.tsv`, lines.join("\n") + "\n");
}
const ri = (R: () => number, n: number) => Math.floor(R() * n);

// ---------- run
async function runCli(root: string): Promise<{ code: number; verdict: string | null }> {
  const p = await new Deno.Command("deno", { args: ["run", "-A", "--no-lock", "tools/slab-readout.ts", "--out", root, "--experiment", "chk"], cwd: ROOT, stdout: "piped", stderr: "piped" }).output();
  let verdict: string | null = null;
  try { verdict = JSON.parse(Deno.readTextFileSync(`${root}/readout.json`)).verdict; } catch { /* none */ }
  return { code: p.code, verdict };
}
const tally: Record<string, number> = {};
let mism = 0;
const queue = Array.from({ length: N }, (_, i) => BASE + i);
async function worker() {
  for (;;) {
    const sd = queue.shift();
    if (sd === undefined) return;
    const c = genCase(sd);
    const root = `${WORK}/c${sd}`;
    const R = rng(sd * 7919 + 1);
    c.neutral.forEach((x, i) => writeBundle(root, "neutral", i + 1, x, R));
    c.evolving.forEach((x, i) => writeBundle(root, "treatment", i + 1, x, R));
    const ref = reference(c);
    const path = PATH, ties = TIES;
    const got = await runCli(root);
    const mine = ref;
    const theirs = got.code === 2 ? "INPUT_ERROR" : got.code === 3 ? "WAIT" : got.verdict ?? `exit${got.code}`;
    const key = `${mine} [${path}]`; void ties;
    tally[key] = (tally[key] ?? 0) + 1;
    if (mine !== theirs) { mism++; console.log(`MISMATCH ${c.label} ref=${mine} cli=${theirs} dir=${root}`); } else Deno.removeSync(root, { recursive: true });
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`cases=${N} mismatches=${mism} exactTiesSeen=${TIES}`);
for (const k of Object.keys(tally).sort()) console.log(`  ${k}: ${tally[k]}`);
