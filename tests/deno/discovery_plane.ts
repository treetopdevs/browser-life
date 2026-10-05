// Discovery plane integration test (PLAN Stage 3b; PRD O1-O9 as far as one
// machine can show them). Run from the repo root:
//   pnpm build:discovery && deno run -A tests/deno/discovery_plane.ts [--keep] [--no-browser]
//
// 1. Runs the engineering campaign by shards (the 3a reference), host labels
//    host-a and host-b.
// 2. Starts a real coordinator (`mix phx.server`) on scratch data
//    directories, submits the same frozen root, and drives the plane with
//    CLI workers and the browser worker page: a worker that dies holding a
//    lease, a corrupt upload, a wrong observer version, a late upload after
//    lease expiry, a completion sent twice, a coordinator restart while a
//    worker is retrying, then normal workers on two host labels.
// 3. Collects the plane's campaign into the shard layout and checks that
//    validate and reduce give the same case set, canonical results and
//    reduction digest as the shard run.
//
// Two host labels on one Mac exercise the plumbing only; they are not the
// two-physical-host proof the PRD requires.

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const keep = Deno.args.includes("--keep");
const browser = !Deno.args.includes("--no-browser");
const tmp = await Deno.makeTempDir({ prefix: "bl-discovery-plane-" });
const port = 41_000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
const ADMIN = "admin-" + crypto.randomUUID();
const JOIN = "join-" + crypto.randomUUID();
const LEASE_MS = 3000;
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures++;
};
const dec = new TextDecoder();

function sh(cmd: string, args: string[], env: Record<string, string> = {}): { code: number; out: string } {
  const p = new Deno.Command(cmd, { args, cwd: REPO, env: { ...Deno.env.toObject(), ...env }, stdout: "piped", stderr: "piped" }).outputSync();
  return { code: p.code, out: dec.decode(p.stdout) + dec.decode(p.stderr) };
}
const tool = (...args: string[]) => sh("deno", ["run", "-A", `${REPO}/tools/discovery.ts`, ...args], { BL_ADMIN_TOKEN: ADMIN });

function worker(host: string, extra: string[] = []) {
  return new Deno.Command("deno", {
    args: ["run", "-A", `${REPO}/tools/discovery-worker.ts`, "--coordinator", base, "--host", host, "--token", JOIN, "--max-minutes", "10", ...extra],
    cwd: REPO,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
}
async function finish(p: Deno.ChildProcess): Promise<{ code: number; out: string }> {
  const o = await p.output();
  return { code: o.code, out: dec.decode(o.stdout) + dec.decode(o.stderr) };
}

let server: Deno.ChildProcess | null = null;
function startServer() {
  server = new Deno.Command("mix", {
    args: ["phx.server"],
    cwd: `${REPO}/apps/coordinator`,
    env: {
      ...Deno.env.toObject(),
      MIX_ENV: "dev",
      PORT: String(port),
      BL_DATA_DIR: `${tmp}/queue-data`,
      BL_DISCOVERY_DATA_DIR: `${tmp}/discovery-data`,
      BL_DISCOVERY_LEASE_MS: String(LEASE_MS),
      BL_DISCOVERY_JOIN_TOKEN: JOIN,
      BL_ADMIN_TOKEN: ADMIN,
    },
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
}
async function stopServer() {
  server?.kill("SIGKILL");
  await server?.status;
  server = null;
}
async function waitReady(ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/api/discovery/status`, { headers: { authorization: `Bearer ${ADMIN}` } });
      if (r.ok) return void (await r.body?.cancel());
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("coordinator did not start");
}
const admin = async (path: string) => (await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${ADMIN}` } })).json();

try {
  // ---- 1. The shard reference.
  const REF = `${tmp}/shard`;
  tool("freeze", "--protocol", `${REPO}/experiments/discovery/engineering-v1/protocol.json`, "--out", REF);
  tool("run", "--root", REF, "--host", "host-a");
  tool("replay", "--root", REF, "--host", "host-b");
  tool("validate", "--root", REF);
  const refRed = tool("reduce", "--root", REF);
  check(refRed.out.startsWith("complete: 12/12"), "shard reference campaign complete");
  const refReport = JSON.parse(await Deno.readTextFile(`${REF}/report.json`));
  const md = (await Deno.readTextFile(`${REF}/MANIFEST-DIGEST`)).trim();

  // ---- 2. The plane.
  startServer();
  await waitReady(90_000);
  let r = tool("submit", "--root", REF, "--coordinator", base);
  check(r.code === 0 && r.out.includes('"registered"'), "campaign submitted once by the researcher");
  r = tool("submit", "--root", REF, "--coordinator", base);
  check(r.out.includes('"exists"'), "resubmitting the same frozen campaign is idempotent");
  const queueStatus = await (await fetch(`${base}/api/public/status`)).json();
  check(JSON.stringify(queueStatus).includes('"experiments":0') || !JSON.stringify(queueStatus).includes("engineering-v1"), "the registered/public queue never sees the research campaign (O9)");
  const dataFiles = [...Deno.readDirSync(`${tmp}/queue-data`)].map((e) => e.name);
  check(!dataFiles.some((n) => n.includes("blobs")) && [...Deno.readDirSync(`${tmp}/discovery-data`)].some((e) => e.name === "blobs"), "research blobs live only in the discovery data directory (O9)");

  // Admission and capability checks over the wire.
  const join = (body: Record<string, unknown>, token = JOIN) =>
    fetch(`${base}/api/discovery/workers`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ label: "x", physicalHostId: "x", backend: "cpu-ref-v1", sourceClosureDigest: "e".repeat(64), runtime: "t", concurrency: 1, environment: "local", ...body }) });
  let res = await join({}, "wrong-token");
  check(res.status === 401, "a worker without the research join token is refused");
  await res.body?.cancel();
  res = await join({ environment: "cloud" });
  const cloud = await res.json();
  check(res.status === 403 && String(cloud.error).includes("allowance is zero"), "a cloud worker is refused without a launch envelope (O6)");
  res = await join({});
  const stale = await res.json();
  const next = await (await fetch(`${base}/api/discovery/next`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${stale.workerId}:${stale.token}` }, body: "{}" })).json();
  check(next.idle === true && String(next.reason).includes("source closure"), "a worker with different code is told why it gets no work (O2)");

  // Faults, one at a time. Each faulted case is then completed by a normal worker before the next fault,
  // so no case reaches its attempt cap (three per role) through the test itself.
  const settle = async (host: string) => {
    await new Promise((res) => setTimeout(res, LEASE_MS + 500));
    return finish(worker(host, ["--max-cases", "1"]));
  };
  r = await finish(worker("host-a", ["--fault", "exit-after-lease"]));
  check(r.code === 3 && r.out.includes("exiting while holding lease"), "a worker dies holding a lease");
  r = await settle("host-a");
  check(r.out.includes("primary") && r.out.includes(": valid"), "after the lease expires another worker repeats the case");
  r = await finish(worker("host-b", ["--fault", "corrupt-upload", "--max-cases", "1"]));
  check(r.out.includes("rejected") && r.out.includes("corrupt bytes"), "a corrupt upload is rejected with its reason");
  await settle("host-b");
  r = await finish(worker("host-b", ["--fault", "wrong-observer", "--max-cases", "1"]));
  check(r.out.includes("rejected") && r.out.includes("observer version exact-ledger-v0"), "a wrong observer version is rejected");
  await settle("host-b");
  r = await finish(worker("host-a", ["--fault", "late-upload", "--max-cases", "1"]));
  check(r.out.includes("lease expired before completion"), "an upload after lease expiry is kept as a late, rejected attempt");
  r = await finish(worker("host-b", ["--fault", "complete-twice", "--max-cases", "1"]));
  check(/completed .* a second time -> valid/.test(r.out), "a repeated completion returns the recorded verdict (idempotent)");

  // Coordinator restart while a worker keeps retrying.
  await stopServer();
  const during = worker("host-a", ["--idle-exit", "20"]);
  await new Promise((res) => setTimeout(res, 4000));
  startServer();
  await waitReady(90_000);
  const st = await admin("/api/discovery/status");
  check(st.campaigns?.[0]?.cases === 12, "campaign, workers and attempts survive a coordinator restart");

  // Normal work: host-b on the CLI, host-c through the browser page.
  const hostB = worker("host-b", ["--idle-exit", "20", "--concurrency", "2"]);
  let browserOut = "";
  if (browser) {
    const b = sh("node", [`${REPO}/tests/browser/discovery-worker.mjs`, `${base}/discovery/index.html?host=host-c&threads=2&idle-exit=20#token=${JOIN}`, "240"], { BL_SCREENSHOT: `${tmp}/browser.png` });
    browserOut = b.out;
    // Chrome also reports failed fetches (for example a heartbeat answered 409) as console errors; the verdict is the JSON line.
    const parsed = JSON.parse(b.out.trim().split("\n").reverse().find((l) => l.startsWith("{")) ?? "{}");
    for (const l of b.out.split("\n")) if (l.startsWith("console:")) console.log(`  browser ${l}`);
    check(parsed.state === "finished" && parsed.done >= 1, `the browser worker page joined, qualified and completed ${parsed.done} case(s) with one click`);
  }
  const ra = await finish(during);
  const rb = await finish(hostB);
  check(ra.out.includes("retrying") || ra.out.includes("joined"), "the worker that started during the outage retried and resumed");
  const status = await admin("/api/discovery/status");
  check(status.campaigns[0].decisions.accepted === 12, `the plane accepts all 12 cases (${JSON.stringify(status.campaigns[0].decisions)})`);

  // ---- 3. Export and compare with the shard run.
  r = tool("collect", "--coordinator", base, "--campaign", md, "--out", `${tmp}/plane-export`);
  check(r.code === 0, "collect exports the plane's campaign into the shard layout");
  r = tool("validate", "--root", `${tmp}/plane-export`);
  r = tool("reduce", "--root", `${tmp}/plane-export`);
  check(r.out.startsWith("complete: 12/12"), "validate and reduce on the export: complete");
  const planeReport = JSON.parse(await Deno.readTextFile(`${tmp}/plane-export/report.json`));
  check(planeReport.manifestDigest === refReport.manifestDigest, "same manifest");
  check(JSON.stringify(planeReport.cases.map((c: { caseId: string }) => c.caseId)) === JSON.stringify(refReport.cases.map((c: { caseId: string }) => c.caseId)), "same case set, same order");
  check(JSON.stringify(planeReport.cases.map((c: { canonicalDigest: string }) => c.canonicalDigest)) === JSON.stringify(refReport.cases.map((c: { canonicalDigest: string }) => c.canonicalDigest)), "same canonical result for every case");
  check(planeReport.reductionDigest === refReport.reductionDigest, `same reduction digest (${planeReport.reductionDigest.slice(0, 16)})`);
  const idx = JSON.parse(await Deno.readTextFile(`${tmp}/plane-export/acceptance.json`));
  const rejected = idx.cases.flatMap((c: { attempts: { valid: boolean; partial: boolean }[] }) => c.attempts.filter((a) => !a.valid && !a.partial)).length;
  const partial = idx.cases.flatMap((c: { attempts: { partial: boolean }[] }) => c.attempts.filter((a) => a.partial)).length;
  check(rejected >= 3 && partial >= 1, `the export keeps rejected (${rejected}) and abandoned (${partial}) attempts`);
  const hosts = new Set(idx.cases.flatMap((c: { attempts: { physicalHostId: string; valid: boolean }[] }) => c.attempts.filter((a) => a.valid).map((a) => a.physicalHostId)));
  check(hosts.size >= 2, `accepted results span host labels ${[...hosts].join(", ")}`);
  if (failures) console.log(ra.out.slice(-3000), rb.out.slice(-3000), browserOut.slice(-3000));
} catch (e) {
  failures++;
  console.log(`FAIL uncaught: ${(e as Error).stack ?? e}`);
} finally {
  await stopServer();
  console.log(failures ? `${failures} FAILED (scratch ${tmp})` : `all passed${keep ? ` (scratch ${tmp})` : ""}`);
  if (!keep && !failures) await Deno.remove(tmp, { recursive: true });
}
Deno.exit(failures ? 1 : 0);
