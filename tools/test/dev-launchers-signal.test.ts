import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

// Stub children are wrappers (`sleep 60 &; wait`), so each has a direct child and a grandchild. Every pid goes into
// $HARNESS/pids: the test signals the launcher from outside and asserts that exactly those pids are gone.
const scratch: string[] = [];
const survivors: number[] = [];
afterEach(() => {
  for (const pid of survivors.splice(0)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (ok()) return; await sleep(100); }
  throw new Error(`timed out waiting for ${what}`);
}

function setup(launcher: "bin/dev" | "bin/garden-dev", perl?: string) {
  const dir = mkdtempSync(join(tmpdir(), "launcher-signal-test-")); scratch.push(dir);
  for (const path of ["bin", "stubs", "tmp", "apps/coordinator/deps", "node_modules"]) mkdirSync(join(dir, path), { recursive: true });
  for (const name of ["dev", "garden-dev"]) {
    const file = join(dir, "bin", name);
    writeFileSync(file, readFileSync(new URL(`../../bin/${name}`, import.meta.url)));
    chmodSync(file, 0o755);
  }
  const stub = (name: string, body: string) => writeFileSync(join(dir, "stubs", name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const wrapper = `sleep 60 &\necho "$$ $!" >> "$HARNESS/pids"\nwait`;
  stub("mix", `echo "$$" > "$HARNESS/pid.tmp"; mv "$HARNESS/pid.tmp" "$HARNESS/pid"\n${wrapper}`);
  stub("pnpm", wrapper);
  stub("deno", 'if [ "$1" = eval ]; then cat >/dev/null; echo "256 256 spots"; else exit 99; fi');
  stub("lsof", 'if [ -s "$HARNESS/pid" ]; then cat "$HARNESS/pid"; else exit 1; fi');
  stub("curl", `data=""; out=""
while [ "$#" -gt 0 ]; do
  case "$1" in --data) data=$2; shift ;; -o) out=$2; shift ;; esac
  shift
done
if [ -n "$data" ]; then printf '%s' '{}' > "$out"; printf '200'; else [ -s "$HARNESS/pid" ]; fi`);
  if (perl !== undefined) stub("perl", perl);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GARDEN_|BL_)/.test(k) && k !== "PORT" && k !== "LAB_PORT"));
  const env = { ...inherited, PATH: `${dir}/stubs:${process.env.PATH}`, HARNESS: dir, TMPDIR: join(dir, "tmp"), GARDEN_ISLANDS: "0" };
  const pids = () => (existsSync(join(dir, "pids")) ? readFileSync(join(dir, "pids"), "utf8").split(/\s+/).filter(Boolean).map(Number) : []);
  return { dir, env, pids, launcher };
}

/** Starts the launcher the way `nohup ... &` does: SIGINT ignored at start. */
function start(h: ReturnType<typeof setup>, ignoreInt = true) {
  const shell = ignoreInt ? `trap "" INT; exec sh ${h.launcher}` : `exec sh ${h.launcher}`;
  const child = spawn("/bin/sh", ["-c", shell], { cwd: h.dir, env: h.env });
  let output = "";
  child.stdout.on("data", (b) => { output += b; });
  child.stderr.on("data", (b) => { output += b; });
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  survivors.push(child.pid!);
  return { child, exited, output: () => output };
}

async function signalAndCheck(launcher: "bin/dev" | "bin/garden-dev", signal: "SIGINT" | "SIGTERM", extraEnv: Record<string, string> = {}) {
  const h = setup(launcher);
  Object.assign(h.env, extraEnv);
  const run = start(h);
  try {
    await until("two stub children with a grandchild each", () => h.pids().length === 4 && run.output().includes("Press Ctrl-C"), 20_000);
    const recorded = h.pids();
    expect(recorded.length).toBe(4);
    for (const pid of recorded) expect(alive(pid), `pid ${pid} before the signal`).toBe(true);
    run.child.kill(signal);
    await run.exited;
    await until("every recorded pid to be gone", () => recorded.every((p) => !alive(p)), 25_000);
    survivors.push(...recorded);
    if (launcher === "bin/garden-dev") expect(readdirSync(join(h.dir, "tmp")), "scratch directory removed").toEqual([]);
  } finally {
    survivors.push(...h.pids());
  }
}

describe.each(["bin/garden-dev", "bin/dev"] as const)("%s", (launcher) => {
  it("stops the launcher and all descendants on SIGINT sent with SIGINT ignored at start", () => signalAndCheck(launcher, "SIGINT"), 60_000);
  it("still resets SIGINT when an exported BL_SIGNALS_RESET=1 is inherited", () => signalAndCheck(launcher, "SIGINT", { BL_SIGNALS_RESET: "1" }), 60_000);
  it("stops the launcher and all descendants on SIGTERM", () => signalAndCheck(launcher, "SIGTERM"), 60_000);
});

it("re-exec failure is loud", async () => {
  const h = setup("bin/garden-dev", "exit 1");
  const run = start(h);
  const code = await Promise.race([run.exited, sleep(10_000).then(() => "timeout" as const)]);
  expect(code).not.toBe(0);
  expect(code).not.toBe("timeout");
  expect(h.pids()).toEqual([]);
}, 20_000);

it("a missing perl continues without the re-exec, with a note", async () => {
  const h = setup("bin/dev");
  // A PATH with the stubs and only the few system tools bin/dev needs, so `command -v perl` fails.
  const sys = join(h.dir, "sys"); mkdirSync(sys);
  for (const tool of ["sh", "dirname", "pgrep", "sleep", "mv", "cat"]) {
    const found = spawnSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    symlinkSync(found, join(sys, tool));
  }
  h.env.PATH = `${h.dir}/stubs:${sys}`;
  const run = start(h);
  try {
    await until("stub children", () => h.pids().length === 4 && run.output().includes("Press Ctrl-C"), 20_000);
    expect(run.output()).toContain("perl not found");
    run.child.kill("SIGTERM");
    await run.exited;
  } finally { survivors.push(...h.pids()); }
}, 40_000);

it("SIGHUP disposition is preserved by the re-exec", async () => {
  const h = setup("bin/dev");
  const probe = join(h.dir, "hup");
  // Started with HUP ignored (as under nohup). The pnpm stub sends itself SIGHUP and records that it survived.
  writeFileSync(join(h.dir, "stubs", "pnpm"), `#!/bin/sh\nsleep 60 &\necho "$$ $!" >> "$HARNESS/pids"\nkill -HUP $$\necho survived > "${probe}"\nwait\n`, { mode: 0o755 });
  const child = spawn("/bin/sh", ["-c", "trap '' HUP INT; exec sh bin/dev"], { cwd: h.dir, env: h.env });
  survivors.push(child.pid!);
  const exited = new Promise((r) => child.on("exit", r));
  try {
    await until("hup probe", () => existsSync(probe) && h.pids().length === 4, 20_000);
    expect(readFileSync(probe, "utf8").trim()).toBe("survived");
    child.kill("SIGINT");
    await exited;
  } finally { survivors.push(...h.pids()); }
}, 40_000);
