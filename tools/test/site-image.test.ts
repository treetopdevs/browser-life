// The site image as built from Dockerfile.site, started the way it is deployed: its default command, its embedded
// /etc/caddy/Caddyfile and /srv, nothing mounted over either. A synthetic coordinator (the same image running a tiny
// Caddyfile) answers on the network alias `coordinator` of a private bridge network; only the site's port 80 is
// published, on an ephemeral 127.0.0.1 port. The forwarding matrix with a trusted proxy list stays in
// deployment-config.test.ts, run against the Caddy binary extracted from this image (BL_CADDY_BIN).
//
// BL_SITE_IMAGE is an immutable image ID (sha256:<64 hex>), e.g. from `docker build --iidfile`. Without it the suite
// skips and no Docker command runs. BL_REQUIRE_SITE_IMAGE=1 makes a missing or invalid ID, an unusable Docker or the
// image's absence fail instead. BL_SITE_IMAGE_CI_RUN adds a second label so a CI job can remove what a cancelled run
// left behind (see .github/workflows/site-image.yml). Not claimed: Traefik, TLS or the live host.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const image = process.env.BL_SITE_IMAGE ?? "";
const required = process.env.BL_REQUIRE_SITE_IMAGE === "1";
const valid = /^sha256:[0-9a-f]{64}$/.test(image);
// Docker is only asked about a valid ID: with BL_SITE_IMAGE unset nothing here touches the daemon.
const usable = valid && spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", image], { timeout: 20_000, killSignal: "SIGKILL" }).status === 0;

it("has the site image and a working Docker when the image gate is requested or an image is named", () => {
  if (!required && !image) return;
  expect(image, "BL_SITE_IMAGE must name the image").not.toBe("");
  expect(valid, "BL_SITE_IMAGE must be an image ID, sha256: and 64 hex digits").toBe(true);
  expect(usable, "Docker must be available and know the image ID").toBe(true);
});

type Raw = { status: number; headers: IncomingHttpHeaders; body: string };
/** One request with its target sent as written (fetch resolves `/./` and `/x/../` first). */
function raw(origin: string, path: string, init: { method?: string; headers?: Record<string, string | string[]> } = {}): Promise<Raw> {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: hostname, port, path, method: init.method ?? "GET", headers: { Accept: "text/html", ...init.headers } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.setTimeout(10_000, () => req.destroy(new Error(`timeout: ${path}`)));
    req.on("error", reject);
    req.end();
  });
}

const cards = JSON.parse(readFileSync(repo("apps/lab/public/og/worlds/manifest.json"), "utf8")) as Record<string, { id: string; name: string }>;
const ids = Object.keys(cards);
const TITLE = "<title>Page not found · Cadence Garden</title>";
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
const metaOf = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];
const PAGES = ["/", "/lab/", "/worlds/", "/how-it-works/", "/research/", "/about/", "/participate/", "/status/", "/privacy/", "/garden/"];

// What the synthetic coordinator says; the site must pass these through untouched.
const NOT_FOUND = "upstream-not-found";
const BUSY = "upstream-busy";
// (The explicit `*` matcher: a body opening with a placeholder would otherwise be read as the matcher and sent empty.)
const upstreamCaddyfile = `{
  admin off
  persist_config off
  auto_https off
}
:4000 {
  handle /api/no-such* {
    respond "${NOT_FOUND}" 404
  }
  handle /api/busy* {
    header Retry-After 1
    respond "${BUSY}" 503
  }
  handle {
    respond * "{http.request.uri.path}|{http.request.header.X-Forwarded-For}|{http.request.header.X-Forwarded-Proto}" 200
  }
}
`;
/** The echo the synthetic coordinator sends for anything else: what Caddy forwarded. */
const echo = (res: Raw) => {
  const [path, xff, proto, ...rest] = res.body.split("|");
  expect(rest, res.body).toEqual([]);
  return { path, xff, proto };
};

describe.skipIf(!usable)("the site image, started as deployed", () => {
  const id = randomBytes(6).toString("hex");
  const ci = process.env.BL_SITE_IMAGE_CI_RUN;
  const labels = ["--label", `bl.site-image.invocation=${id}`, ...(ci ? ["--label", `bl.site-image.ci=${ci}`] : [])];
  // Every name is recorded before the command that creates it: a Docker CLI that times out leaves its container
  // behind, and removing by name reaches it. Only these names are ever removed.
  const containers: string[] = [];
  let network = "";
  let scratch = "";
  let site = "";
  let upstream = "";
  let origin = "";
  let cleanedUp = false;
  let survivors: string[] = [];

  const docker = (args: string[], timeout = 30_000) =>
    spawnSync("docker", args, { encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024 });
  const must = (args: string[], timeout?: number) => {
    const result = docker(args, timeout);
    if (result.status !== 0) throw new Error(`docker ${args.join(" ")}: ${result.error ?? ""}${result.stderr}`);
    return result.stdout;
  };
  const logs = (name: string) => { const r = docker(["logs", "--tail", "40", name], 10_000); return r.stdout + r.stderr; };
  const gone = (kind: "container" | "network", name: string) => {
    // Exit 1 from inspect also means a broken daemon/transport. Only a successful
    // listing of this invocation's resources can confirm that a name is absent.
    const args = kind === "container"
      ? ["ps", "-a", "--filter", `label=bl.site-image.invocation=${id}`, "--format", "{{.Names}}"]
      : ["network", "ls", "--filter", `label=bl.site-image.invocation=${id}`, "--format", "{{.Name}}"];
    const result = docker(args, 10_000);
    return result.status === 0 && !result.stdout.trim().split("\n").includes(name);
  };

  /** Removes what this invocation created, containers (and their anonymous volumes) first; returns what survived. */
  function cleanup(): string[] {
    if (cleanedUp) return survivors;
    cleanedUp = true;
    const left: string[] = [];
    for (const name of [...containers].reverse()) {
      const result = docker(["rm", "-f", "-v", name]);
      if (result.status !== 0 && !gone("container", name)) left.push(`container ${name}: ${result.error ?? ""}${result.stderr}`);
    }
    if (network) {
      const result = docker(["network", "rm", network]);
      if (result.status !== 0 && !gone("network", network)) left.push(`network ${network}: ${result.error ?? ""}${result.stderr}`);
    }
    // Files go after the processes that read them.
    if (scratch && left.length === 0) rmSync(scratch, { recursive: true, force: true });
    survivors = left;
    return left;
  }

  beforeAll(async () => {
    process.once("exit", () => { cleanup(); });
    try {
      console.info(`Site image test invocation: ${id} (label bl.site-image.invocation=${id})`);
      scratch = mkdtempSync(join(tmpdir(), "bl-site-image-"));
      chmodSync(scratch, 0o755);
      writeFileSync(join(scratch, "upstream.Caddyfile"), upstreamCaddyfile, { mode: 0o644 });

      network = `bl-site-image-${id}-net`;
      must(["network", "create", "--driver", "bridge", ...labels, network]);
      upstream = `bl-site-image-${id}-coordinator`;
      containers.push(upstream);
      must(["run", "-d", "--pull=never", "--name", upstream, ...labels, "--network", network, "--network-alias", "coordinator",
        "-v", `${join(scratch, "upstream.Caddyfile")}:/etc/caddy/upstream.Caddyfile:ro`,
        image, "caddy", "run", "--config", "/etc/caddy/upstream.Caddyfile", "--adapter", "caddyfile"], 60_000);
      // The site: no command, no environment, no mounts.
      site = `bl-site-image-${id}-site`;
      containers.push(site);
      must(["run", "-d", "--pull=never", "--name", site, ...labels, "--network", network, "-p", "127.0.0.1::80", image], 60_000);

      const deadline = Date.now() + 45_000;
      for (;;) {
        for (const name of [upstream, site]) {
          const running = docker(["inspect", "--format", "{{.State.Running}}", name], 10_000).stdout.trim();
          if (running !== "true") throw new Error(`${name} is not running:\n${logs(name)}`);
        }
        if (!origin) {
          const port = /127\.0\.0\.1:(\d+)/.exec(docker(["port", site, "80/tcp"], 10_000).stdout)?.[1];
          if (port) origin = `http://127.0.0.1:${port}`;
        }
        // The answer is the synthetic coordinator's echo, so it comes from this stack and nothing else on the host.
        if (origin) {
          const ready = await raw(origin, "/api/ready").catch(() => undefined);
          if (ready?.status === 200 && ready.body.startsWith("/api/ready|")) break;
        }
        if (Date.now() > deadline) throw new Error(`the stack did not answer within 45 s\nsite:\n${logs(site)}\ncoordinator:\n${logs(upstream)}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch (error) {
      cleanup();
      throw error;
    }
  }, 180_000);

  afterAll(() => {
    // Preserve logs in the job output before removing containers, including assertion failures.
    if (!cleanedUp) for (const name of containers) console.info(`Container logs (${name}):\n${logs(name)}`);
    const left = cleanup();
    if (left.length) throw new Error(`could not remove:\n${left.join("\n")}`);
  }, 120_000);

  it("embeds the Caddyfile in the repository", () => {
    expect(must(["exec", site, "cat", "/etc/caddy/Caddyfile"])).toBe(readFileSync(repo("deploy/Caddyfile"), "utf8"));
  });

  it("packages the lab files, the media and the garden", () => {
    const files = new Set(must(["exec", site, "find", "/srv"]).split("\n").filter(Boolean));
    expect(files.has("/srv/lab/index.html"), "packaged lab content: /srv/lab/index.html is missing from the image").toBe(true);
    const wanted = [
      "/srv/index.html", "/srv/404.html", "/srv/worlds/index.html", "/srv/garden/index.html", "/srv/robots.txt", "/srv/sitemap.xml", "/srv/site.webmanifest", "/srv/favicon.svg",
      ...ids.flatMap((world) => [`/srv/lab/world/${world}/index.html`, `/srv/worlds/world/${world}/index.html`, `/srv/og/worlds/${world}.jpg`]),
    ];
    expect(wanted.filter((file) => !files.has(file)), "packaged files missing from the image").toEqual([]);
  });

  it("serves every page with the styles and scripts it names", async () => {
    const assets = new Set<string>();
    for (const path of PAGES) {
      const res = await raw(origin, path);
      expect(res.status, path).toBe(200);
      expect(res.headers["content-type"], path).toMatch(/^text\/html/);
      expect(titleOf(res.body), path).toBeTruthy();
      expect(res.body, path).not.toContain(TITLE);
      for (const [, url] of res.body.matchAll(/\s(?:src|href)="(\/[^"]*)"/g)) {
        const clean = url.split(/[?#]/)[0];
        if (!url.startsWith("//") && /\.(?:css|js|mjs)$/.test(clean)) assets.add(clean);
      }
    }
    expect([...assets].filter((a) => a.endsWith(".css")).length, "stylesheets named by the pages").toBeGreaterThan(0);
    expect([...assets].filter((a) => !a.endsWith(".css")).length, "scripts named by the pages").toBeGreaterThan(0);
    for (const asset of assets) {
      const res = await raw(origin, asset, { headers: { Accept: "*/*" } });
      expect(res.status, asset).toBe(200);
      expect(res.headers["content-type"], asset).toMatch(asset.endsWith(".css") ? /text\/css/ : /javascript/);
      if (asset.startsWith("/assets/")) expect(res.headers["cache-control"], asset).toContain("immutable");
    }
  });

  it("sends /lab to /lab/ and a link naming a world that world's preview", async () => {
    const bare = await raw(origin, "/lab");
    expect([bare.status, bare.headers.location]).toEqual([308, "/lab/"]);
    const copy = await raw(origin, "/lab/world/ponds/");
    expect([copy.status, copy.headers.location]).toEqual([308, "/lab/?world=ponds"]);
    for (const [path, title, page, world] of [
      ["/lab/?world=ponds&seed=12", `${cards.ponds.name} · Cadence Garden`, "lab", "ponds"],
      ["/worlds/?world=planet-motile", `${cards["planet-motile"].name} · The worlds · Cadence Garden`, "worlds", "planet-motile"],
    ]) {
      const res = await raw(origin, path);
      expect(res.status, path).toBe(200);
      expect(titleOf(res.body), path).toBe(title);
      expect(metaOf(res.body, "og:url"), path).toBe(`https://cadence.garden/${page}/?world=${world}`);
      expect(metaOf(res.body, "og:image"), path).toBe(`https://cadence.garden/og/worlds/${world}.jpg`);
    }
    const plain = await raw(origin, "/lab/?world=no-such-world");
    expect(metaOf(plain.body, "og:url"), "an unknown world gets the plain lab").toBe("https://cadence.garden/lab/");
  });

  const expectPage = (res: Raw, path: string) => {
    expect(res.status, path).toBe(404);
    expect(res.headers["content-type"], path).toMatch(/^text\/html/);
    expect(res.body, path).toContain(TITLE);
  };

  it("answers a miss with the whole 404 page, never stored", async () => {
    for (const path of ["/no-such-page/", "/no-such-page", "/a/b/c.html", "/lab/no-such-page/", "/assets/no-such.js", "/fonts/no-such.woff2", "/api", "/healthz/"]) {
      const res = await raw(origin, path);
      expectPage(res, path);
      expect(res.headers["cache-control"], `${path}: a miss is never stored`).toBe("no-store");
      expect(res.headers.etag, `${path}: no ETag`).toBeUndefined();
      expect(res.headers["last-modified"], `${path}: no Last-Modified`).toBeUndefined();
      expect(res.body, path).toMatch(/<meta name="robots" content="noindex"/);
      expect(res.body, path).not.toContain('rel="canonical"');
    }
    expect((await raw(origin, "/no-such-page/", { method: "HEAD" })).status, "HEAD").toBe(404);
  });

  it("answers the 404 page asked for by name with 404, under every spelling", async () => {
    for (const path of ["/404.html", "/404%2ehtml", "//404.html", "/./404.html", "/x/../404.html", "/404.HTML", "/404.html?raw"]) {
      const res = await raw(origin, path);
      expectPage(res, path);
      expect(res.headers.etag, path).toBeUndefined();
      expect(res.headers["last-modified"], path).toBeUndefined();
    }
    const slashed = await raw(origin, "/404.html/");
    expect([slashed.status, slashed.headers.location]).toEqual([308, "/404.html"]);
  });

  it("keeps the whole 404 page for a conditional or ranged request", async () => {
    const full = await raw(origin, "/no-such-page/");
    expectPage(full, "plain");
    const conditions: Record<string, string>[] = [
      { "If-None-Match": "*" },
      { "If-Modified-Since": "Fri, 01 Jan 2100 00:00:00 GMT" },
      { "If-Match": '"no-such-etag"' },
      { "If-Unmodified-Since": "Thu, 01 Jan 1970 00:00:00 GMT" },
      { Range: "bytes=0-10" },
      { Range: "bytes=0-10", "If-Range": '"no-such-etag"' },
    ];
    for (const headers of conditions) {
      const label = JSON.stringify(headers);
      const res = await raw(origin, "/no-such-page/", { headers });
      expectPage(res, label);
      expect(res.body, label).toBe(full.body);
      expect(res.headers["content-range"], label).toBeUndefined();
    }
    // The same on a missing asset, whose cache headers are otherwise the immutable year.
    const asset = await raw(origin, "/assets/no-such.js", { headers: { "If-None-Match": "*", Range: "bytes=0-10" } });
    expectPage(asset, "/assets/no-such.js");
    expect(asset.body).toBe(full.body);
  });

  it("serves the garden page and sends every garden API to the coordinator", async () => {
    const bare = await raw(origin, "/garden");
    expect([bare.status, bare.headers.location]).toEqual([308, "/garden/"]);
    const copy = await raw(origin, "/garden?x=1");
    expect([copy.status, copy.headers.location]).toEqual([308, "/garden/?x=1"]);
    for (const path of [
      "/api/public/garden", "/api/public/garden/letters", "/api/public/gardens/commons", "/api/public/gardens/commons/checkpoints/abc",
      "/api/gardens", "/api/gardens/commons/days/0/requeue", "/api/garden/test",
    ]) {
      for (const method of ["GET", "POST"]) {
        const res = await raw(origin, path, { method });
        expect(res.status, `${method} ${path}`).toBe(200);
        expect(echo(res).path, `${method} ${path}`).toBe(path);
      }
    }
  });

  it("sends /api/* and /healthz to the coordinator as https, /healthz as its status route", async () => {
    for (const [path, reached] of [["/api/probe", "/api/probe"], ["/API/public/status", "/API/public/status"], ["/healthz", "/api/public/status"]]) {
      const res = await raw(origin, path);
      expect(res.status, path).toBe(200);
      expect(res.body, path).not.toContain(TITLE);
      expect(echo(res).path, path).toBe(reached);
      expect(echo(res).proto, path).toBe("https");
    }
  });

  it("passes the coordinator's own 404 and 503 through", async () => {
    const missing = await raw(origin, "/api/no-such");
    expect([missing.status, missing.body]).toEqual([404, NOT_FOUND]);
    const busy = await raw(origin, "/api/busy");
    expect([busy.status, busy.body, busy.headers["retry-after"]]).toEqual([503, BUSY, "1"]);
  });

  it("trusts no proxy by default: a forged chain becomes one address that is not the attacker's, over https", async () => {
    const forged = ["198.51.100.99", "203.0.113.10", "2001:db8::17", "198.51.100.88", "192.0.2.77"];
    for (const route of ["/api/probe", "/healthz"]) {
      const attempts: Record<string, string | string[]>[] = [
        { "X-Forwarded-For": "198.51.100.99, 203.0.113.10, 192.0.2.77", "X-Real-IP": "198.51.100.88", "X-Forwarded-Proto": "http" },
        { "X-Forwarded-For": ["198.51.100.99", "2001:db8::17"], Forwarded: "for=198.51.100.88" },
        { "X-Forwarded-For": "203.0.113.10:1234" },
      ];
      for (const headers of attempts) {
        const res = await raw(origin, route, { headers });
        expect(res.status, route).toBe(200);
        const seen = echo(res);
        expect(seen.xff, `${route} ${JSON.stringify(headers)}: exactly one address`).not.toMatch(/[,\s]/);
        expect(isIP(seen.xff), `${route}: ${seen.xff} is an address`).not.toBe(0);
        expect(forged, `${route}: the address is not one the client wrote`).not.toContain(seen.xff);
        expect(seen.proto, route).toBe("https");
      }
    }
  });

  // Last: it stops the coordinator.
  it("answers a proxy error, not the site's 404 page, once the coordinator is gone", async () => {
    must(["stop", "-t", "2", upstream], 60_000);
    for (const path of ["/api/public/status", "/api/no-such", "/healthz"]) {
      const res = await raw(origin, path);
      expect(res.status, `${path}: ${res.body}`).toBe(502);
      expect(res.body, path).not.toContain(TITLE);
    }
    expectPage(await raw(origin, "/no-such-page/"), "a site miss is still the page");
  });
});
