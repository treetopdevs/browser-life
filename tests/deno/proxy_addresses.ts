// Local release gate: actual deployment Caddyfile -> real Phoenix/Queue/limiter.
// deno run --no-lock -A tests/deno/proxy_addresses.ts
// BL_CADDY_BIN selects a production-line Caddy binary. No GPU, Docker daemon,
// real credentials, public network listeners or production data are used.
import { createServer, request } from "node:http";
import { once } from "node:events";

const root = Deno.cwd();
const scratch = await Deno.makeTempDir({ prefix: "bl-proxy-addresses-" });
const caddy = Deno.env.get("BL_CADDY_BIN") || "caddy";
const version = await new Deno.Command(caddy, { args: ["version"], stdout: "piped" }).output();
if (!version.success) throw new Error("Caddy is required for this release gate");
console.log(new TextDecoder().decode(version.stdout).trim());
async function port() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no test port");
  const result = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return result;
}
const coordinatorPort = await port();
const proxyPort = await port();
const children: { child: Deno.ChildProcess; output: Promise<Deno.CommandOutput> }[] = [];
function spawn(command: string, args: string[], cwd: string, env: Record<string, string>) {
  const child = new Deno.Command(command, { args, cwd, env, stdout: "piped", stderr: "piped" }).spawn();
  children.push({ child, output: child.output() });
}
async function ready(url: string) {
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}
async function join(headers: string[]) {
  const body = JSON.stringify({ host: "proxy-release-test", adapter: "synthetic", metricsVersion: 1 });
  // Raw header pairs preserve duplicate XFF fields on the wire.
  return await new Promise<number>((resolve, reject) => {
    const req = request(`http://127.0.0.1:${proxyPort}/api/islands`, {
      method: "POST", headers: ["Host", `127.0.0.1:${proxyPort}`, "Content-Type", "application/json", "Content-Length", String(new TextEncoder().encode(body).length), ...headers],
      timeout: 5000,
    }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("join timeout")));
    req.end(body);
  });
}
function check(label: string, actual: number, expected: number) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
  console.log(`PASS ${label} (${actual})`);
}
try {
  const bootstrap = `
Application.put_env(:coordinator, :start_queue, true)
Application.put_env(:coordinator, :start_discovery, false)
Application.put_env(:coordinator, :trust_forwarded_for, true)
Application.put_env(:coordinator, :island_joins_per_address, 1)
Application.put_env(:coordinator, :island_requests_per_address, nil)
config = Application.fetch_env!(:coordinator, CoordinatorWeb.Endpoint)
Application.put_env(:coordinator, CoordinatorWeb.Endpoint, Keyword.merge(config, server: true, http: [ip: {127,0,0,1}, port: ${coordinatorPort}]))
{:ok, _} = Application.ensure_all_started(:coordinator)
Process.sleep(:infinity)
`;
  spawn("mix", ["run", "--no-start", "-e", bootstrap], `${root}/apps/coordinator`, {
    MIX_ENV: "test", BL_DATA_DIR: `${scratch}/data`, BL_DISCOVERY_DATA_DIR: `${scratch}/discovery`,
    BL_GARDEN_SCHEDULING: "off", BL_CORS_ORIGINS: "", BL_ISLAND_JOINS_PER_ADDRESS: "", BL_MAX_ISLANDS: "", BL_LEASE_MS: "",
    BL_ADMIN_TOKEN: "", BL_DISCOVERY_JOIN_TOKEN: "", BL_GARDEN_ISLAND_TOKEN: "",
  });
  await ready(`http://127.0.0.1:${coordinatorPort}/api/public/status`);
  const config = (await Deno.readTextFile(`${root}/deploy/Caddyfile`))
    .replace(/^\{/, "{\n admin off\n persist_config off")
    .replace(/^:80 \{/m, `http://127.0.0.1:${proxyPort} {`)
    .replaceAll("coordinator:4000", `127.0.0.1:${coordinatorPort}`)
    .replace("root * /srv", `root * ${scratch}`);
  const file = `${scratch}/Caddyfile`;
  await Deno.writeTextFile(file, config);
  spawn(caddy, ["run", "--config", file, "--adapter", "caddyfile"], scratch, { BL_TRUSTED_PROXY_CIDRS: "127.0.0.1/32" });
  await ready(`http://127.0.0.1:${proxyPort}/healthz`);
  check("visitor A joins", await join(["X-Forwarded-For", "198.51.100.1, 203.0.113.10"]), 200);
  check("A cannot reset budget using a forged prefix", await join(["X-Forwarded-For", "198.51.100.2, 203.0.113.10"]), 429);
  check("A cannot reset budget using duplicate fields", await join(["X-Forwarded-For", "198.51.100.3", "X-Forwarded-For", "203.0.113.10"]), 429);
  check("visitor B keeps a separate budget", await join(["X-Forwarded-For", "203.0.113.11"]), 200);
  check("IPv6 visitor joins", await join(["X-Forwarded-For", "2001:db8::17"]), 200);
  check("IPv6 spelling does not reset budget", await join(["X-Forwarded-For", "2001:0db8:0:0:0:0:0:17"]), 429);
  check("missing header falls back to peer", await join([]), 200);
  check("malformed header shares peer budget", await join(["X-Forwarded-For", "not-an-ip"]), 429);
} finally {
  for (const { child } of children.reverse()) {
    try { child.kill("SIGTERM"); } catch { /* already stopped */ }
  }
  try {
    for (const { child, output } of children) {
      const force = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already stopped */ } }, 5000);
      try {
        const result = await output;
        if (result.code !== 0 && result.signal !== "SIGTERM") console.error(new TextDecoder().decode(result.stderr).slice(-5000));
      } finally { clearTimeout(force); }
    }
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}
