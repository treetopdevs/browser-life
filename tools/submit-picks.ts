// Submits a picked breeder run to a coordinator, to be run on islands from a fixed, content-addressed pick log
// (docs/archipelago-breed-2026-10-18.md, amendment 2026-11-02).
//
//   deno run -A tools/submit-picks.ts --picks-from FILE --experiment NAME --steps N --segment-steps M
//     [--coordinator http://localhost:4000] [--token T] [--preset breeder] [--condition treatment] [--seed 1]
//     [--census 100] [--deep 10] [--verify-fraction 1] [--implicit] [--dry-run]
//
// FILE is what the lab exports from a breeder world's hand picks: a lab run manifest (`<runId>.run.json` from lab storage), a
// session file (`*.session.json`, the pond keeper's download) or a picks.jsonl. It is read by the same loader as tools/run.ts
// --picks-from (tools/lib/pick-record.ts). A manifest or session is sparse (a boundary the person left alone takes the arm's rule
// donors), so it is submitted with pickImplicit; a picks.jsonl is strict unless --implicit. Refused with exit 2, before any
// request: a lab history that also holds lesions, feeds, suns or pressures (named in the message), a world that is not the
// run's (preset, seed, config, rule version or start world), a record the run cannot take (picksPreflightError), and a preset or
// condition whose arm does not choose donors. The pick log is stored on the coordinator by its SHA-256 (PUT /api/pick-logs/:sha,
// admin), and the experiment (POST /api/experiments) names it by that digest; islands that advertise `picks-v1` fetch it. Prints
// the run id and the digest. --dry-run prints them without a request. Administrative: --token or BL_ADMIN_TOKEN, as tools/stitch.ts;
// without one only a loopback coordinator that allows local administration (the dev default, bin/dev) answers.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { canonicalPickLog, pickLogDigest, pickedConfigError, picksPreflightError, specConfig, validateSpec, type RunSpec } from "@bl/runner";
import { loadPickRecord, submitRefusal } from "./lib/pick-record.ts";

const a = parseArgs(Deno.args, {
  string: ["picks-from", "experiment", "coordinator", "token", "preset", "condition", "seed", "steps", "segment-steps", "census", "deep", "verify-fraction"],
  boolean: ["implicit", "dry-run"],
  default: { coordinator: "http://localhost:4000", preset: "breeder", condition: "treatment", seed: "1", census: "100", deep: "10", "verify-fraction": "1" },
});
const die = (msg: string): never => {
  console.error(msg);
  Deno.exit(2);
};
if (!a["picks-from"] || !a.experiment || !a.steps || !a["segment-steps"])
  die("usage: submit-picks.ts --picks-from FILE --experiment NAME --steps N --segment-steps M [--coordinator URL] [--token T] [--preset breeder] [--condition treatment] [--seed 1] [--census 100] [--deep 10] [--verify-fraction 1] [--implicit] [--dry-run]");
const int = (name: string, v: string): number => (/^\d+$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : die(`--${name} must be a non-negative integer`));
const steps = int("steps", a.steps!), segmentSteps = int("segment-steps", a["segment-steps"]!), seed = int("seed", a.seed), census = int("census", a.census), deep = int("deep", a.deep);
const verifyFraction = Number(a["verify-fraction"]);
if (!(verifyFraction >= 0 && verifyFraction <= 1)) die("--verify-fraction must be in 0..1");
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(a.experiment!)) die("--experiment must match [a-z0-9][a-z0-9_-]{0,63}");

const spec: RunSpec = { experiment: a.experiment!, presetId: a.preset, condition: a.condition, seed, steps, censusEvery: census, deepEvery: deep, checkpointEvery: 0 };
const bad = validateSpec(spec);
if (bad.length) die(`invalid run spec: ${bad.join("; ")}`);

let text: string;
try {
  text = await Deno.readTextFile(a["picks-from"]!);
} catch (e) {
  die(`--picks-from ${a["picks-from"]}: ${(e as Error).message}`);
}
const { record, lab } = loadPickRecord(text!, { file: a["picks-from"]!, spec, scheduledCount: 0, founderOption: false, die, note: (m) => console.error(m) });
const refusal = submitRefusal(lab, text!);
if (refusal) die(refusal);
const cfg = specConfig(spec);
const pickedSpec: RunSpec = { ...spec, picked: true };
const implicit = record.implicit || a.implicit;
const log = canonicalPickLog(record.entries);
const wrong = pickedConfigError(pickedSpec, cfg) ?? picksPreflightError(record.entries, cfg, 0, steps, true);
if (wrong) die(`${a["picks-from"]}: ${wrong}`);
if (!implicit) {
  const want = Math.floor(steps / cfg.pondPeriod!);
  if (record.entries.length !== want) die(`${a["picks-from"]}: a strict pick log needs an entry at every pond boundary (${want} in ${steps} steps), this one has ${record.entries.length}; pass --implicit to let the arm's rule answer the rest`);
}
const digest = pickLogDigest(log);
const run = `${a.experiment}/${a.preset}/${a.condition}/seed-${seed}`;
console.log(`pick log ${digest}: ${record.entries.length} picks${implicit ? " (sparse: unlisted boundaries take the arm's rule donors)" : ""}`);
if (a["dry-run"]) {
  console.log(`dry run: would submit ${run}, ${steps} steps in segments of ${segmentSteps}`);
  Deno.exit(0);
}

const base = a.coordinator.replace(/\/$/, "");
const token = a.token ?? Deno.env.get("BL_ADMIN_TOKEN");
const headers = (type: string): Record<string, string> => ({ "content-type": type, ...(token ? { authorization: `Bearer ${token}` } : {}) });
async function send(method: string, path: string, type: string, body: string): Promise<unknown> {
  const r = await fetch(`${base}${path}`, { method, headers: headers(type), body });
  const reply = await r.text();
  if (!r.ok) die(`${method} ${path}: ${r.status} ${reply}`);
  try {
    return JSON.parse(reply);
  } catch {
    return reply;
  }
}
await send("PUT", `/api/pick-logs/${digest}`, "application/octet-stream", log);
const made = (await send("POST", "/api/experiments", "application/json", JSON.stringify({
  experiment: a.experiment,
  presetId: a.preset,
  conditions: [a.condition],
  seeds: [seed],
  steps,
  segmentSteps,
  censusEvery: census,
  deepEvery: deep,
  verifyFraction,
  pickLog: digest,
  ...(implicit ? { pickImplicit: true } : {}),
}))) as { segments: number };
console.log(`submitted ${run}: ${made.segments} segments, pickLog ${digest}${implicit ? ", pickImplicit" : ""}`);
console.log(`islands: deno run -A tools/island.ts --coordinator ${base}   (two of them, so every segment is verified)`);
console.log(`export:  deno run -A tools/stitch.ts --coordinator ${base} --experiment ${a.experiment} --out <dir>`);
