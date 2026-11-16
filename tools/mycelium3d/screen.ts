// EXPLORATORY screens of the 3D mycelium world (docs/3d-expansion-plan-2026-11-15.md, Phase 1 B4) on the GPU twin (GpuMycelium3d).
// Not pre-registered tests: no gates, no labels; judged by eye from the pictures plus the descriptive numbers of observe-screen.ts.
// Grids (--grid, observe-screen.ts GRIDS):
//   first            sinking x trail rule x light depth (experiments/mycelium3d/trail-screen-2026-11-15.md), seeds 1, 2;
//   owner-pilots     owner gate / conduit sizing at sink 6, lightK 64, seeds 21, 22;
//   shade-pilots     the wasteShade probe at sink 6, lightK 64, seeds 21, 22;
//   owner-darkfloor  the second screen, six arms, seeds 11 to 14 (experiments/mycelium3d/owner-darkfloor-screen-2026-11-16.md);
//   bond-pilots      bond sizing (break, cost, children) at sink 6, lightK 64, seeds 21, 22;
//   bodies           the bonds screen, five arms, seeds 11 to 14 (experiments/mycelium3d/bonds-screen-2026-11-16.md);
//   leads            the two lone-seed leads on seeds 31 to 42 (experiments/mycelium3d/leads-screen-2026-11-16.md).
//
//   deno run -A --no-lock tools/mycelium3d/screen.ts [--grid first] [--out runs/mycelium3d-screen] [--steps 50000] [--every 2000] [--move-every 20]
//        [--jobs 1|2] [--seeds 1,2] [--only <id-substring>] [--log <out>/run-log.jsonl] [--reclaim]
//   deno run -A --no-lock tools/mycelium3d/screen.ts --out <dir> --render     (PNGs and the contact sheet from finished runs, no GPU;
//        with bonds also contact-sheet-bodies.png, particles | particles in bodies)
//   deno run -A --no-lock tools/mycelium3d/screen.ts --out <dir> --table      (markdown tables of finished runs, no GPU)
//   deno run -A --no-lock tools/mycelium3d/screen.ts --out <dir> --leads [--grid leads]   (per-seed tally against LEADS_BARS of
//        finished runs, no GPU; the grid defaults to leads here and names the arm ids to look for)
//
// Every run reads the full state back every --move-every steps: it checks the step count and both ledger residuals (any residual
// aborts the run, logs it as failed and the process exits 1) and adds to the upward transport. Every --every steps it also runs
// validateState and takes the readout by depth. At the end it stores the projections. Output: <out>/runs/<id>.json (a finished run
// is skipped only if its fingerprint, the config, every cadence and the readout version, matches; otherwise exit 2), and one line
// per start, finish or failure in the --log file. A claim file stops two processes taking the same run.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { GpuMycelium3d, mycelium3dDevice } from "./gpu.ts";
import {
  addTransport, BODY_SIZES, bondSurvival, contactSheet, emptySurvival, emptyTransport, fieldFlux, fingerprint, GRIDS, GROUPS, LEADS_BARS, type LeadsRun, leadsTally, type Projections, projections, readout,
  type Readout, screenConfig, type Setting, sharedMax, type Survival, tilePng, type Transport,
} from "./observe-screen.ts";
import { createWorld, energyTotal, liveGenotypes, matterTotal, type Mycelium3dState, validateState } from "./world.ts";

const NUMS = ["steps", "every", "move-every", "jobs"];
const fail = (msg: string): never => { console.error(msg); Deno.exit(2); };
const a = parseArgs(Deno.args, {
  string: ["out", "seeds", "only", "log", "grid", ...NUMS], boolean: ["render", "table", "reclaim", "leads"],
  unknown: (f) => fail(f.startsWith("-") ? `unknown flag ${f}` : `unexpected argument ${f}`),
});
if (a._.length) fail(`unexpected argument ${a._[0]}`);
const num = (k: string, dflt: number): number => {
  const v = a[k as keyof typeof a];
  if (v === undefined) return dflt;
  if (typeof v !== "string" || !/^[0-9]+$/.test(v) || !Number.isSafeInteger(Number(v))) return fail(`--${k} must be a non-negative integer, got ${JSON.stringify(v)}`);
  return Number(v);
};
const gridName = a.grid ?? (a.leads ? "leads" : "first");
const grid = (typeof gridName === "string" && Object.hasOwn(GRIDS, gridName) ? GRIDS[gridName] : undefined) ?? fail(`--grid must be one of ${Object.keys(GRIDS).join(", ")}`);
const SETTINGS = grid.settings;
/** A string flag given without its operand parses as "": refuse it rather than use the empty string. */
const str = (k: "out" | "log" | "only"): string | undefined => (a[k] === "" ? fail(`--${k} needs a value`) : a[k]);
const only = str("only");
const out = str("out") ?? "runs/mycelium3d-screen";
const steps = num("steps", 50_000), every = num("every", 2000), moveEvery = num("move-every", 20), jobs = num("jobs", 1);
if (moveEvery < 1) fail("--move-every must be at least 1");
if (every < moveEvery || every % moveEvery !== 0) fail("--every must be a positive multiple of --move-every");
if (steps < every || steps % every !== 0) fail("--steps must be a positive multiple of --every");
if (jobs < 1 || jobs > 2) fail("--jobs must be 1 or 2 (the GPU is shared)");
const seeds = (a.seeds ?? grid.seeds.join(",")).split(",").map((v) => (/^[0-9]+$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : fail(`--seeds: bad seed ${JSON.stringify(v)}`)));
const logPath = str("log") ?? `${out}/run-log.jsonl`;

type Row = Record<string, any>;
async function loadRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for await (const e of Deno.readDir(`${out}/runs`)) if (e.name.endsWith(".json")) rows.push(JSON.parse(await Deno.readTextFile(`${out}/runs/${e.name}`)));
  return rows;
}

// ---- one run -----------------------------------------------------------------------------------------------------

const residuals = (s: Mycelium3dState) => ({ matter: matterTotal(s) - s.matter0, energy: energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat) });

interface Window { step: number; transport: Transport; births: number; deaths: number; particleSteps: number; nMax: number; refused: number; survival: Survival }

async function runOne(device: GPUDevice, st: Setting, seed: number): Promise<Row> {
  const cfg = screenConfig(st, seed);
  const s0 = createWorld(cfg);
  const gpu = await GpuMycelium3d.create(device, s0);
  const rows: Readout[] = [], windows: (Window & { genotypes: number })[] = [];
  let prev: Mycelium3dState = s0, checks = 0, nMax = s0.n, nMin = s0.n, last: Mycelium3dState = s0;
  const bonds = cfg.bondBreak !== undefined;
  let win: Window = { step: 0, transport: emptyTransport(), births: 0, deaths: 0, particleSteps: 0, nMax: 0, refused: 0, survival: emptySurvival() };
  try {
    for (let t = moveEvery; t <= steps; t += moveEvery) {
      gpu.step(moveEvery);
      const s = await gpu.read();
      if (s.step !== t) throw new Error(`read step ${s.step}, expected ${t}`);
      const r = residuals(s);
      checks++;
      if (r.matter !== 0 || r.energy !== 0) throw Object.assign(new Error(`ledger residual at step ${t}: matter ${r.matter}, energy ${r.energy}`), { residual: true, step: t });
      addTransport(win.transport, prev, s);
      if (bonds) bondSurvival(win.survival, prev, s);
      win.births += s.totals.births - prev.totals.births; win.deaths += s.totals.deaths - prev.totals.deaths;
      win.refused += s.totals.refused - prev.totals.refused;
      // Particle-steps over the interval, approximated by the trapezoid of the counts at its two ends.
      win.particleSteps += moveEvery * (prev.n + s.n) / 2;
      win.nMax = Math.max(win.nMax, s.n);
      nMax = Math.max(nMax, s.n); nMin = Math.min(nMin, s.n);
      if (t % every === 0) {
        const bad = validateState(s);
        if (bad.length) throw Object.assign(new Error(`validateState at step ${t}: ${bad.slice(0, 3).join("; ")}`), { residual: true, step: t });
        rows.push(readout(s));
        windows.push({ ...win, step: t, genotypes: liveGenotypes(s) });
        win = { step: t, transport: emptyTransport(), births: 0, deaths: 0, particleSteps: 0, nMax: 0, refused: 0, survival: emptySurvival() };
      }
      prev = s; last = s;
    }
  } finally {
    gpu.destroy();
  }
  const proj: Projections = projections(last);
  return { config: cfg, steps, every, moveEvery, ledgerChecks: checks, ledgerResidual: 0, nMax, nMin, refused: last.totals.refused, readouts: rows, windows, projections: proj };
}

// ---- tables ------------------------------------------------------------------------------------------------------

const mean = (v: number[]) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN);
const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "-");

/** The late window: readouts and windows in (steps / 2, steps]. */
const span = (c: Readout["comp"]) => (c.size ? c.zMax - c.zMin + 1 : 0);
function lateSummary(r: Row) {
  const half = r.steps / 2;
  const ro: Readout[] = r.readouts.filter((x: Readout) => x.step > half);
  const wi: Row[] = r.windows.filter((x: Row) => x.step > half);
  const fin: Readout = r.readouts[r.readouts.length - 1];
  const D = r.config.depth;
  const gSum = (k: string, gs: number[]) => mean(ro.map((x) => gs.reduce((t, g) => t + (x.groups[g] as any)[k], 0)));
  const all = Array.from({ length: GROUPS }, (_, g) => g);
  return {
    n: mean(ro.map((x) => x.n)),
    nTop: gSum("particles", [0]), nFloor: gSum("particles", [GROUPS - 1]),
    trail: mean(ro.map((x) => x.trailMass)),
    trailTop2: gSum("P", [0, 1]), trailFloor: gSum("P", [GROUPS - 1]),
    occTrail: mean(ro.map((x) => x.occTrailFrac)),
    comp: mean(ro.map((x) => x.comp.size)), compAbove: mean(ro.map((x) => x.compAboveFloor.size)),
    span: mean(ro.map((x) => span(x.comp))), spanMax: Math.max(...ro.map((x) => span(x.comp))),
    spanAbove: mean(ro.map((x) => span(x.compAboveFloor))),
    compFinal: fin.comp, compAboveFinal: fin.compAboveFloor,
    // Per 1,000 steps, in matter-layers.
    netUp: mean(wi.map((w) => (1000 * w.transport.net) / r.every)), grossUp: mean(wi.map((w) => (1000 * w.transport.up) / r.every)),
    matchedShare: mean(wi.map((w) => (w.transport.total ? w.transport.matched / w.transport.total : NaN))),
    births: mean(wi.map((w) => (1000 * w.births) / w.particleSteps)), deaths: mean(wi.map((w) => (1000 * w.deaths) / w.particleSteps)),
    genotypes: r.windows[r.windows.length - 1].genotypes,
    floorC: gSum("C", [GROUPS - 1]) / gSum("C", all), topA: gSum("A", [0]),
    lightFloor: mean(ro.map((x) => x.groups[GROUPS - 1].light)), lightTop: mean(ro.map((x) => x.groups[0].light)),
    sinkDown: mean(ro.map((x) => 1000 * fieldFlux(x.layers, r.config).sinkDown)), diffUpC: mean(ro.map((x) => 1000 * fieldFlux(x.layers, r.config).diffUpC)),
    diffUpA: mean(ro.map((x) => 1000 * fieldFlux(x.layers, r.config).diffUpA)),
    fieldDown: mean(ro.map((x) => { const f = fieldFlux(x.layers, r.config); return 1000 * (f.sinkDown - f.diffUpC - f.diffUpA); })),
    sameShare: ro[0]?.owner ? mean(ro.map((x) => x.owner!.sameShare)) : NaN, minQ: ro[0]?.owner ? mean(ro.map((x) => x.owner!.medianMinQ)) : NaN,
    ownedCells: ro[0]?.owner ? mean(ro.map((x) => x.owner!.ownedCells)) : NaN, medianQ: ro[0]?.owner ? mean(ro.map((x) => x.owner!.medianQ)) : NaN,
    // The owner conduit's extra A rate on the median same-owner edge, min(De + ((min(Q, Q, q) * g) >> 4), 128) - De, at the late mean median.
    extraRate: ro[0]?.owner && r.config.ownerConduit !== undefined
      ? Math.min(r.config.diffA + ((Math.min(Math.round(mean(ro.map((x) => x.owner!.medianMinQ))), r.config.ownerConduitCap ?? 255) * r.config.ownerConduit) >> 4), 128) - r.config.diffA
      : NaN,
    lightFloorLayer: mean(ro.map((x) => x.floorLight)),
    owners: ro[0]?.owner ? mean(ro.map((x) => x.owner!.owners)) : NaN, topOwner: ro[0]?.owner ? mean(ro.map((x) => x.owner!.topOwnerShare)) : NaN,
    sameShareFinal: fin.owner ? fin.owner.sameShare : NaN,
    ...bondSummary(r, ro, wi, fin),
    D,
  };
}

/** Late-window bond readouts (NaN without bonds). Survival is per --move-every steps, over bonds whose two particles both lived. */
function bondSummary(r: Row, ro: Readout[], wi: Row[], fin: Readout) {
  // A readout with no bodies has no mean size or bonded age (NaN, stored as null): those readouts are left out, not counted as 0.
  const b = (f: (x: NonNullable<Readout["bonds"]>) => number) => (ro[0]?.bonds ? mean(ro.map((x) => f(x.bonds!)).filter((v) => typeof v === "number" && Number.isFinite(v))) : NaN);
  const sv = wi.reduce((a, w) => ({ both: a.both + (w.survival?.bothAlive ?? 0), kept: a.kept + (w.survival?.kept ?? 0), all: a.all + (w.survival?.bonds ?? 0) }), { both: 0, kept: 0, all: 0 });
  const keep = sv.both ? sv.kept / sv.both : NaN;
  return {
    bonds: b((x) => x.bonds), bondedShare: ro[0]?.bonds ? mean(ro.map((x) => (x.n ? x.bonds!.bonded / x.n : 0))) : NaN,
    bodies: b((x) => x.bodies), largestBody: b((x) => x.largest), largestBodyMax: ro[0]?.bonds ? Math.max(...ro.map((x) => x.bonds!.largest)) : NaN,
    meanBody: b((x) => x.meanSize), rings: b((x) => x.rings),
    hist: BODY_SIZES.map((_, k) => b((x) => x.sizeHist[k])),
    bigBodies: b((x) => x.sizeHist[2] + x.sizeHist[3] + x.sizeHist[4]),
    keep, keepAll: sv.all ? sv.kept / sv.all : NaN,
    // Mean bond lifetime implied by the per-interval survival among bonds whose ends both lived: interval / (1 - keep). It cannot
    // fall below the interval itself, so a value near --move-every means "most bonds last less than one interval", not a measured life.
    bondLife: Number.isFinite(keep) && keep < 1 ? r.moveEvery / (1 - keep) : NaN,
    ageBonded: b((x) => x.ageBonded), ageFree: b((x) => x.ageFree), want: b((x) => x.want), wantFinal: fin.bonds ? fin.bonds.want : NaN,
    bodiesTop: b((x) => x.bodiesByGroup[0]), bodiesFloor: b((x) => x.bodiesByGroup[GROUPS - 1]),
  };
}

function printTables(rows: Row[]): void {
  console.log(`Late window = readouts in (steps/2, steps]; each cell is "mean (seed ${seeds.join(" / seed ")})". Transport and turnover per 1,000 steps. Groups are ${GROUPS} slabs of depth/${GROUPS} layers, G1 the surface, G8 the floor.\n`);
  const cols: [string, (x: ReturnType<typeof lateSummary>) => number, number][] = [
    ["particles", (x) => x.n, 0], ["in G1", (x) => x.nTop, 0], ["in G8", (x) => x.nFloor, 0], ["trail P", (x) => x.trail, 0], ["P in G1-2", (x) => x.trailTop2, 0],
    ["P in G8", (x) => x.trailFloor, 0], ["occ. cells with trail", (x) => x.occTrail, 3], ["largest comp", (x) => x.comp, 0], ["z-span", (x) => x.span, 1], ["z-span max", (x) => x.spanMax, 0],
    ["largest comp above floor", (x) => x.compAbove, 0], ["its z-span", (x) => x.spanAbove, 1], ["net up (particles)", (x) => x.netUp, 0], ["gross up (particles)", (x) => x.grossUp, 0],
    ["matched share", (x) => x.matchedShare, 3], ["sinking down (C+P, expected)", (x) => x.sinkDown, 0], ["diffusion up, C (expected)", (x) => x.diffUpC, 0],
    ["diffusion up, A (expected)", (x) => x.diffUpA, 0], ["net field down (expected)", (x) => x.fieldDown, 0], ["births /1k particle-steps", (x) => x.births, 2], ["deaths", (x) => x.deaths, 2], ["genotypes (final)", (x) => x.genotypes, 0],
    ["C share in G8", (x) => x.floorC, 3], ["A in G1", (x) => x.topA, 0], ["light G1/256", (x) => x.lightTop, 0], ["light G8/256", (x) => x.lightFloor, 0],
    ["light floor layer /256", (x) => x.lightFloorLayer, 1],
    ["same-owner edge share", (x) => x.sameShare, 3], ["same-owner share (final)", (x) => x.sameShareFinal, 3], ["median min(Q,Q)", (x) => x.minQ, 1],
    ["owned cells", (x) => x.ownedCells, 0], ["distinct owners", (x) => x.owners, 0], ["largest owner's share of owned cells", (x) => x.topOwner, 3], ["median Q (owned cells)", (x) => x.medianQ, 1], ["conduit extra rate at median edge", (x) => x.extraRate, 0],
    ["bonds", (x) => x.bonds, 0], ["share of particles bonded", (x) => x.bondedShare, 3], ["bodies (2+)", (x) => x.bodies, 0], ["largest body", (x) => x.largestBody, 1],
    ["largest body (max over late reads)", (x) => x.largestBodyMax, 0], ["mean body size", (x) => x.meanBody, 2], ["rings", (x) => x.rings, 1],
    ...BODY_SIZES.map((name, k) => [`bodies of ${name}`, (x: ReturnType<typeof lateSummary>) => x.hist[k], 1] as [string, (x: ReturnType<typeof lateSummary>) => number, number]),
    ["bond kept over one read interval (both ends alive)", (x) => x.keep, 3], ["bond kept (all bonds)", (x) => x.keepAll, 3], ["implied bond life (steps)", (x) => x.bondLife, 0],
    ["mean age, bonded", (x) => x.ageBonded, 0], ["mean age, free", (x) => x.ageFree, 0], ["share wanting a bond (BOND > 0)", (x) => x.want, 3], ["share wanting (final)", (x) => x.wantFinal, 3],
    ["bodies in G1", (x) => x.bodiesTop, 1], ["bodies in G8", (x) => x.bodiesFloor, 1],
  ];
  const by = (st: Setting) => seeds.map((sd) => rows.find((r) => r.id === `${st.id}.s${sd}`)).filter((r): r is Row => !!r);
  const present = SETTINGS.filter((st) => by(st).length);
  console.log(`| readout | ${present.map((st) => st.id).join(" | ")} |`);
  console.log(`|---|${present.map(() => "---").join("|")}|`);
  for (const [name, f, d] of cols) {
    const cells = present.map((st) => {
      const vs = by(st).map((r) => f(lateSummary(r)));
      return `${fmt(mean(vs), d)} (${vs.map((v) => fmt(v, d)).join(" / ")})`;
    });
    console.log(`| ${name} | ${cells.join(" | ")} |`);
  }
  console.log("\n### By depth (late window, seed mean)\n");
  for (const st of present) {
    const rs = by(st);
    const g = (k: string, i: number) => mean(rs.map((r) => mean(r.readouts.filter((x: Readout) => x.step > r.steps / 2).map((x: Readout) => (x.groups[i] as any)[k]))));
    const bonded = rs.every((r) => r.readouts[0]?.bonds);
    const gb = (f: (b: NonNullable<Readout["bonds"]>) => number) => mean(rs.map((r) => mean(r.readouts.filter((x: Readout) => x.step > r.steps / 2).map((x: Readout) => f(x.bonds!)))));
    const bh = bonded ? " in bodies | bodies | mean body size |" : "";
    console.log(`#### ${st.id}\n\n| group | particles | M | A | C | P | light /256 |${bh}\n|---|---|---|---|---|---|---|${bonded ? "---|---|---|" : ""}`);
    for (let i = 0; i < GROUPS; i++) {
      const bc = bonded ? ` ${fmt(gb((b) => b.inBodiesByGroup[i]))} | ${fmt(gb((b) => b.bodiesByGroup[i]), 1)} | ${fmt(mean(rs.map((r) => {
        const v = r.readouts.filter((x: Readout) => x.step > r.steps / 2).map((x: Readout) => x.bonds!.meanSizeByGroup[i]).filter((v: number) => Number.isFinite(v));
        return v.length ? mean(v) : NaN;
      }).filter((v) => Number.isFinite(v))), 2)} |` : "";
      console.log(`| G${i + 1} | ${["particles", "M", "A", "C", "P", "light"].map((k) => fmt(g(k, i))).join(" | ")} |${bc}`);
    }
    console.log("");
  }
  console.log("\n| run | seconds | ledger reads (residual 0) | n min / max | refused | final step |");
  console.log("|---|---|---|---|---|---|");
  for (const r of [...rows].sort((x, y) => (x.id < y.id ? -1 : 1))) console.log(`| ${r.id} | ${fmt(r.seconds, 1)} | ${r.ledgerChecks} | ${r.nMin} / ${r.nMax} | ${r.refused} | ${r.readouts.at(-1).step} |`);
}

// ---- leads tally -------------------------------------------------------------------------------------------------

/** One row per seed per arm against LEADS_BARS, then a line per arm; a run whose late window is not complete aborts the tally. */
function printLeads(rows: Row[]): void {
  const late = `(${fmt(LEADS_BARS.lateFrom)}, steps]`;
  console.log(`Leads tally, ${grid.title}: late window = readouts with step in ${late}. Keeps bodies = share of particles bonded >= ${LEADS_BARS.bondedShare} at every late readout; spans = a G1-to-G8 trail component in at least ${LEADS_BARS.spanShare} of the late readouts. Net lift is matter-layers per 1,000 steps by particles.\n`);
  for (const st of SETTINGS) {
    const rs = seeds.map((sd) => rows.find((r) => r.id === `${st.id}.s${sd}`)).filter((r): r is Row => !!r);
    if (!rs.length) continue;
    const ts = rs.map((r) => {
      try { return { seed: r.config.seed as number, t: leadsTally(r as LeadsRun) }; } catch (e) { return fail(`${r.id}: ${(e as Error).message}`); }
    });
    const bonded = ts.some((x) => x.t.keepsBodies !== null);
    console.log(`#### ${st.id}\n`);
    console.log("| seed | particles | bonded share min / mean / max | keeps bodies | largest body (max) | bodies 2+ | closed rings | late reads with G1-G8 trail | spans | trail P | net lift /1k steps |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const { seed, t } of ts) {
      const yn = (v: boolean | null) => (v === null ? "-" : v ? "yes" : "no");
      const share = t.keepsBodies === null ? "-" : `${fmt(t.bondedMin, 4)} / ${fmt(t.bondedMean, 4)} / ${fmt(t.bondedMax, 4)}`;
      console.log(`| ${seed} | ${fmt(t.particlesMean)} | ${share} | ${yn(t.keepsBodies)} | ${fmt(t.largestBodyMax)} | ${fmt(t.bodiesMean, 1)} | ${fmt(t.ringsMean, 1)} | ${t.spanReads} of ${t.late} | ${yn(t.spans)} | ${fmt(t.trailMean)} | ${fmt(t.netUpMean)} |`);
    }
    const list = (f: (t: ReturnType<typeof leadsTally>) => boolean) => {
      const k = ts.filter((x) => f(x.t)).map((x) => x.seed);
      return `${k.length} of ${ts.length} seeds (${k.length ? k.join(", ") : "none"})`;
    };
    console.log("");
    if (bonded) console.log(`- keeps bodies: ${list((t) => t.keepsBodies === true)}`);
    console.log(`- spans: ${list((t) => t.spans)}\n`);
  }
}

// ---- pictures ----------------------------------------------------------------------------------------------------

const label = (r: Row) => {
  const st = SETTINGS.find((x) => r.id === `${x.id}.s${r.config.seed}`)!;
  const own = st.owner ? ` ${st.owner.trailOwner.toUpperCase()} T${st.owner.ownerDefend ?? "-"} G${st.owner.ownerConduit ?? "-"}` : "";
  const bond = st.bonds ? ` B${st.bonds.bondBreak} C${st.bonds.bondCost ?? 0}${st.bonds.bondChild ? " CHILD" : ""}` : "";
  return `SINK ${st.sink ?? "OFF"} ${st.trail.toUpperCase()}${own}${bond}${st.wasteShade === undefined ? "" : ` WS${st.wasteShade}`} K${st.lightK} S${r.config.seed}`;
};
async function render(rows: Row[]): Promise<void> {
  await Deno.mkdir(`${out}/png`, { recursive: true });
  const order = SETTINGS.flatMap((st) => seeds.map((sd) => rows.find((r) => r.id === `${st.id}.s${sd}`))).filter((r): r is Row => !!r);
  const mx = sharedMax(order.map((r) => r.projections));
  for (const r of order) await Deno.writeFile(`${out}/png/${r.id}.png`, await tilePng(r.projections, mx, label(r)));
  const header = [
    `${grid.title}, STEP ${order[0].steps}. 64 X 64 X 32, 8192 FOUNDERS. EACH TILE: TOP VIEWS ABOVE (X BY Y, SUMMED OVER Z),`,
    `SIDE VIEWS BELOW (X BY Z, SUMMED OVER Y, SURFACE UP). LEFT ORANGE = PARTICLES, RIGHT GREEN = TRAIL. LOG SCALE SHARED BY ALL TILES:`,
    `PARTICLES MAX ${mx.particles} SIDE / ${mx.topParticles} TOP, TRAIL MAX ${mx.trail} SIDE / ${mx.topTrail} TOP. BLACK = NONE.`,
  ];
  const cols = seeds.length === 2 ? 4 : seeds.length;
  await Deno.writeFile(`${out}/contact-sheet.png`, await contactSheet(order.map((r) => ({ p: r.projections, label: label(r) })), mx, cols, header));
  console.error(`wrote ${order.length} tiles to ${out}/png and ${out}/contact-sheet.png`);
  // With bonds: the same tiles with the trail panels replaced by particles in bodies (a run without bonds shows black there).
  if (SETTINGS.some((st) => st.bonds)) {
    const W = order[0].projections.W, H = order[0].projections.H, D = order[0].projections.D;
    const swap = (p: Projections): Projections => ({ ...p, sideTrail: p.sideBonded ?? new Array(W * D).fill(0), topTrail: p.topBonded ?? new Array(W * H).fill(0) });
    const bp = order.map((r) => swap(r.projections));
    const bm = sharedMax(bp);
    const bh = [
      `${grid.title}, STEP ${order[0].steps}. 64 X 64 X 32, 8192 FOUNDERS. EACH TILE: TOP VIEWS ABOVE (X BY Y, SUMMED OVER Z),`,
      `SIDE VIEWS BELOW (X BY Z, SUMMED OVER Y, SURFACE UP). LEFT ORANGE = ALL PARTICLES, RIGHT GREEN = PARTICLES HOLDING A BOND. LOG SCALE`,
      `SHARED BY ALL TILES: PARTICLES MAX ${bm.particles} SIDE / ${bm.topParticles} TOP, BONDED MAX ${bm.trail} SIDE / ${bm.topTrail} TOP. BLACK = NONE.`,
    ];
    await Deno.writeFile(`${out}/contact-sheet-bodies.png`, await contactSheet(order.map((r, i) => ({ p: bp[i], label: label(r) })), bm, cols, bh));
    console.error(`wrote ${out}/contact-sheet-bodies.png`);
  }
}

// ---- main --------------------------------------------------------------------------------------------------------

if (a.table) { printTables(await loadRows()); Deno.exit(0); }
if (a.leads) { printLeads(await loadRows()); Deno.exit(0); }
if (a.render) { await render(await loadRows()); Deno.exit(0); }
await Deno.mkdir(`${out}/runs`, { recursive: true });
const path = (id: string) => `${out}/runs/${id}.json`;
const exists = async (p: string) => { try { await Deno.stat(p); return true; } catch { return false; } };
const todo: { st: Setting; seed: number; id: string }[] = [];
for (const st of SETTINGS) for (const seed of seeds) {
  const id = `${st.id}.s${seed}`;
  if (only !== undefined && !id.includes(only)) continue;
  if (await exists(path(id))) {
    const done = JSON.parse(await Deno.readTextFile(path(id)));
    if (done.fingerprint !== fingerprint(screenConfig(st, seed), steps, every, moveEvery)) fail(`${id} exists with different settings (config, steps or cadences); use a fresh --out`);
    continue;
  }
  todo.push({ st, seed, id });
}
const device = await mycelium3dDevice();
const log = async (o: Record<string, unknown>) => await Deno.writeTextFile(logPath, JSON.stringify({ t: new Date().toISOString(), out, ...o }) + "\n", { append: true });
let next = 0, failures = 0;
const worker = async () => {
  while (next < todo.length) {
    const { st, seed, id } = todo[next++];
    const claim = `${out}/runs/${id}.claim`;
    if (a.reclaim) { try { await Deno.remove(claim); } catch { /* none */ } }
    try { (await Deno.open(claim, { createNew: true, write: true })).close(); } catch { console.error(`${id} is claimed by another process; skipped`); continue; }
    const cfg = screenConfig(st, seed);
    await log({ id, state: "started", steps, every, moveEvery, seed, setting: st });
    const t0 = performance.now();
    try {
      const res = await runOne(device, st, seed);
      const seconds = +((performance.now() - t0) / 1000).toFixed(1);
      await Deno.writeTextFile(`${path(id)}.tmp`, JSON.stringify({ id, setting: st, seconds, fingerprint: fingerprint(cfg, steps, every, moveEvery), ...res }));
      await Deno.rename(`${path(id)}.tmp`, path(id));
      const fin: Readout = res.readouts.at(-1);
      await log({ id, state: "finished", seconds, ledgerChecks: res.ledgerChecks, ledgerResidual: 0, n: fin.n, trail: fin.trailMass, comp: fin.comp.size });
      const bodies = fin.bonds ? `, bonds ${fin.bonds.bonds}, bodies ${fin.bonds.bodies} (largest ${fin.bonds.largest})` : "";
      console.error(`${id} done in ${seconds}s: ${res.ledgerChecks} ledger reads exact, n ${fin.n}, trail ${fin.trailMass}, largest component ${fin.comp.size} (z ${fin.comp.zMin}-${fin.comp.zMax})${bodies}`);
    } catch (e) {
      failures++;
      try { await Deno.remove(claim); } catch { /* none */ }
      await log({ id, state: "failed", seconds: +((performance.now() - t0) / 1000).toFixed(1), error: String((e as Error).message ?? e), residual: (e as any).residual === true, step: (e as any).step ?? null });
      console.error(`${id} FAILED: ${(e as Error).message}`);
    }
  }
};
console.error(`${todo.length} runs, ${steps} steps, readout every ${every}, transport every ${moveEvery}, jobs ${jobs}`);
await Promise.all(Array.from({ length: jobs }, worker));
console.error(failures ? `${failures} runs failed or had ledger residuals` : "all ledgers exact");
Deno.exit(failures ? 1 : 0);
