// Pond keeper v0: a real lab session file replays to the lab's own final state (docs/pond-keeper-v0-2026-10-17.md, "The session file").
// The file is a superset of the lab run manifest, so tools/run.ts --picks-from <file> replays it as it replays a lab manifest, and the
// runner's existing comparison with the file's `checkpoints` entry (one, for the final state) is the proof. The checks:
//
//  1. the file is a cadence-garden.session, version 1, with a final state, one checkpoint equal to it, and a replay command that names
//     this preset, seed, step count and --picks-from;
//  2. tools/run.ts, run with the flags the file gives (preset, seed, --steps final.step, the lab's census and deep cadence, --picks-from
//     the file), exits 0 and prints "matches the lab's checkpoint at t=<final.step>" (and no note that nothing was compared);
//  3. a copy with final.stateHash and checkpoints[0].hash both changed (so the file still agrees with itself and only the replay can
//     disagree) exits 4 with "not the lab's history".
//
// The input is a session file the lab exported: argv[0], default tests/e2e/fixtures/pond-keeper-session.json (written by
// tests/e2e/lab-pond-keeper.spec.ts with BL_WRITE_FIXTURE=1). Native WebGPU is needed for the two replays.
//
// Run from the repo root: deno run -A tests/deno/pond_keeper_replay.ts [session-file]
import { sessionFileError } from "../../apps/lab/src/session-file.ts";

const repo = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const runTool = `${repo}/tools/run.ts`;
const source = Deno.args[0] ?? `${repo}/tests/e2e/fixtures/pond-keeper-session.json`;

let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail}` : ""}`);
  ok &&= cond;
};

let text: string;
try {
  text = await Deno.readTextFile(source);
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
  console.error(`FAIL no session file at ${source}\nrun tests/e2e/lab-pond-keeper.spec.ts with BL_WRITE_FIXTURE=1 first (it keeps a real lab export as tests/e2e/fixtures/pond-keeper-session.json), or pass a session file as the argument`);
  Deno.exit(1);
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
let file: Json;
try {
  const parsed = JSON.parse(text);
  if (!isObject(parsed)) throw new Error("not a JSON object");
  file = parsed;
} catch (e) {
  console.error(`FAIL ${source} is not a JSON object: ${(e as Error).message}`);
  Deno.exit(1);
}

// --- 1. the file itself
const final = isObject(file.final) ? file.final : {};
const settings = isObject(file.settings) ? file.settings : {};
const checkpoints = Array.isArray(file.checkpoints) ? file.checkpoints : [];
const ck = isObject(checkpoints[0]) ? checkpoints[0] : {};
const step = final.step;
const stateHash = final.stateHash;
check("1. format cadence-garden.session, version 1", file.format === "cadence-garden.session" && file.version === 1, `${JSON.stringify(file.format)} ${JSON.stringify(file.version)}`);
const fields = typeof file.presetId === "string" && Number.isInteger(file.seed) && Number.isInteger(step) && (step as number) > 0 && typeof stateHash === "string" && stateHash !== "" &&
  Number.isInteger(settings.censusEvery) && Number.isInteger(settings.deepEvery);
check("1. ...with presetId, seed, final.step, final.stateHash and settings.censusEvery / deepEvery", fields, JSON.stringify({ presetId: file.presetId, seed: file.seed, final, settings }));
check("1. ...exactly one checkpoint, equal to the final state (step, hash)", checkpoints.length === 1 && ck.step === step && ck.hash === stateHash, JSON.stringify(checkpoints));
const replay = typeof file.replay === "string" ? file.replay : "";
check("1. ...whose own replay command names the preset, seed, step count and --picks-from", fields && replay.includes("tools/run.ts") && replay.includes(`--preset ${file.presetId}`) && replay.includes(`--seeds ${file.seed}`) && replay.includes(`--steps ${step}`) && replay.includes("--picks-from"), replay);
const own = sessionFileError(file);
check("1. ...and the lab's own validator (sessionFileError) accepts it", own === null, own ?? "");
if (!ok) {
  console.log("\nFAILURES");
  Deno.exit(1);
}

const tmp = await Deno.makeTempDir({ prefix: "pond-keeper-replay-" });
try {
  /** tools/run.ts on a session file, with the flags the file gives, into a fresh output directory. */
  const replayOf = async (sessionFile: string, name: string) => {
    const o = await new Deno.Command(Deno.execPath(), {
      args: [
        "run", "-A", runTool,
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
  check("2. tools/run.ts replays the session file: exit 0", good.code === 0, `exit ${good.code}: ${tail(good)}`);
  check(`2. ...and prints "${matches}" with the final state hash`, good.out.includes(`${matches} (stateHash ${stateHash})`), tail(good));
  check("2. ...with no note that nothing was compared against the lab", !/^note: no lab checkpoint/m.test(good.out + good.err), tail(good));

  // --- 3. a tampered copy
  const flip = (h: string) => (h.startsWith("0") ? "1" : "0") + h.slice(1);
  const tampered = {
    ...file,
    final: { ...final, stateHash: flip(stateHash as string) },
    checkpoints: [{ ...ck, hash: flip(stateHash as string) }],
  };
  const tamperedFile = `${tmp}/tampered.session.json`;
  await Deno.writeTextFile(tamperedFile, JSON.stringify(tampered, null, 2));
  const bad = await replayOf(tamperedFile, "tampered");
  check("3. a copy with final.stateHash and checkpoints[0].hash changed: exit 4", bad.code === 4, `exit ${bad.code}: ${tail(bad)}`);
  check("3. ...saying it is not the lab's history, with both hashes", bad.err.includes("not the lab's history") && bad.err.includes(stateHash as string) && bad.err.includes(flip(stateHash as string)), tail(bad));
} finally {
  await Deno.remove(tmp, { recursive: true }).catch(() => {});
}
console.log(ok ? "\nALL PASS" : "\nFAILURES");
if (!ok) Deno.exit(1);
