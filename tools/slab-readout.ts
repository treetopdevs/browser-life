// Reads the rung 1b depth check (docs/3d-rung1b-plan-2026-10-23.md section 5.2; docs/3d-rung1b-m5-plan.md section 7).
// The rule is fixed and lives, with its tests, in tools/lib/slab-readout.ts; this file only loads bundles.
//
//   deno run -A --no-lock tools/slab-readout.ts --out runs/3d-slab/check1 [--experiment slab-check]
//
// Reads <out>/<experiment>/slab-spots/{treatment,neutral}/seed-<1..6>/{manifest.json,layers.tsv} (the evolving arm is the
// condition treatment). Each finished bundle must be the run of the slot it sits in (its manifest's experiment, preset,
// condition, seed, steps, cfg.seed and cfg.neutral say so) and the protocol's world (256 x 256 x 8, kernel 3, uniform light
// 40 + 200, seasons off, the slab-spots founding; the three overrides are whatever the bundle records, M4's pick), and no two
// slots may hold the same final state hash; all bundles must agree on cfg except seed and neutral, on ruleVersion and on
// spec.overrides. It prints the shared defaultMu/defaultSigma/lightK (for comparing with the M4 amendment by eye), removes
// the previous readout files of this mode, and writes <out>/readout.md and <out>/readout.json. Seeds 4-6 are read only if present. A seed without a summary is unfinished: not present.
// Exit codes: 0 a verdict (go, pause, pause: control undefined), 2 unusable input (InputError: never a verdict),
// 3 the extension's seeds 4-6 are not all finished yet.
// Hidden: --rehearsal-steps N reads a short rehearsal run whose last step is N (window = its last min(10, N/1000) censuses),
// writes only readout-rehearsal.md under a "REHEARSAL, not a check result" banner, and tolerates fewer than three seeds.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import {
  CENSUS_EVERY,
  CHECK_WINDOW,
  EXTENSION_SEEDS,
  FIRST_SEEDS,
  InputError,
  PRESET_ID,
  WINDOW,
  checkBundleIdentity,
  checkDistinctHistories,
  decide,
  decisionJson,
  ratDecimal,
  render,
  seedStats,
  type BundleInfo,
  type SeedStats,
  type Window,
} from "./lib/slab-readout.ts";
import { specConfig, type RunSpec } from "@bl/runner";

const a = parseArgs(Deno.args, { string: ["out", "experiment", "rehearsal-steps"], default: { experiment: "slab-check" } });
const die = (msg: string, code: number): never => {
  console.error(msg);
  Deno.exit(code);
};
if (a.out === undefined) die("--out DIR is required", 2);
const out = a.out as string;
const rehearsal = a["rehearsal-steps"] !== undefined;
let window: Window = CHECK_WINDOW;
if (rehearsal) {
  const n = Number(a["rehearsal-steps"]);
  if (!Number.isInteger(n) || n < CENSUS_EVERY || n % CENSUS_EVERY !== 0) die("--rehearsal-steps N: N must be a multiple of 1000, at least 1000", 2);
  window = { finalStep: n, censuses: Math.min(WINDOW, n / CENSUS_EVERY) };
}

const ARMS = [["evolving", "treatment"], ["neutral", "neutral"]] as const;
const dirOf = (cond: string, seed: number) => `${out}/${a.experiment}/slab-spots/${cond}/seed-${seed}`;
async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw new InputError(`${path}: ${(e as Error).message}`);
  }
}

/** The config the code builds for the slot's spec with the manifest's own overrides (identity-checked next), so the comparison is whole. */
function expectedCfg(cond: string, seed: number, manifest: Record<string, unknown>): Record<string, unknown> {
  const spec = manifest.spec as Record<string, unknown> | undefined;
  const overrides = spec?.overrides;
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) throw new InputError("manifest spec.overrides is not an object");
  try {
    const rs: RunSpec = { experiment: a.experiment, presetId: PRESET_ID, condition: cond, seed, steps: window.finalStep, censusEvery: CENSUS_EVERY, deepEvery: 1, checkpointEvery: 0, overrides };
    return specConfig(rs) as unknown as Record<string, unknown>;
  } catch (e) {
    throw new InputError(`cannot build the check's config from the manifest's overrides: ${(e as Error).message}`);
  }
}

interface Loaded {
  arm: "evolving" | "neutral";
  seed: number;
  manifest: Record<string, unknown>;
  stats: SeedStats;
}

async function removeStale(path: string) {
  try {
    await Deno.remove(path);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

async function main() {
  // The previous result of this mode goes first: a run that ends in an error must not leave an earlier verdict beside it.
  for (const f of rehearsal ? ["readout-rehearsal.md"] : ["readout.md", "readout.json"]) await removeStale(`${out}/${f}`);
  const loaded: Loaded[] = [];
  const unfinished: string[] = [];
  for (const [arm, cond] of ARMS)
    for (const seed of [...FIRST_SEEDS, ...EXTENSION_SEEDS]) {
      const dir = dirOf(cond, seed);
      const manifest = (await readJson(`${dir}/manifest.json`)) as Record<string, unknown> | null;
      if (manifest === null) continue;
      if (!manifest.summary) {
        unfinished.push(`${arm} ${seed}`);
        continue;
      }
      let layers: string;
      try {
        layers = await Deno.readTextFile(`${dir}/layers.tsv`);
      } catch {
        throw new InputError(`${dir}: a finished run with no layers.tsv`);
      }
      try {
        const stats = seedStats(layers, manifest, window);
        checkBundleIdentity(manifest, { arm, condition: cond, seed, experiment: a.experiment, steps: window.finalStep }, expectedCfg(cond, seed, manifest));
        loaded.push({ arm, seed, manifest, stats });
      } catch (e) {
        if (e instanceof InputError) throw new InputError(`${arm} seed ${seed} (${dir}): ${e.message}`);
        throw e;
      }
    }
  if (loaded.length === 0) throw new InputError(`no finished bundle under ${out}/${a.experiment}/slab-spots`);
  checkDistinctHistories(loaded.map((l) => ({ label: `${l.arm} seed ${l.seed}`, finalHash: (l.manifest.summary as Record<string, unknown>).finalHash })));
  const bundles: BundleInfo[] = loaded.map((l) => ({ arm: l.arm, seed: l.seed, conservationOk: (l.manifest.summary as Record<string, unknown>).conservationOk, extinct: (l.manifest.summary as Record<string, unknown>).extinct }));

  // All bundles describe one world and one rule version, differing only in seed and in the neutral switch.
  // Override key order is not meaningful (tools/run.ts --override keeps the order given), so compare sorted.
  const sortKeys = (o: unknown) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1))) : null);
  const canon = (m: Record<string, unknown>) => {
    const { seed: _s, neutral: _n, ...cfg } = m.cfg as Record<string, unknown>;
    return JSON.stringify({ cfg: Object.fromEntries(Object.entries(cfg).sort(([x], [y]) => (x < y ? -1 : 1))), ruleVersion: m.ruleVersion, overrides: sortKeys((m.spec as Record<string, unknown>).overrides) });
  };
  const first = canon(loaded[0].manifest);
  for (const l of loaded) if (canon(l.manifest) !== first) throw new InputError(`${l.arm} seed ${l.seed} differs from ${loaded[0].arm} seed ${loaded[0].seed} in cfg (other than seed and neutral), ruleVersion or spec.overrides: the bundles are not one check`);
  const c0 = loaded[0].manifest.cfg as Record<string, unknown>;
  const params = `Shared parameters: defaultMu ${c0.defaultMu}, defaultSigma ${c0.defaultSigma}, lightK ${c0.lightK}; ruleVersion ${loaded[0].manifest.ruleVersion}; ${loaded.length} bundles read.`;
  console.log(params);
  if (unfinished.length) console.log(`unfinished (not counted): ${unfinished.join(", ")}`);

  const pick = (arm: "evolving" | "neutral") => new Map(loaded.filter((l) => l.arm === arm).map((l) => [l.seed, l.stats] as const));
  let decision;
  try {
    decision = decide({ evolving: pick("evolving"), neutral: pick("neutral") });
  } catch (e) {
    if (rehearsal && e instanceof InputError) {
      const rows = loaded.map((l) => `| ${l.arm} | ${l.seed} | ${l.stats.D ? `${ratDecimal(l.stats.D)}` : "undefined"} | ${l.stats.all.saturated} |`);
      const md = ["> REHEARSAL, not a check result", "", "# Rung 1b depth check: rehearsal readout", "", params, "", `No decision (${e.message}).`, "", "| arm | seed | D | saturated fields |", "|---|---|---|---|", ...rows, ""].join("\n");
      await Deno.writeTextFile(`${out}/readout-rehearsal.md`, md);
      console.log(md);
      return 0;
    }
    throw e;
  }
  const md = render(decision, { window, params, bundles, banner: rehearsal ? "REHEARSAL, not a check result" : undefined });
  if (rehearsal) await Deno.writeTextFile(`${out}/readout-rehearsal.md`, md);
  else {
    await Deno.writeTextFile(`${out}/readout.md`, md);
    await Deno.writeTextFile(`${out}/readout.json`, JSON.stringify({ params: { defaultMu: c0.defaultMu, defaultSigma: c0.defaultSigma, lightK: c0.lightK, ruleVersion: loaded[0].manifest.ruleVersion }, bundles, ...decisionJson(decision) }, null, 2) + "\n");
  }
  console.log(md);
  return decision.verdict === "extend: waiting for seeds" ? 3 : 0;
}

try {
  Deno.exit(await main());
} catch (e) {
  if (e instanceof InputError) die(`slab-readout: ${e.message}`, 2);
  throw e;
}
