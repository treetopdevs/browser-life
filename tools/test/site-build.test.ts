// The public site as deployed: builds apps/lab into a scratch directory and checks the per-world copies of the lab
// and Worlds pages that link previews depend on (written by vite.config.ts's writeBundle), then, where Caddy is
// installed, serves the build through deploy/Caddyfile and checks what a link naming a world is actually sent.
// Here rather than in apps/lab/test because it needs Node's file system and processes, which the browser-typed
// typecheck of apps/lab does not include.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const cards = JSON.parse(readFileSync(repo("apps/lab/public/og/worlds/manifest.json"), "utf8")) as Record<string, { id: string; name: string }>;
const ids = Object.keys(cards);
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
const metaOf = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];

let dir = "";
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bl-site-"));
  await build({ configFile: repo("apps/lab/vite.config.ts"), root: repo("apps/lab"), logLevel: "silent", build: { outDir: dir, emptyOutDir: true } });
}, 120_000);
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("the built site", () => {
  it("has a copy of the lab and the Worlds page for every world, each previewing as that world", () => {
    expect(ids.length).toBeGreaterThanOrEqual(40);
    for (const id of ids) {
      for (const page of ["lab", "worlds"]) {
        const file = join(dir, page, "world", id, "index.html");
        expect(existsSync(file), file).toBe(true);
        const html = readFileSync(file, "utf8");
        expect(metaOf(html, "og:url")).toBe(`https://cadence.garden/${page}/?world=${id}`);
        expect(metaOf(html, "og:image")).toBe(`https://cadence.garden/og/worlds/${id}.jpg`);
        expect(html).toContain(`<link rel="canonical" href="https://cadence.garden/${page}/" />`);
        expect(titleOf(html)).toContain(cards[id].name.replace(/&/g, "&amp;"));
        expect(existsSync(join(dir, "og", "worlds", `${id}.jpg`))).toBe(true);
      }
    }
  });
});

const caddyBin = process.env.BL_CADDY_BIN || "caddy";
const caddy = spawnSync(caddyBin, ["version"]).status === 0;

// BL_REQUIRE_DEPLOY_TOOLS=1 (release checks, CI) makes a missing Caddy a failure rather than a skipped block.
it("has Caddy when the release gate is requested", () => {
  if (process.env.BL_REQUIRE_DEPLOY_TOOLS === "1") expect(caddy, "Caddy is required").toBe(true);
});

describe.skipIf(!caddy)("served through deploy/Caddyfile", () => {
  let server: ChildProcess | undefined;
  let file = "";
  let log = "";
  let origin = "";
  const get = (path: string) => fetch(origin + path, { redirect: "manual" });

  beforeAll(async () => {
    // An address that was free a moment ago; if something takes it first, Caddy cannot bind, exits, and the check below fails.
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    origin = `http://127.0.0.1:${port}`;

    // The explicit http://127.0.0.1 address makes the listener plain HTTP on loopback only.
    const config = readFileSync(repo("deploy/Caddyfile"), "utf8").replace(/^:80 \{/m, `http://127.0.0.1:${port} {`).replace("root * /srv", `root * ${dir}`);
    if (!config.includes(`http://127.0.0.1:${port} {`) || !config.includes(dir)) throw new Error("could not point the Caddyfile at the build");
    file = join(dir, "..", `Caddyfile-${port}`);
    // Caddy allows one global block: the Caddyfile opens with its own, so admin off goes inside it.
    if (!config.startsWith("{\n")) throw new Error("the Caddyfile must open with its global block");
    writeFileSync(file, config.replace(/^\{/, "{\n  admin off"));
    // Ready means this process answered with a token only this run wrote into its scratch build, so another
    // listener on the port cannot pass for it, and a Caddy that exited cannot either.
    const sentinel = `bl-ready-${randomUUID()}.txt`;
    const token = randomUUID();
    writeFileSync(join(dir, sentinel), token);
    server = spawn(caddyBin, ["run", "--config", file, "--adapter", "caddyfile"], { env: { ...process.env, BL_TRUSTED_PROXY_CIDRS: "" }, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout?.on("data", (data) => { log += data; });
    server.stderr?.on("data", (data) => { log += data; });
    let spawnError: Error | undefined;
    server.once("error", (error) => { spawnError = error; });
    for (let i = 0; i < 100; i++) {
      if (spawnError || server.exitCode !== null || server.signalCode !== null) throw new Error(`caddy exited: ${spawnError ?? ""}\n${log}`);
      try { if ((await (await get(`/${sentinel}`)).text()) === token) return; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`caddy did not start\n${log}`);
  }, 30_000);
  afterAll(async () => {
    if (server?.pid && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      const stopped = async (ms: number) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([exited.then(() => true), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); })]);
        } finally { if (timer) clearTimeout(timer); }
      };
      server.kill("SIGTERM");
      if (!await stopped(5000)) {
        server.kill("SIGKILL");
        if (!await stopped(5000)) throw new Error(`Caddy termination could not be confirmed; retained ${file}\n${log}`);
      }
    }
    if (file) rmSync(file, { force: true });
  });

  it("sends a link naming a known world that world's copy, on either page, whatever else the query holds", async () => {
    for (const [path, title] of [
      ["/lab/?world=ponds&seed=12", `${cards.ponds.name} · Cadence Garden`],
      ["/lab/?seed=3&world=planet-motile", `${cards["planet-motile"].name} · Cadence Garden`],
      ["/worlds/?world=ponds", `${cards.ponds.name} · The worlds · Cadence Garden`],
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(titleOf(await res.text()), path).toBe(title);
    }
  });

  it("sends anything else the plain page", async () => {
    const lab = titleOf(await (await get("/lab/")).text());
    const worlds = titleOf(await (await get("/worlds/")).text());
    for (const path of ["/lab/?world=nope", "/lab/?world=..%2F..%2Findex", "/lab/?world=PONDS", "/lab/?world="]) {
      expect(titleOf(await (await get(path)).text()), path).toBe(lab);
    }
    expect(titleOf(await (await get("/worlds/?world=nope")).text())).toBe(worlds);
  });

  it("sends a copy opened directly, or a page without its slash, to the address it stands for", async () => {
    for (const [path, to] of [
      ["/lab/world/ponds/", "/lab/?world=ponds"],
      ["/worlds/world/ponds/index.html", "/worlds/?world=ponds"],
      ["/worlds?world=ponds", "/worlds/?world=ponds"],
      ["/lab", "/lab/"],
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(308);
      expect(res.headers.get("location"), path).toBe(to);
    }
  });
});
