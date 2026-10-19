// Pond keeper: real lab session files replay to the lab's own final state (docs/pond-keeper-v0-2026-10-17.md,
// docs/pond-keeper-v1-2026-10-17.md and docs/pond-keeper-v2-2026-10-17.md, "The session file"). A session file is a superset of the lab run manifest, so
// tools/run.ts --picks-from <file> replays it as it replays a lab manifest, and the runner's existing comparison with the
// file's `checkpoints` entry (one, for the final state) is the proof. For each file the checks are:
//
//  1. the file is a cadence-garden.session of version 1 (rules firsts-v0), 2 (rules firsts-v1) or 3 (rules firsts-v2, and a
//     `families` block of rule set families-v1), with a final state, one
//     checkpoint equal to it, and a replay command that names this preset, seed, step count and --picks-from; the lab's own
//     validator (sessionFileError) accepts it. A version 2 file must hold a pressure and a pick, so the pressure path is replayed
//     and not vacuous, and a pond boundary at or before final.step with no pick while a pressure governs it, so the replay ranks
//     donors by the dial's score itself (the pressured rule path, not only logged picks); a version 3 file must name its family
//     tree, holds at least one wound (a lesion) and lists at least one family, and is held to nothing more about pressures (any it holds
//     are replayed with the rest, as are its wounds); a version 1 file holds no pressure;
//  2. tools/run.ts, run with the flags the file gives (preset, seed, --steps final.step, the lab's census and deep cadence,
//     --picks-from the file), exits 0 and prints "matches the lab's checkpoint at t=<final.step>" (and no note that nothing was
//     compared);
//  3. a copy with final.stateHash and checkpoints[0].hash both changed (so the file still agrees with itself and only the replay
//     can disagree) exits 4 with "not the lab's history".
//
// The inputs are session files the lab exported: argv paths (one or more, replacing the defaults), else the frozen fixtures,
// tests/e2e/fixtures/pond-keeper-session.json (version 1, written once by the v0 spec; it is never rewritten),
// tests/e2e/fixtures/pond-keeper-session-v2.json (version 2, written by tests/e2e/lab-pond-keeper-v1.spec.ts with
// BL_WRITE_FIXTURE=1) and, when it has been written, tests/e2e/fixtures/pond-keeper-session-v3.json (version 3, by
// tests/e2e/lab-pond-keeper-v2.spec.ts with BL_WRITE_FIXTURE=1; a default that is absent is skipped, a path given is not).
// Native WebGPU is needed: two replays per file. The version 2 and 3 replays are 20,000+ steps of a 256x256 pond world, so they
// take a while on a loaded machine.
//
// Run from the repo root: deno run -A tests/deno/pond_keeper_replay.ts [session-file ...]
import { sessionFileError } from "../../apps/lab/src/session-file.ts";

const repo = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const runTool = `${repo}/tools/run.ts`;
const defaults: Record<string, string> = {
  [`${repo}/tests/e2e/fixtures/pond-keeper-session.json`]: "tests/e2e/lab-pond-keeper.spec.ts (already kept: the version 1 fixture is frozen)",
  [`${repo}/tests/e2e/fixtures/pond-keeper-session-v2.json`]: "tests/e2e/lab-pond-keeper-v1.spec.ts with BL_WRITE_FIXTURE=1",
  [`${repo}/tests/e2e/fixtures/pond-keeper-session-v3.json`]: "tests/e2e/lab-pond-keeper-v2.spec.ts with BL_WRITE_FIXTURE=1",
};
// The version 3 fixture is added by a later slice of work: until it exists the default run covers the two that do.
const present = async (path: string) => !!(await Deno.stat(path).catch(() => null));
const sources = Deno.args.length > 0 ? Deno.args : (await Promise.all(Object.keys(defaults).map(async (k) => ((await present(k)) || !k.endsWith("-v3.json") ? k : null)))).filter((k): k is string => k !== null);

let ok = true;
const check = (label: string, name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} [${label}] ${name}${detail && !cond ? `: ${detail}` : ""}`);
  ok &&= cond;
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const flip = (h: string) => (h.startsWith("0") ? "1" : "0") + h.slice(1);

async function checkFile(source: string): Promise<void> {
  const label = source.split("/").pop() ?? source;
  let text: string;
  try {
    text = await Deno.readTextFile(source);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
    const how = defaults[source] ? `write it with ${defaults[source]}, or pass` : "pass";
    console.error(`FAIL no session file at ${source}\n${how} a session file as the argument`);
    Deno.exit(1);
  }
  let file: Json;
  try {
    const parsed = JSON.parse(text);
    if (!isObject(parsed)) throw new Error("not a JSON object");
    file = parsed;
  } catch (e) {
    console.error(`FAIL ${source} is not a JSON object: ${(e as Error).message}`);
    Deno.exit(1);
  }
  console.log(`\n== ${label}`);

  // --- 1. the file itself
  const final = isObject(file.final) ? file.final : {};
  const settings = isObject(file.settings) ? file.settings : {};
  const checkpoints = Array.isArray(file.checkpoints) ? file.checkpoints : [];
  const ck = isObject(checkpoints[0]) ? checkpoints[0] : {};
  const firsts = isObject(file.firsts) ? file.firsts : {};
  const interventions = Array.isArray(file.interventions) ? file.interventions : [];
  const kinds = (k: string) => interventions.filter((iv) => isObject(iv) && iv.kind === k).length;
  const step = final.step;
  const stateHash = final.stateHash;
  const version = file.version;
  check(label, "1. format cadence-garden.session, version 1, 2 or 3", file.format === "cadence-garden.session" && (version === 1 || version === 2 || version === 3), `${JSON.stringify(file.format)} ${JSON.stringify(version)}`);
  const ruleSets: Record<number, string> = { 1: "firsts-v0", 2: "firsts-v1", 3: "firsts-v2" };
  check(label, "1. ...whose firsts rule set goes with the version (1: firsts-v0, 2: firsts-v1, 3: firsts-v2)", firsts.rules === ruleSets[version as number], `version ${JSON.stringify(version)}, rules ${JSON.stringify(firsts.rules)}`);
  if (version === 3) {
    const families = isObject(file.families) ? file.families : {};
    check(label, "1. ...a version 3 file names its family tree (families-v1, a list of families and a list of events)", families.rules === "families-v1" && Array.isArray(families.families) && Array.isArray(families.events), JSON.stringify(families.rules));
    check(label, "1. ...lists at least one family, and holds at least one wound (a lesion), so the replay re-applies a wound", Array.isArray(families.families) && families.families.length >= 1 && kinds("lesion") >= 1, `families ${Array.isArray(families.families) ? families.families.length : "?"}, lesions ${kinds("lesion")}`);
  } else check(label, "1. ...a version 1 or 2 file has no families block", file.families === undefined);
  const fields = typeof file.presetId === "string" && Number.isInteger(file.seed) && Number.isInteger(step) && (step as number) > 0 && typeof stateHash === "string" && stateHash !== "" &&
    Number.isInteger(settings.censusEvery) && Number.isInteger(settings.deepEvery);
  check(label, "1. ...with presetId, seed, final.step, final.stateHash and settings.censusEvery / deepEvery", fields, JSON.stringify({ presetId: file.presetId, seed: file.seed, final, settings }));
  check(label, "1. ...exactly one checkpoint, equal to the final state (step, hash)", checkpoints.length === 1 && ck.step === step && ck.hash === stateHash, JSON.stringify(checkpoints));
  const replay = typeof file.replay === "string" ? file.replay : "";
  check(label, "1. ...whose own replay command names the preset, seed, step count and --picks-from", fields && replay.includes("tools/run.ts") && replay.includes(`--preset ${file.presetId}`) && replay.includes(`--seeds ${file.seed}`) && replay.includes(`--steps ${step}`) && replay.includes("--picks-from"), replay);
  if (version === 2) {
    check(label, "1. ...a version 2 file holds a pressure and a pick, so the replay exercises the pressure path", kinds("pressure") >= 1 && kinds("pick") >= 1, `pressures ${kinds("pressure")}, picks ${kinds("pick")}`);
    // A boundary b * period <= final.step with no pick at its step and a pressure for a cycle <= b: the rule chooses there, under the dial.
    const period = isObject(file.cfg) ? file.cfg.pondPeriod : undefined;
    const picked = new Set(interventions.filter((iv) => isObject(iv) && iv.kind === "pick").map((iv) => (iv as Json).step));
    const pressured = interventions.filter((iv) => isObject(iv) && iv.kind === "pressure").map((iv) => (iv as Json).cycle as number);
    const ruled: number[] = [];
    if (Number.isInteger(period) && (period as number) > 0 && Number.isInteger(step))
      for (let b = 1; b * (period as number) <= (step as number); b++) if (!picked.has(b * (period as number)) && pressured.some((c) => c <= b)) ruled.push(b);
    check(label, "1. ...and a pond boundary at or before final.step with no pick while a pressure governs it (the pressured rule path)", ruled.length >= 1, `pondPeriod ${JSON.stringify(period)}, pick steps ${[...picked].join(", ")}, pressure cycles ${pressured.join(", ")}`);
    if (ruled.length) console.log(`  rule-only cycles under a pressure: ${ruled.join(", ")}`);
  } else if (version === 1) check(label, "1. ...a version 1 file holds no pressure", kinds("pressure") === 0, `pressures ${kinds("pressure")}`);
  const own = sessionFileError(file);
  check(label, "1. ...and the lab's own validator (sessionFileError) accepts it", own === null, own ?? "");
  if (!ok) return;

  const tmp = await Deno.makeTempDir({ prefix: "pond-keeper-replay-" });
  try {
    /** tools/run.ts on a session file, with the flags the file gives, into a fresh output directory. */
    const replayOf = async (sessionFile: string, name: string) => {
      const o = await new Deno.Command(Deno.execPath(), {
        args: [
          "run", "--no-lock", "-A", runTool,
          "--experiment", "pond-keeper", "--preset", file.presetId as string, "--conditions", "treatment", "--seeds", String(file.seed),
          "--steps", String(step), "--census", String(settings.censusEvery), "--deep", String(settings.deepEvery),
          "--picks-from", sessionFile, "--out", `${tmp}/${name}`,
        ],
        cwd: repo, stdout: "piped", stderr: "piped",
      }).output();
      return { code: o.code, out: new TextDecoder().decode(o.stdout), err: new TextDecoder().decode(o.stderr) };
    };
    const tail = (r: { out: string; err: string }) => (r.err || r.out).slice(-400);

    // --- 2. the replay of the real export
    const good = await replayOf(source, "replay");
    const matches = `matches the lab's checkpoint at t=${step}`;
    check(label, "2. tools/run.ts replays the session file: exit 0", good.code === 0, `exit ${good.code}: ${tail(good)}`);
    check(label, `2. ...and prints "${matches}" with the final state hash`, good.out.includes(`${matches} (stateHash ${stateHash})`), tail(good));
    check(label, "2. ...with no note that nothing was compared against the lab", !/^note: no lab checkpoint/m.test(good.out + good.err), tail(good));

    // --- 3. a tampered copy
    const tampered = {
      ...file,
      final: { ...final, stateHash: flip(stateHash as string) },
      checkpoints: [{ ...ck, hash: flip(stateHash as string) }],
    };
    const tamperedFile = `${tmp}/tampered.session.json`;
    await Deno.writeTextFile(tamperedFile, JSON.stringify(tampered, null, 2));
    const bad = await replayOf(tamperedFile, "tampered");
    check(label, "3. a copy with final.stateHash and checkpoints[0].hash changed: exit 4", bad.code === 4, `exit ${bad.code}: ${tail(bad)}`);
    check(label, "3. ...saying it is not the lab's history, with both hashes", bad.err.includes("not the lab's history") && bad.err.includes(stateHash as string) && bad.err.includes(flip(stateHash as string)), tail(bad));
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

for (const source of sources) {
  await checkFile(source);
  if (!ok) break;
}
console.log(ok ? "\nALL PASS" : "\nFAILURES");
if (!ok) Deno.exit(1);
