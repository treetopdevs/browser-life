// Verifiers and helpers for the coordinator image gate (.github/workflows/coordinator-image.yml,
// tools/test/coordinator-image.test.ts). Plain Node, no dependencies, so the workflow runs it directly and
// tools/test/ci-verify.test.ts imports it.
//
//   node tools/ci/verify-image-gate.mjs gate   <vitest.json>
//   node tools/ci/verify-image-gate.mjs canary <cache|root> <vitest.json> <junit.xml>
//
// gate:   the live suites must really have run: nothing failed, skipped or todo, and every test against the started
//         image (13) and every refusal case (10) passed. The floors equal the suite's size on purpose: a deleted or
//         renamed test fails the gate; raise them with the suite.
// canary: a deliberately damaged image must fail exactly one named assertion (Vitest JSON) with no hook or runtime
//         error (JUnit: failures="1", errors="0", no <error> element).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MIN_LIVE = 13;
export const MIN_REFUSAL = 10;
export const LIVE_NAME = "started as deployed";
export const REFUSAL_NAME = "refuses to start";
export const GATE_FILE = "tools/test/coordinator-image.test.ts";

/** Each canary: the one test that must fail and a phrase its failure message must contain. */
export const CANARIES = {
  cache: { test: "validator runs from the image's cache", message: "validator from the image cache" },
  root: { test: "runs as the unprivileged coordinator user", message: "container user must not be root" },
};

/** True when any non-empty secret occurs in the text. A boolean on purpose: assertions never print the value. */
export const containsAny = (text, secrets) => secrets.some((s) => s !== "" && text.includes(s));

/** The text with every non-empty secret replaced. */
export const redact = (text, secrets) => secrets.reduce((t, s) => (s === "" ? t : t.split(s).join("[redacted]")), text);

/**
 * Scans raw container output: `leaked` is decided on the raw text, `text` is what may be printed. Assertions on a
 * leak must use `leaked`, never a search of `text`, which has no secret left in it by construction.
 */
export const scanOutput = (raw, secrets) => ({ leaked: containsAny(raw, secrets), text: redact(raw, secrets) });

/** Compose prints durations like "1m15s" or "75s"; a bare number is nanoseconds. Returns milliseconds. */
export function parseDurationMs(value) {
  if (typeof value === "number") return value / 1e6;
  const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?$/.exec(String(value));
  if (!m || value === "") throw new Error(`unrecognised duration: ${value}`);
  return (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 1000;
}

/**
 * The coordinator service as `docker compose config --format json` resolves it. Returns the environment (strings
 * only), the stop grace period in ms and the volume mount targets. Throws if the file stops describing what the gate
 * assumes: no published ports, no command override, exactly two distinct, writable, copy-up named volumes at /data and /data-discovery.
 */
export function deployedEnvironment(config) {
  const svc = config?.services?.coordinator;
  if (!svc) throw new Error("compose config has no coordinator service");
  if (svc.ports?.length) throw new Error("the coordinator service publishes ports");
  if (svc.command?.length || svc.entrypoint?.length) throw new Error("the coordinator service overrides the image command");
  const env = {};
  for (const [k, v] of Object.entries(svc.environment ?? {})) env[k] = v == null ? "" : String(v);
  for (const k of ["SECRET_KEY_BASE", "BL_ADMIN_TOKEN", "BL_DISCOVERY_JOIN_TOKEN", "PHX_SERVER", "PORT", "BL_DATA_DIR", "BL_DISCOVERY_DATA_DIR"]) {
    if (!(k in env)) throw new Error(`compose environment lacks ${k}`);
  }
  // The test starts two writable, labelled named volumes with Docker's copy-up of the image's directories: the file
  // must describe exactly that (no bind mounts, read-only or nocopy volumes, subpaths, or one volume shared by both).
  const volumes = svc.volumes ?? [];
  for (const v of volumes) {
    if (v.type !== "volume") throw new Error(`coordinator mount ${v.target} is a ${v.type} mount, not a named volume`);
    if (typeof v.source !== "string" || v.source === "") throw new Error(`coordinator mount ${v.target} has no named volume source`);
    if (v.read_only) throw new Error(`coordinator mount ${v.target} is read-only`);
    if (v.volume?.nocopy) throw new Error(`coordinator mount ${v.target} disables copy-up (nocopy)`);
    if (v.volume?.subpath) throw new Error(`coordinator mount ${v.target} mounts a subpath`);
  }
  if (new Set(volumes.map((v) => v.source)).size !== volumes.length) throw new Error("the coordinator mounts share a volume");
  const mounts = volumes.map((v) => v.target).sort();
  if (mounts.join(",") !== "/data,/data-discovery") throw new Error(`unexpected coordinator volumes: ${mounts.join(",")}`);
  return { env, stopGraceMs: parseDurationMs(svc.stop_grace_period ?? "10s"), mounts };
}

/**
 * Problems with a gate report (Vitest JSON); empty when the live suites ran and passed.
 * @param {any} report
 */
export function gateProblems(report, { minLive = MIN_LIVE, minRefusal = MIN_REFUSAL } = {}) {
  const problems = [];
  const suite = report.testResults?.find((t) => t.name.endsWith(GATE_FILE));
  if (!suite) problems.push("coordinator-image: no result");
  else if (!suite.assertionResults.some((a) => a.status === "passed")) problems.push("coordinator-image: nothing passed");
  for (const key of ["numFailedTests", "numPendingTests", "numTodoTests"]) if (report[key] !== 0) problems.push(`${key} = ${report[key]}`);
  const passed = (report.testResults ?? []).flatMap((t) => t.assertionResults).filter((a) => a.status === "passed");
  const live = passed.filter((a) => a.fullName.includes(LIVE_NAME)).length;
  const refusals = passed.filter((a) => a.fullName.includes(REFUSAL_NAME)).length;
  if (live < minLive) problems.push(`only ${live} tests ran against the started image (need ${minLive})`);
  if (refusals < minRefusal) problems.push(`only ${refusals} refusal cases passed (need ${minRefusal})`);
  return problems;
}

/**
 * Problems with a canary run; empty when exactly the expected assertion failed and nothing else did.
 * @param {"cache"|"root"} variant
 */
export function canaryProblems(variant, report, junit) {
  const expected = CANARIES[variant];
  if (!expected) return [`unknown canary ${variant}`];
  const problems = [];
  const failed = (report.testResults ?? []).flatMap((t) => t.assertionResults).filter((a) => a.status === "failed");
  if (failed.length !== 1) problems.push(`expected exactly one failed test, found ${failed.length}`);
  else {
    if (!failed[0].fullName.includes(expected.test)) problems.push(`the failed test is not "${expected.test}"`);
    if (!failed[0].failureMessages.join("\n").includes(expected.message)) problems.push(`the failure message lacks "${expected.message}"`);
  }
  const root = /<testsuites\b[^>]*>/.exec(junit)?.[0] ?? "";
  const attr = (name) => Number(new RegExp(`\\b${name}="(\\d+)"`).exec(root)?.[1] ?? NaN);
  const failures = (junit.match(/<failure\b/g) ?? []).length;
  const errors = (junit.match(/<error\b/g) ?? []).length;
  if (!root || attr("failures") !== 1 || attr("errors") !== 0 || failures !== 1 || errors !== 0) {
    problems.push("canary contains hook/runtime errors or an unexpected failure count");
  }
  return problems;
}

/**
 * Removes only what one test invocation created. A recorded name is a candidate, never a target: removal happens only
 * for an ID that a successful label-filtered listing returned, and absence is confirmed only by such a listing.
 * `docker(args, timeoutMs)` returns { status, stdout, stderr, error }.
 */
export function createResourceTracker({ docker, invocation, prefix = "bl.coordinator-image" }) {
  const label = `${prefix}.invocation=${invocation}`;
  const names = { container: [], volume: [] };
  const listing = (kind) => {
    const args = kind === "container"
      ? ["ps", "-a", "--filter", `label=${label}`, "--format", "{{.ID}}\t{{.Names}}"]
      : ["volume", "ls", "--filter", `label=${label}`, "--format", "{{.Name}}\t{{.Name}}"];
    const r = docker(args, 15_000);
    if (r.status !== 0) return null;
    return r.stdout.split("\n").filter(Boolean).map((line) => { const [id, name] = line.split("\t"); return { id, name }; });
  };
  return {
    label,
    /** Recorded candidate names of a kind (not proof that they exist). */
    candidates(kind) { return [...names[kind]]; },
    /** Call before the command that creates the resource, so a timed-out CLI still leaves a candidate. */
    record(kind, name) { names[kind].push(name); },
    /** Containers (and their anonymous volumes) first, then volumes. Returns what could not be removed or confirmed. */
    cleanup() {
      const left = [];
      for (const kind of ["container", "volume"]) {
        for (const name of [...names[kind]].reverse()) {
          const before = listing(kind);
          if (!before) { left.push(`${kind} ${name}: could not be enumerated`); continue; }
          const hit = before.find((e) => e.name === name);
          if (!hit) continue;
          const r = docker(kind === "container" ? ["rm", "-f", "-v", hit.id] : ["volume", "rm", "-f", hit.id], 120_000);
          const after = listing(kind);
          if (!after || after.some((e) => e.id === hit.id)) left.push(`${kind} ${name}: ${r.error ?? ""}${r.stderr ?? ""}`.trim());
        }
      }
      return left;
    },
  };
}

function main(argv) {
  const [cmd, ...args] = argv;
  const read = (p) => readFileSync(p, "utf8");
  let problems;
  if (cmd === "gate" && args.length === 1) {
    const report = JSON.parse(read(args[0]));
    problems = gateProblems(report);
    const all = report.testResults.flatMap((t) => t.assertionResults);
    console.log(`${report.numPassedTests} passed, ${all.filter((a) => a.status === "passed" && a.fullName.includes(LIVE_NAME)).length} against the started image`);
  } else if (cmd === "canary" && args.length === 3) {
    const report = JSON.parse(read(args[1]));
    problems = canaryProblems(args[0], report, read(args[2]));
    const failed = report.testResults.flatMap((t) => t.assertionResults).filter((a) => a.status === "failed");
    console.log(failed.map((a) => `${a.fullName}\n${a.failureMessages.join("\n").slice(0, 300)}`).join("\n---\n") || "no failed test");
  } else {
    console.error("usage: verify-image-gate.mjs gate <json> | canary <cache|root> <json> <junit>");
    return 2;
  }
  if (problems.length) { console.error(problems.join("\n")); return 1; }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
