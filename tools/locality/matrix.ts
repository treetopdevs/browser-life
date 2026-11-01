/**
 * I05 controller-locality evidence. CPU only, no GPU. Exploratory; see docs/controller-locality-2026-11-01/PLAN.md.
 *   deno run -A --no-lock tools/locality/matrix.ts --write         write evidence.json and manifest.json (once, deliberately; --force rewrites)
 *   deno run -A --no-lock tools/locality/matrix.ts --check         validate the saved artifacts without simulating
 *   deno run -A --no-lock tools/locality/matrix.ts --replay-check  regenerate the payload and require byte equality
 *   deno run -A --no-lock tools/locality/matrix.ts --calibrate     print timings and the viability / noise numbers; writes nothing
 * Also runs under Node 24 through the @bl/* resolver registered below.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { arch, platform } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const OUT_DIR = `${REPO}docs/controller-locality-2026-11-01/`;
export const EVIDENCE = `${OUT_DIR}evidence.json`;
export const MANIFEST = `${OUT_DIR}manifest.json`;
export const BASE_COMMIT = "b43db3be";
const SRC_DIR = "packages/lineage/src/locality/";

if (!(globalThis as { Deno?: unknown }).Deno && !process.env.VITEST) {
  try {
    registerHooks({
      resolve(specifier, context, next) {
        const m = /^@bl\/(.+)$/.exec(specifier);
        return m ? next(pathToFileURL(`${REPO}packages/${m[1]}/src/index.ts`).href, context) : next(specifier, context);
      },
    });
  } catch { /* a loader that resolves @bl/* is already active */ }
}
const lib = await import("@bl/lineage");
type Payload = import("@bl/lineage").Payload;

export const sha256 = (s: string | Uint8Array): string => createHash("sha256").update(s).digest("hex");
/** Key-sorted JSON, the form the integrity seal covers. */
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x && typeof x === "object") return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(x);
}
export const sealPayload = (p: Payload): Payload => { const { integritySha256: _drop, ...rest } = p; return { ...rest, integritySha256: sha256(canonical(rest)) } as Payload; };
export const verifySeal = (p: Payload): boolean => { const { integritySha256, ...rest } = p; return integritySha256 === sha256(canonical(rest)); };

export function generate(onProgress?: (m: string) => void): Payload {
  return sealPayload(lib.buildPayload(lib.runStudy({ onProgress })));
}
export const serialize = (p: unknown): string => `${JSON.stringify(p, null, 1)}\n`;

/**
 * Files whose bytes feed the evidence: the locality library, the genotype probe and this tool. The schema and the reference
 * simulator are deliberately not hashed: an unrelated edit there must not break `--check`. Changes to dynamics are caught by
 * `--replay-check`, which regenerates the payload; `--check` is a no-simulation integrity check of the saved artifacts only.
 */
const SOURCE_DIRS = [SRC_DIR];
export function sourceFiles(root = REPO): string[] {
  const dirs = SOURCE_DIRS.flatMap((d) => readdirSync(`${root}${d}`).filter((f) => f.endsWith(".ts")).sort().map((f) => d + f));
  return [...dirs, "packages/lineage/src/genotype.ts", "tools/locality/matrix.ts"];
}
const sourceHashes = (): Record<string, string> => Object.fromEntries(sourceFiles().map((f) => [f, sha256(readFileSync(REPO + f))]));

export function makeManifest(payload: Payload, evidenceText: string, seconds: number): Record<string, unknown> {
  return {
    kind: "controller-locality-manifest",
    payloadFileSha256: sha256(evidenceText),
    integritySha256: payload.integritySha256,
    version: payload.version,
    sources: sourceHashes(),
    genomes: payload.genomes.map((g) => ({ id: g.id, hash: g.hash, cluster: g.cluster, votes: g.votes })),
    candidates: payload.candidates.map((c) => ({ slot: c.slot, cluster: c.cluster, pass: c.qualification.pass, chosen: c.chosen })),
    provenance: { note: "not replayed; excluded from the deterministic payload", baseCommit: BASE_COMMIT, runtime: (globalThis as { Deno?: { version: { deno: string } } }).Deno ? `deno ${(globalThis as { Deno?: { version: { deno: string } } }).Deno!.version.deno}` : `node ${process.version}`, platform: `${platform()}-${arch()}`, generatedAt: new Date().toISOString(), generateSeconds: seconds },
  };
}

const ROW_KEYS = ["genome", "id", "family", "kind", "k", "cls", "slots", "requestedL1", "realisedL1", "undoExact", "dupOf", "hash", "expression", "changed", "maxDelta", "breadth", "participation", "sensorReach", "sensorMask", "structActuators", "structSensors", "withinStructural", "assayed", "assay"];

const sameJson = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

/** Everything in the payload that follows from other saved numbers is recomputed here, so a resealed edit to a derived field is caught. */
export function recomputeProblems(payload: Payload): string[] {
  const out: string[] = [];
  for (const [i, r] of payload.rows.entries()) {
    const at = `row ${i} (${r.genome} ${r.id})`;
    const slotCls = r.slots.map((x) => (x.after - x.before !== x.applied ? "inconsistent" : x.applied === 0 ? "unchanged" : x.applied === x.exp ? "genuine" : "boundary-clamped"));
    r.slots.forEach((x, j) => { if (x.cls !== slotCls[j]) out.push(`${at}: slot ${j} cls ${x.cls} does not follow from its before/after/expected`); });
    const cls = r.slots.every((x) => x.applied === 0) ? "unchanged" : r.slots.every((x) => x.cls === "genuine") ? "genuine" : "boundary-clamped";
    if (r.cls !== cls) out.push(`${at}: cls ${r.cls} does not follow from its slots (${cls})`);
    if (r.k !== r.slots.length) out.push(`${at}: k ${r.k} differs from the slot count ${r.slots.length}`);
    if (r.requestedL1 !== r.slots.reduce((a, x) => a + Math.abs(x.op), 0)) out.push(`${at}: requestedL1 does not follow from its slots`);
    if (r.realisedL1 !== r.slots.reduce((a, x) => a + Math.abs(x.applied), 0)) out.push(`${at}: realisedL1 does not follow from its slots`);
    if (r.assayed !== (r.assay !== null)) out.push(`${at}: assayed flag disagrees with the assay record`);
  }
  for (const [i, r] of payload.rows.entries()) {
    const at = `row ${i} (${r.genome} ${r.id})`;
    const permille = r.changed.map((c) => Math.floor((1000 * c) / lib.GRID_POINTS));
    if (r.breadth !== permille.filter((v) => v >= lib.BREADTH_FLOOR_PERMILLE).length) out.push(`${at}: breadth does not follow from changed`);
    if (r.participation !== r.maxDelta.filter((v) => v >= lib.PARTICIPATION_DELTA).length) out.push(`${at}: participation does not follow from maxDelta`);
    if (r.sensorReach !== lib.popcount(r.sensorMask)) out.push(`${at}: sensorReach does not follow from sensorMask`);
    let act = 0;
    r.changed.forEach((c, k) => { if (c > 0) act |= 1 << k; });
    if (r.withinStructural !== ((act & ~r.structActuators) === 0 && (r.sensorMask & ~r.structSensors) === 0)) out.push(`${at}: withinStructural does not follow from its masks`);
    if (r.assay) {
      const g = payload.genomes.find((x) => x.id === r.genome);
      if (g) {
        const base = [lib.sum(g.baseline.lg), lib.sum(g.baseline.dp), lib.sum(g.baseline.dt)];
        if (!sameJson(r.assay.dev, r.assay.sums.map((v, k) => v - base[k]))) out.push(`${at}: assay dev does not follow from its sums and the baseline`);
      }
    }
  }
  // Sampling counts follow from the rows: population = genuine non-duplicate edits, chosen = assayed rows, per stratum.
  for (const g of payload.genomes) {
    const mine = payload.rows.filter((r) => r.genome === g.id);
    const want: Record<string, { population: number; chosen: number }> = {};
    for (const r of mine) {
      const k = lib.strataKey(r as unknown as Parameters<typeof lib.strataKey>[0]);
      if (r.cls === "genuine" && r.dupOf === null) (want[k] ??= { population: 0, chosen: 0 }).population++;
      if (r.assay) (want[k] ??= { population: 0, chosen: 0 }).chosen++;
    }
    const have = payload.strata[g.id] ?? {};
    for (const k of new Set([...Object.keys(want), ...Object.keys(have)])) {
      const w = want[k] ?? { population: 0, chosen: 0 }, h = have[k];
      // Strata are recorded only for allocated keys; an unallocated stratum must hold no assayed rows.
      if (!h ? w.chosen !== 0 : h.population !== w.population || h.chosen !== w.chosen) out.push(`genome ${g.id}: stratum ${k} counts do not follow from the rows`);
    }
    const nb = payload.nullBreadth[g.id];
    if (nb && nb.median2 !== lib.median2(nb.values)) out.push(`genome ${g.id}: nullBreadth median2 does not follow from its values`);
    const gen0 = payload.genomes.find((x) => x.id === lib.GENERALIST_ID);
    if (gen0 && !sameJson(g.tau, [lib.tau(g.baseline.lg, gen0.baseline.lg), lib.tau(g.baseline.dp, gen0.baseline.dp), lib.tau(g.baseline.dt, gen0.baseline.dt)])) out.push(`genome ${g.id}: tau does not follow from the baselines`);
  }
  // Selection: per slot the first passing candidate in order is used, and exactly those genomes vote.
  const picked = new Set<string>();
  for (const { slot } of lib.SLOTS) {
    let done = false;
    for (const c of payload.candidates.filter((x) => x.slot === slot)) {
      const want = c.qualification.pass && !done;
      if (c.chosen !== want) out.push(`candidate ${c.id}: chosen flag does not follow from the selection rule`);
      if (want) { done = true; picked.add(c.id); }
    }
  }
  for (const g of payload.genomes) if (g.votes !== picked.has(g.id)) out.push(`genome ${g.id}: votes does not follow from candidate selection`);
  if (!sameJson(payload.protocol, JSON.parse(JSON.stringify(lib.protocolRecord())))) out.push("protocol differs from the code's constants");
  for (const f of payload.fixtures) {
    const passes = f.neutral ? f.physical.identical && f.functional.changedOutputs === 0 && f.physical.dev.every((d) => d === 0) : f.functional.changedOutputs > 0;
    if (f.passes !== passes) out.push(`fixture ${f.id}: passes does not follow from its numbers`);
  }
  const neutralOk = payload.fixtures.filter((f) => f.neutral).every((f) => f.passes);
  if (payload.neutralControlsOk !== neutralOk) out.push("neutralControlsOk does not follow from the fixtures");
  const gen = payload.genomes.find((g) => g.id === lib.GENERALIST_ID);
  const sensPasses = gen !== undefined && payload.sensitivity.dev < -payload.sensitivity.tau;
  if (payload.sensitivity.passes !== sensPasses) out.push("sensitivity.passes does not follow from its dev and tau");
  if (gen && payload.sensitivity.tau !== gen.tau[0]) out.push("sensitivity.tau differs from the generalist light-growth tau");
  for (const g of payload.genomes) {
    const q = lib.qualify(g.baseline);
    if (!sameJson(q, g.qualification)) out.push(`genome ${g.id}: qualification does not follow from its baseline`);
  }
  for (const c of payload.candidates) if (!sameJson(lib.qualify(c.baseline), c.qualification)) out.push(`candidate ${c.id}: qualification does not follow from its baseline`);
  for (const g of payload.genomes) {
    const want = lib.readoutFor(g, payload.rows, payload.strata[g.id] ?? {}, payload.nullBreadth[g.id]?.median2 ?? 0);
    const have = payload.readouts.find((r) => r.genome === g.id);
    if (!have || !sameJson(have, want)) out.push(`genome ${g.id}: saved readout does not follow from the saved rows`);
  }
  if (payload.readouts.length !== payload.genomes.length) out.push("readouts and genomes differ in number");
  return out;
}

/** Validate saved artifacts without simulating. Returns problems (empty when sound). */
export function checkSaved(evidencePath = EVIDENCE, manifestPath = MANIFEST, root = REPO): string[] {
  const problems: string[] = [];
  if (!existsSync(evidencePath) || !existsSync(manifestPath)) return ["evidence.json or manifest.json is missing"];
  const text = readFileSync(evidencePath, "utf8");
  const payload = JSON.parse(text) as Payload;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!verifySeal(payload)) problems.push("integritySha256 does not match the payload");
  if (manifest.payloadFileSha256 !== sha256(text)) problems.push("manifest payloadFileSha256 does not match evidence.json");
  if (manifest.integritySha256 !== payload.integritySha256) problems.push("manifest seal differs from the payload seal");
  const ids = new Set(payload.genomes.map((g) => g.id));
  for (const g of manifest.genomes as { id: string; hash: string }[]) if (payload.genomes.find((x) => x.id === g.id)?.hash !== g.hash) problems.push(`genome ${g.id}: manifest hash differs`);
  for (const [i, r] of payload.rows.entries()) {
    const missing = ROW_KEYS.filter((k) => !(k in r));
    if (missing.length) problems.push(`row ${i} lacks ${missing.join(", ")}`);
    if (!ids.has(r.genome)) problems.push(`row ${i} names unknown genome ${r.genome}`);
  }
  if (payload.grid.points !== lib.GRID_POINTS) problems.push(`grid points ${payload.grid.points} differ from the derived ${lib.GRID_POINTS}`);
  try { lib.assertIntegers(payload); } catch (e) { problems.push(String((e as Error).message)); }
  problems.push(...recomputeProblems(payload));
  const again = lib.verdictFromPayload(payload);
  if (canonical(again) !== canonical(payload.verdict)) problems.push("the saved verdict does not follow from the saved rows");
  if (!payload.neutralControlsOk) problems.push("a neutral control was not neutral");
  if (existsSync(root + SRC_DIR)) for (const f of sourceFiles(root)) if (!Object.keys(manifest.sources).includes(f)) problems.push(`source ${f} is not in the manifest (added since the evidence was written)`);
  for (const [file, hash] of Object.entries(manifest.sources as Record<string, string>)) {
    if (!existsSync(root + file)) problems.push(`source ${file} is missing`);
    else if (sha256(readFileSync(root + file)) !== hash) problems.push(`source ${file} changed since the evidence was written`);
  }
  return problems;
}

export function replayCheck(evidencePath = EVIDENCE): string[] {
  return serialize(generate()) === readFileSync(evidencePath, "utf8") ? [] : ["regenerated payload differs from evidence.json"];
}

function calibrate(): void {
  const t0 = performance.now();
  const gen = lib.generalistStart();
  const cache = new lib.AssayCache();
  const timeRun = (w: Uint32Array, sc: import("@bl/lineage").Scenario) => { const t = performance.now(); const r = lib.runAssay(w, sc, 1); return [r.permille, Math.round(performance.now() - t)]; };
  console.log("scenario protocol", JSON.stringify(lib.ASSAY));
  for (const s of [gen, ...[4, 10, 16, 9].map((c) => lib.m3Start(c, c === 4 || c === 10 ? "m3-sparse" : "m3-dense"))]) {
    const b = { lg: lib.responses(cache, s.words, "light-growth"), dp: lib.responses(cache, s.words, "dark-persistence"), dt: lib.responses(cache, s.words, "dim-transfer") };
    console.log(s.id, "baseline", JSON.stringify(b), "gate", JSON.stringify(lib.qualify(b)), "ms(lg,dp,dt seed1)", JSON.stringify(lib.SCENARIO_IDS.map((sc) => timeRun(s.words, sc))));
  }
  console.log(`calibrate took ${Math.round(performance.now() - t0)} ms; budget: assayed edits per M3 genome ${Object.values(lib.ALLOC_M3).reduce((a, b) => a + b, 0)}, scenarios 3, seeds ${lib.ASSAY.seeds.length}, horizon ${lib.ASSAY.horizon}`);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "--write") {
    if (existsSync(EVIDENCE) && !process.argv.includes("--force")) throw new Error("evidence.json exists; files are written once. Pass --force to rewrite deliberately.");
    const t = performance.now();
    const payload = generate((m) => console.error(m));
    const text = serialize(payload);
    const manifestText = serialize(makeManifest(payload, text, Math.round((performance.now() - t) / 1000)));
    writeFileSync(`${EVIDENCE}.tmp`, text);
    writeFileSync(`${MANIFEST}.tmp`, manifestText);
    renameSync(`${EVIDENCE}.tmp`, EVIDENCE);
    renameSync(`${MANIFEST}.tmp`, MANIFEST);
    console.log(`wrote evidence.json (${text.length} bytes) seal ${payload.integritySha256}`);
  } else if (mode === "--check" || mode === "--replay-check") {
    const problems = mode === "--check" ? checkSaved() : replayCheck();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log(`${mode} ok`);
  } else if (mode === "--calibrate") calibrate();
  else {
    console.error("usage: deno run -A --no-lock tools/locality/matrix.ts --write | --check | --replay-check | --calibrate");
    process.exit(2);
  }
}
const isMain = (import.meta as { main?: boolean }).main ?? (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url);
if (isMain) await main();
