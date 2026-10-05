// Engineering check of the renewal-v1 tooling on ARTIFICIAL worlds: generalist
// and builder-like founders on a small nutrient field, short horizons and
// engineering seeds. No reservoir witness habitat and no renewal seed is
// stepped. Covers: durable attempts (interrupted attempt superseded, a complete
// attempt immutable), census and checkpoints, CPU and native GPU replays
// (including the polymerTransport:false gate), the independent audit agreeing
// with the production readout, tamper detection, and a dry-run freeze that
// executes zero steps and runs later operations from the frozen source tree.
//
//   deno run -A tests/deno/construction_renewal_engineering.ts
import { join } from "node:path";
import {
  allocState,
  CH,
  defaultConfig,
  encodeCheckpoint,
  encodeGenome,
  GENOME_CHANNELS,
  generalistGenome,
  stateHash,
  totalsOf,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { MOT_ZERO } from "@bl/sim-ref";
import { constructionGenome } from "../../tools/lib/construction.ts";
import { sha256Hex } from "../../tools/lib/construction-renewal.ts";
import { caseInfo, type ManifestCase, publicationOf, readCompletedCase, report, runCase } from "../../tools/construction-renewal.ts";
import { auditCase, cpuReplay, gpuReplay } from "../../tools/construction-renewal-verify.ts";
import { completeAttempt, exists, listAttempts } from "../../tools/lib/construction-renewal-store.ts";
import type { Thresholds } from "../../tools/lib/construction-renewal-readout.ts";

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}
async function throws(fn: () => Promise<unknown>, pattern: RegExp): Promise<string> {
  try {
    await fn();
    return "did not throw";
  } catch (e) {
    const m = (e as Error).message;
    return pattern.test(m) ? "" : m;
  }
}

const repo = new URL("../../", import.meta.url).pathname;
const scratch = await Deno.makeTempDir({ prefix: "renewal-engineering-" });
const root = join(scratch, "root");
await Deno.mkdir(join(root, "initial"), { recursive: true });

// Engineering protocol: the real one's structure with short windows.
const p = JSON.parse(await Deno.readTextFile(join(repo, "experiments/construction/renewal-v1/protocol.json")));
p.censusEvery = 10;
p.checkpointSteps = [0, 100, 200, 300];
p.endpoints.mainWindow = { from: 200, to: 300 };
p.endpoints.controlWindow = { from: 100, to: 200 };
const th: Thresholds = { ...p.endpoints, censusEvery: p.censusEvery };

function engWorld(seed: number, spread: number, founders: { x: number; y: number; B: number; E: number; words: Uint32Array }[], extra: Partial<WorldConfig> = {}): WorldState {
  const cfg = defaultConfig({
    ruleVersion: 1, seed, tileW: 32, tileH: 32, kernelRadius: 2, dtQ: 0, motility: false, mutRate: 0,
    lightMode: "uniform", lightBase: 255, lightAmp: 0, seasonPeriod: 0, spread, ...extra,
  });
  const s = allocState(cfg), n = 1024;
  s.cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
  for (let i = 0; i < n; i++) s.cells[CH.A * n + i] = 12;
  for (const f of founders) {
    const i = f.y * 32 + f.x;
    s.cells[CH.B * n + i] = f.B;
    s.cells[CH.E * n + i] = f.E;
    for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = f.words[g];
  }
  return s;
}
const gen = (k: number) => encodeGenome(generalistGenome(154, 24), 0, k);
const builderLike = (k: number) => encodeGenome(constructionGenome({ build: 16, grow: 64 }), 0, k);

const specs: { id: string; kind: ManifestCase["kind"]; spread: number; horizon: number; state: WorldState; sources: number[] }[] = [
  { id: "eng-main-s1", kind: "main", spread: 1, horizon: 300, state: engWorld(4201, 1, [{ x: 16, y: 16, B: 1500, E: 3000, words: gen(1) }]), sources: [528] },
  { id: "eng-main-s0", kind: "main", spread: 0, horizon: 300, state: engWorld(4202, 0, [{ x: 16, y: 16, B: 900, E: 1800, words: builderLike(1) }]), sources: [528] },
  { id: "eng-ablation-s2", kind: "main", spread: 2, horizon: 300, state: engWorld(4203, 2, [{ x: 16, y: 16, B: 1200, E: 2400, words: builderLike(1) }], { polymerTransport: false }), sources: [528] },
  {
    id: "eng-capacity", kind: "capacity", spread: 0, horizon: 200,
    state: engWorld(4204, 0, [{ x: 8, y: 16, B: 1024, E: 2048, words: builderLike(1) }, { x: 24, y: 16, B: 1024, E: 2048, words: builderLike(2) }]), sources: [520, 536],
  },
  { id: "eng-small", kind: "small-founder", spread: 2, horizon: 300, state: engWorld(4205, 2, [{ x: 16, y: 16, B: 64, E: 128, words: gen(1) }]), sources: [528] },
];
const cases: ManifestCase[] = [];
for (const s of specs) {
  const bytes = encodeCheckpoint(s.state, { case: s.id, role: "initial" });
  await Deno.writeFile(join(root, "initial", `${s.id}.blck`), bytes);
  const t = totalsOf(s.state.cfg, s.state.cells);
  const tot = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, String(v)]));
  cases.push({
    id: s.id, phase: s.kind === "main" ? "pilot" : "controls", kind: s.kind, arm: "builder", seed: s.state.cfg.seed, reservoir: 12,
    spread: s.spread, horizon: s.horizon, founders: [], sourceSites: s.sources, habitat: s.id, cfg: s.state.cfg,
    initialStateHash: stateHash(s.state), initialFile: `initial/${s.id}.blck`, initialFileSha256: await sha256Hex(bytes),
    initialTotals: tot, expectedTotals: tot,
  } as ManifestCase & { expectedTotals: Record<string, string> });
}

// 1. An interrupted attempt is retained and superseded; the rerun completes; a complete attempt is immutable.
const first = cases[0];
const partial = join(root, "cases", first.id, "attempt-1");
await Deno.mkdir(partial, { recursive: true });
await Deno.writeTextFile(join(partial, "census.jsonl"), '{"step":0}\n{"step":10');
await runCase(root, first, p.checkpointSteps, p.censusEvery, "engineering");
const attempts = await listAttempts(join(root, "cases", first.id));
check("an interrupted attempt is kept and marked superseded", attempts.length === 2 && attempts[0].superseded && !attempts[0].complete && attempts[1].complete, attempts);
check("a complete attempt cannot be replaced", (await throws(() => runCase(root, first, p.checkpointSteps, p.censusEvery, "engineering"), /immutable/)) === "");
for (const c of cases.slice(1)) await runCase(root, c, p.checkpointSteps, p.censusEvery, "engineering");
for (const c of cases) {
  const done = await completeAttempt(join(root, "cases", c.id));
  const r = JSON.parse(await Deno.readTextFile(join(done!.dir, "result.json")));
  check(`${c.id}: complete with ${r.censusCount} censuses and checkpoints ${r.checkpoints.map((k: { step: number }) => k.step)}`, r.censusCount === c.horizon / 10 + 1 && r.checkpoints.length === p.checkpointSteps.filter((s: number) => s <= c.horizon).length);
}

// 2. The independent audit validates every case and agrees with the production readout.
for (const c of cases) {
  const audit = await auditCase(root, c as never, p);
  const readout = await readCompletedCase(root, c, th);
  const agree = readout.status === "complete" && audit.status === "complete" &&
    (readout.renew === undefined || readout.renew === audit.renew) &&
    JSON.stringify(readout.qualifyingSites ?? null) === JSON.stringify(audit.qualifyingSites ?? null) &&
    (readout.bothSitesPersist === undefined || readout.bothSitesPersist === audit.bothSitesPersist) &&
    JSON.stringify(readout.maintainedSites ?? null) === JSON.stringify(audit.maintainedSites ?? null);
  check(`${c.id}: audit valid and agrees with the readout`, agree, { audit, readout: readout.status === "complete" ? { renew: readout.renew, q: readout.qualifyingSites, both: readout.bothSitesPersist, m: readout.maintainedSites } : readout });
}

// 3. Replays: complete CPU replay, native GPU replay including the ablated gate.
for (const id of ["eng-main-s1", "eng-capacity"]) {
  const r = await cpuReplay(root, cases.find((c) => c.id === id)! as never, p);
  check(`CPU replay of ${id} matches every census and checkpoint (${r.censusesCompared})`, r.status === "match", r.mismatches);
}
for (const id of ["eng-main-s1", "eng-ablation-s2"]) {
  const r = await gpuReplay(root, cases.find((c) => c.id === id)! as never, p);
  check(`GPU replay of ${id}: state hash, ledgers, flux and last-step roles at ${r.censusesCompared} censuses`, r.status === "match", r);
}

// 4. Tampering is detected and reported as invalid or incomplete, never as a result.
{
  const c = cases[1];
  const done = await completeAttempt(join(root, "cases", c.id));
  const path = join(done!.dir, "census.jsonl");
  const text = await Deno.readTextFile(path);
  const lines = text.trimEnd().split("\n");
  const rec = JSON.parse(lines[25]);
  rec.cells.B[0] = 5; // off-source B at spread 0
  lines[25] = JSON.stringify(rec);
  await Deno.writeTextFile(path, lines.join("\n") + "\n");
  const audit = await auditCase(root, c as never, p);
  check("a tampered census is invalid in the audit (hash and spread-0 off-source B)", audit.status === "invalid" && audit.issues.some((s: string) => /census file hash/.test(s)) && audit.issues.some((s: string) => /off-source B/.test(s)), audit.issues);
  const readout = await readCompletedCase(root, c, th);
  check("the production readout refuses the tampered census", readout.status === "incomplete");
}
{
  const c = cases[3];
  const done = await completeAttempt(join(root, "cases", c.id));
  const f = join(done!.dir, "checkpoint-100.blck");
  const bytes = await Deno.readFile(f);
  bytes[bytes.length - 5] ^= 1;
  await Deno.writeFile(f, bytes);
  const audit = await auditCase(root, c as never, p);
  check("a corrupted checkpoint is invalid in the audit", audit.status === "invalid" && audit.issues.some((s: string) => /checkpoint 100/.test(s)), audit.issues);
}

{
  // A forged census that keeps its own file hash consistent (result.json rewritten) still fails
  // the reconstructed identities: one cell's cumulative synthesis no longer matches the flux.
  const c = cases[0];
  const done = await completeAttempt(join(root, "cases", c.id));
  const path = join(done!.dir, "census.jsonl");
  const lines = (await Deno.readTextFile(path)).trimEnd().split("\n");
  const rec = JSON.parse(lines[28]);
  rec.cumulative.photo[528] += 200;
  lines[28] = JSON.stringify(rec);
  await Deno.writeTextFile(path, lines.join("\n") + "\n");
  const resPath = join(done!.dir, "result.json");
  const res = JSON.parse(await Deno.readTextFile(resPath));
  res.censusSha256 = await sha256Hex(await Deno.readFile(path));
  await Deno.writeTextFile(resPath, JSON.stringify(res));
  // The publication rule on its own, including the confirmation branch no artificial root can reach
  // (a run confirmation case before the final readout): nothing unaudited is published.
  const audited = { "x": { attempt: 2, resultSha256: "aa" } };
  check("publication rule: no attempt, unaudited confirmation, audited, and refused",
    publicationOf("x", null, audited) === "absent" && publicationOf("x", { attempt: 2, resultSha256: "bb" }, null) === "unaudited" &&
      publicationOf("x", { attempt: 2, resultSha256: "aa" }, audited) === "audited" &&
      (await throws(async () => publicationOf("x", { attempt: 2, resultSha256: "bb" }, audited), /not the one the bound audit recorded/)) === "" &&
      (await throws(async () => publicationOf("x", { attempt: 3, resultSha256: "aa" }, audited), /not the one/)) === "" &&
      (await throws(async () => publicationOf("y", { attempt: 1, resultSha256: "aa" }, audited), /not the one/)) === "");
  const audit = await auditCase(root, c as never, p);
  check("a self-consistent forged census fails the reconstructed identities", audit.status === "invalid" && audit.issues.some((s: string) => /photo roles vs flux/.test(s)), audit.issues);
}

{
  // Report: results.json, RESULTS.md's generated section (text outside the markers kept) and the figure,
  // from a pilot readout bound to a passing audit of this manifest.
  const clean = [cases[2], cases[4]]; // untampered so far: eng-ablation-s2, eng-small
  const manifestText = JSON.stringify({ cases: clean });
  await Deno.writeTextFile(join(root, "manifest.json"), manifestText);
  const manifestSha256 = await sha256Hex(new TextEncoder().encode(manifestText));
  await Deno.writeTextFile(join(root, "FROZEN.json"), JSON.stringify({ manifestSha256, protocolSha256: "eng", sourceDigest: "eng" }));
  const readouts = [];
  const auditCases: Record<string, unknown> = {};
  for (const c of clean) {
    readouts.push(await readCompletedCase(root, c, th));
    auditCases[c.id] = await auditCase(root, c as never, p);
  }
  await Deno.mkdir(join(root, "verify", "pilot-attempt-1"), { recursive: true });
  const selection = { status: "incomplete", reason: `${clean.length} of 40 cases read` };
  const auditText = JSON.stringify({ status: "pass", manifestSha256, selection, cases: auditCases });
  await Deno.writeTextFile(join(root, "verify", "pilot-attempt-1", "audit.json"), auditText);
  await Deno.mkdir(join(root, "readout"));
  await Deno.writeTextFile(join(root, "readout", "pilot-readout.json"), JSON.stringify({
    manifestSha256, auditPath: "verify/pilot-attempt-1/audit.json", auditSha256: await sha256Hex(new TextEncoder().encode(auditText)),
    selection, cases: readouts,
  }));
  const out = join(scratch, "report");
  await Deno.mkdir(out);
  await Deno.writeTextFile(join(out, "RESULTS.md"), "# Title\n\nHuman text before.\n\n<!-- GENERATED:BEGIN (tools/construction-renewal.ts report; do not edit inside) -->\nold\n<!-- GENERATED:END -->\n\nHuman text after.\n");
  const loaded = { protocol: p, inputs: { witness: JSON.parse(await Deno.readTextFile(join(repo, p.inputs.witness.path))), selected: JSON.parse(await Deno.readTextFile(join(repo, p.inputs.selected.path))) } };
  await report(root, out, loaded);
  const results = JSON.parse(await Deno.readTextFile(join(out, "results.json")));
  const md = await Deno.readTextFile(join(out, "RESULTS.md"));
  const svg = await Deno.readTextFile(join(out, "renewal-v1.svg"));
  check("report: confirmation absent because unearned, inputs, limitations and per-case accounting recorded",
    results.confirmation.status === "absent: the pilot selection is incomplete" && results.inputs.witness.sha256 === p.inputs.witness.sha256 && results.limitations.length >= 5 &&
      results.cases.find((r: { id: string }) => r.id === "eng-small").accounting.offeredLightExposure === String(1024 * 255 * 300) &&
      "heatExport" in results.cases.find((r: { id: string }) => r.id === "eng-small").accounting, results.confirmation);
  check("report: RESULTS.md regenerated between its markers, human text kept, incomplete cases labelled",
    md.includes("Human text before.") && md.includes("Human text after.") && !md.includes("\nold\n") && /\| eng-small \| a site maintained (true|false) \|/.test(md) && /\| eng-ablation-s2 \| RENEW (true|false) \|/.test(md), md.slice(0, 800));
  // A pilot readout whose stored case summary was edited (decision and hashes untouched) is not published.
  const rpOriginal = await Deno.readTextFile(join(root, "readout", "pilot-readout.json"));
  const rp = JSON.parse(rpOriginal);
  const edited = rp.cases.find((x: { status: string }) => x.status === "complete");
  edited.secondary.finalActiveB = 999999;
  await Deno.writeTextFile(join(root, "readout", "pilot-readout.json"), JSON.stringify(rp));
  check("report: a fabricated per-case summary is refused", (await throws(() => report(root, out, loaded), /differ from those recomputed/)) === "");
  await Deno.writeTextFile(join(root, "readout", "pilot-readout.json"), rpOriginal);
  check("report: figure has one panel per main case with a complete attempt", (svg.match(/<polyline/g) ?? []).length === 5 && svg.includes("eng-ablation-s2"));
  // One character of result.json's finalStateHash changed after the audit: not published, and not read.
  const resPath = join((await completeAttempt(join(root, "cases", "eng-ablation-s2")))!.dir, "result.json");
  const original = await Deno.readTextFile(resPath);
  const res = JSON.parse(original);
  res.finalStateHash = (res.finalStateHash[0] === "0" ? "1" : "0") + res.finalStateHash.slice(1);
  await Deno.writeTextFile(resPath, JSON.stringify(res));
  const editedMsg = await throws(() => report(root, out, loaded), /not the one the bound audit recorded|differ from those recomputed/);
  check("report: a result.json whose final hash was edited after the audit is refused", editedMsg === "", editedMsg);
  const meta = JSON.parse(original);
  meta.artifactBytes += 1; // published metadata only the audit's result hash covers
  await Deno.writeTextFile(resPath, JSON.stringify(meta));
  const metaMsg = await throws(() => report(root, out, loaded), /not the one the bound audit recorded/);
  check("report: a result.json metadata edit after the audit is refused", metaMsg === "", metaMsg);
  await Deno.writeTextFile(resPath, JSON.stringify(res));
  check("readout: a result.json whose final hash disagrees with its census is incomplete", (await readCompletedCase(root, cases[2], th)).status === "incomplete");
  await Deno.writeTextFile(resPath, original);
}

{
  // Sol's reproduction: final totals A+1, C-1, S+2 (matter and energy preserved) and the emission flux
  // changed at a checkpointed census, census hash re-forged. The checkpoint comparison must catch it.
  const c = cases[4];
  const done = await completeAttempt(join(root, "cases", c.id));
  const path = join(done!.dir, "census.jsonl");
  const lines = (await Deno.readTextFile(path)).trimEnd().split("\n");
  const rec = JSON.parse(lines.at(-1)!);
  rec.totals.A = String(BigInt(rec.totals.A) + 1n);
  rec.totals.C = String(BigInt(rec.totals.C) - 1n);
  rec.totals.S = String(BigInt(rec.totals.S) + 2n);
  rec.flux.emit = String(BigInt(rec.flux.emit) + 1n);
  lines[lines.length - 1] = JSON.stringify(rec);
  await Deno.writeTextFile(path, lines.join("\n") + "\n");
  const resPath = join(done!.dir, "result.json");
  const res = JSON.parse(await Deno.readTextFile(resPath));
  res.censusSha256 = await sha256Hex(await Deno.readFile(path));
  await Deno.writeTextFile(resPath, JSON.stringify(res));
  const audit = await auditCase(root, c as never, p);
  check("forged totals and flux at a checkpointed census are invalid", audit.status === "invalid" && audit.issues.some((s: string) => /channel totals differ/.test(s)) && audit.issues.some((s: string) => /flux differs/.test(s)), audit.issues);
}

// 5. Dry-run freeze of the real protocol: zero steps; later operations run from the frozen tree.
const dry = join(scratch, "freeze-dry");
const run = async (args: string[], env: Record<string, string> = {}) => {
  const out = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", ...args], cwd: repo, env, stdout: "piped", stderr: "piped" }).output();
  return { ok: out.success, stdout: new TextDecoder().decode(out.stdout), stderr: new TextDecoder().decode(out.stderr) };
};
const fr = await run(["tools/construction-renewal.ts", "freeze", "--out", dry]);
check("freeze succeeds on the real protocol", fr.ok, fr.stderr.slice(-500));
if (fr.ok) {
  const frozen = JSON.parse(await Deno.readTextFile(join(dry, "FROZEN.json")));
  const manifest = JSON.parse(await Deno.readTextFile(join(dry, "manifest.json")));
  check("freeze executes zero steps and creates no case directory", frozen.stepsExecuted === 0 && manifest.stepsExecuted === 0 && !(await exists(join(dry, "cases"))));
  check("freeze binds 40 initial states, the plan, the protocol and the source closure", manifest.cases.length === 40 && "experiments/construction/RENEWAL-PLAN.md" in manifest.sources.files && "tools/lib/construction-renewal-observer.ts" in manifest.sources.files && "packages/sim-gpu/src/gpu-sim.ts" in manifest.sources.files && !("deno.lock" in manifest.sources.files) && manifest.provenance.denoLockSha256 === await sha256Hex(await Deno.readFile(join(dry, "deno.lock.at-freeze"))));
  const st = await run(["tools/construction-renewal.ts", "status", "--root", dry]);
  const status = st.ok ? JSON.parse(st.stdout) : null;
  check("a later operation re-executes from the frozen source tree", st.ok && status.runningFrom === join(dry, "source") && status.complete === 0, st.stderr.slice(-500));
  const ver = await run(["tools/construction-renewal-verify.ts", "pilot", "--root", dry]);
  check("the verifier (GPU imports included) loads from the frozen tree and fails closed with no cases run", !ver.ok && /"status": "fail"/.test(ver.stdout) && /"status": "incomplete"/.test(ver.stdout), ver.stderr.slice(-300));
  const ver2 = await run(["tools/construction-renewal-verify.ts", "pilot", "--root", dry]);
  check("verification attempts are numbered and never overwritten", !ver2.ok && (await exists(join(dry, "verify", "pilot-attempt-1", "audit.json"))) && (await exists(join(dry, "verify", "pilot-attempt-2", "audit.json"))), ver2.stderr.slice(-300));
  check("the FROZEN record binds the source list initialized from", frozen.sourcesSha256 === await sha256Hex(await Deno.readFile(join(dry, "sources.json"))) && manifest.sourcesSha256 === frozen.sourcesSha256);
  const direct = await run([join(dry, "source", "tools/construction-renewal.ts"), "status", "--root", dry]);
  check("a direct run of the frozen copy is verified and relaunched with the restricted loader", direct.ok && JSON.parse(direct.stdout).runningFrom === join(dry, "source"), direct.stderr.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 600));
  // The public launch variable with another configuration: aliases resolve into the live tree, so it is refused.
  const spoof = await run([`--config=${join(repo, "deno.json")}`, join(dry, "source", "tools/construction-renewal.ts"), "status", "--root", dry], { BL_RENEWAL_FROZEN_LAUNCH: frozen.sourceDigest });
  check("a launch-variable spoof with a different import map is refused", !spoof.ok && /resolves to .*not the frozen/.test(spoof.stderr), spoof.stderr.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 400));
  // An import-map scope for the frozen entrypoint that swaps @bl/sim-ref for the live package: the global
  // aliases still point into the copy, so only the module-identity check can see it.
  const copy = join(dry, "source");
  const imports = Object.fromEntries(Object.entries(JSON.parse(await Deno.readTextFile(join(copy, "deno.json"))).imports as Record<string, string>)
    .map(([k, v]) => [k, v.startsWith("./") ? `file://${join(copy, v)}` : v]));
  const scoped = join(scratch, "scoped.json");
  await Deno.writeTextFile(scoped, JSON.stringify({ imports, scopes: { [`file://${join(copy, "tools/construction-renewal.ts")}`]: { "@bl/sim-ref": `file://${join(repo, "packages/sim-ref/src/index.ts")}` } } }));
  const scopedRun = await run([`--config=${scoped}`, "--no-lock", join(copy, "tools/construction-renewal.ts"), "status", "--root", dry], { BL_RENEWAL_FROZEN_LAUNCH: frozen.sourceDigest });
  check("an entrypoint-scoped remap of a package is refused by module identity", !scopedRun.ok && /is not the one exported by the frozen/.test(scopedRun.stderr), scopedRun.stderr.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 400));
  // A fabricated confirmation panel (no pilot readout, wrong habitat) is refused by the runner and failed by the audit.
  await Deno.mkdir(join(dry, "confirmation"));
  const fake = { manifestSha256: frozen.manifestSha256, pilotReadoutSha256: "0", habitat: { reservoir: 16, spread: 2 }, cases: manifest.cases.slice(16, 20), stepsExecuted: 0 };
  await Deno.writeTextFile(join(dry, "confirmation", "freeze.json"), JSON.stringify(fake));
  await Deno.writeTextFile(join(dry, "confirmation", "FROZEN.json"), JSON.stringify({ freezeSha256: await sha256Hex(await Deno.readFile(join(dry, "confirmation", "freeze.json"))) }));
  const fakeStatus = await run(["tools/construction-renewal.ts", "status", "--root", dry]);
  check("the runner refuses a confirmation panel not bound to a verified pilot readout", !fakeStatus.ok && /pilot-readout\.json|pilot readout/.test(fakeStatus.stderr), fakeStatus.stderr.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 400));
  const fakeFinal = await run(["tools/construction-renewal-verify.ts", "final", "--root", dry]);
  check("the audit fails a confirmation panel the protocol did not prescribe", !fakeFinal.ok && /"panelIssues"/.test(fakeFinal.stdout) && /no passing pilot audit pinned by the freeze selected a habitat/.test(fakeFinal.stdout), fakeFinal.stdout.slice(-400));
  await Deno.remove(join(dry, "confirmation"), { recursive: true });
  const again = await run(["tools/construction-renewal.ts", "freeze", "--out", dry]);
  check("a second freeze into the same root is refused", !again.ok);
  await Deno.writeTextFile(join(dry, "source", "tools/lib/construction-renewal-readout.ts"), "\n// edited after freeze\n", { append: true });
  const tampered = await run(["tools/construction-renewal.ts", "status", "--root", dry]);
  check("an edited frozen source is refused", !tampered.ok && /frozen source .* changed/.test(tampered.stderr), tampered.stderr.slice(-300));
  const tamperedDirect = await run([join(dry, "source", "tools/construction-renewal.ts"), "status", "--root", dry]);
  check("an edited frozen source is refused on a direct run of the copy too", !tamperedDirect.ok && /frozen source .* changed/.test(tamperedDirect.stderr), tamperedDirect.stderr.slice(-300));
}

await Deno.remove(scratch, { recursive: true });
console.log(failures ? `${failures} FAILED` : "all passed");
if (failures) Deno.exit(1);
