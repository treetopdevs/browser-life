// The coordinator image as built from Dockerfile.coordinator, started the way compose.dokploy.yaml deploys it: default
// command, the environment Compose resolves for the coordinator service (with synthetic secrets generated here), two
// named volumes at /data and /data-discovery, no source mounted, no published port beyond an ephemeral 127.0.0.1 one
// for the probes. Plan and decisions: docs/coordinator-image-gate-2026-10-30.md.
//
// BL_COORDINATOR_IMAGE is an immutable image ID (sha256:<64 hex>), e.g. from `docker build --iidfile`. Without it the
// Docker suites skip and no Docker command runs. BL_REQUIRE_COORDINATOR_IMAGE=1 makes a missing or invalid ID, an
// unusable Docker, a missing Docker Compose or an unknown image fail instead. BL_COORDINATOR_IMAGE_CI_RUN adds a
// second label so a CI job can remove what a cancelled run left behind. Secrets reach containers only as `-e NAME`
// (inherited from this process), and no assertion message carries one. Not claimed: TLS, Traefik/Caddy in front, the
// live host, a real campaign through the validator (tests/deno/coordinator_integration.ts), load.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
// @ts-ignore plain .mjs helpers shared with the CI verifier; no type declarations
import { containsAny, createResourceTracker, deployedEnvironment, redact, scanOutput } from "../ci/verify-image-gate.mjs";

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const image = process.env.BL_COORDINATOR_IMAGE ?? "";
const required = process.env.BL_REQUIRE_COORDINATOR_IMAGE === "1";
const ciRun = process.env.BL_COORDINATOR_IMAGE_CI_RUN;
const valid = /^sha256:[0-9a-f]{64}$/.test(image);
const hasCompose = spawnSync("docker", ["compose", "version"], { timeout: 5000 }).status === 0;
// Docker is only asked about a valid ID: with BL_COORDINATOR_IMAGE unset nothing here touches the daemon.
const usable = valid && spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", image], { timeout: 20_000, killSignal: "SIGKILL" }).status === 0;

// Synthetic secrets. CI may pre-generate (and mask) them in the workflow; otherwise they are random per run.
const SECRET_NAMES = ["SECRET_KEY_BASE", "BL_ADMIN_TOKEN", "BL_DISCOVERY_JOIN_TOKEN"] as const;
const secretValues: Record<string, string> = {
  SECRET_KEY_BASE: process.env.BL_TEST_SECRET_KEY_BASE || randomBytes(64).toString("hex"),
  BL_ADMIN_TOKEN: process.env.BL_TEST_ADMIN_TOKEN || randomBytes(32).toString("hex"),
  BL_DISCOVERY_JOIN_TOKEN: process.env.BL_TEST_JOIN_TOKEN || randomBytes(32).toString("hex"),
};
const secretList = Object.values(secretValues);
const ADMIN = secretValues.BL_ADMIN_TOKEN;
const JOIN = secretValues.BL_DISCOVERY_JOIN_TOKEN;

it("has the coordinator image, Docker and Compose when the image gate is requested or an image is named", () => {
  if (!required && !image) return;
  expect(hasCompose, "Docker Compose is required").toBe(true);
  expect(image, "BL_COORDINATOR_IMAGE must name the image").not.toBe("");
  expect(valid, "BL_COORDINATOR_IMAGE must be an image ID, sha256: and 64 hex digits").toBe(true);
  expect(usable, "Docker must be available and know the image ID").toBe(true);
});

/** `docker compose config` for compose.dokploy.yaml with the given variables (and nothing inherited). */
function composeConfig(vars: Record<string, string>) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...vars };
  return spawnSync("docker", ["compose", "--env-file", "/dev/null", "-f", repo("compose.dokploy.yaml"), "config", "--format", "json"], {
    cwd: repo(""), encoding: "utf8", timeout: 20_000, env,
  });
}

describe.skipIf(!hasCompose)("the deployment file the coordinator image is started from", () => {
  it("requires each of the three secrets, naming the variable", () => {
    for (const missing of SECRET_NAMES) {
      const vars = { ...secretValues };
      delete vars[missing];
      const result = composeConfig(vars);
      expect(result.status, `compose accepted a missing ${missing}`).not.toBe(0);
      expect(result.stderr.includes(missing), `compose error does not name ${missing}`).toBe(true);
    }
  });

  it("resolves to the environment and volumes the gate starts the image with", () => {
    const result = composeConfig(secretValues);
    expect(result.status, "compose config failed").toBe(0);
    const deployed = deployedEnvironment(JSON.parse(result.stdout));
    expect(deployed.env.PHX_SERVER).toBe("true");
    expect(deployed.stopGraceMs).toBe(75_000);
    // Booleans only: a failing assertion must not print a secret.
    for (const name of SECRET_NAMES) expect(deployed.env[name] === secretValues[name], `${name} does not come from the environment`).toBe(true);
    for (const name of ["BL_TRUST_FORWARDED_FOR", "BL_ISLAND_JOINS_PER_ADDRESS", "BL_MAX_ISLANDS", "BL_CORS_ORIGINS", "BL_LEASE_MS"]) {
      expect(deployed.env[name], `${name} should be passed blank`).toBe("");
    }
  });
});

type Raw = { status: number; headers: IncomingHttpHeaders; body: string };
function http(origin: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Raw> {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...init.headers };
    if (init.body !== undefined) { headers["content-type"] ??= "application/json"; headers["content-length"] = String(Buffer.byteLength(init.body)); }
    const req = httpRequest({ host: hostname, port, path, method: init.method ?? "GET", headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.setTimeout(10_000, () => req.destroy(new Error(`timeout: ${path}`)));
    req.on("error", reject);
    req.end(init.body);
  });
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const parse = (r: Raw): Record<string, unknown> => { try { return JSON.parse(r.body); } catch { return {}; } };
const joinBody = (host: string) => JSON.stringify({ physicalHostId: host, label: `${host}-label`.slice(0, 30), sourceClosureDigest: "a".repeat(64) });

/** Markers that mean the application crashed or could not use its directories, whatever else the logs say. */
const CRASH_MARKERS = ["Application coordinator exited", "CRASH REPORT", "Config provider", "eacces"];

describe.skipIf(!usable || !hasCompose)("the coordinator image", () => {
  const invocation = randomBytes(6).toString("hex");
  const labels = ["--label", `bl.coordinator-image.invocation=${invocation}`, ...(ciRun ? ["--label", `bl.coordinator-image.ci=${ciRun}`] : [])];
  // Secrets are inherited by name, never written into argv.
  const dockerEnv = { ...process.env, ...secretValues };
  let scratchLogs = "";
  let cleaned = false;
  /** A start hook failed; a container may exist whose start never returned, so print every tracked container's logs. */
  let startupFailed = false;
  let survivors: string[] = [];
  const d = (args: string[], timeout = 30_000, input?: string) =>
    spawnSync("docker", args, { encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, env: dockerEnv, input });
  const must = (args: string[], timeout?: number, input?: string) => {
    const r = d(args, timeout, input);
    if (r.status !== 0) throw new Error(redact(`docker ${args[0]} ${args[1] ?? ""} failed: ${r.error ?? ""}${r.stderr}`, secretList));
    return r.stdout;
  };
  const tracker = createResourceTracker({ docker: (args: string[], timeout?: number) => d(args, timeout), invocation });
  /** Raw container output scanned for secrets: decide on `leaked`, print only `text` (redacted). */
  const scanLogs = (name: string) => { const r = d(["logs", "--tail", "80", name], 15_000); return scanOutput(r.stdout + r.stderr, secretList); };
  const logsOf = (name: string) => scanLogs(name).text;
  const unique = (what: string) => `bl-coordinator-image-${invocation}-${what}`;

  // Environment: exactly what Compose resolves for the coordinator service.
  let deployedEnv: Record<string, string> = {};
  let stopGraceMs = 75_000;

  /** Creates labelled named volumes; names recorded first. */
  function volumes(tag: string): [string, string] {
    const names: [string, string] = [unique(`${tag}-data`), unique(`${tag}-discovery`)];
    for (const n of names) { tracker.record("volume", n); must(["volume", "create", ...labels, n]); }
    return names;
  }
  /** Starts the image detached; `env` entries set to undefined are left out. */
  function start(tag: string, env: Record<string, string | undefined>, vols?: [string, string], publish = true): string {
    const name = unique(tag);
    const args = ["run", "-d", "--pull=never", "--restart", "no", "--name", name, ...labels];
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) continue;
      if ((SECRET_NAMES as readonly string[]).includes(k) && v !== "") args.push("-e", k);
      else args.push("-e", `${k}=${v}`);
    }
    if (vols) args.push("-v", `${vols[0]}:/data`, "-v", `${vols[1]}:/data-discovery`);
    if (publish) args.push("-p", "127.0.0.1::4000");
    args.push(image);
    tracker.record("container", name);
    must(args, 60_000);
    return name;
  }
  const originOf = (name: string) => {
    const port = /127\.0\.0\.1:(\d+)/.exec(d(["port", name, "4000/tcp"], 10_000).stdout)?.[1];
    return port ? `http://127.0.0.1:${port}` : "";
  };
  const running = (name: string) => d(["inspect", "--format", "{{.State.Running}}", name], 10_000).stdout.trim() === "true";
  async function ready(name: string, ms = 60_000): Promise<string> {
    const deadline = Date.now() + ms;
    for (;;) {
      if (!running(name)) throw new Error(`${name} is not running:\n${logsOf(name)}`);
      const origin = originOf(name);
      if (origin) {
        const r = await http(origin, "/api/public/status").catch(() => undefined);
        if (r?.status === 200) return origin;
      }
      if (Date.now() > deadline) throw new Error(`${name} did not answer within ${ms / 1000} s:\n${logsOf(name)}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  /** Runs a script with Deno inside the container as its service user; the cache is the image's unless `cached`. */
  function deno(name: string, script: string, extra: string[] = [], cached = false) {
    const env = cached ? [] : ["-e", "DENO_DIR=/tmp/deno-probe"];
    // --no-lock first, except under the validator's own --lock/--frozen flags (deno refuses both). This deno runs inside
    // the container, so it cannot touch the repository's deno.lock either way.
    const lock = extra.some((f) => f.startsWith("--lock")) ? [] : ["--no-lock"];
    return d(["exec", "-i", ...env, name, "/usr/local/bin/deno", "run", ...lock, "-A", ...extra, "-"], 90_000, script);
  }
  /** One POST made from inside the container to its own port; `host` is 127.0.0.1 or [::1]. A refused connection is reported, not thrown. */
  function inside(name: string, path: string, init: { headers?: Record<string, string>; body?: string; host?: string } = {}) {
    const script = `try {
  const r = await fetch("http://${init.host ?? "127.0.0.1"}:4000${path}", ${JSON.stringify({ method: "POST", redirect: "manual", headers: { "content-type": "application/json", "x-forwarded-proto": "https", ...init.headers }, body: init.body })});
  console.log(JSON.stringify({ status: r.status, body: await r.text() }));
} catch (e) { console.log(JSON.stringify({ status: 0, body: "", error: String(e).slice(0, 200) })); }`;
    const r = deno(name, script);
    if (r.status !== 0) throw new Error(redact(`in-container request failed: ${r.stderr}`, secretList));
    return JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}") as { status: number; body: string; error?: string };
  }
  const exec = (name: string, ...cmd: string[]) => d(["exec", name, ...cmd], 60_000);

  let primary = "";
  let origin = "";
  let vols: [string, string];

  beforeAll(async () => {
    process.once("exit", () => { tracker.cleanup(); });
    try {
      console.info(`Coordinator image test invocation: ${invocation} (label bl.coordinator-image.invocation=${invocation})`);
      const result = composeConfig(secretValues);
      if (result.status !== 0) throw new Error("docker compose config failed for compose.dokploy.yaml");
      const deployed = deployedEnvironment(JSON.parse(result.stdout));
      deployedEnv = deployed.env;
      stopGraceMs = deployed.stopGraceMs;
      vols = volumes("deployed");
    } catch (error) {
      startupFailed = true;
      cleanup();
      throw error;
    }
  }, 120_000);

  function cleanup(): string[] {
    if (cleaned) return survivors;
    cleaned = true;
    survivors = tracker.cleanup();
    return survivors;
  }

  let anyFailed = false;
  afterEach((ctx) => { if (ctx.task.result?.state === "fail") anyFailed = true; });

  afterAll(() => {
    if (!cleaned && scratchLogs) console.info(scratchLogs);
    // Cleanup removes the containers, so their (redacted) logs are printed first when anything failed.
    if (!cleaned && (anyFailed || startupFailed || scratchLogs)) {
      for (const name of tracker.candidates("container")) {
        const r = d(["logs", "--tail", "40", name], 15_000);
        if (r.status === 0) console.info(`Container logs before cleanup (${name}):\n${redact(r.stdout + r.stderr, secretList)}`);
      }
    }
    const left = cleanup();
    if (left.length) throw new Error(`could not remove:\n${left.join("\n")}`);
  }, 180_000);

  describe("started as deployed", () => {
    beforeAll(async () => {
      try {
        primary = start("primary", deployedEnv, vols);
        origin = await ready(primary);
      } catch (error) {
        startupFailed = true;
        scratchLogs = primary ? `Container logs (${primary}):\n${logsOf(primary)}` : "";
        throw error;
      }
    }, 150_000);

    it("answers on its port, still running, with no crash in the logs", () => {
      expect(running(primary), "the container stopped after answering").toBe(true);
      const { leaked, text: logs } = scanLogs(primary);
      for (const marker of CRASH_MARKERS) expect(logs.includes(marker), `logs contain "${marker}"`).toBe(false);
      expect(leaked, "the logs carried a secret").toBe(false);
    });

    it("serves the public status and nothing else public about it", async () => {
      const r = await http(origin, "/api/public/status");
      expect(r.status).toBe(200);
      expect(String(r.headers["content-type"])).toContain("application/json");
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(parse(r)).sort()).toEqual(["activeIslands", "counts", "deviceTypes", "updatedAt"]);
    });

    it("keeps the administrator status behind the admin token", async () => {
      for (const headers of [{}, bearer("not-the-token"), { authorization: "Basic YWRtaW46YWRtaW4=" }, bearer(JOIN)] as Record<string, string>[]) {
        const r = await http(origin, "/api/status", { headers });
        expect(r.status, "an unauthenticated or wrongly authenticated request reached /api/status").toBe(401);
        expect(parse(r).error).toBe("admin authentication required");
        expect(containsAny(r.body, secretList), "a 401 body carried a secret").toBe(false);
      }
      const ok = await http(origin, "/api/status", { headers: bearer(ADMIN) });
      expect(ok.status).toBe(200);
      expect(Object.keys(parse(ok))).toEqual(expect.arrayContaining(["limits", "capabilityNeeds"]));
      expect(containsAny(ok.body, secretList), "the admin status carried a secret").toBe(false);
    });

    it("requires the discovery join token even from inside the container", () => {
      const noToken = inside(primary, "/api/discovery/workers", { body: joinBody("inside-host") });
      expect(noToken.status, "a join from inside the container without a token was admitted").toBe(401);
      expect(JSON.parse(noToken.body).error).toBe("unauthorized");
      const wrong = inside(primary, "/api/discovery/workers", { headers: bearer("wrong-token"), body: joinBody("inside-host") });
      expect(wrong.status, "a join from inside the container with a wrong token was admitted").toBe(401);
      // Positive control: the same probe with the real token succeeds, so a 401 above means the token mattered.
      const good = inside(primary, "/api/discovery/workers", { headers: bearer(JOIN), body: joinBody("inside-host") });
      expect(good.status, "the join from inside the container with the real token was refused").toBe(200);
      expect(containsAny(noToken.body + wrong.body, secretList)).toBe(false);
    });

    it("redirects to https for the public host unless the proxy says it was https", async () => {
      const plain = await http(origin, "/api/public/status", { headers: { host: "cadence.garden" } });
      expect([301, 302, 307, 308], "plain http for the public host was not redirected").toContain(plain.status);
      expect(String(plain.headers.location)).toMatch(/^https:\/\/cadence\.garden\//);
      const proxied = await http(origin, "/api/public/status", { headers: { host: "cadence.garden", "x-forwarded-proto": "https" } });
      expect(proxied.status).toBe(200);
      expect(String(proxied.headers["strict-transport-security"] ?? ""), "no HSTS behind the proxy").toContain("max-age=");
    });

    it("sends no CORS allowance to a foreign origin", async () => {
      const r = await http(origin, "/api/public/status", { headers: { origin: "https://evil.example" } });
      expect(r.status).toBe(200);
      expect(r.headers["access-control-allow-origin"], "a foreign origin was allowed").toBeUndefined();
    });

    it("runs the discovery plane over the published port and writes its state as the service user", async () => {
      const bad = await http(origin, "/api/discovery/workers", { method: "POST", body: joinBody("published-host") });
      expect(bad.status).toBe(401);
      const wrong = await http(origin, "/api/discovery/workers", { method: "POST", headers: bearer("wrong-token"), body: joinBody("published-host") });
      expect(wrong.status).toBe(401);
      const joined = await http(origin, "/api/discovery/workers", { method: "POST", headers: bearer(JOIN), body: joinBody("published-host") });
      expect(joined.status, "the join with the real token was refused").toBe(200);
      const status = await http(origin, "/api/discovery/status", { headers: bearer(ADMIN) });
      expect(status.status).toBe(200);
      const hosts = ((parse(status).workers ?? []) as { host: string }[]).map((w) => w.host);
      expect(hosts).toEqual(expect.arrayContaining(["published-host", "inside-host"]));
      expect((await http(origin, "/api/discovery/status", { headers: bearer(JOIN) })).status, "the join token is not an admin credential").toBe(401);
      expect(containsAny(joined.body.replace(/"token":"[^"]*"/, ""), secretList)).toBe(false);
      // The BEAM, as the service user, wrote into the named volume.
      const uid = exec(primary, "id", "-u").stdout.trim();
      const owner = exec(primary, "stat", "-c", "%u", "/data-discovery/state.bin");
      expect(owner.status, "/data-discovery/state.bin does not exist").toBe(0);
      expect(owner.stdout.trim()).toBe(uid);
    });

    it("read its configuration from the packaged environment", () => {
      const expr = `IO.puts(Jason.encode!(%{v: Application.get_env(:coordinator, :discovery_validator), d: Application.get_env(:coordinator, :data_dir), x: Application.get_env(:coordinator, :discovery_data_dir), c: Application.get_env(:coordinator, :cors_origins), g: Application.get_env(:coordinator, :garden_scheduling), l: Application.get_env(:coordinator, :allow_local_admin) == true}))`;
      const r = exec(primary, "/app/bin/coordinator", "rpc", expr);
      expect(r.status, `rpc failed: ${redact(r.stderr, secretList)}`).toBe(0);
      const cfg = JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}") as { v: string[]; d: string; x: string; c: unknown; g: boolean; l: boolean };
      expect(cfg.v[0]).toBe("/usr/local/bin/deno");
      expect(cfg.v.at(-1)).toBe("check-attempt");
      expect([cfg.d, cfg.x, cfg.c, cfg.g, cfg.l]).toEqual(["/data", "/data-discovery", [], false, false]);
    });

    it("validator runs from the image's cache", () => {
      const command = must(["exec", primary, "printenv", "BL_DISCOVERY_VALIDATOR"]).trim().split(" ").filter(Boolean);
      const dir = `/tmp/validator-${invocation}`;
      expect(exec(primary, "sh", "-c", `mkdir -p ${dir} && printf not-json > ${dir}/manifest.json && printf not-json > ${dir}/case.json && mkdir -p ${dir}/attempt`).status).toBe(0);
      const run = d(["exec", primary, ...command, "--manifest", `${dir}/manifest.json`, "--case", `${dir}/case.json`, "--attempt", `${dir}/attempt`], 90_000);
      expect(run.status, `validator from the image cache did not run: ${redact(run.stderr, secretList).slice(0, 400)}`).toBe(0);
      expect(JSON.parse(run.stdout.trim().split("\n").pop() ?? "{}")).toEqual({ valid: false, errors: ["manifest or case is not JSON"], canonical: null });
      // The vendored renewal copy, PIN.json and the pin helper, under the same cached-only flags.
      const flags = command.slice(command.indexOf("-A") + 1, command.indexOf("/opt/browser-life/tools/discovery.ts"));
      const pin = deno(primary, `import { verifyPin } from "file:///opt/browser-life/tools/lib/discovery-pin.ts"; verifyPin("/opt/browser-life"); console.log("ok");`, flags, true);
      expect(pin.status, `validator from the image cache cannot verify the pin: ${redact(pin.stderr, secretList).slice(0, 400)}`).toBe(0);
      expect(pin.stdout.trim().endsWith("ok")).toBe(true);
      // The pinned code itself, as pinCall (tools/lib/discovery-pin.ts) launches it: a child Deno with the pin's import map,
      // run as the service user with the image's own DENO_DIR. A missing COPY or a broken import map fails here.
      const call = d(["exec", "-i", primary, "/usr/local/bin/deno", "run", "--no-lock", "--allow-read", "--config=/opt/browser-life/vendor/construction-renewal-v1/deno.json", "--no-remote", "--no-npm", "/opt/browser-life/tools/discovery-pin-case.ts", "freeze-check"], 90_000, '{"cases":[]}');
      expect(call.status, `validator from the image cache cannot run the pinned case script: ${redact(call.stderr, secretList).slice(0, 400)}`).toBe(0);
      expect(JSON.parse(call.stdout.trim() || "{}")).toEqual({ checks: [] });
    });

    it("runs as the unprivileged coordinator user and can write its volumes", () => {
      expect(exec(primary, "id", "-u").stdout.trim(), "container user must not be root").not.toBe("0");
      expect(exec(primary, "id", "-un").stdout.trim()).toBe("coordinator");
      for (const dir of ["/data", "/data-discovery"]) {
        const probe = `${dir}/.write-probe-${invocation}`;
        expect(exec(primary, "sh", "-c", `touch ${probe} && rm ${probe}`).status, `${dir} is not writable by the service user`).toBe(0);
      }
    });

    it("declares only its port and starts the release by default", () => {
      const ports = JSON.parse(must(["image", "inspect", "--format", "{{json .Config.ExposedPorts}}", image]));
      expect(Object.keys(ports)).toEqual(["4000/tcp"]);
      const cmd = JSON.parse(must(["image", "inspect", "--format", "{{json .Config.Cmd}}", image]));
      expect(cmd).toEqual(["/app/bin/coordinator", "start"]);
    });

    it("stops cleanly within the compose grace period", () => {
      const t0 = Date.now();
      const stop = d(["stop", "-t", String(Math.ceil(stopGraceMs / 1000)), primary], stopGraceMs + 20_000);
      expect(stop.status, "docker stop failed").toBe(0);
      expect(Date.now() - t0, "stop took longer than the grace period").toBeLessThan(stopGraceMs);
      const code = d(["inspect", "--format", "{{.State.ExitCode}}", primary], 10_000).stdout.trim();
      expect(code, `exit code after SIGTERM (${logsOf(primary).slice(-300)})`).toBe("0");
    }, 120_000);

    it("restarts on the same volumes with its discovery state", async () => {
      const second = start("restart", deployedEnv, vols);
      const reopened = await ready(second);
      const status = await http(reopened, "/api/discovery/status", { headers: bearer(ADMIN) });
      expect(status.status).toBe(200);
      const hosts = ((parse(status).workers ?? []) as { host: string }[]).map((w) => w.host);
      expect(hosts, "state did not survive the restart").toEqual(expect.arrayContaining(["published-host", "inside-host"]));
      expect(logsOf(second).includes("CRASH REPORT")).toBe(false);
    }, 120_000);
  });

  describe("without a join token (control, not a deployed configuration)", () => {
    it("still refuses a join over the published port", async () => {
      const env = { ...deployedEnv };
      delete env.BL_DISCOVERY_JOIN_TOKEN;
      const name = start("nojoin", env, undefined);
      const o = await ready(name);
      const outside = await http(o, "/api/discovery/workers", { method: "POST", body: joinBody("control-host-2") });
      expect(outside.status, "a join over the published port was admitted without a token").toBe(401);
      // Recorded, not asserted: the release binds ::, so an IPv4 client inside the container may arrive as an
      // IPv4-mapped address that the controller's loopback check does not match. The first hosted run settles it.
      for (const host of ["127.0.0.1", "[::1]"]) {
        const r = inside(name, "/api/discovery/workers", { host, body: joinBody(`control-${host.replace(/\W/g, "")}`) });
        console.info(`join-token control: unauthenticated join from inside the container via ${host}: status ${r.status}${r.error ? ` (${r.error})` : ""}`);
      }
    }, 150_000);
  });

  describe("refuses to start", () => {
    /** Runs the deployed environment with one change; returns how the container ended. */
    async function refused(tag: string, change: (env: Record<string, string | undefined>) => void) {
      const env: Record<string, string | undefined> = { ...deployedEnv };
      change(env);
      const name = start(tag, env, undefined);
      let answered = false;
      const deadline = Date.now() + 90_000;
      while (running(name) && Date.now() < deadline) {
        const o = originOf(name);
        if (o && (await http(o, "/api/public/status").catch(() => undefined))?.status === 200) answered = true;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const waited = d(["wait", name], 90_000);
      const waitedOut = waited.stdout.trim();
      if (waited.status !== 0 || !/^\d+$/.test(waitedOut)) throw new Error(`docker wait ${name} gave no exit code (status ${waited.status}, ${redact(`${waited.error ?? ""}${waited.stderr}`, secretList).slice(0, 200)})`);
      const code = Number(waitedOut);
      const { leaked, text: logs } = scanLogs(name);
      const diff = d(["diff", name], 15_000).stdout;
      return { answered, code, logs, leaked, stillRunning: running(name), diff };
    }
    const expectRefusal = (r: Awaited<ReturnType<typeof refused>>, ...messages: string[]) => {
      expect(r.answered, "the coordinator answered although it should have refused").toBe(false);
      expect(r.stillRunning, "the container is still running").toBe(false);
      expect(r.code, "the container exited 0").not.toBe(0);
      for (const m of messages) expect(r.logs.includes(m), `logs lack "${m}"`).toBe(true);
      expect(r.leaked, "the logs carried a secret").toBe(false);
    };
    const T = 120_000;

    it("without an admin token", async () => {
      expectRefusal(await refused("no-admin", (e) => { delete e.BL_ADMIN_TOKEN; }), "BL_ADMIN_TOKEN must be set in production");
    }, T);
    it("with an empty admin token", async () => {
      expectRefusal(await refused("empty-admin", (e) => { e.BL_ADMIN_TOKEN = ""; }), "BL_ADMIN_TOKEN must be set in production");
    }, T);
    it("without a secret key base", async () => {
      expectRefusal(await refused("no-key", (e) => { delete e.SECRET_KEY_BASE; }), "SECRET_KEY_BASE is missing");
    }, T);
    it("with a wildcard CORS origin", async () => {
      expectRefusal(await refused("cors-star", (e) => { e.BL_CORS_ORIGINS = "*"; }), "BL_CORS_ORIGINS", "is not allowed in production");
    }, T);
    it("with a plain-http CORS origin", async () => {
      expectRefusal(await refused("cors-http", (e) => { e.BL_CORS_ORIGINS = "http://example.org"; }), "BL_CORS_ORIGINS", "is not allowed in production");
    }, T);
    it("with a count that is not a number", async () => {
      expectRefusal(await refused("bad-count", (e) => { e.BL_MAX_ISLANDS = "lots"; }), `BL_MAX_ISLANDS: "lots" is not a positive whole number`);
    }, T);
    it("with a garden switch that is neither on nor off", async () => {
      expectRefusal(await refused("bad-switch", (e) => { e.BL_GARDEN_SCHEDULING = "maybe"; }), "BL_GARDEN_SCHEDULING must be on or off");
    }, T);
    it("with a relative discovery directory under the read-only /app", async () => {
      const r = await refused("relative-dir", (e) => { e.BL_DISCOVERY_DATA_DIR = "data-discovery"; });
      expectRefusal(r);
      expect(/eacces|permission denied|eperm|read-only/i.test(r.logs), "no permission error in the logs").toBe(true);
      expect(r.diff.includes("/app/data-discovery"), "a directory was created under /app").toBe(false);
    }, T);
    it("with the discovery directory inside the data directory", async () => {
      expectRefusal(await refused("inside-data", (e) => { e.BL_DISCOVERY_DATA_DIR = "/data/discovery"; }), "overlaps the registered queue's");
    }, T);
    it("with the discovery directory equal to the data directory", async () => {
      expectRefusal(await refused("equal-data", (e) => { e.BL_DISCOVERY_DATA_DIR = "/data"; }), "overlaps the registered queue's");
    }, T);
  });
});
