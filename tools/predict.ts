// The prediction-envelope harness CLI (docs/prediction-envelope-2026-11-01/PLAN.md). Deno, native CPU only: no GPU, no model call,
// no network. Observer and tooling only; nothing here changes the dynamics.
//
//   deno run -A --no-lock tools/predict.ts protocol                       write the draft experiments/prediction-envelope/protocol.json (never overwrites)
//   deno run -A --no-lock tools/predict.ts run --stage dev --out DIR      dev families only: DIR/dev/qualification.json (raw effects, tallies, stability)
//   deno run -A --no-lock tools/predict.ts freeze --min-effect N [--out DIR]   set minEffect and devPrior from DIR/dev/qualification.json, write the freeze hash
//   deno run -A --no-lock tools/predict.ts run --stage confirm --out DIR  all families; refuses unless protocol.json and protocol.freeze.sha256 are COMMITTED (HEAD) and match; `--exploratory yes` (last) skips the commit gate and marks the output EXPLORATORY
//   deno run -A --no-lock tools/predict.ts run --stage smoke --protocol P --out DIR   a small protocol, no freeze check (output marked SMOKE in meta.json)
//   deno run -A --no-lock tools/predict.ts validate FILE [--envelopes F]  check a predictions file against its envelopes (wrapped {proposer, prediction} or bare lines)
//   deno run -A --no-lock tools/predict.ts report --out DIR               re-render report.html from the files in DIR
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, arch } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, sha256Text } from "./lib/propose.ts";
import type { PredictionEnvelope } from "./lib/prediction/envelope.ts";
import { CANONICAL_FILES, buildOutputs, rerender } from "./lib/prediction/output.ts";
import { ORACLE_IDS, RUN_VERSIONS, confirmRefusal, draftProtocol, freezeRefusal, generate, priorFromEffects, protocolHash, qualificationReport, splitPlanOf, type Protocol } from "./lib/prediction/run.ts";
import { validatePredictionFile } from "./lib/prediction/validate.ts";
import { sourceClosureHash as closureHash } from "./lib/prediction/closure.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const EXP = join(root, "experiments/prediction-envelope");
const PROTOCOL = join(EXP, "protocol.json");
const FREEZE = join(EXP, "protocol.freeze.sha256");

function args(argv: string[]): { cmd: string; pos: string[]; opt: Record<string, string> } {
  const [cmd = "", ...rest] = argv;
  const pos: string[] = [], opt: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      opt[rest[i].slice(2)] = rest[i + 1] ?? "";
      i++;
    } else pos.push(rest[i]);
  }
  return { cmd, pos, opt };
}
const readProtocol = (path: string): Protocol => JSON.parse(readFileSync(path, "utf8")) as Protocol;
const writeText = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
function sh(cmd: string, a: string[]): string {
  try {
    return execFileSync(cmd, a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}
const CLOSURE_ENTRIES = ["tools/predict.ts", "tools/lib/prediction/model-seam.ts"];
const sourceClosureHash = (): string => closureHash(root, CLOSURE_ENTRIES).sha256;
/** The committed (HEAD) text of a repo path, or null when HEAD has no such file. */
function committedText(path: string): string | null {
  try {
    return execFileSync("git", ["show", `HEAD:${relative(root, path)}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}
const readJsonl = <T>(path: string): T[] => readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as T);

function main(): number {
  const { cmd, pos, opt } = args(Deno.args);
  if (cmd === "protocol") {
    if (existsSync(PROTOCOL)) {
      console.error(`${PROTOCOL} exists; not overwriting`);
      return 1;
    }
    writeText(PROTOCOL, JSON.stringify(draftProtocol(), null, 2) + "\n");
    console.log(`wrote ${PROTOCOL}`);
    return 0;
  }
  if (cmd === "run") {
    const stage = opt.stage ?? "";
    const out = resolve(opt.out ?? "");
    if (!opt.out) throw new Error("--out is required");
    const protoPath = stage === "smoke" ? resolve(opt.protocol ?? "") : PROTOCOL;
    const p = readProtocol(protoPath);
    const t0 = Date.now();
    if (stage === "dev") {
      if (p.frozen) throw new Error("the protocol is already frozen; the dev stage is for qualification before the freeze");
      const plan = splitPlanOf(p);
      const gen = generate(p, plan.dev, true);
      writeText(join(out, "dev/qualification.json"), JSON.stringify(qualificationReport(p, gen), null, 1) + "\n");
      console.log(`dev: ${gen.results.length} families, ${gen.variants.length} seed variants, ${Date.now() - t0} ms -> ${join(out, "dev/qualification.json")}`);
      return 0;
    }
    if (stage === "confirm" || stage === "smoke") {
      // `--exploratory` runs the confirm computation without the committed-freeze gate and marks every output EXPLORATORY: the test
      // families are then not held out (their outcomes may already have been seen), so the run is a rehearsal, not a confirmation.
      const exploratory = stage === "confirm" && opt.exploratory !== undefined;
      if (stage === "confirm" && !exploratory) {
        const freezeWorking = existsSync(FREEZE) ? readFileSync(FREEZE, "utf8") : null;
        const refusal = confirmRefusal(p, freezeWorking, { protocol: committedText(PROTOCOL), freeze: committedText(FREEZE), protocolWorking: readFileSync(PROTOCOL, "utf8"), freezeWorking: freezeWorking ?? "" });
        if (refusal) throw new Error(`refusing to confirm: ${refusal}`);
      }
      if (stage === "confirm" && exploratory) {
        const refusal = freezeRefusal(p, existsSync(FREEZE) ? readFileSync(FREEZE, "utf8") : null);
        if (refusal) throw new Error(`refusing even to rehearse: ${refusal}`);
      }
      const gen = generate(p, p.families.map((f) => f.id), true);
      const built = buildOutputs(p, gen);
      for (const [name, text] of Object.entries(built.files)) writeText(join(out, name), text);
      const meta = {
        stage,
        status: stage === "smoke" ? "SMOKE" : exploratory ? "EXPLORATORY" : "CONFIRM",
        ...(exploratory ? { exploratoryReason: "run before the freeze was committed, with test outcomes already inspected; not a held-out confirmation" } : {}),
        gitSha: sh("git", ["rev-parse", "HEAD"]),
        gitDirty: sh("git", ["status", "--porcelain", "--", "tools", "packages", "experiments/prediction-envelope"]) !== "",
        sourceClosureSha256: sourceClosureHash(),
        versions: RUN_VERSIONS,
        protocolSha256: protocolHash(p),
        command: `deno run -A --no-lock tools/predict.ts ${Deno.args.join(" ")}`,
        hardware: { cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, platform: platform(), arch: arch() },
        wallMs: Date.now() - t0,
        cellSteps: built.comparison.validNonNullYieldAndCost.totalCellSteps,
        statement: "CPU only (sim-ref). No model call, no GPU, no network, no paid compute.",
      };
      writeText(join(out, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
      console.log(`${stage}: ${gen.results.length} families, ${built.files["envelopes.jsonl"].split("\n").length - 1} cases, ${Date.now() - t0} ms -> ${out}`);
      return 0;
    }
    throw new Error(`unknown --stage ${JSON.stringify(stage)} (dev, confirm, smoke)`);
  }
  if (cmd === "freeze") {
    const out = resolve(opt.out ?? join(EXP, "v0"));
    const min = Number(opt["min-effect"]);
    if (!Number.isFinite(min) || min <= 0) throw new Error("--min-effect must be a positive number");
    const p = readProtocol(PROTOCOL);
    if (p.frozen) throw new Error("already frozen");
    const q = JSON.parse(readFileSync(join(out, "dev/qualification.json"), "utf8")) as { protocolHash: string; devEffects: { bodyMass: number }[] };
    if (q.protocolHash !== protocolHash(p)) throw new Error("dev/qualification.json was made with a different draft protocol");
    p.minEffect = min;
    p.devPrior = priorFromEffects(q.devEffects.map((e) => e.bodyMass), min);
    p.frozen = true;
    writeText(PROTOCOL, JSON.stringify(p, null, 2) + "\n");
    writeText(FREEZE, protocolHash(p) + "\n");
    console.log(`frozen: minEffect ${min}, devPrior ${JSON.stringify(p.devPrior)}, hash ${protocolHash(p)}`);
    return 0;
  }
  if (cmd === "validate") {
    const file = resolve(pos[0] ?? "");
    const envPath = resolve(opt.envelopes ?? join(dirname(file), "envelopes.jsonl"));
    const envelopes = readJsonl<PredictionEnvelope>(envPath);
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
    const groups = new Map<string, string[]>();
    for (const l of lines) {
      let proposer = "(bare)", body = l;
      try {
        const o = JSON.parse(l) as { proposer?: unknown; prediction?: unknown };
        if (o && typeof o === "object" && typeof o.proposer === "string" && "prediction" in o) {
          proposer = o.proposer;
          body = JSON.stringify(o.prediction);
        }
      } catch {
        /* the validator counts it */
      }
      (groups.get(proposer) ?? groups.set(proposer, []).get(proposer)!).push(body);
    }
    // The dev-only oracle is validated against dev envelopes only, when the protocol snapshot beside the file says which are dev.
    const snap = join(dirname(file), "protocol.snapshot.json");
    const devFamilies = existsSync(snap) ? new Set(splitPlanOf(readProtocol(snap)).dev) : null;
    // An empty submission is still checked against the envelopes: every case is missing.
    if (groups.size === 0) groups.set("(empty file)", []);
    let bad = 0;
    for (const [id, ls] of groups) {
      const meant = devFamilies && ORACLE_IDS.includes(id) ? envelopes.filter((e) => devFamilies.has(e.familyId)) : envelopes;
      const r = validatePredictionFile(ls, meant);
      bad += r.invalid + r.missing.length + r.extra.length + r.duplicates.length + r.notObject + r.badEnvelopes.length;
      console.log(`${id}: ${ls.length} lines, invalid ${r.invalid}, missing ${r.missing.length}${r.missing.length ? ` (${r.missing.slice(0, 5).join(", ")}${r.missing.length > 5 ? ", ..." : ""})` : ""}, extra ${r.extra.length}, duplicates ${r.duplicates.length}, unsound envelopes ${r.badEnvelopes.length}`);
    }
    return bad === 0 ? 0 : 1;
  }
  if (cmd === "report") {
    // Re-renders comparison.md, report.html and canonical.sha256 from the canonical data files in DIR, and refreshes the source hash in meta.json.
    if (!opt.out) throw new Error("--out is required");
    const dir = resolve(opt.out);
    const derived = rerender((name) => readFileSync(join(dir, name), "utf8"));
    for (const [name, text] of Object.entries(derived)) writeText(join(dir, name), text);
    const metaPath = join(dir, "meta.json");
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
      // The generation hash stays as recorded (it names the code that made the outcomes); the renderer's hash is recorded separately.
      meta.reportRenderedFromCanonicalData = { sourceClosureSha256: sourceClosureHash() };
      writeText(metaPath, JSON.stringify(meta, null, 2) + "\n");
    }
    console.log(`report: re-rendered ${Object.keys(derived).join(", ")} in ${dir}`);
    return 0;
  }
  console.error("usage: predict.ts protocol | run --stage dev|confirm|smoke --out DIR | freeze --min-effect N | validate FILE | report --out DIR");
  return 2;
}

try {
  Deno.exit(main());
} catch (e) {
  console.error((e as Error).message);
  Deno.exit(1);
}
void CANONICAL_FILES;
void canonical;
