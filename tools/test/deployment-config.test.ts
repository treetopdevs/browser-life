// Real configuration/wire checks; set BL_REQUIRE_DEPLOY_TOOLS=1 in release checks
// to fail rather than skip when Caddy or Docker Compose is not installed.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const caddyBin = process.env.BL_CADDY_BIN || "caddy";
const hasCaddy = spawnSync(caddyBin, ["version"], { timeout: 5000 }).status === 0;
const hasCompose = spawnSync("docker", ["compose", "version"], { timeout: 5000 }).status === 0;
const optional = ["BL_TRUST_FORWARDED_FOR", "BL_ISLAND_JOINS_PER_ADDRESS", "BL_MAX_ISLANDS", "BL_CORS_ORIGINS", "BL_LEASE_MS"];
const cleanEnv = { ...process.env };
for (const name of [...optional, "BL_TRUSTED_PROXY_CIDRS", "COMPOSE_FILE", "COMPOSE_PROFILES"]) delete cleanEnv[name];

it("has required deployment tools when the release gate is requested", () => {
  if (process.env.BL_REQUIRE_DEPLOY_TOOLS === "1") {
    expect(hasCaddy, "Caddy is required").toBe(true);
    expect(hasCompose, "Docker Compose is required").toBe(true);
  }
});

function compose(overrides: Record<string, string> = {}, host = false) {
  const args = ["compose", "--env-file", "/dev/null", "-f", join(repo, "compose.dokploy.yaml")];
  if (host) args.push("-f", join(repo, "deploy/compose.traefik.yaml"));
  args.push("config", "--format", "json");
  const result = spawnSync("docker", args, {
    cwd: repo, encoding: "utf8", timeout: 15_000,
    env: { ...cleanEnv, SECRET_KEY_BASE: "synthetic-key-".repeat(8), BL_ADMIN_TOKEN: "synthetic-admin", BL_DISCOVERY_JOIN_TOKEN: "synthetic-discovery", ...overrides },
  });
  expect(result.status, result.stderr || String(result.error)).toBe(0);
  return JSON.parse(result.stdout).services;
}

describe.skipIf(!hasCompose)("resolved deployment configuration", () => {
  it("keeps address trust and optional limits unset by default", () => {
    const services = compose();
    for (const name of optional) expect(services.coordinator.environment[name], name).toBe("");
    expect(services.site.environment.BL_TRUSTED_PROXY_CIDRS).toBe("");
  });
  it("passes operator values to the correct containers in both deployment modes", () => {
    const values = { BL_TRUSTED_PROXY_CIDRS: "172.30.0.2/32 2001:db8::2/128", BL_TRUST_FORWARDED_FOR: "1", BL_ISLAND_JOINS_PER_ADDRESS: "20", BL_MAX_ISLANDS: "1000", BL_CORS_ORIGINS: "https://worker.example", BL_LEASE_MS: "120000" };
    for (const host of [false, true]) {
      const services = compose(values, host);
      for (const name of optional) expect(services.coordinator.environment[name], name).toBe(values[name as keyof typeof values]);
      expect(services.site.environment.BL_TRUSTED_PROXY_CIDRS).toBe(values.BL_TRUSTED_PROXY_CIDRS);
    }
  });
  it("keeps the coordinator private and garden scheduling disabled", () => {
    for (const host of [false, true]) {
      const services = compose({}, host);
      expect(services.coordinator.ports ?? []).toEqual([]);
      expect(Object.keys(services.coordinator.networks)).toEqual(["default"]);
      expect(services.coordinator.environment.BL_GARDEN_SCHEDULING).toBe("off");
    }
  });
});

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test port");
  return address.port;
}

describe.skipIf(!hasCaddy)("Caddy proxy allowlist validation", () => {
  for (const [ranges, valid] of [["", true], ["127.0.0.1/32 2001:db8::2/128", true], ["not-a-cidr", false], ["127.0.0.1/32,2001:db8::2/128", false]] as const) {
    it(`validates allowlist ${JSON.stringify(ranges)}`, () => {
      const result = spawnSync(caddyBin, ["validate", "--config", "-", "--adapter", "caddyfile"], {
        input: readFileSync(join(repo, "deploy/Caddyfile"), "utf8"), encoding: "utf8", timeout: 5000,
        env: { ...cleanEnv, BL_TRUSTED_PROXY_CIDRS: ranges },
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(valid ? 0 : 1);
    });
  }
});

for (const mode of ["empty", "trusted-peer", "untrusted-peer"] as const) {
  const trusted = mode === "trusted-peer";
  const ranges = trusted ? "127.0.0.1/32 2001:db8::2/128" : mode === "empty" ? "" : "192.0.2.2/32";
  describe.skipIf(!hasCaddy)(`Caddy forwarding with ${mode}`, () => {
    let upstream: Server;
    let child: ChildProcess;
    let directory: string;
    let origin: string;
    let log = "";
    beforeAll(async () => {
      directory = mkdtempSync(join(tmpdir(), "bl-proxy-"));
      upstream = createServer((req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ path: req.url, xff: req.headers["x-forwarded-for"], proto: req.headers["x-forwarded-proto"], realIp: req.headers["x-real-ip"], forwarded: req.headers["forwarded"] }));
      });
      const upstreamPort = await listen(upstream);
      const reservation = createServer();
      const port = await listen(reservation);
      await new Promise<void>((resolve) => reservation.close(() => resolve()));
      origin = `http://127.0.0.1:${port}`;
      const source = readFileSync(join(repo, "deploy/Caddyfile"), "utf8");
      const isolated = source.startsWith("{\n") ? source.replace(/^\{/, "{\n admin off\n persist_config off") : `{\n admin off\n persist_config off\n}\n${source}`;
      const config = isolated
        .replace(/^:80 \{/m, `http://127.0.0.1:${port} {`)
        .replaceAll("coordinator:4000", `127.0.0.1:${upstreamPort}`)
        .replace("root * /srv", `root * ${directory}`);
      const path = join(directory, "Caddyfile");
      writeFileSync(path, config);
      child = spawn(caddyBin, ["run", "--config", path, "--adapter", "caddyfile"], { env: { ...cleanEnv, BL_TRUSTED_PROXY_CIDRS: ranges }, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout?.on("data", (data) => { log += data; });
      child.stderr?.on("data", (data) => { log += data; });
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) throw new Error(log);
        try { if ((await fetch(origin + "/api/ready")).ok) return; } catch { /* starting */ }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Caddy did not start: ${log}`);
    }, 15_000);
    afterAll(async () => {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      if (upstream) await new Promise<void>((resolve) => upstream.close(() => resolve()));
      if (directory) rmSync(directory, { recursive: true, force: true });
    });

    for (const route of ["/api/probe", "/healthz"]) {
      it(`replaces forged chains with one resolved address on ${route}`, async () => {
        for (const visitor of ["203.0.113.10", "203.0.113.11", "2001:db8::17"]) {
          const res = await fetch(origin + route, { headers: { "X-Forwarded-For": `198.51.100.99, ${visitor}, 127.0.0.1`, "X-Real-IP": "198.51.100.88", "X-Forwarded-Proto": "http" } });
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.xff).toBe(trusted ? visitor : "127.0.0.1");
          expect(body.proto).toBe("https");
          expect(body.path).toBe(route === "/healthz" ? "/api/public/status" : route);
        }
      });
      it(`ignores attacker prefixes and alternate headers when selecting the address on ${route}`, async () => {
        for (const prefix of ["198.51.100.1", "198.51.100.2, 198.51.100.3"]) {
          const body = await (await fetch(origin + route, { headers: { "X-Forwarded-For": `${prefix}, 203.0.113.10`, "X-Real-IP": "198.51.100.88", "Forwarded": "for=198.51.100.77" } })).json();
          expect(body.xff).toBe(trusted ? "203.0.113.10" : "127.0.0.1");
          // These headers remain untrusted data; Phoenix budgets read only XFF.
          expect(body.realIp).toBe("198.51.100.88");
          expect(body.forwarded).toBe("for=198.51.100.77");
        }
      });
      it(`normalizes an address with a source port on ${route}`, async () => {
        const body = await (await fetch(origin + route, { headers: { "X-Forwarded-For": "198.51.100.1, 203.0.113.10:1234" } })).json();
        expect(body.xff).toBe(trusted ? "203.0.113.10" : "127.0.0.1");
      });
      it(`falls back to the peer for absent or invalid forwarding on ${route}`, async () => {
        const cases: Record<string, string>[] = [{}, { "X-Forwarded-For": "not-an-ip" }, { "X-Forwarded-For": "127.0.0.1" }, { "X-Real-IP": "198.51.100.88" }];
        for (const headers of cases) {
          const body = await (await fetch(origin + route, { headers })).json();
          expect(body.xff).toBe("127.0.0.1");
        }
      });
    }
    it("forwards garden APIs to the coordinator and redirects /garden", async () => {
      for (const route of ["/api/garden/test", "/api/gardens/test", "/api/public/gardens/test"]) {
        const res = await fetch(origin + route);
        expect(res.status, route).toBe(200);
        expect((await res.json()).path, route).toBe(route);
      }
      const res = await fetch(origin + "/garden?x=1", { redirect: "manual" });
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe("/garden/?x=1");
    });
  });
}
