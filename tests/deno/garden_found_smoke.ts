// bin/garden-found, end to end, without the GPU or an island. Run from the repo root (after `pnpm install`, and with
// apps/coordinator's deps fetched): deno run -A --no-lock tests/deno/garden_found_smoke.ts < /dev/null
//
// Pass criteria, fixed before the run (docs/garden-opening-2026-10-18.md, section 5):
// A. Against a stub on 127.0.0.1 (a Deno.serve that records every request it gets; it cannot see a bare connection,
//    so "nothing sent" is also checked with a curl on PATH that records being started). The stub answers the admin
//    spec (GET /api/experiments/commons) with the checklist's censusEvery and deepEvery unless a case says otherwise.
//    1. A dry run gets no request and starts no curl, exits 0, prints a body byte-equal to the checklist's
//       `garden-found:body` block, and prints `$BL_ADMIN_TOKEN` literally, never the token. A dry run aimed at
//       https://cadence.garden starts no curl either.
//    2. `--apply --yes` against a stub that answers the view 404, then the founding 200, then the view and the spec:
//       the POST carries exactly the printed body, `content-type: application/json` and `authorization: Bearer
//       <token>`; the view GETs carry no authorization, the spec GET carries the token; exit 0. No curl or deno the
//       script starts has the token, or a variable named BL_ADMIN_TOKEN or token, in its environment (a curl and a deno
//       on PATH that record their environment), under sh, with `token=` in the environment, and under bash with
//       SHELLOPTS=allexport.
//    3. A commons that exists with seed 2: exit 3, the difference names `seed`, no POST. One that exists and matches:
//       exit 0, no POST. One whose spec has another censusEvery: exit 3, names it. One whose spec answers 401: exit 1,
//       "not compared". One whose spec holds the token in censusEvery and deepEvery: exit 3, both described by kind,
//       the token not shown.
//    4. A founding answered 422 (with "garden exists", or with an HTML body) and a matching view after it: exit 0,
//       reported as existing; the race is told by the view, not the answer's text. A 422 and no commons after it:
//       exit 1, refused, the coordinator's reason not shown. A 401: exit 1. A 401, 422 or 500 whose body repeats the
//       Authorization header whole, in base64, in half and JSON-escaped: exit 1, none of those forms shown.
//    5. A view answered 500: exit 1, no POST.
//    6. After the founding: a view that differs, exit 3 ("founded, but"); a view read back as 500, exit 1. A founding
//       answered 503: exit 1, and the message says the commons may exist and that running it again is safe.
//    7. The view answered 503, 503, then 200: recovers (three view GETs), exit 0. Six 503s: exit 1 after six GETs, no
//       POST. A 301 with a Location: exit 1, the Location is never requested, no POST. A 200 that is HTML, or JSON
//       `null`: exit 1, no POST. A port where nothing listens: exit 1, "no answer".
//    8. A hostile .curlrc (trace-ascii to a file and location, in CURL_HOME, HOME and XDG_CONFIG_HOME; without -q this
//       curl writes that file): the founding still succeeds and no trace file is written.
//    9. `sh -x`, and bash with SHELLOPTS=xtrace in its environment, on a dry run and on a founding: the token is never
//       printed. `sh -x` and `bash -x` with a PS4 that expands BL_ADMIN_TOKEN, on a dry run: never printed; and with
//       BASH_XTRACEFD=1 too when bash is 4.1 or later (skipped, and counted as skipped, with an older bash).
//   10. bash with a BASH_ENV that makes BL_ADMIN_TOKEN readonly, and one that makes an exported `token` readonly: exit 2,
//       no curl started, the token not printed.
//    (Not covered: a founding that times out after 30 s; a hanging stub request would also block its shutdown.)
// B. Refusals, each exit 2 with no request and no curl started: --apply without --confirm-coordinator, two different
//    URLs, http:// for a host that is not loopback (an invalid name, *.localhost, localhost.evil.com,
//    127.0.0.1.evil.com), a URL with a path or a trailing slash, an uppercase host, a port with a leading zero or above
//    65535, no or an empty BL_ADMIN_TOKEN, a token with CR, LF or a space, no terminal and no --yes, an unknown flag, a
//    flag given twice, no --coordinator, --yes or --confirm-coordinator without --apply. --help exits 0, no curl.
//    The typed confirmation, through a pseudo-terminal (macOS `script`; skipped, and counted as skipped, elsewhere):
//    the line is typed once the question is shown; the right line proceeds (a matching view and spec, exit 0), a wrong
//    line is refused (exit 2, no request), and the parameters are shown before the question.
// C. A real dev coordinator (`MIX_ENV=dev mix phx.server`, scratch BL_DATA_DIR and a sibling BL_DISCOVERY_DATA_DIR, a
//    free port, BL_ADMIN_TOKEN set so the bearer path is used: with a token configured, dev's tokenless loopback admin
//    does not apply, CoordinatorWeb.Auth):
//    Before any founding: nothing answered on the port before the coordinator started, and everything listening on it
//    now is the coordinator's process or one of its descendants (lsof). Otherwise C6 to C8 do not run.
//    6. A wrong token with --yes: exit 1, the 401 reported, the public view still 404.
//    7. The right token with --yes: exit 0, the public view, read by this test, carries every compared parameter, and
//       the admin spec, read by this test, carries censusEvery and deepEvery.
//    8. The same again: exit 0, "already exists", nothing founded.
// D. Neither token appears in anything the script printed, nor in the coordinator's log; every line of the script
//    that expands the token is one of the allowed forms; the script's first commands are `{ set +xva; } >/dev/null 2>&1`,
//    `unset token || exit 2`, the token's capture and `unset BL_ADMIN_TOKEN || exit 2`, it has no `set -x`, and every curl it runs starts `curl -q` and
//    asks for no headers, trace or redirects.
// Every run of the script is killed after 120 s, with its whole process tree (found with pgrep, which the test requires
// before it starts anything), and its output is no longer waited for
// 10 s after that (a failed check, not a hang). uptime is printed at the start and the
// end. Exit 0 only if every check passed; the scratch directory is removed on a pass and kept (and printed) on a
// failure.
import { noLockDenoBin } from "./lib/no_lock_deno.ts";

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const uptime = async () => {
  try {
    return text((await new Deno.Command("uptime", { stdin: "null" }).output()).stdout).trim();
  } catch {
    return "unavailable";
  }
};
console.log(`uptime: ${await uptime()}`);

const root = Deno.cwd();
const script = `${root}/bin/garden-found`;
const checklist = `${root}/docs/garden-opening-2026-10-18.md`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () => {
  const l = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const p = (l.addr as Deno.NetAddr).port;
  l.close();
  return p;
};
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);

let ok = true;
let checks = 0;
let skipped = 0;
const check = (name: string, cond: boolean, detail = "") => {
  checks++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail.slice(0, 1500)}` : ""}`);
  ok &&= cond;
};

// The 120 s limit kills a run's whole process tree, found with pgrep; without it only the shell would be killed.
const hasPgrep = (await new Deno.Command("sh", { args: ["-c", "command -v pgrep"], stdin: "null", stdout: "null", stderr: "null" }).output()).success;
check("pgrep is here, so a run past its limit is killed with its whole process tree", hasPgrep);
if (!hasPgrep) Deno.exit(1);

const scratch = await Deno.makeTempDir({ prefix: "bl-garden-found-smoke-" });
const shimBin = await noLockDenoBin(`${scratch}/shim`);
// A curl that only records being started, for the runs that must send nothing.
const fakeBin = `${scratch}/fake-curl`;
const curlMark = `${scratch}/curl-started`;
await Deno.mkdir(fakeBin);
await Deno.writeTextFile(`${fakeBin}/curl`, `#!/bin/sh\necho started >> '${curlMark}'\nexit 99\n`);
await Deno.chmod(`${fakeBin}/curl`, 0o755);

// A curl and a deno that write their environment to a file, then run the real ones: the token must reach no child.
const envBin = `${scratch}/env-dump`;
const envDumps = `${scratch}/env-dumps`;
await Deno.mkdir(envBin);
await Deno.mkdir(envDumps);
const realCurl = text((await new Deno.Command("sh", { args: ["-c", "command -v curl"], stdout: "piped" }).output()).stdout).trim();
for (const [name, real] of [["curl", realCurl], ["deno", `${shimBin}/deno`]]) {
  await Deno.writeTextFile(`${envBin}/${name}`, `#!/bin/sh\nenv > "${envDumps}/${name}.$$"\nexec '${real}' "$@"\n`);
  await Deno.chmod(`${envBin}/${name}`, 0o755);
}
const envDumped = async () => {
  const all: string[] = [];
  for await (const e of Deno.readDir(envDumps)) all.push(await Deno.readTextFile(`${envDumps}/${e.name}`));
  return all;
};

const TOKEN = `sentinel-${crypto.randomUUID()}`;
const WRONG = `wrong-${crypto.randomUUID()}`;
const baseEnv = Object.fromEntries(Object.entries(Deno.env.toObject()).filter(([k]) => !k.startsWith("BL_") && !k.startsWith("GF_") && k !== "SHELLOPTS" && !k.startsWith("CURL_") && !["BASH_ENV", "BASH_XTRACEFD", "ENV", "PS4"].includes(k)));
const printed: string[] = [];

async function treePids(pid: number): Promise<number[]> {
  let kids: number[] = [];
  try {
    const out = await new Deno.Command("pgrep", { args: ["-P", String(pid)], stdin: "null", stdout: "piped", stderr: "null" }).output();
    kids = text(out.stdout).split(/\s+/).filter(Boolean).map(Number);
  } catch {
    // no pgrep: the pid alone
  }
  return [pid, ...(await Promise.all(kids.map(treePids))).flat()];
}
const alive = async (pid: number) => {
  const out = await new Deno.Command("ps", { args: ["-o", "stat=", "-p", String(pid)], stdin: "null", stdout: "piped", stderr: "null" }).output();
  const s = text(out.stdout).trim();
  return out.success && s !== "" && !s.startsWith("Z");
};

interface Ran {
  code: number;
  out: string;
}
const RUN_LIMIT_MS = 120_000;
/** Runs the script (through `script` for a pseudo-terminal when `pty`, or under `shell` such as ["sh", "-x"]), with
 * the environment cleared of BL_* and `env` added; everything it prints is kept for the secret check. A run is killed
 * after RUN_LIMIT_MS. With `pty`, the line is typed once the question has been shown. */
async function run(args: string[], env: Record<string, string> = {}, opts: { fakeCurl?: boolean; pty?: string; shell?: string[]; envDump?: boolean } = {}): Promise<Ran> {
  const path = `${opts.fakeCurl ? `${fakeBin}:` : ""}${opts.envDump ? `${envBin}:` : ""}${shimBin}:${baseEnv.PATH ?? ""}`;
  const fullEnv = { ...baseEnv, PATH: path, ...env };
  const [cmd, cmdArgs] = opts.pty !== undefined
    ? ["script", ["-q", "/dev/null", script, ...args]]
    : opts.shell
    ? [opts.shell[0], [...opts.shell.slice(1), script, ...args]]
    : [script, args];
  const child = new Deno.Command(cmd, { args: cmdArgs, cwd: root, env: fullEnv, clearEnv: true, stdin: opts.pty !== undefined ? "piped" : "null", stdout: "piped", stderr: "piped" }).spawn();
  // Output is read through readers this function can cancel: past the limit the whole process tree is killed (not only
  // the shell or `script`), and 10 s after that the readers are cancelled, so a descendant that still holds a pipe
  // open cannot keep this run, or the cleanup after it, waiting.
  const cancels: (() => void)[] = [];
  const collect = (stream: ReadableStream<Uint8Array>, onText?: (all: string) => Promise<void>) => {
    const reader = stream.getReader();
    cancels.push(() => reader.cancel().catch(() => {}));
    return (async () => {
      const dec = new TextDecoder();
      let all = "";
      for (;;) {
        let r: ReadableStreamReadResult<Uint8Array>;
        try {
          r = await reader.read();
        } catch {
          break;
        }
        if (r.done) break;
        all += dec.decode(r.value, { stream: true });
        if (onText) await onText(all);
      }
      return all;
    })();
  };
  let killed = false;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(async () => {
    killed = true;
    for (const p of (await treePids(child.pid)).reverse()) {
      try {
        Deno.kill(p, "SIGKILL");
      } catch {
        // gone
      }
    }
    cancelTimer = setTimeout(() => cancels.forEach((c) => c()), 10_000);
  }, RUN_LIMIT_MS);
  let typed = false;
  const w = opts.pty !== undefined ? child.stdin.getWriter() : undefined;
  const outText = collect(child.stdout, async (seen) => {
    if (w && !typed && seen.includes("to go on: ")) {
      typed = true;
      await w.write(new TextEncoder().encode(opts.pty));
      // A moment for the line to reach the terminal before its end arrives.
      await sleep(1000);
      await w.close().catch(() => {});
    }
  });
  const errText = collect(child.stderr);
  const [status, o, e] = await Promise.all([child.status, outText, errText]);
  if (w && !typed) await w.close().catch(() => {});
  clearTimeout(timer);
  clearTimeout(cancelTimer);
  const code = status.code;
  let out = o + e;
  if (killed) out += `\n[killed after ${RUN_LIMIT_MS / 1000} s]`;
  printed.push(out);
  return { code: killed ? -1 : code, out };
}

// The checklist's body block.
const doc = await Deno.readTextFile(checklist);
const block = /<!-- garden-found:body -->\s*```json\n([^\n]*)\n```\s*<!-- \/garden-found:body -->/.exec(doc);
const docBody = block?.[1] ?? "";
check("the checklist has one garden-found:body block holding one line of JSON", block !== null && doc.split("<!-- garden-found:body -->").length === 2 && (() => {
  try {
    JSON.parse(docBody);
    return true;
  } catch {
    return false;
  }
})(), docBody);
const want = JSON.parse(docBody || "{}");

/** The public view's compared keys for a body, as a coordinator would answer them (key order differs on purpose). */
const viewOf = (b: Record<string, unknown>, change: Record<string, unknown> = {}) => ({
  contract: "garden-v1",
  seed: b.seed,
  presetId: b.presetId,
  name: b.name,
  founding: (b.founding as Record<string, unknown>[]).map((f) => Object.fromEntries(Object.entries(f).reverse())),
  pace: { dawnOffsetMs: b.dawnOffsetMs, dawnPeriodMs: b.dawnPeriodMs, stepsPerDay: b.stepsPerDay },
  clock: { daysTotal: b.days, step: 0 },
  letters: { queueMax: b.queueMax, perDay: b.lettersPerDay },
  food: { enabled: b.food },
  meteor: { enabled: b.meteor },
  sun: { enabled: b.sun },
  ...change,
});

// ---- A and B: the stub ----
interface Req {
  method: string;
  path: string;
  auth: string | null;
  type: string | null;
  body: string;
}
let reqs: Req[] = [];
/** A stub answer: JSON `body`, or `raw` text. In either, `{AUTH}` is replaced by the request's Authorization header,
 * `{AUTH64}` by its base64, `{AUTHJSON}` by it JSON-escaped (inside a string) and `{AUTHHALF}` by its first half. */
type Answer = { status: number; body?: unknown; raw?: string; headers?: Record<string, string> };
let answers: Answer[] = [];
let specAnswers: Answer[] = [];
const viewPath = "/api/public/gardens/commons";
const specPath = "/api/experiments/commons";
const goodSpec = (change: Record<string, unknown> = {}): Answer => ({
  status: 200,
  body: { spec: { experiment: "commons", presetId: want.presetId, censusEvery: want.censusEvery, deepEvery: want.deepEvery, ...change }, segments: [] },
});
const stubPort = freePort();
const stub = Deno.serve({ hostname: "127.0.0.1", port: stubPort, onListen: () => {} }, async (req) => {
  const u = new URL(req.url);
  const auth = req.headers.get("authorization");
  reqs.push({ method: req.method, path: u.pathname, auth, type: req.headers.get("content-type"), body: await req.text() });
  const a = (u.pathname === specPath ? specAnswers.shift() ?? goodSpec() : answers.shift()) ?? { status: 599, body: { error: "the stub has no answer left" } };
  const raw = a.raw ?? JSON.stringify(a.body);
  const h = auth ?? "";
  const echoed = raw.replaceAll("{AUTH64}", btoa(h)).replaceAll("{AUTHJSON}", JSON.stringify(h).slice(1, -1).replaceAll("-", "\\u002d"))
    .replaceAll("{AUTHHALF}", h.slice(0, Math.ceil(h.length / 2))).replaceAll("{AUTH}", h);
  return new Response(echoed, {
    status: a.status,
    headers: { "content-type": a.raw !== undefined ? "text/html" : "application/json", ...a.headers },
  });
});
const stubUrl = `http://127.0.0.1:${stubPort}`;
const applyArgs = (u = stubUrl) => ["--coordinator", u, "--apply", "--confirm-coordinator", u, "--yes"];
const reset = async (a: Answer[], spec: Answer[] = []) => {
  reqs = [];
  answers = a;
  specAnswers = spec;
  try {
    await Deno.remove(curlMark);
  } catch {
    // none yet
  }
};
const paths = () => reqs.map((q) => `${q.method} ${q.path}`).join(",");
const views = () => reqs.filter((q) => q.path === viewPath).length;
const posted = () => reqs.some((q) => q.method === "POST");
const v404: Answer = { status: 404, body: { error: "not found" } };
const founded: Answer = { status: 200, body: { garden: "commons", days: 365 } };

// A1: the dry run.
await reset([]);
{
  const r = await run(["--coordinator", stubUrl], { BL_ADMIN_TOKEN: TOKEN }, { fakeCurl: true });
  const line = r.out.split("\n").find((l) => l.startsWith('  {"name"'))?.slice(2) ?? "";
  check("A1 dry run: exit 0, no request, no curl started", r.code === 0 && reqs.length === 0 && !(await exists(curlMark)), `exit ${r.code}, ${reqs.length} requests\n${r.out}`);
  check("A1 dry run: the printed body is byte-equal to the checklist's block", line !== "" && line === docBody, `printed ${line}\nchecklist ${docBody}`);
  check("A1 dry run: the token is written as $BL_ADMIN_TOKEN, and said to be set", r.out.includes("authorization: Bearer $BL_ADMIN_TOKEN") && r.out.includes("BL_ADMIN_TOKEN set in this shell: yes") && !r.out.includes(TOKEN), r.out);
  const live = await run(["--coordinator", "https://cadence.garden"], { BL_ADMIN_TOKEN: TOKEN }, { fakeCurl: true });
  check("A1 dry run at https://cadence.garden: exit 0, no curl started", live.code === 0 && !(await exists(curlMark)) && live.out.includes("POST https://cadence.garden/api/gardens"), live.out);
}

// A2: found against the stub.
const foundingOk = (r: Ran, name: string) => {
  const post = reqs.find((q) => q.method === "POST");
  const viewGets = reqs.filter((q) => q.path === viewPath);
  const specGets = reqs.filter((q) => q.path === specPath);
  check(`${name}: exit 0, GET view, POST, GET view, GET spec`, r.code === 0 && paths() === `GET ${viewPath},POST /api/gardens,GET ${viewPath},GET ${specPath}`, `exit ${r.code} ${paths()}\n${r.out}`);
  check(`${name}: the POST is exactly what the dry run printed`, post !== undefined && post.body === docBody && post.type === "application/json" && post.auth === `Bearer ${TOKEN}`, post ? `body ${post.body} type ${post.type} auth-ok ${post.auth === `Bearer ${TOKEN}`}` : "no POST");
  check(`${name}: the view GETs carry no authorization, the spec GET carries the token`, viewGets.length === 2 && viewGets.every((q) => q.auth === null) && specGets.length === 1 && specGets[0].auth === `Bearer ${TOKEN}`);
  check(`${name}: says founded and that the view and spec match`, r.out.includes("founded (HTTP 200).") && r.out.includes("the public view and the spec match the checklist"), r.out);
};
await reset([v404, founded, { status: 200, body: viewOf(want) }]);
foundingOk(await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN }), "A2 apply");
// A2: no child sees the token, even with a `token` (and allexport through SHELLOPTS) in the environment.
for (const [label, extra, shell] of [["sh", {}, undefined], ["sh with token= in the environment", { token: "from-the-environment" }, undefined], ["bash with SHELLOPTS=allexport", { SHELLOPTS: "allexport" }, ["bash"]]] as [string, Record<string, string>, string[] | undefined][]) {
  for await (const e of Deno.readDir(envDumps)) await Deno.remove(`${envDumps}/${e.name}`);
  await reset([v404, founded, { status: 200, body: viewOf(want) }]);
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN, ...extra }, { envDump: true, shell });
  const dumps = await envDumped();
  const names = dumps.map((d) => d.split("\n").map((l) => l.split("=")[0]));
  check(`A2 ${label}: no curl or deno it starts has the token in its environment`, r.code === 0 && posted() && dumps.length >= 4 && dumps.every((d) => !d.includes(TOKEN)) && names.every((n) => !n.includes("BL_ADMIN_TOKEN") && !n.includes("token")), `exit ${r.code}, ${dumps.length} children\n${r.out}`);
}

// A3: an existing commons, different and the same.
await reset([{ status: 200, body: viewOf(want, { seed: 2 }) }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A3 exists with seed 2: exit 3, names seed only, no POST", r.code === 3 && /seed \(seed\): the commons has 2/.test(r.out) && !/presetId \(/.test(r.out) && !posted(), `exit ${r.code}\n${r.out}`);
}
await reset([{ status: 200, body: viewOf(want) }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A3 exists and matches: exit 0, the view and the spec read, no POST", r.code === 0 && paths() === `GET ${viewPath},GET ${specPath}` && r.out.includes("already exists") && r.out.includes("matches the checklist; nothing was founded"), `exit ${r.code} ${paths()}\n${r.out}`);
}
await reset([{ status: 200, body: viewOf(want) }], [goodSpec({ censusEvery: 512 })]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A3 exists with censusEvery 512 in its spec: exit 3, names censusEvery, no POST", r.code === 3 && /censusEvery \(spec\.censusEvery\): the commons has 512/.test(r.out) && !/deepEvery \(/.test(r.out) && !posted(), `exit ${r.code}\n${r.out}`);
}
await reset([{ status: 200, body: viewOf(want) }], [{ status: 401, body: { error: "admin authentication required" } }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A3 exists, the spec answers 401: exit 1, not compared, no POST", r.code === 1 && r.out.includes("censusEvery, deepEvery: not compared") && r.out.includes("HTTP 401") && !posted(), `exit ${r.code}\n${r.out}`);
}

await reset([{ status: 200, body: viewOf(want) }], [{ status: 200, raw: JSON.stringify(goodSpec({ censusEvery: "{AUTH}", deepEvery: ["{AUTH}"] }).body) }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A3 a spec whose censusEvery and deepEvery repeat the token: exit 3, the values described, not shown", r.code === 3 && r.out.includes("censusEvery (spec.censusEvery): the commons has a different string") && r.out.includes("deepEvery (spec.deepEvery): the commons has a different list") && !r.out.includes(TOKEN), `exit ${r.code}\n${r.out.replaceAll(TOKEN, "<TOKEN>")}`);
}

// A3: the switches this checklist sends are read back too (slice 41): a sun or meteor switch that differs, and a view
// from a coordinator without the sun switch, each stop the script.
for (const [label, change, said] of [
  ["sun.enabled false", { sun: { enabled: false } }, /sun \(sun\.enabled\): the commons has false/],
  ["meteor.enabled true", { meteor: { enabled: true } }, /meteor \(meteor\.enabled\): the commons has true/],
  ["a sun block with no enabled", { sun: { span: 131072 } }, /sun \(sun\.enabled\): the commons has nothing/],
] as [string, Record<string, unknown>, RegExp][]) {
  await reset([{ status: 200, body: viewOf(want, change) }]);
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check(`A3 exists with ${label}: exit 3, names it, no POST`, r.code === 3 && said.test(r.out) && !/seed \(/.test(r.out) && !posted(), `exit ${r.code}\n${r.out}`);
}

// A4: a race, and other refusals of the founding.
await reset([v404, { status: 422, body: { error: "garden exists" } }, { status: 200, body: viewOf(want) }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A4 422 garden exists: exit 0, reported as existing", r.code === 0 && r.out.includes("the commons now exists") && r.out.includes("already exists") && paths() === `GET ${viewPath},POST /api/gardens,GET ${viewPath},GET ${specPath}`, `exit ${r.code} ${paths()}\n${r.out}`);
}
// The race is told by the view, not the answer's text (with a token such as "garden", hiding the text would hide it).
await reset([v404, { status: 422, raw: "<html>unprocessable</html>" }, { status: 200, body: viewOf(want) }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A4 a 422 with any body, then a view that exists: exit 0, reported as existing", r.code === 0 && r.out.includes("already exists") && posted() && views() === 2, `exit ${r.code} ${paths()}\n${r.out}`);
}
await reset([v404, { status: 422, body: { error: "seed must be a u32 integer" } }, v404]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A4 another 422, and no commons after it: exit 1, refused, the reason not shown", r.code === 1 && r.out.includes("refused the founding (422) and no commons exists") && !r.out.includes("u32") && paths() === `GET ${viewPath},POST /api/gardens,GET ${viewPath}`, `exit ${r.code} ${paths()}\n${r.out}`);
}
await reset([v404, { status: 401, body: { error: "admin authentication required" } }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A4 401: exit 1, the refusal said", r.code === 1 && r.out.includes("refused the admin token (401)"), `exit ${r.code}\n${r.out}`);
}
{
  const half = `Bearer ${TOKEN}`.slice(0, Math.ceil(`Bearer ${TOKEN}`.length / 2));
  const forms = [TOKEN, btoa(`Bearer ${TOKEN}`), half, TOKEN.replaceAll("-", "\\u002d")];
  for (const [status, label] of [[401, "a 401"], [422, "a 422"], [500, "a 500"]] as [number, string][]) {
    await reset([v404, { status, raw: `{"error":"bad authorization: {AUTH} {AUTH64} {AUTHHALF} {AUTHJSON}"}` }, v404]);
    const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
    check(`A4 ${label} that repeats the Authorization header (whole, base64, half, JSON-escaped): exit 1, none of it shown`, r.code === 1 && forms.every((f) => !r.out.includes(f)), `exit ${r.code}\n${forms.reduce((o, f, i) => o.replaceAll(f, `<FORM${i}>`), r.out)}`);
  }
}

// A5: the view fails.
await reset([{ status: 500, body: { error: "boom" } }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A5 view 500: exit 1, no POST", r.code === 1 && reqs.length === 1 && reqs[0].method === "GET", `exit ${r.code} ${paths()}\n${r.out}`);
}

// A6: after the founding.
await reset([v404, founded, { status: 200, body: viewOf(want, { seed: 2 }) }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A6 founded, then a view that differs: exit 3, founded but differs", r.code === 3 && r.out.includes("founded, but the commons differs from the checklist") && /seed \(seed\)/.test(r.out), `exit ${r.code}\n${r.out}`);
}
await reset([v404, founded, { status: 500, body: { error: "boom" } }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A6 founded, then the view read back as 500: exit 1", r.code === 1 && r.out.includes("founded, but reading the view back failed (HTTP 500)"), `exit ${r.code}\n${r.out}`);
}
await reset([v404, { status: 503, body: { error: "busy" } }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A6 a founding answered 503: exit 1, says it may exist and to run it again, one POST", r.code === 1 && r.out.includes("founding failed (HTTP 503)") && r.out.includes("may have been founded anyway") && r.out.includes("Run the same command again") && reqs.filter((q) => q.method === "POST").length === 1, `exit ${r.code} ${paths()}\n${r.out}`);
}

// A7: the view's transport.
const busy: Answer = { status: 503, body: { error: "busy" } };
await reset([busy, busy, { status: 200, body: viewOf(want) }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A7 view 503, 503, 200: recovers, exit 0, three view GETs, no POST", r.code === 0 && views() === 3 && !posted() && r.out.includes("already exists"), `exit ${r.code} ${paths()}\n${r.out}`);
}
await reset([busy, busy, busy, busy, busy, busy, busy]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A7 view 503 six times: exit 1 after six GETs, no POST", r.code === 1 && views() === 6 && !posted() && r.out.includes("HTTP 503"), `exit ${r.code} ${paths()}\n${r.out}`);
}
await reset([{ status: 301, body: { moved: true }, headers: { location: `${stubUrl}/elsewhere` } }, { status: 200, body: viewOf(want) }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A7 view 301: exit 1, the Location never requested, no POST", r.code === 1 && reqs.length === 1 && !reqs.some((q) => q.path === "/elsewhere") && r.out.includes("HTTP 301"), `exit ${r.code} ${paths()}\n${r.out}`);
}
await reset([{ status: 200, raw: "<!doctype html><title>Cadence Garden</title>" }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A7 view 200 that is HTML: exit 1, not JSON, no POST", r.code === 1 && r.out.includes("the public view is not JSON") && !posted(), `exit ${r.code}\n${r.out}`);
}
await reset([{ status: 200, body: null }]);
{
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN });
  check("A7 view 200 that is JSON null: exit 1, not an object, no POST", r.code === 1 && r.out.includes("the public view is not a JSON object") && !posted(), `exit ${r.code}\n${r.out}`);
}
{
  const closed = `http://127.0.0.1:${freePort()}`;
  const r = await run(applyArgs(closed), { BL_ADMIN_TOKEN: TOKEN });
  check("A7 a port where nothing listens: exit 1, no answer", r.code === 1 && r.out.includes("no answer from"), `exit ${r.code}\n${r.out}`);
}

// A8: a hostile .curlrc.
{
  const rc = `${scratch}/curlrc`;
  const trace = `${scratch}/curl-trace.txt`;
  await Deno.mkdir(rc);
  // verbose is left out on purpose: it overrides trace-ascii, so no trace file would show the .curlrc being read.
  await Deno.writeTextFile(`${rc}/.curlrc`, `trace-ascii = "${trace}"\nlocation\n`);
  await reset([v404, founded, { status: 200, body: viewOf(want) }]);
  const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN, CURL_HOME: rc, HOME: rc, XDG_CONFIG_HOME: rc });
  foundingOk(r, "A8 a hostile .curlrc");
  check("A8 a hostile .curlrc: no trace written", !(await exists(trace)), r.out.replaceAll(TOKEN, "<TOKEN>"));
}

// A9: tracing.
{
  const dry = await run(["--coordinator", "https://cadence.garden"], { BL_ADMIN_TOKEN: TOKEN }, { fakeCurl: true, shell: ["sh", "-x"] });
  check("A9 sh -x dry run: exit 0, the token not traced", dry.code === 0 && !dry.out.includes(TOKEN), dry.out.replaceAll(TOKEN, "<TOKEN>"));
  await reset([v404, founded, { status: 200, body: viewOf(want) }]);
  const found = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN }, { shell: ["sh", "-x"] });
  check("A9 sh -x founding: exit 0, the token not traced", found.code === 0 && posted() && !found.out.includes(TOKEN), `exit ${found.code}\n${found.out.replaceAll(TOKEN, "<TOKEN>")}`);
  const hasBash = (await new Deno.Command("sh", { args: ["-c", "command -v bash"], stdout: "null", stderr: "null" }).output()).success;
  if (!hasBash) {
    skipped++;
    console.log("SKIP A9 SHELLOPTS=xtrace: no bash here");
  } else {
    await reset([v404, founded, { status: 200, body: viewOf(want) }]);
    const inherited = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN, SHELLOPTS: "xtrace" }, { shell: ["bash"] });
    check("A9 bash with SHELLOPTS=xtrace founding: exit 0, the token not traced", inherited.code === 0 && posted() && !inherited.out.includes(TOKEN), `exit ${inherited.code}\n${inherited.out.replaceAll(TOKEN, "<TOKEN>")}`);
  }
  // A PS4 that expands the token: the first line's own trace must not reach the output either.
  for (const shell of hasBash ? [["sh", "-x"], ["bash", "-x"]] : [["sh", "-x"]]) {
    await reset([]);
    const r = await run(["--coordinator", "https://cadence.garden"], { BL_ADMIN_TOKEN: TOKEN, PS4: "${BL_ADMIN_TOKEN} " }, { fakeCurl: true, shell });
    check(`A9 ${shell.join(" ")} with a PS4 that expands the token, dry run: exit 0, the token not traced`, r.code === 0 && !r.out.includes(TOKEN) && !(await exists(curlMark)), `exit ${r.code}\n${r.out.replaceAll(TOKEN, "<TOKEN>")}`);
  }
  const xtracefd = hasBash && (await new Deno.Command("bash", { args: ["-c", '[ "${BASH_VERSINFO[0]}${BASH_VERSINFO[1]}" -ge 41 ] || [ "${BASH_VERSINFO[0]}" -ge 5 ]'], stdin: "null", stdout: "null", stderr: "null" }).output()).success;
  if (!xtracefd) {
    skipped++;
    console.log("SKIP A9 BASH_XTRACEFD=1: no bash 4.1 or later here");
  } else {
    await reset([]);
    const r = await run(["--coordinator", "https://cadence.garden"], { BL_ADMIN_TOKEN: TOKEN, PS4: "${BL_ADMIN_TOKEN} ", BASH_XTRACEFD: "1" }, { fakeCurl: true, shell: ["bash", "-x"] });
    check("A9 bash -x with BASH_XTRACEFD=1 and a PS4 that expands the token, dry run: exit 0, the token not traced", r.code === 0 && !r.out.includes(TOKEN) && !(await exists(curlMark)), `exit ${r.code}\n${r.out.replaceAll(TOKEN, "<TOKEN>")}`);
  }
  if (!hasBash) {
    skipped += 2;
    console.log("SKIP A10 readonly through BASH_ENV (2 checks): no bash here");
  } else {
    // A10: a variable the script cannot unset stops it before any child starts.
    for (const [label, rc] of [["BL_ADMIN_TOKEN readonly", "readonly BL_ADMIN_TOKEN\n"], ["an exported token readonly", "readonly token=from-bash-env; export token\n"]]) {
      const file = `${scratch}/bash-env-${label.split(" ")[0]}.sh`;
      await Deno.writeTextFile(file, rc);
      await reset([v404, founded, { status: 200, body: viewOf(want) }]);
      const r = await run(applyArgs(), { BL_ADMIN_TOKEN: TOKEN, BASH_ENV: file }, { fakeCurl: true, shell: ["bash"] });
      check(`A10 bash with ${label} (BASH_ENV): exit 2, no curl started, no request, the token not printed`, r.code === 2 && !(await exists(curlMark)) && reqs.length === 0 && !r.out.includes(TOKEN), `exit ${r.code}\n${r.out.replaceAll(TOKEN, "<TOKEN>")}`);
    }
  }
}

// B: refusals, before any request.
const refusals: [string, string[], Record<string, string>][] = [
  ["--apply without --confirm-coordinator", ["--coordinator", stubUrl, "--apply", "--yes"], { BL_ADMIN_TOKEN: TOKEN }],
  ["two different URLs", ["--coordinator", stubUrl, "--apply", "--confirm-coordinator", `http://localhost:${stubPort}`, "--yes"], { BL_ADMIN_TOKEN: TOKEN }],
  ["http:// for a host that is not loopback", applyArgs("http://example.invalid"), { BL_ADMIN_TOKEN: TOKEN }],
  ["http:// for *.localhost", applyArgs(`http://garden.localhost:${stubPort}`), { BL_ADMIN_TOKEN: TOKEN }],
  ["http://localhost.evil.com", applyArgs("http://localhost.evil.com"), { BL_ADMIN_TOKEN: TOKEN }],
  ["http://127.0.0.1.evil.com", applyArgs("http://127.0.0.1.evil.com"), { BL_ADMIN_TOKEN: TOKEN }],
  ["a URL with a path", applyArgs(`${stubUrl}/api`), { BL_ADMIN_TOKEN: TOKEN }],
  ["a URL with a trailing slash", applyArgs(`${stubUrl}/`), { BL_ADMIN_TOKEN: TOKEN }],
  ["an uppercase host", applyArgs(`http://LOCALHOST:${stubPort}`), { BL_ADMIN_TOKEN: TOKEN }],
  ["a port with a leading zero", applyArgs(`http://127.0.0.1:0${stubPort}`), { BL_ADMIN_TOKEN: TOKEN }],
  ["a port above 65535", applyArgs("http://127.0.0.1:65536"), { BL_ADMIN_TOKEN: TOKEN }],
  ["no BL_ADMIN_TOKEN", applyArgs(), {}],
  ["an empty BL_ADMIN_TOKEN", applyArgs(), { BL_ADMIN_TOKEN: "" }],
  ["a token with LF", applyArgs(), { BL_ADMIN_TOKEN: `${TOKEN}\nx-injected: 1` }],
  ["a token with CR", applyArgs(), { BL_ADMIN_TOKEN: `${TOKEN}\rx` }],
  ["a token with a space", applyArgs(), { BL_ADMIN_TOKEN: `${TOKEN} x` }],
  ["no terminal and no --yes", ["--coordinator", stubUrl, "--apply", "--confirm-coordinator", stubUrl], { BL_ADMIN_TOKEN: TOKEN }],
  ["an unknown flag", [...applyArgs(), `--token=${TOKEN}`], { BL_ADMIN_TOKEN: TOKEN }],
  ["a flag given twice", [...applyArgs(), "--yes"], { BL_ADMIN_TOKEN: TOKEN }],
  ["no --coordinator", ["--apply", "--yes"], { BL_ADMIN_TOKEN: TOKEN }],
  ["--yes without --apply", ["--coordinator", stubUrl, "--yes"], { BL_ADMIN_TOKEN: TOKEN }],
  ["--confirm-coordinator without --apply", ["--coordinator", stubUrl, "--confirm-coordinator", stubUrl], { BL_ADMIN_TOKEN: TOKEN }],
];
for (const [label, args, env] of refusals) {
  await reset([]);
  const r = await run(args, env, { fakeCurl: true });
  check(`B refuses ${label}: exit 2, no request, no curl`, r.code === 2 && reqs.length === 0 && !(await exists(curlMark)), `exit ${r.code} ${reqs.length}\n${r.out}`);
}
await reset([]);
{
  const r = await run(["--help"], {}, { fakeCurl: true });
  check("B --help: exit 0, the usage, no curl", r.code === 0 && r.out.startsWith("usage: bin/garden-found") && !(await exists(curlMark)), `exit ${r.code}\n${r.out}`);
}

// B: the typed confirmation, through a pseudo-terminal.
// BSD `script [file [command ...]]` (macOS); util-linux `script` takes the command after -c instead, so elsewhere skip.
const hasScript = Deno.build.os === "darwin" && (await new Deno.Command("sh", { args: ["-c", "command -v script"], stdout: "null", stderr: "null" }).output()).success;
if (!hasScript) {
  skipped += 3;
  console.log("SKIP the typed confirmation (3 checks): no macOS `script` here for a pseudo-terminal (check it by hand)");
} else {
  const args = ["--coordinator", stubUrl, "--apply", "--confirm-coordinator", stubUrl];
  await reset([]);
  const wrong = await run(args, { BL_ADMIN_TOKEN: TOKEN }, { pty: "found commons on cadence.garden\n" });
  check("B a wrong typed line: exit 2, no request", wrong.code === 2 && reqs.length === 0 && wrong.out.includes("not confirmed"), `exit ${wrong.code} ${reqs.length}\n${wrong.out}`);
  const shown = wrong.out.indexOf("preset          wild-storm-large");
  check("B the parameters are shown before the question", shown >= 0 && shown < wrong.out.indexOf("to go on: ") && wrong.out.includes(`body            ${docBody}`), wrong.out);
  await reset([{ status: 200, body: viewOf(want) }]);
  const right = await run(args, { BL_ADMIN_TOKEN: TOKEN }, { pty: `found commons on 127.0.0.1:${stubPort}\n` });
  check("B the right typed line: proceeds (a matching view and spec), exit 0", right.code === 0 && paths() === `GET ${viewPath},GET ${specPath}` && right.out.includes("already exists"), `exit ${right.code} ${paths()}\n${right.out}`);
}
await stub.shutdown();

// ---- C: a dev coordinator ----
const port = freePort();
const api = `http://127.0.0.1:${port}`;
/** Everything listening on the port must be `pid` or one of its descendants (lsof), or the founding goes elsewhere. */
async function ownsPort(pid: number): Promise<{ ok: boolean; detail: string }> {
  let listeners: number[] = [];
  try {
    const out = await new Deno.Command("lsof", { args: ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], stdin: "null", stdout: "piped", stderr: "null" }).output();
    listeners = text(out.stdout).split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return { ok: false, detail: "lsof is missing, and this test needs it to check who listens on the port" };
  }
  const ours = new Set(await treePids(pid));
  return { ok: listeners.length > 0 && listeners.every((l) => ours.has(l)), detail: `listeners [${listeners.join(", ")}], ours [${[...ours].join(", ")}]` };
}
const answersBefore = await fetch(`${api}/api/public/status`, { signal: AbortSignal.timeout(5_000) }).then((r) => (r.body?.cancel(), true), () => false);
const logPath = `${scratch}/coordinator.log`;
await Deno.mkdir(`${scratch}/data`);
const log = await Deno.open(logPath, { append: true, create: true });
const server = new Deno.Command("mix", {
  args: ["phx.server"],
  cwd: `${root}/apps/coordinator`,
  env: { ...baseEnv, PATH: `${shimBin}:${baseEnv.PATH ?? ""}`, MIX_ENV: "dev", PORT: String(port), BL_DATA_DIR: `${scratch}/data`, BL_DISCOVERY_DATA_DIR: `${scratch}/discovery`, BL_ADMIN_TOKEN: TOKEN },
  clearEnv: true,
  stdin: "null",
  stdout: "piped",
  stderr: "piped",
}).spawn();
const pumped = Promise.all([server.stdout.pipeTo(log.writable), server.stderr.pipeTo((await Deno.open(logPath, { append: true })).writable)]).catch(() => {});
let exited = false;
server.status.then(() => (exited = true));

const viewStatus = async () => {
  try {
    const r = await fetch(`${api}${viewPath}`, { signal: AbortSignal.timeout(10_000) });
    const body = await r.text();
    return { status: r.status, body };
  } catch (e) {
    return { status: 0, body: (e as Error).message };
  }
};

try {
  console.log(`starting the dev coordinator on ${api} (logs in ${logPath}) ...`);
  const deadline = Date.now() + 600_000;
  let up = false;
  while (!up && !exited && Date.now() < deadline) {
    try {
      up = (await fetch(`${api}/api/public/status`, { signal: AbortSignal.timeout(5_000) })).ok;
    } catch {
      await sleep(1000);
    }
  }
  check("C the dev coordinator answers", up, exited ? "it exited" : "no answer within 600 s");
  const own = up ? await ownsPort(server.pid) : { ok: false, detail: "it did not answer" };
  check("C nothing answered on the port before, and the listener now is the coordinator this test started", !answersBefore && own.ok, `answered before: ${answersBefore}; ${own.detail}`);
  if (up && own.ok && !answersBefore) {
    const r6 = await run(applyArgs(api), { BL_ADMIN_TOKEN: WRONG });
    const v6 = await viewStatus();
    check("C6 a wrong token: exit 1, 401 reported, the view still 404", r6.code === 1 && r6.out.includes("(401)") && v6.status === 404, `exit ${r6.code} view ${v6.status}\n${r6.out}`);

    const r7 = await run(applyArgs(api), { BL_ADMIN_TOKEN: TOKEN });
    const v7 = await viewStatus();
    let echoed = false;
    let detail = v7.body.slice(0, 400);
    if (v7.status === 200) {
      const v = JSON.parse(v7.body);
      const canon = (x: unknown): unknown => Array.isArray(x) ? x.map(canon) : x !== null && typeof x === "object" ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])])) : x;
      const pairs: [unknown, unknown][] = [
        [v.name, want.name], [v.presetId, want.presetId], [v.seed, want.seed], [canon(v.founding), canon(want.founding)],
        [v.pace?.stepsPerDay, want.stepsPerDay], [v.pace?.dawnPeriodMs, want.dawnPeriodMs], [v.pace?.dawnOffsetMs, want.dawnOffsetMs],
        [v.clock?.daysTotal, want.days], [v.letters?.perDay, want.lettersPerDay], [v.letters?.queueMax, want.queueMax], [v.food?.enabled, want.food],
        [v.meteor?.enabled, want.meteor], [v.sun?.enabled, want.sun],
      ];
      echoed = pairs.every(([a, b]) => JSON.stringify(a) === JSON.stringify(b));
      detail = JSON.stringify(pairs);
    }
    check("C7 the right token: exit 0, and the view carries every compared parameter", r7.code === 0 && r7.out.includes("the public view and the spec match the checklist") && echoed, `exit ${r7.code} view ${v7.status} ${detail}\n${r7.out}`);
    let spec: Record<string, unknown> = {};
    try {
      const s = await fetch(`${api}${specPath}`, { headers: { authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(10_000) });
      spec = (await s.json())?.spec ?? {};
    } catch {
      // checked below
    }
    check("C7 the admin spec carries censusEvery and deepEvery", spec.censusEvery === want.censusEvery && spec.deepEvery === want.deepEvery, JSON.stringify({ censusEvery: spec.censusEvery, deepEvery: spec.deepEvery }));

    const r8 = await run(applyArgs(api), { BL_ADMIN_TOKEN: TOKEN });
    check("C8 again: exit 0, already exists, nothing founded", r8.code === 0 && r8.out.includes("already exists") && r8.out.includes("matches the checklist; nothing was founded"), `exit ${r8.code}\n${r8.out}`);
  }
} finally {
  const pids = await treePids(server.pid);
  for (const p of pids) {
    try {
      Deno.kill(p, "SIGTERM");
    } catch {
      // gone
    }
  }
  const stopBy = Date.now() + 20_000;
  while (Date.now() < stopBy && (await Promise.all(pids.map(alive))).some(Boolean)) await sleep(500);
  for (const p of pids) {
    if (await alive(p)) {
      try {
        Deno.kill(p, "SIGKILL");
      } catch {
        // gone
      }
    }
  }
  await server.status;
  await pumped;
}

// ---- D: secrets ----
const all = printed.join("\n");
check("D neither token appears in anything the script printed", !all.includes(TOKEN) && !all.includes(WRONG));
const serverLog = await Deno.readTextFile(logPath).catch(() => "");
check("D neither token appears in the coordinator's log", serverLog !== "" && !serverLog.includes(TOKEN) && !serverLog.includes(WRONG));
const src = await Deno.readTextFile(script);
const code = src.split("\n").filter((l) => !/^\s*#/.test(l));
const allowed = new Set([
  `token=\${BL_ADMIN_TOKEN:-}`,
  `[ -z "$token" ] || token_set=yes`,
  `printf '  authorization: Bearer %s\\n' '$BL_ADMIN_TOKEN'`,
  `[ -n "$token" ] || refuse "BL_ADMIN_TOKEN is not set (the admin token is read from it only)"`,
  `case $token in`,
  `printf 'authorization: Bearer %s\\n' "$token" | http "$@" -H @-`,
  `*"$token"*) result="  (the comparison repeats the admin token, so it is not shown)" ;;`,
]);
const expanding = code.filter((l) => /\$\{?(BL_ADMIN_TOKEN|token)\b/.test(l)).map((l) => l.trim());
const stray = expanding.filter((l) => !allowed.has(l));
check("D every line that expands the token is an allowed form", stray.length === 0 && expanding.length === allowed.size, `stray: ${stray.join(" | ")}; found ${expanding.length} of ${allowed.size}`);
const firstCommands = code.filter((l) => l.trim() !== "" && !l.startsWith("#!")).slice(0, 4).map((l) => l.trim());
check(
  "D the script's first commands switch tracing and allexport off, then take the token out of the environment",
  JSON.stringify(firstCommands) === JSON.stringify(["{ set +xva; } >/dev/null 2>&1", "unset token || exit 2", "token=${BL_ADMIN_TOKEN:-}", "unset BL_ADMIN_TOKEN || exit 2"]),
  JSON.stringify(firstCommands),
);
const curlLines = code.filter((l) => /^\s*curl\s/.test(l));
check(
  "D no set -x, and every curl starts `curl -q` and asks for no headers, trace or redirects",
  curlLines.length === 2 && curlLines.every((l) => /^\s*curl -q\s/.test(l)) && !code.some((l) => /\bset\s+-[a-z]*x/.test(l)) &&
    !curlLines.some((l) => /--verbose|--trace|\s-v\s|\s-i\s|--include|\s-D\s|--dump-header|\s-L\s|--location|--config|\s-K\s/.test(l)),
  curlLines.join("\n"),
);

console.log(`uptime: ${await uptime()}`);
const skipNote = skipped > 0 ? ` (${skipped} skipped, see SKIP above)` : "";
if (ok) {
  await Deno.remove(scratch, { recursive: true });
  console.log(`garden_found_smoke: all ${checks} checks passed${skipNote}`);
} else {
  console.log(`garden_found_smoke: FAILED${skipNote} (scratch kept at ${scratch})`);
}
Deno.exit(ok ? 0 : 1);
