// Unit tests for tools/ci/verify-image-gate.mjs and the cleanup step of .github/workflows/coordinator-image.yml.
// Nothing here needs Docker: reports are fixtures and `docker` is a fake.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
// @ts-ignore plain .mjs helpers; no type declarations
import { canaryProblems, containsAny, createResourceTracker, deployedEnvironment, gateProblems, parseDurationMs, redact, scanOutput } from "../ci/verify-image-gate.mjs";

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "bl-ci-verify-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type A = { fullName: string; status: string; failureMessages: string[] };
const a = (fullName: string, status = "passed", failureMessages: string[] = []): A => ({ fullName, status, failureMessages });
const LIVE = "the coordinator image started as deployed";
const REFUSE = "the coordinator image refuses to start";
const report = (assertions: A[], over: Record<string, unknown> = {}) => ({
  numPassedTests: assertions.filter((x) => x.status === "passed").length,
  numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
  testResults: [{ name: "/work/tools/test/coordinator-image.test.ts", assertionResults: assertions }],
  ...over,
});
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => a(`${prefix} ${i}`));
const goodReport = () => report([...many(LIVE, 13), ...many(REFUSE, 10)]);

describe("gate report", () => {
  it("accepts a run with the live floor and every refusal case", () => {
    expect(gateProblems(goodReport())).toEqual([]);
  });
  it("rejects skipped, failed, todo or too few tests", () => {
    expect(gateProblems(report([...many(LIVE, 13), ...many(REFUSE, 10)], { numPendingTests: 3 }))).toEqual(["numPendingTests = 3"]);
    expect(gateProblems(report([...many(LIVE, 12), ...many(REFUSE, 10)])).join()).toContain("only 12 tests ran against the started image");
    expect(gateProblems(report([...many(LIVE, 13), ...many(REFUSE, 9)])).join()).toContain("only 9 refusal cases");
    expect(gateProblems(report([...many(LIVE, 13), ...many(REFUSE, 10), a("x started as deployed", "failed")], { numFailedTests: 1 })).join()).toContain("numFailedTests = 1");
  });
  it("rejects a missing or empty suite", () => {
    expect(gateProblems({ ...goodReport(), testResults: [] }).join()).toContain("no result");
    expect(gateProblems(report([a("only skipped", "skipped")])).join()).toContain("nothing passed");
  });
});

describe("canary report", () => {
  const cacheFail = a("the coordinator image started as deployed validator runs from the image's cache", "failed", ["AssertionError: validator from the image cache did not run"]);
  const rootFail = a("the coordinator image started as deployed runs as the unprivileged coordinator user and can write its volumes", "failed", ["AssertionError: container user must not be root"]);
  const junit = (failures: number, errors: number, body = "") => `<?xml version="1.0"?><testsuites name="vitest tests" tests="13" failures="${failures}" errors="${errors}" time="1">${"<failure/>".repeat(failures)}${body}</testsuites>`;
  it("accepts exactly the named failure with a clean JUnit report", () => {
    expect(canaryProblems("cache", report([...many(LIVE, 13), cacheFail]), junit(1, 0))).toEqual([]);
    expect(canaryProblems("root", report([...many(LIVE, 13), rootFail]), junit(1, 0))).toEqual([]);
  });
  it("rejects no failure, two failures, a different failure, a wrong message", () => {
    expect(canaryProblems("cache", report(many(LIVE, 13)), junit(0, 0)).length).toBeGreaterThan(0);
    expect(canaryProblems("cache", report([cacheFail, rootFail]), junit(2, 0)).join()).toContain("exactly one");
    expect(canaryProblems("cache", report([rootFail]), junit(1, 0)).join()).toContain("is not");
    expect(canaryProblems("cache", report([{ ...cacheFail, failureMessages: ["boom"] }]), junit(1, 0)).join()).toContain("lacks");
  });
  it("rejects an extra hook or runtime error that JSON omits", () => {
    expect(canaryProblems("root", report([rootFail]), junit(1, 1, "<error/>"))).toEqual(["canary contains hook/runtime errors or an unexpected failure count"]);
    expect(canaryProblems("root", report([rootFail]), "<testsuites/>").length).toBe(1);
  });
  it("rejects an unknown variant", () => {
    expect(canaryProblems("nope" as never, report([]), "")).toEqual(["unknown canary nope"]);
  });
});

describe("the command line", () => {
  const run = (...args: string[]) => spawnSync("node", [repo("tools/ci/verify-image-gate.mjs"), ...args], { encoding: "utf8" });
  it("exits 0 for a good gate report, 1 for a bad one, 2 for bad usage", () => {
    writeFileSync(join(scratch, "good.json"), JSON.stringify(goodReport()));
    writeFileSync(join(scratch, "bad.json"), JSON.stringify(report(many(LIVE, 3))));
    expect(run("gate", join(scratch, "good.json")).status).toBe(0);
    expect(run("gate", join(scratch, "bad.json")).status).toBe(1);
    expect(run("bogus").status).toBe(2);
  });
});

describe("secret handling", () => {
  it("detects and redacts secrets without printing them in the verdict", () => {
    const secrets = ["s3cr3t-one", "", "s3cr3t-two"];
    expect(containsAny("nothing here", secrets)).toBe(false);
    expect(containsAny("has s3cr3t-two inside", secrets)).toBe(true);
    expect(containsAny("anything", [""])).toBe(false);
    expect(redact("a s3cr3t-one b s3cr3t-two s3cr3t-one", secrets)).toBe("a [redacted] b [redacted] [redacted]");
  });
  it("decides a leak on the raw output, so redacted text cannot hide one", () => {
    const secrets = ["s3cr3t-one", "s3cr3t-two"];
    const leaking = scanOutput("boot ok\nadmin token is s3cr3t-two\n", secrets);
    expect(leaking.leaked).toBe(true);
    expect(leaking.text).not.toContain("s3cr3t-two");
    expect(containsAny(leaking.text, secrets), "searching the redacted text is the bug this guards against").toBe(false);
    expect(scanOutput("boot ok\n", secrets)).toEqual({ leaked: false, text: "boot ok\n" });
  });
});

describe("deployed environment", () => {
  const config = (over: Record<string, unknown> = {}) => ({
    services: { coordinator: {
      environment: { PHX_SERVER: "true", PORT: "4000", BL_DATA_DIR: "/data", BL_DISCOVERY_DATA_DIR: "/data-discovery", SECRET_KEY_BASE: "k", BL_ADMIN_TOKEN: "a", BL_DISCOVERY_JOIN_TOKEN: "j", BL_CORS_ORIGINS: "" },
      volumes: [{ type: "volume", source: "coordinator_data", target: "/data", volume: {} }, { type: "volume", source: "discovery_data", target: "/data-discovery", volume: {} }],
      stop_grace_period: "1m15s", ...over,
    } },
  });
  it("reads the environment, grace period and mounts", () => {
    const d = deployedEnvironment(config());
    expect(d.env.BL_CORS_ORIGINS).toBe("");
    expect(d.stopGraceMs).toBe(75_000);
    expect(d.mounts).toEqual(["/data", "/data-discovery"]);
  });
  it("refuses a file that stops matching the gate's assumptions", () => {
    expect(() => deployedEnvironment(config({ ports: [{ target: 4000 }] }))).toThrow(/publishes ports/);
    expect(() => deployedEnvironment(config({ command: ["sleep"] }))).toThrow(/overrides/);
    expect(() => deployedEnvironment(config({ volumes: [{ type: "volume", source: "a", target: "/data" }] }))).toThrow(/volumes/);
    expect(() => deployedEnvironment(config({ environment: { PHX_SERVER: "true" } }))).toThrow(/lacks/);
    expect(() => deployedEnvironment({ services: {} })).toThrow(/no coordinator/);
  });
  it("refuses mounts the test does not start: bind, read-only, nocopy, subpath, shared, unnamed", () => {
    const vol = (target: string, extra: Record<string, unknown> = {}, source = target.slice(1)) => ({ type: "volume", source, target, volume: {}, ...extra });
    const two = (a: Record<string, unknown>, b: Record<string, unknown> = vol("/data-discovery")) => config({ volumes: [a, b] });
    expect(() => deployedEnvironment(two({ type: "bind", source: "/srv/x", target: "/data" }))).toThrow(/bind mount, not a named volume/);
    expect(() => deployedEnvironment(two(vol("/data", { read_only: true })))).toThrow(/read-only/);
    expect(() => deployedEnvironment(two(vol("/data", { volume: { nocopy: true } })))).toThrow(/nocopy/);
    expect(() => deployedEnvironment(two(vol("/data", { volume: { subpath: "x" } })))).toThrow(/subpath/);
    expect(() => deployedEnvironment(two(vol("/data", {}, "shared"), vol("/data-discovery", {}, "shared")))).toThrow(/share a volume/);
    expect(() => deployedEnvironment(two(vol("/data", {}, "")))).toThrow(/no named volume source/);
  });
  it("parses Compose durations", () => {
    expect(parseDurationMs("1m15s")).toBe(75_000);
    expect(parseDurationMs("75s")).toBe(75_000);
    expect(parseDurationMs("10s")).toBe(10_000);
    expect(parseDurationMs(30e9)).toBe(30_000);
    expect(() => parseDurationMs("soon")).toThrow();
  });
});

describe("resource cleanup", () => {
  type R = { status: number; stdout: string; stderr: string };
  /** A fake Docker holding containers and volumes; `labelled` ones are listed by the label filter, `foreign` ones ([id, name]) exist but are not ours, so no listing returns them and removing one is recorded. */
  function fake(opts: { labelled?: [string, string][]; foreign?: [string, string][]; failList?: boolean; stuck?: boolean } = {}) {
    const state = { labelled: [...(opts.labelled ?? [])], foreign: [...(opts.foreign ?? [])], removed: [] as string[], calls: [] as string[] };
    const docker = (args: string[]): R => {
      state.calls.push(args.join(" "));
      if (args[0] === "ps" || (args[0] === "volume" && args[1] === "ls")) {
        if (opts.failList) return { status: 1, stdout: "", stderr: "daemon down" };
        return { status: 0, stdout: state.labelled.map(([id, name]) => `${id}\t${name}`).join("\n"), stderr: "" };
      }
      const id = args.at(-1) as string;
      if (!opts.stuck) {
        state.labelled = state.labelled.filter(([i]) => i !== id);
        state.foreign = state.foreign.filter(([i]) => i !== id);
      }
      state.removed.push(id);
      return { status: 0, stdout: "", stderr: "" };
    };
    return { state, tracker: createResourceTracker({ docker, invocation: "abc" }) };
  }
  it("removes what a labelled listing returns, containers before volumes", () => {
    const { state, tracker } = fake({ labelled: [["c1", "box"], ["v1", "vol"]] });
    tracker.record("volume", "vol");
    tracker.record("container", "box");
    expect(tracker.cleanup()).toEqual([]);
    expect(state.removed).toEqual(["c1", "v1"]);
  });
  it("never removes a recorded name that the labelled listing does not return", () => {
    const { state, tracker } = fake({ foreign: [["f1", "existing"], ["f2", "existing"]], labelled: [["c9", "ours"]] });
    tracker.record("container", "existing");
    tracker.record("volume", "existing");
    tracker.record("container", "ours");
    expect(tracker.cleanup()).toEqual([]);
    expect(state.removed).toEqual(["c9"]);
    expect(state.foreign.length).toBe(2);
  });
  it("reports an enumeration failure and a survivor as failures", () => {
    const failing = fake({ labelled: [["c1", "box"]], failList: true });
    failing.tracker.record("container", "box");
    expect(failing.tracker.cleanup().join()).toContain("could not be enumerated");
    const stuck = fake({ labelled: [["c1", "box"]], stuck: true });
    stuck.tracker.record("container", "box");
    expect(stuck.tracker.cleanup().length).toBe(1);
  });
});

describe("the workflow", () => {
  const text = readFileSync(repo(".github/workflows/coordinator-image.yml"), "utf8");
  const site = readFileSync(repo(".github/workflows/site-image.yml"), "utf8");
  it("keeps the site gate's authority and pinned actions", () => {
    expect(text).toMatch(/^permissions:\n  contents: read$/m);
    expect(text).toContain("persist-credentials: false");
    const pins = (t: string) => [...t.matchAll(/uses: (\S+@[0-9a-f]{40})/g)].map((m) => m[1]);
    expect(pins(text).length).toBe(2);
    expect(pins(text)).toEqual(pins(site));
    expect([...text.matchAll(/uses: (\S+)/g)].length).toBe(2);
    expect(text).not.toMatch(/secrets\.|docker login|docker push|packages: write/);
  });

  // The final step, run against a fake `docker` on PATH.
  const step = /- name: Remove this run's[^\n]*\n(?:[^\n]*\n)*?\s+run: \|\n((?:\s{10}[^\n]*\n|\n)+)/.exec(text);
  const body = (step?.[1] ?? "").split("\n").map((l) => l.slice(10)).join("\n");
  function cleanup(mode: "empty" | "failps" | "survivor") {
    const dir = mkdtempSync(join(scratch, "fake-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const kept = join(dir, "scratch");
    mkdirSync(kept);
    writeFileSync(join(bin, "docker"), `#!/bin/bash
case "$1 $2" in
  "ps -aq") ${mode === "failps" ? "exit 1" : mode === "survivor" ? "echo deadbeef" : "exit 0"} ;;
  "volume ls") exit 0 ;;
  *) exit 0 ;;
esac
`);
    chmodSync(join(bin, "docker"), 0o755);
    // A pass-through `timeout`, so the probe does not depend on GNU coreutils being on PATH (a Mac without it).
    writeFileSync(join(bin, "timeout"), '#!/bin/bash\nshift\nexec "$@"\n');
    chmodSync(join(bin, "timeout"), 0o755);
    const r = spawnSync("bash", ["-c", body], { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}`, BL_COORDINATOR_IMAGE_CI_RUN: "1-1", BL_SCRATCH: kept } });
    return { status: r.status, kept: existsSync(kept) };
  }
  it("cleans up with exit 0 and deletes scratch only when nothing is left", () => {
    expect(body).toContain("docker volume ls");
    expect(cleanup("empty")).toEqual({ status: 0, kept: false });
  });
  it("fails and keeps scratch when listing fails or something survives", () => {
    expect(cleanup("failps")).toEqual({ status: 1, kept: true });
    expect(cleanup("survivor")).toEqual({ status: 1, kept: true });
  });
});
