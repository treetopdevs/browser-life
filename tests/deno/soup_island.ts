// End to end for the shared soup (docs/soup-garden-2026-10-31.md, Part B): a real
// Coordinator.Soup behind a real HTTP server (`mix phx.server` against scratch data
// directories, like coordinator_integration.ts) and two in-process CPU islands from
// tools/soup_island.ts, each its own island identity.
//
// It registers a 16x16 grid soup (radius 2, 4 segments of 8 epochs, every second
// segment and the last verified), runs both islands until the coordinator says the
// world is finished, and checks that nothing diverged, that segments 0, 2 and 3 were
// verified by the island that did not run them, and that the chain's last snapshot
// equals a continuous local CPU run byte for byte. Then a second world with a lying
// island (it flips one program byte under a valid header and completes with its
// upload's own hash): the honest verifier must catch it, the segment is diverged
// and every later one blocked. Last, islands behind a proxy that answers some
// requests 429: they wait and retry, and give up a task whose lease would end
// before the wait does; a fresh island's join answered 429 is retried too.
//
// Run from the repo root: deno run -A --no-lock tests/deno/soup_island.ts < /dev/null
import { noLockDenoBin } from "./lib/no_lock_deno.ts";
import { Soup } from "../../tools/soup/bff.ts";
import { encodeSnapshot, sha256Hex } from "../../tools/soup/snapshot.ts";
import { joinIsland, runSoupIsland, soupParams, type SoupTask } from "../../tools/soup_island.ts";

const root = Deno.cwd();
const coordinatorDir = `${root}/apps/coordinator`;
const port = 41107;
const base = `http://127.0.0.1:${port}`;
const scratch = await Deno.makeTempDir({ prefix: "bl-soup-it-" });
// A deno the coordinator finds on PATH (its discovery validator) runs with --no-lock (tests/deno/lib/no_lock_deno.ts).
const denoBin = await noLockDenoBin(`${scratch}/bin`);

let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!cond) ok = false;
};

const withoutValidator = (env: Record<string, string>) => Object.fromEntries(Object.entries(env).filter(([k]) => k !== "BL_DISCOVERY_VALIDATOR"));

const server = new Deno.Command("mix", {
  args: ["phx.server"],
  cwd: coordinatorDir,
  env: {
    ...withoutValidator(Deno.env.toObject()),
    PATH: `${denoBin}:${Deno.env.get("PATH") ?? ""}`,
    MIX_ENV: "dev",
    PORT: String(port),
    BL_DATA_DIR: `${scratch}/data`,
    BL_DISCOVERY_DATA_DIR: `${scratch}/data-discovery`,
    BL_SOUP_DATA_DIR: `${scratch}/data-soup`,
  },
  clearEnv: true,
  stdin: "null",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

async function waitReady(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/soup/status`);
      if (r.ok) return void await r.body?.cancel();
      await r.body?.cancel();
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("coordinator did not become ready in time");
}

// Loopback is the administrator in dev (allow_local_admin).
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, init);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

interface Seg { id: string; status: string; blocked: boolean; sha: string | null; ranBy: string | null; verifiedBy: string | null }
interface World { name: string; chain: Seg[]; head: { index: number; sha: string } | null; counts: Record<string, number> }
const world = async (name: string) => (await call<{ worlds: World[] }>("/api/soup/status")).worlds.find((w) => w.name === name)!;
const register = (body: Record<string, unknown>) =>
  call<{ status: string }>("/api/soup/worlds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const quiet = () => {};

try {
  await waitReady(60_000);

  const spec = { name: "e2e", seed: 3, width: 16, height: 16, radius: 2, epochsPerSegment: 8, segments: 4, verifyEvery: 2 };
  check("registers the world", (await register(spec)).status === "registered");

  const a = await joinIsland(base, "soup-it-a"), b = await joinIsland(base, "soup-it-b");
  check("two distinct island identities", a.id !== b.id);
  const [ra, rb] = await Promise.all([
    runSoupIsland({ url: base, identity: a, idleMs: 100, log: quiet }),
    runSoupIsland({ url: base, identity: b, idleMs: 100, log: quiet }),
  ]);
  check("every task was accepted", ra.refused + rb.refused === 0, JSON.stringify({ ra, rb }));
  check("4 runs and 3 verifies in all", ra.runs + rb.runs === 4 && ra.verifies + rb.verifies === 3, JSON.stringify({ ra, rb }));

  const w = await world("e2e");
  check("no divergence: verified, done, verified, verified", w.chain.map((s) => s.status).join() === "verified,done,verified,verified", JSON.stringify(w.counts));
  check("each verify came from the other island", w.chain.every((s) => s.status !== "verified" || (s.verifiedBy !== null && s.verifiedBy !== s.ranBy)));

  // The chain's head equals a continuous CPU run of all 32 epochs.
  const params = soupParams({ seed: 3, num: 256, width: 16, height: 16, radius: 2, mutation: 1 << 18, lang: "noheads" });
  const soup = new Soup(params);
  for (let i = 0; i < 32; i++) soup.step();
  const expected = encodeSnapshot(params, soup.programs, soup.epoch);
  const last = new Uint8Array(await (await fetch(`${base}/api/soup/segments/e2e.3/snapshot`)).arrayBuffer());
  check("the last snapshot equals a continuous run, byte for byte", last.length === expected.length && last.every((x, i) => x === expected[i]), `${last.length} bytes`);
  check("and its hash is the head's", w.head?.index === 3 && w.head.sha === await sha256Hex(expected));

  // A lying island runs segment 0 of a second world; the honest one verifies it.
  check("registers the tamper world", (await register({ ...spec, name: "tamper" })).status === "registered");
  const lie = (bytes: Uint8Array<ArrayBuffer>, _t: SoupTask) => {
    const out = bytes.slice();
    out[64 + 100] ^= 1;
    return out;
  };
  const liar = await runSoupIsland({ url: base, identity: a, maxSegments: 1, tamper: lie, log: quiet });
  check("the liar's upload is accepted (its header is valid)", liar.runs === 1 && liar.refused === 0, JSON.stringify(liar));
  const honest = await runSoupIsland({ url: base, identity: b, maxSegments: 1, log: quiet });
  check("the honest island verifies it", honest.verifies === 1, JSON.stringify(honest));
  const t = await world("tamper");
  check("segment 0 diverged", t.chain[0].status === "diverged", t.chain[0].status);
  check("every later segment is blocked", t.chain.slice(1).every((s) => s.blocked), JSON.stringify(t.counts));
  const after = await runSoupIsland({ url: base, identity: a, once: true, log: quiet });
  check("nothing more is offered", after.runs + after.verifies === 0, JSON.stringify(after));

  // A proxy in front of the coordinator that can answer a request 429 instead.
  let inject: ((path: string) => Response | null) = () => null;
  const injected: string[] = [];
  const proxy = Deno.serve({ hostname: "127.0.0.1", port: port + 1, onListen() {} }, async (req) => {
    const u = new URL(req.url);
    const hit = inject(u.pathname);
    if (hit) {
      injected.push(u.pathname);
      return hit;
    }
    const headers = new Headers();
    for (const k of ["authorization", "content-type"]) if (req.headers.has(k)) headers.set(k, req.headers.get(k)!);
    const body = req.method === "GET" ? undefined : await req.arrayBuffer();
    const res = await fetch(`${base}${u.pathname}${u.search}`, { method: req.method, headers, body });
    return new Response(await res.arrayBuffer(), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream" } });
  });
  const limited = (ms: number) => new Response(JSON.stringify({ error: "too many", retryAfterMs: ms }), { status: 429, headers: { "content-type": "application/json", "retry-after": String(Math.ceil(ms / 1000)) } });
  try {
    const via = `http://127.0.0.1:${port + 1}`;
    check("registers the rate-limited world", (await register({ ...spec, name: "limited", segments: 2, verifyEvery: 1 })).status === "registered");
    // The first next, upload and completion are each refused once, briefly.
    const once = new Set<string>();
    inject = (path) => {
      const kind = path.endsWith("/next") ? "next" : path.endsWith("/snapshot") ? "put" : path.endsWith("/complete") ? "complete" : null;
      if (!kind || once.has(kind)) return null;
      once.add(kind);
      return limited(150);
    };
    const [la, lb] = await Promise.all([
      runSoupIsland({ url: via, identity: a, idleMs: 100, log: quiet }),
      runSoupIsland({ url: via, identity: b, idleMs: 100, log: quiet }),
    ]);
    check("429s were answered", injected.length === 3, injected.join(" "));
    check("the islands waited, retried and finished the world", la.refused + lb.refused === 0 && la.runs + lb.runs === 2 && la.verifies + lb.verifies === 2, JSON.stringify({ la, lb }));
    const l = await world("limited");
    check("both segments verified", l.chain.every((s) => s.status === "verified"), JSON.stringify(l.counts));

    // A wait longer than the lease: the task is given up, the island goes on.
    check("registers the give-up world", (await register({ ...spec, name: "giveup", segments: 1 })).status === "registered");
    inject = (path) => path.endsWith("/complete") ? limited(10 * 3_600_000) : null;
    const gave = await runSoupIsland({ url: via, identity: a, once: true, log: quiet });
    check("a task rate-limited past its lease is given up", gave.refused === 1 && gave.runs === 0, JSON.stringify(gave));

    // An island with no identity yet: its join is refused once, then it joins and works.
    injected.length = 0;
    let joinOnce = false;
    inject = (path) => {
      if (path !== "/api/islands" || joinOnce) return null;
      joinOnce = true;
      return limited(150);
    };
    check("registers the late-join world", (await register({ ...spec, name: "late", segments: 1 })).status === "registered");
    const fresh = await runSoupIsland({ url: via, once: true, log: quiet });
    check("a join answered 429 is retried", injected.join() === "/api/islands" && fresh.id !== a.id && fresh.id !== b.id, injected.join());
    check("and the new island works", fresh.runs === 1 && fresh.refused === 0, JSON.stringify(fresh));
  } finally {
    await proxy.shutdown();
  }
} catch (e) {
  console.error(e);
  ok = false;
} finally {
  try {
    server.kill("SIGTERM");
  } catch {
    // already gone
  }
  await server.status;
  await Deno.remove(scratch, { recursive: true }).catch(() => {});
}

console.log(ok ? "soup_island: all checks passed" : "soup_island: FAILED");
Deno.exit(ok ? 0 : 1);
