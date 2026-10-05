// The renewal-observer adapter (PLAN step 4, decision D5: pinned execution).
//
//   deno run -A tests/deno/discovery_renewal.ts
//
// Freezes a small pinned campaign in a scratch root and runs it through the
// shard path with two host labels (primary and cross-host replay), then
// checks: the pin in the manifest and closure; a passive deposit that must
// not read as renewal; a stationary positive control; a rotating active site
// and a missing census through the adapter's readout; a missing census in a
// delivered result; saturated role counters refused at freeze; an unavailable
// observer refused at freeze; the plane refusing a pinned campaign.
import { join } from "node:path";
import { b64, pinCall, PIN_DIR, verifyPin } from "../../tools/lib/discovery-pin.ts";
import { closureFiles } from "../../tools/lib/discovery-closure.ts";

const REPO = new URL("../../", import.meta.url).pathname;
let failures = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
async function cli(args: string[]) {
  const out = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", "tools/discovery.ts", ...args], cwd: REPO, stdout: "piped", stderr: "piped" }).output();
  return { ok: out.success, out: strip(new TextDecoder().decode(out.stdout)), err: strip(new TextDecoder().decode(out.stderr)) };
}

const witness = JSON.parse(await Deno.readTextFile(join(REPO, PIN_DIR, "experiments/construction/witness-v1.json")));
const { seed: _seed, ...witnessCfg } = witness.cfg;
const scratch = await Deno.makeTempDir({ prefix: "discovery-renewal-" });

function protocol(over: Record<string, unknown> = {}, fixtures?: unknown[]) {
  return {
    schemaVersion: "discovery-v1",
    campaign: "renewal-adapter-test",
    purpose: "engineering",
    question: "Does the pinned renewal observer run, validate and read out through the workbench?",
    seedNamespace: { name: "discovery-engineering", first: 8500001, last: 8500999 },
    blocks: [{ id: "b1", seed: 8500101 }],
    fixtures: fixtures ?? [
      {
        id: "passive", candidateId: "witness", habitatId: "a4-s1", founderId: "none", assayId: "renewal-null", armId: "passive",
        config: { ...witnessCfg, spread: 1 },
        initial: { kind: "deposits", nutrient: 4, deposits: [{ x: 16, y: 16, B: 1024, P: 0, E: 2048 }] },
        steps: 10000, censusEvery: 100, segmentAt: [], sites: [{ x: 16, y: 16 }],
      },
      {
        id: "stationary", candidateId: "witness", habitatId: "a16-s0", founderId: "builder", assayId: "renewal-positive", armId: "builder",
        config: { ...witnessCfg, spread: 0 },
        initial: { kind: "cells", nutrient: 16, founders: [{ x: 16, y: 16, genomeHex: witness.genomeHex, biomass: 128, energy: 256 }] },
        steps: 10000, censusEvery: 100, segmentAt: [], sites: [{ x: 16, y: 16 }],
      },
    ],
    observerVersion: "renewal-observer-v1.pin-24cef9e2",
    readoutVersion: "renewal-readout-v1.pin-24cef9e2",
    resourceLimits: { concurrentCasesPerHost: 2, caseWallSeconds: 300, campaignWallSeconds: 3600, campaignBytes: 200_000_000, attemptsPerCasePerRole: 3 },
    verificationPolicy: { replay: "every-case-cross-host" },
    stoppingRule: "engineering check: all cases once, primary and cross-host replay",
    ...over,
  };
}
async function freeze(name: string, p: unknown) {
  const path = join(scratch, `${name}.json`);
  await Deno.writeTextFile(path, JSON.stringify(p));
  return cli(["freeze", "--protocol", path, "--out", join(scratch, name)]);
}

// The pin is part of every build's source closure.
const files = closureFiles(REPO);
check("the source closure contains the vendored pin and its scripts", files.includes(`${PIN_DIR}/PIN.json`) && files.includes(`${PIN_DIR}/tools/lib/construction-renewal-observer.ts`) && files.includes("tools/discovery-pin-case.ts"));

// Freeze refusals.
const unavailable = await freeze("unavailable", protocol({ observerVersion: "renewal-observer-v9" }));
check("freeze refuses an observer this build does not have", !unavailable.ok && /not available in this build/.test(unavailable.err), unavailable.err.slice(-300));
const saturated = await freeze("saturated", protocol({}, [{ ...protocol().fixtures[0], initial: { kind: "deposits", nutrient: 2000, deposits: [{ x: 16, y: 16, B: 1024, P: 0, E: 2048 }] } }]));
check("freeze refuses a world whose role counters could saturate (unsupported measurement)", !saturated.ok && /unsupported measurement: per-cell role counters could saturate/.test(saturated.err), saturated.err.slice(-300));

// Case shapes the pinned readout cannot measure are refused at freeze, before a root exists.
const main1 = (over: Record<string, unknown>) => ({ ...protocol().fixtures[1], id: "m", assayId: "renewal-main", ...over });
const twoFounders = await freeze("two", protocol({}, [main1({ initial: { kind: "cells", nutrient: 16, founders: [{ x: 16, y: 16, genomeHex: witness.genomeHex, biomass: 1024, energy: 2048 }, { x: 4, y: 4, genomeHex: witness.genomeHex, biomass: 1024, energy: 2048 }] } })]));
check("renewal-main with a second seeded founder is refused (a seeded site can never count as renewal)", !twoFounders.ok && /exactly one initialized cell/.test(twoFounders.err), twoFounders.err.slice(-300));
const emptyControl = await freeze("ctl", protocol({}, [main1({ assayId: "renewal-control", steps: 3000, sites: [] })]));
check("a control with no sites is refused (no vacuous positive)", !emptyControl.ok && /at least one site/.test(emptyControl.err), emptyControl.err.slice(-300));
const shortMain = await freeze("short", protocol({}, [main1({ steps: 3000 })]));
check("an assay horizon the readout cannot use is refused", !shortMain.ok && /runs 10000 steps, not 3000/.test(shortMain.err), shortMain.err.slice(-300));
const segmented = await freeze("seg", protocol({}, [main1({ segmentAt: [5000] })]));
check("segmentation is refused for pinned cases", !segmented.ok && /not segmented/.test(segmented.err), segmented.err.slice(-300));
const ablation = await freeze("abl", protocol({}, [main1({ config: { ...witnessCfg, spread: 1, polymerTransport: false } })]));
check("the cost-retaining ablation (polymerTransport false) freezes on a pinned campaign", ablation.ok, ablation.err.slice(-300));
const unpinnedAbl = await freeze("abl-unpinned", protocol({ observerVersion: "exact-ledger-v1", readoutVersion: "engineering-readout-v1" }, [main1({ assayId: "passive-transport", config: { ...witnessCfg, spread: 1, polymerTransport: false } })]));
check("polymerTransport is refused on an unpinned campaign (this build would ignore it)", !unpinnedAbl.ok && /polymerTransport/.test(unpinnedAbl.err), unpinnedAbl.err.slice(-300));

// A vendored tree whose code and PIN.json were changed together is not the pin.
const fake = join(scratch, "fake-repo");
await Deno.mkdir(join(fake, "vendor"), { recursive: true });
await new Deno.Command("cp", { args: ["-R", join(REPO, PIN_DIR), join(fake, "vendor")] }).output();
const obsPath = join(fake, PIN_DIR, "tools/lib/construction-renewal-observer.ts");
await Deno.writeTextFile(obsPath, (await Deno.readTextFile(obsPath)) + "\n// replaced\n");
const pinJson = JSON.parse(await Deno.readTextFile(join(fake, PIN_DIR, "PIN.json")));
const sha = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource)), (x) => x.toString(16).padStart(2, "0")).join("");
pinJson.files["tools/lib/construction-renewal-observer.ts"] = await sha(await Deno.readFile(obsPath));
pinJson.sourceDigest = await sha(new TextEncoder().encode(JSON.stringify(Object.keys(pinJson.files).sort().map((p) => [p, pinJson.files[p]]))));
await Deno.writeTextFile(join(fake, PIN_DIR, "PIN.json"), JSON.stringify(pinJson));
let pinRefused = "";
try {
  verifyPin(fake);
} catch (e) {
  pinRefused = (e as Error).message;
}
check("a self-consistent replacement of the vendored code is not accepted as the pin", /does not describe the pin this build accepts/.test(pinRefused), pinRefused);

// A real pinned campaign through the shard path on two host labels.
const fr = await freeze("camp", protocol());
check("a pinned campaign freezes, zero steps", fr.ok && /zero simulation steps executed/.test(fr.out), fr.err.slice(-500));
const root = join(scratch, "camp");
const manifest = JSON.parse(await Deno.readTextFile(join(root, "manifest.json")));
check("the manifest records the pin and the pin's physics versions", manifest.pin?.sourceDigest === "24cef9e2f79abaad6d9260e63585c30c1b0a3516d38e669321235ccd3d0e6362" && manifest.physicsVersions.ruleVersion === 2);
const caseIds: string[] = manifest.orderedCaseIds;
const spec0 = JSON.parse(await Deno.readTextFile(join(root, "cases", caseIds[0], "case.json")));
check("cases require the pinned backend", spec0.requiredBackendContract === "cpu-ref-renewal-pin-v1");
check("the founder panel records the cells recipe's genome", manifest.encodedFounderPanel.some((x: { founderId: string; genomeHex: string[] }) => x.founderId === "builder" && x.genomeHex.includes(witness.genomeHex)));
const run = await cli(["run", "--root", root, "--host", "host-a"]);
check("primaries run under the pin", run.ok && /primary: 2 completed, 0 failed/.test(run.out), run.out.slice(-400) + run.err.slice(-400));
const rep = await cli(["replay", "--root", root, "--host", "host-b"]);
check("replays from another host label run under the pin", rep.ok && /replay: 2 completed, 0 failed/.test(rep.out), rep.out.slice(-400) + rep.err.slice(-400));
const val = await cli(["validate", "--root", root]);
check("both cases accepted: valid, agreeing canonical results on two hosts", val.ok && /2 accepted/.test(val.out), val.out + val.err.slice(-300));
const red = await cli(["reduce", "--root", root]);
const report = red.ok ? JSON.parse(await Deno.readTextFile(join(root, "report.json"))) : null;
const fx = (id: string) => report?.fixtures.find((f: { fixtureId: string }) => f.fixtureId === id);
check("a passive deposit does not read as renewal or maintenance (null expectation met)", fx("passive")?.status === "supported" && fx("passive")?.met === 1, report?.fixtures ?? red.err);
check("the stationary positive control is maintained (expectation met)", fx("stationary")?.status === "supported" && fx("stationary")?.met === 1, report?.fixtures);

// A delivered result with one census removed (digests re-forged so only content checks can catch it).
const att = join(root, "cases", caseIds[1], "attempts", "host-a.primary.1");
const forged = join(scratch, "forged");
await Deno.mkdir(forged);
for (const f of ["result.json", "readout.json", "end.blck", "observations.jsonl"]) await Deno.copyFile(join(att, f), join(forged, f));
const lines = (await Deno.readTextFile(join(forged, "observations.jsonl"))).trimEnd().split("\n");
lines.splice(50, 1);
const obsText = lines.join("\n") + "\n";
await Deno.writeTextFile(join(forged, "observations.jsonl"), obsText);
const res = JSON.parse(await Deno.readTextFile(join(forged, "result.json")));
const hex = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource)), (x) => x.toString(16).padStart(2, "0")).join("");
const obsBytes = new TextEncoder().encode(obsText);
res.execution.files["observations.jsonl"] = res.canonical.canonicalObservationDigests.observations = await hex(obsBytes);
res.execution.artifactSizes["observations.jsonl"] = obsBytes.byteLength;
await Deno.writeTextFile(join(forged, "result.json"), JSON.stringify(res));
const spec1 = JSON.parse(await Deno.readTextFile(join(root, "cases", caseIds[1], "case.json")));
const ca = await cli(["check-attempt", "--manifest", join(root, "manifest.json"), "--case", join(root, "cases", caseIds[1], "case.json"), "--attempt", forged, "--initial", join(root, "initial", `${spec1.initialArtifactDigest}.blck`)]);
const verdict = ca.ok ? JSON.parse(ca.out.trim().split("\n").at(-1)!) : null;
check("a result missing one census is invalid", verdict?.valid === false && verdict.errors.some((e: string) => /census/.test(e)), verdict ?? ca.err.slice(-300));

// An interior census with fields removed, re-serialized canonically and re-digested.
{
  const all = (await Deno.readTextFile(join(att, "observations.jsonl"))).trimEnd().split("\n");
  const rec = JSON.parse(all[40]);
  for (const k of ["kind", "stateHash", "lastStepRolesDigest", "mutations"]) delete rec[k];
  const keys = (o: unknown): unknown => Array.isArray(o) ? o.map(keys) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, keys((o as Record<string, unknown>)[k])])) : o;
  all[40] = JSON.stringify(keys(rec));
  const text = all.join("\n") + "\n";
  await Deno.writeTextFile(join(forged, "observations.jsonl"), text);
  const r2 = JSON.parse(await Deno.readTextFile(join(att, "result.json")));
  const bytes = new TextEncoder().encode(text);
  r2.execution.files["observations.jsonl"] = r2.canonical.canonicalObservationDigests.observations = await hex(bytes);
  r2.execution.artifactSizes["observations.jsonl"] = bytes.byteLength;
  await Deno.writeTextFile(join(forged, "result.json"), JSON.stringify(r2));
  const ca2 = await cli(["check-attempt", "--manifest", join(root, "manifest.json"), "--case", join(root, "cases", caseIds[1], "case.json"), "--attempt", forged, "--initial", join(root, "initial", `${spec1.initialArtifactDigest}.blck`)]);
  const v2 = ca2.ok ? JSON.parse(ca2.out.trim().split("\n").at(-1)!) : null;
  check("a census with fields removed (digests re-forged) is invalid", v2?.valid === false && v2.errors.some((e: string) => /incomplete record/.test(e)), v2 ?? ca2.err.slice(-300));
  // An interior census with an impossible mask counter (negative gross import), digests re-forged.
  const all3 = (await Deno.readTextFile(join(att, "observations.jsonl"))).trimEnd().split("\n");
  const rec3 = JSON.parse(all3[40]);
  const mk = Object.keys(rec3.masks)[0];
  rec3.masks[mk].A.grossIn = -1;
  rec3.masks[mk].A.netIn = -1 - rec3.masks[mk].A.grossOut;
  all3[40] = JSON.stringify(keys(rec3));
  const text3 = all3.join("\n") + "\n";
  await Deno.writeTextFile(join(forged, "observations.jsonl"), text3);
  const r3 = JSON.parse(await Deno.readTextFile(join(att, "result.json")));
  const bytes3 = new TextEncoder().encode(text3);
  r3.execution.files["observations.jsonl"] = r3.canonical.canonicalObservationDigests.observations = await hex(bytes3);
  r3.execution.artifactSizes["observations.jsonl"] = bytes3.byteLength;
  await Deno.writeTextFile(join(forged, "result.json"), JSON.stringify(r3));
  const ca3 = await cli(["check-attempt", "--manifest", join(root, "manifest.json"), "--case", join(root, "cases", caseIds[1], "case.json"), "--attempt", forged, "--initial", join(root, "initial", `${spec1.initialArtifactDigest}.blck`)]);
  const v3 = ca3.ok ? JSON.parse(ca3.out.trim().split("\n").at(-1)!) : null;
  check("an impossible mask counter in an interior census (digests re-forged) is invalid", v3?.valid === false && v3.errors.some((e: string) => /masks/.test(e)), v3 ?? ca3.err.slice(-300));
}

// The adapter's readout on synthetic records: a rotating active site and a missing census.
const n = 1024, zeros = () => new Array(n).fill(0);
function records(siteAt: (t: number) => number | null, drop?: number) {
  const out = [];
  let photo = zeros();
  for (let t = 0; t <= 10000; t += 100) {
    const B = zeros();
    const s = siteAt(t);
    if (s !== null) B[s] = 300;
    photo = photo.map((v, i) => v + (i === siteAt(t) ? 200 : 0));
    if (t !== drop) out.push({ step: t, cells: { B }, cumulative: { photo: [...photo], grow: zeros(), reactB: zeros(), boundBIn: zeros(), boundBOut: zeros() }, totals: { A: "4000", B: "300" }, flux: { build: "0" }, lightIn: "0", activeBArea: "0" });
  }
  return out;
}
const rotSpec = { ...spec0, assayId: "renewal-positive", fixtureId: "rotating" };
const rotating = await pinCall<{ status: string; met: boolean; details: { maintainedSites: number[] } }>(REPO, "readout", { spec: rotSpec, records: records((t) => 400 + ((t / 100) % 4)), initialA: "4096" });
check("a rotating active site (a different cell each census) is not a maintained site", rotating.status === "unsupported-within-tested-domain" && rotating.met === false && rotating.details.maintainedSites.length === 0, rotating);
const fixed = await pinCall<{ status: string; met: boolean }>(REPO, "readout", { spec: rotSpec, records: records(() => 401), initialA: "4096" });
check("the same synthetic history on one fixed cell is maintained (the readout can say yes)", fixed.status === "supported" && fixed.met === true, fixed);
const missing = await pinCall<{ status: string; met: boolean }>(REPO, "readout", { spec: rotSpec, records: records(() => 401, 9500), initialA: "4096" });
check("a missing census in the window makes the readout invalid-or-incomplete, never a negative", missing.status === "invalid-or-incomplete" && missing.met === false, missing);

// The plane serves cpu-ref-v1 only and says so before contacting anything.
const sub = await cli(["submit", "--root", root, "--coordinator", "http://127.0.0.1:9"]);
check("submit refuses a pinned campaign with the reason", !sub.ok && /serves cpu-ref-v1 campaigns only/.test(sub.err), sub.err.slice(-300));

// Imported evidence (DESIGN 7): validates against the construction root; one changed byte is caught.
// BL_RENEWAL_ROOT points at a renewal-v1 run root; the checks are skipped when it is unset or missing.
const RENEWAL_ROOT = Deno.env.get("BL_RENEWAL_ROOT") ?? "";
if (RENEWAL_ROOT && await Deno.stat(RENEWAL_ROOT).then(() => true, () => false)) {
  const clone = join(scratch, "renewal-clone");
  await new Deno.Command("cp", { args: ["-R", RENEWAL_ROOT, clone] }).output();
  const imp = join(scratch, "imported");
  const ir = await cli(["import-renewal", "--renewal-root", clone, "--out", imp]);
  const iv = await cli(["validate-import", "--root", imp, "--renewal-root", clone]);
  check("imported renewal evidence re-derives from its root, none counted as discovery-replayed", ir.ok && iv.ok && /none counted as discovery-replayed/.test(iv.out), ir.err + iv.err);
  const rec = JSON.parse(await Deno.readTextFile(join(imp, "imported.json")));
  check("every imported case is in the imported class with discoveryReplayed false", rec.cases.length === 40 && rec.cases.every((c: { class: string; coverage: { discoveryReplayed: boolean } }) => c.class === "imported-evidence" && c.coverage.discoveryReplayed === false));
  const census = join(clone, "cases", "pilot-matched-A16-s1", "attempt-1", "census.jsonl");
  const bytes = await Deno.readFile(census);
  await Deno.remove(census);
  bytes[bytes.length - 10] ^= 1;
  await Deno.writeFile(census, bytes);
  const bad = await cli(["validate-import", "--root", imp, "--renewal-root", clone]);
  check("one changed byte in an imported census invalidates the import", !bad.ok && /INVALID/.test(bad.err), bad.err.slice(-300));
  const clone2 = join(scratch, "renewal-clone-2");
  await new Deno.Command("cp", { args: ["-R", RENEWAL_ROOT, clone2] }).output();
  const proto = join(clone2, "source", "experiments/construction/renewal-v1/protocol.json");
  const ptext = await Deno.readTextFile(proto);
  await Deno.remove(proto);
  await Deno.writeTextFile(proto, ptext.replace('"V": 128', '"V": 64'));
  const badProto = await cli(["validate-import", "--root", imp, "--renewal-root", clone2]);
  check("an edited frozen protocol in the source root invalidates the import", !badProto.ok && /frozen source .* changed|frozen protocol/.test(badProto.err), badProto.err.slice(-300));
  check("the import binds the four designated CPU and GPU replay artifacts", rec.replayCoverage.artifacts.length === 4 && rec.replayCoverage.artifacts.every((a: { sha256: string }) => /^[0-9a-f]{64}$/.test(a.sha256)));
} else console.log("SKIP imported-evidence checks: BL_RENEWAL_ROOT is not set to a renewal-v1 run root");

void b64;
await Deno.remove(scratch, { recursive: true });
console.log(failures ? `${failures} FAILED` : "all passed");
if (failures) Deno.exit(1);
