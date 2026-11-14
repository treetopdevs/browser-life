// tools/creative-prototypes/restore.mjs against a tiny temp fixture (no need for the real 300 MB), plus structure checks
// on the real docs/creative-prototypes/ARTIFACTS.md. The script is run as a child process with plain argv (no deno).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, utimesSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(REPO, "tools/creative-prototypes/restore.mjs");
const modPath: string = SCRIPT;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const A = { path: "docs/cp/a.json", data: Buffer.from("alpha-bytes") };
const B = { path: "docs/cp/media/b.mp4", data: Buffer.from("bravo-bytes-longer") };
const C = { path: "docs/cp/c.json", data: Buffer.from("charlie") };
const D = { path: "docs/cp/d.json", data: Buffer.from("delta") };

let root: string, target: string, source: string, excl: string, artifacts: string;
// Git reads its repository location from these variables before it looks at cwd (they are set inside hooks and by some
// wrappers), so every child process gets an environment without them: the fixture must never touch the caller's repository.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|PREFIX|CEILING_DIRECTORIES|CONFIG|CONFIG_PARAMETERS|CONFIG_COUNT)$/.test(k) && !/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)));
const git = (...a: string[]) => execFileSync("git", a, { cwd: target, env: ENV, stdio: ["ignore", "pipe", "pipe"] }).toString();

function table(entries: { path: string; data: Buffer; commit?: string }[], withCommit: boolean) {
  return entries.map((e) => `| \`${e.path}\` | ${e.data.length} | \`${sha(e.data)}\`${withCommit ? ` | \`${e.commit}\`` : ""} |`).join("\n");
}
function run(...args: string[]) {
  const r = spawnSync("node", [SCRIPT, target, "--source", source, "--artifacts", artifacts, "--exclude-file", excl, "--first-table-commit", firstCommit, ...args], { encoding: "utf8", env: ENV });
  return { code: r.status, out: r.stdout + r.stderr };
}
function runDefaultExclude(cwdTarget: string, ...args: string[]) {
  const r = spawnSync("node", [SCRIPT, cwdTarget, "--source", source, "--artifacts", artifacts, "--first-table-commit", firstCommit, ...args], { encoding: "utf8", env: ENV });
  return { code: r.status, out: r.stdout + r.stderr };
}
let firstCommit = "";
const tmpLeft = () => {
  const found: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (n === ".git") continue; if (n.includes(".restore-tmp-")) found.push(p); else if (lstatSync(p).isDirectory()) walk(p); } };
  walk(target);
  return found;
};
const put = (dir: string, e: { path: string; data: Buffer }, data = e.data) => { const p = join(dir, e.path); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, data); return p; };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "restore-test-"));
  target = join(root, "target"); source = join(root, "runs"); excl = join(root, "exclude"); artifacts = join(root, "ARTIFACTS.md");
  mkdirSync(target); mkdirSync(join(source, "food-line-101-119"), { recursive: true }); mkdirSync(join(source, "creative-prototypes-85-100"), { recursive: true });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  // C (second table) is committed to the fixture repo so the git fallback can find it; D is in no commit.
  put(target, C); git("add", "."); git("commit", "-qm", "c"); const cCommit = git("rev-parse", "HEAD").trim().slice(0, 8);
  rmSync(join(target, C.path)); git("rm", "-q", "--cached", C.path); git("commit", "-qm", "rm c");
  put(target, A); git("add", "."); git("commit", "-qm", "a"); firstCommit = git("rev-parse", "HEAD").trim().slice(0, 8);
  rmSync(join(target, A.path)); git("rm", "-q", "--cached", A.path); git("commit", "-qm", "rm a");
  writeFileSync(artifacts, `# t\n\n| Path | Bytes | SHA-256 |\n|---|---|---|\n${table([A, B], false)}\n\n# Food-band line\n\n| Path | Bytes | SHA-256 | Commit |\n|---|---|---|---|\n${table([{ ...C, commit: cCommit }, { ...D, commit: cCommit }], true)}\n`);
  writeFileSync(excl, "# keep me\n*.swp\n");
  put(join(source, "creative-prototypes-85-100"), B);
  put(join(source, "food-line-101-119"), A);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
// D is only restorable by fixing the fixture; most tests add it to the source.
const addD = () => put(join(source, "food-line-101-119"), D);

describe("restore.mjs", () => {
  it("restores a file whose source hash matches", () => {
    addD();
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain("RESULT: 4/4 verified");
    for (const e of [A, B, C, D]) expect(readFileSync(join(target, e.path)).equals(e.data)).toBe(true);
    expect(tmpLeft()).toEqual([]);
  });

  it("fails on a source hash mismatch and leaves nothing in place", () => {
    put(join(source, "food-line-101-119"), D, Buffer.from("deltz")); // D has no git fallback
    const r = run();
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/MISSING\s+docs\/cp\/d\.json.*wrong hash/);
    expect(existsSync(join(target, D.path))).toBe(false);
    expect(tmpLeft()).toEqual([]);
  });

  it("rejects a truncated source with a matching prefix (size mismatch)", () => {
    put(join(source, "food-line-101-119"), D, D.data.subarray(0, 3));
    put(join(source, "food-line-101-119"), A, A.data.subarray(0, 5)); // truncated, but git can supply A
    const r = run();
    expect(r.code).not.toBe(0);
    expect(existsSync(join(target, D.path))).toBe(false);
    expect(tmpLeft()).toEqual([]);
    expect(r.out).toMatch(/copied\s+docs\/cp\/a\.json\s+\(from git/);
  });

  it("a bad source never clobbers an existing differing file, even with --force", () => {
    addD();
    const p = put(target, B, Buffer.from("local edits"));
    put(join(source, "creative-prototypes-85-100"), B, Buffer.from("garbage")); // wrong hash; B has no git copy
    const r = run("--force");
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/MISSING|HASH MISMATCH/);
    expect(r.out).toMatch(/HASH MISMATCH\s+docs\/cp\/media\/b\.mp4.*wrong hash/);
    expect(readFileSync(p, "utf8")).toBe("local edits");
    expect(tmpLeft()).toEqual([]);
  });

  it("falls back to git show when the source file is missing", () => {
    addD();
    rmSync(join(source, "food-line-101-119", A.path));
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(new RegExp(`copied\\s+${A.path}\\s+\\(from git ${firstCommit}\\)`));
  });

  it("fails when the source is missing and git has no such path", () => {
    const r = run(); // D is in no source and no commit
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/MISSING\s+docs\/cp\/d\.json/);
    expect(existsSync(join(target, D.path))).toBe(false);
    expect(r.out).toContain("RESULT: 3/4 verified");
  });

  it("fails when the git fallback gives bytes with the wrong hash", () => {
    addD();
    rmSync(join(source, "food-line-101-119", A.path));
    // Pin A to different bytes than the commit holds.
    writeFileSync(artifacts, readFileSync(artifacts, "utf8").replace(sha(A.data), sha("something else")));
    const r = run();
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/MISSING\s+docs\/cp\/a\.json.*wrong hash/);
    expect(existsSync(join(target, A.path))).toBe(false);
    expect(tmpLeft()).toEqual([]);
  });

  it("refuses to overwrite a differing existing file without --force, and overwrites with it", () => {
    addD();
    const p = put(target, A, Buffer.from("local edits"));
    const r = run();
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/REFUSED\s+docs\/cp\/a\.json/);
    expect(readFileSync(p, "utf8")).toBe("local edits");
    const f = run("--force");
    expect(f.code).toBe(0);
    expect(readFileSync(p).equals(A.data)).toBe(true);
  });

  it("refuses a dangling symlink at a target path, and a flag-like value for --source", () => {
    addD();
    mkdirSync(join(target, "docs/cp"), { recursive: true });
    symlinkSync(join(root, "nowhere"), join(target, A.path));
    const r = run();
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/REFUSED\s+docs\/cp\/a\.json/);
    const bad = spawnSync("node", [SCRIPT, target, "--source", "--dry-run"], { encoding: "utf8", env: ENV });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("--source needs a value");
  });

  it("refuses a symlinked parent directory that points outside the target, and writes nothing there", () => {
    addD();
    const outside = join(root, "outside"); mkdirSync(outside);
    rmSync(join(target, "docs/cp"), { recursive: true, force: true });
    symlinkSync(outside, join(target, "docs/cp"));
    const r = run();
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/REFUSED\s+docs\/cp\/a\.json.*symlink/);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses a symlinked parent even when it points inside the target (tracked-file overwrite)", () => {
    addD();
    rmSync(join(target, "docs/cp"), { recursive: true, force: true });
    const shared = join(target, "shared"); mkdirSync(shared);
    writeFileSync(join(shared, "a.json"), "tracked");
    symlinkSync(shared, join(target, "docs/cp"));
    const r = run("--force");
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/REFUSED\s+docs\/cp\/a\.json.*symlink/);
    expect(readFileSync(join(shared, "a.json"), "utf8")).toBe("tracked");
  });

  it("fails closed when the git index cannot be read", () => {
    addD();
    writeFileSync(join(target, ".git/index"), "garbage");
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/cannot read the git index/);
    for (const e of [A, B, C, D]) expect(existsSync(join(target, e.path))).toBe(false);
  });

  it("--unexclude refuses to combine with --dry-run or --check and leaves the exclude file alone", () => {
    addD();
    expect(run().code).toBe(0);
    const before = readFileSync(excl, "utf8");
    for (const f of ["--dry-run", "--check"]) {
      const r = run("--unexclude", f);
      expect(r.code).toBe(2);
      expect(r.out).toContain("cannot be combined");
    }
    expect(readFileSync(excl, "utf8")).toBe(before);
  });

  it("with --force replaces a symlink at the destination instead of writing through it", () => {
    addD();
    mkdirSync(join(target, "docs/cp"), { recursive: true });
    const victim = join(root, "victim.txt"); writeFileSync(victim, "keep me");
    symlinkSync(victim, join(target, A.path));
    expect(run().code).not.toBe(0);
    expect(readFileSync(victim, "utf8")).toBe("keep me");
    expect(run("--force").code).toBe(0);
    expect(readFileSync(victim, "utf8")).toBe("keep me");
    expect(lstatSync(join(target, A.path)).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(target, A.path)).equals(A.data)).toBe(true);
  });

  it("a symlink to a file with matching bytes does not pass --check", () => {
    addD();
    mkdirSync(join(target, "docs/cp"), { recursive: true });
    const real = join(root, "real-a.json"); writeFileSync(real, A.data);
    symlinkSync(real, join(target, A.path));
    const c = run("--check");
    expect(c.code).not.toBe(0);
    expect(c.out).toMatch(/REFUSED\s+docs\/cp\/a\.json/);
  });

  it("refuses paths that the checkout tracks, before writing anything", () => {
    addD();
    put(target, A, Buffer.from("tracked content")); git("add", A.path);
    const r = run();
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/REFUSED\s+docs\/cp\/a\.json.*tracked/);
    expect(readFileSync(join(target, A.path), "utf8")).toBe("tracked content");
  });

  it("writes the exclude block before copying: an unwritable exclude file stops the run with nothing copied", () => {
    addD();
    const dirAsExclude = join(root, "exclude-is-a-dir"); mkdirSync(dirAsExclude);
    const r = spawnSync("node", [SCRIPT, target, "--source", source, "--artifacts", artifacts, "--exclude-file", dirAsExclude, "--first-table-commit", firstCommit], { encoding: "utf8", env: ENV });
    expect(r.status).not.toBe(0);
    for (const e of [A, B, C, D]) expect(existsSync(join(target, e.path))).toBe(false);
    expect(tmpLeft()).toEqual([]);
  });

  it("a target that is not a git checkout fails with exit 1 and copies nothing when the exclude file cannot be resolved", () => {
    addD();
    const plain = join(root, "plain"); mkdirSync(plain);
    const r = runDefaultExclude(plain);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/not a git checkout|cannot resolve/);
    expect(readdirSync(plain)).toEqual([]);
  });

  it("default exclude resolution: in a linked worktree the shared info/exclude gains the block and git status stays clean", () => {
    addD();
    const wt = join(root, "wt");
    git("worktree", "add", "--detach", wt);
    const r = runDefaultExclude(wt);
    expect(r.code).toBe(0);
    const shared = readFileSync(join(target, ".git/info/exclude"), "utf8");
    expect(shared).toContain("# >>> restore.sh");
    expect(shared).toContain(`/${A.path}`);
    expect(shared).toContain(".restore-tmp-*");
    expect(r.out).toContain(join(target, ".git/info/exclude"));
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: wt, env: ENV }).toString()).toBe("");
    // --unexclude takes the block out again and leaves unrelated lines alone.
    const u = runDefaultExclude(wt, "--unexclude");
    expect(u.code).toBe(0);
    const after = readFileSync(join(target, ".git/info/exclude"), "utf8");
    expect(after).not.toContain("restore.sh");
    expect(after).not.toContain(`/${A.path}`);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: wt, env: ENV }).toString()).toContain("docs/");
  });

  it("second run is idempotent", () => {
    addD();
    expect(run().code).toBe(0);
    const past = new Date(2020, 1, 1);
    for (const e of [A, B, C, D]) utimesSync(join(target, e.path), past, past);
    const second = run();
    expect(second.code).toBe(0);
    expect(second.out).toContain("copied 0, already ok 4");
    for (const e of [A, B, C, D]) expect(statSync(join(target, e.path)).mtime.getTime()).toBe(past.getTime());
  });

  it("--check writes nothing and exits non-zero when a file is missing, zero when all verify", () => {
    addD();
    const before = readFileSync(excl, "utf8");
    const c = run("--check");
    expect(c.code).not.toBe(0);
    expect(c.out).toMatch(/MISSING\s+docs\/cp\/a\.json/);
    expect(existsSync(join(target, A.path))).toBe(false);
    expect(readFileSync(excl, "utf8")).toBe(before);
    expect(run().code).toBe(0);
    const ok = run("--check");
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("RESULT: 4/4 verified");
  });

  it("--dry-run writes nothing, including the exclude file", () => {
    addD();
    const before = readFileSync(excl, "utf8");
    const r = run("--dry-run");
    expect(r.out).toContain("would copy");
    expect(r.out).toContain("exclude file: not touched");
    expect(existsSync(join(target, A.path))).toBe(false);
    expect(readFileSync(excl, "utf8")).toBe(before);
  });

  it("adds the restored paths to the exclude file once, keeps unrelated lines, and hides them from git status", () => {
    addD();
    expect(run().code).toBe(0); expect(run().code).toBe(0);
    for (const e of [A, B, C, D]) expect(readFileSync(join(target, e.path)).equals(e.data)).toBe(true);
    const text = readFileSync(excl, "utf8");
    expect(text.startsWith("# keep me\n*.swp\n")).toBe(true);
    expect(text.match(/# >>> restore\.sh/g)).toHaveLength(1);
    for (const e of [A, B, C, D]) expect(text.split("\n").filter((l) => l === `/${e.path}`)).toHaveLength(1);
    // Point git at the fixture exclude file and confirm nothing restored shows as untracked.
    mkdirSync(join(target, ".git/info"), { recursive: true });
    writeFileSync(join(target, ".git/info/exclude"), text);
    expect(git("status", "--porcelain")).toBe("");
  });
});

describe("real ARTIFACTS.md", () => {
  const md = readFileSync(join(REPO, "docs/creative-prototypes/ARTIFACTS.md"), "utf8");
  it("parses 15 + 58 rows with 64-hex hashes and well-formed commit ids", async () => {
    const mod: any = await import(/* @vite-ignore */ modPath);
    const rows = mod.parseArtifacts(md);
    expect(rows.filter((r: any) => r.table === 1)).toHaveLength(15);
    expect(rows.filter((r: any) => r.table === 2)).toHaveLength(58);
    expect(new Set(rows.map((r: any) => r.path)).size).toBe(73);
    for (const r of rows) { expect(r.sha256).toMatch(/^[0-9a-f]{64}$/); expect(Number.isInteger(r.size)).toBe(true); }
    for (const c of new Set(rows.map((r: any) => r.commit as string))) expect(c).toMatch(/^[0-9a-f]{7,40}$/);
  });
  it("the hard-coded first-table commit matches the prose in ARTIFACTS.md", async () => {
    const mod: any = await import(/* @vite-ignore */ modPath);
    expect(md).toContain(`(\`${mod.FIRST_TABLE_COMMIT}\`, on origin)`);
  });
  it("rejects a malformed row", async () => {
    const mod: any = await import(/* @vite-ignore */ modPath);
    expect(() => mod.parseArtifacts("| `x` | notanumber | `abc` |")).toThrow(/unparseable/);
  });
  it("the tables and prose that were on main before this tool are unchanged (pinned bytes; only appended text may differ)", () => {
    // Length and SHA-256 of docs/creative-prototypes/ARTIFACTS.md at origin/main 9d91709a, before the "Restoring with one command" section.
    const ORIGINAL_BYTES = 15483;
    const ORIGINAL_SHA256 = "52318dceff6cad391094528120074901014caa2667cd576ead91acb5761fadee";
    const bytes = readFileSync(join(REPO, "docs/creative-prototypes/ARTIFACTS.md"));
    expect(sha(bytes.subarray(0, ORIGINAL_BYTES))).toBe(ORIGINAL_SHA256);
  });
  it("rejects a non-canonical path, which the tracked-file check could not match", async () => {
    const mod: any = await import(/* @vite-ignore */ modPath);
    for (const p of ["docs/cp/./a.json", "docs//a.json", "./a.json", "docs/../a.json"]) expect(() => mod.parseArtifacts(`| \`${p}\` | 3 | \`${"a".repeat(64)}\` |`), p).toThrow(/unsafe|unparseable/);
  });
});

describe("restore.mjs, git's own view", () => {
  it("stops before copying when a .gitignore rule re-includes a restored path", () => {
    addD();
    writeFileSync(join(target, ".gitignore"), `!/${A.path}\n`);
    const r = runDefaultExclude(target);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/would still stage 1 restored path/);
    expect(existsSync(join(target, A.path))).toBe(false);
    expect(existsSync(join(target, B.path))).toBe(false);
  });
  it("treats -h after --source as a missing value, not a directory", () => {
    const r = spawnSync("node", [SCRIPT, target, "--source", "-h"], { encoding: "utf8", env: ENV });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--source needs a value/);
  });
});
