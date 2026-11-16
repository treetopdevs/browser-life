// tools/volume-capture: the pure parts (arguments, the sheet file, captions, the sheet layout), the copies of the slab page's
// id tables against their sources, the WebGPU flags against playwright.config.ts, and the CLI's exit on bad arguments
// (which happens before it starts Vite or Chrome, so this starts neither).
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRESETS } from "../../apps/lab/src/volume3d/camera.ts";
import { CANOPY_OPTIONS, CYCLIC_SIZES, DEFAULT_CYCLIC, DEFAULT_ECO, ECO_OPTIONS, ECO_SIZES, KILL_OPTIONS } from "../../apps/lab/src/slab/settings.ts";
import { RENDERERS } from "../../apps/lab/src/volume3d/approaches/registry.ts";
import {
  ArgError, CAMERA_IDS, CAMERA_POSES, GPU_ARGS, RENDERER_IDS, WORLDS, captionLines, parseArgs, parseSheet, sheetLayout, sheetSubLabel, slabUrl, stripHeight, thousands, turntableYaw,
} from "../volume-capture/lib.ts";
import { OutputError, prepareOut } from "../volume-capture/outputs.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

describe("copies of the page's tables", () => {
  it("worlds, settings, sizes and defaults match apps/lab/src/slab/settings.ts", () => {
    expect(WORLDS.cyclic.settings).toEqual(KILL_OPTIONS.map((k) => k.id));
    expect(WORLDS.eco.settings).toEqual([...ECO_OPTIONS, ...CANOPY_OPTIONS].map((o) => o.id));
    expect(WORLDS.cyclic.sizes).toEqual(CYCLIC_SIZES.map((s) => s.join("x")));
    expect(WORLDS.eco.sizes).toEqual(ECO_SIZES.map((s) => s.join("x")));
    expect(WORLDS.cyclic.defaults).toEqual({ setting: DEFAULT_CYCLIC.kill, seed: DEFAULT_CYCLIC.seed, size: DEFAULT_CYCLIC.size.join("x") });
    expect(WORLDS.eco.defaults).toEqual({ setting: DEFAULT_ECO.option, seed: DEFAULT_ECO.seed, size: DEFAULT_ECO.size.join("x") });
  });
  it("renderers and camera poses match the volume view's", () => {
    expect([...RENDERER_IDS]).toEqual(RENDERERS.map((r) => r.id));
    expect([...CAMERA_IDS]).toEqual(Object.keys(PRESETS));
    for (const id of CAMERA_IDS) {
      const p = PRESETS[id]!.pose;
      expect(CAMERA_POSES[id], id).toEqual({ yaw: p.yaw, pitch: p.pitch, dist: p.dist });
    }
  });
  it("the WebGPU flags are the e2e's", () => {
    const cfg = readFileSync(`${REPO}playwright.config.ts`, "utf8");
    const m = /const gpuArgs = (\[[^\]]*\]);/.exec(cfg);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1]!)).toEqual(GPU_ARGS);
  });
});

describe("parseArgs", () => {
  const ok = (s: string) => parseArgs(s.split(" "));
  const bad = (s: string, msg: RegExp) => expect(() => parseArgs(s ? s.split(" ") : [])).toThrow(msg);

  it("fills defaults: the ecology default, ray march, true shape, the oblique pose, 48 frames at 24 fps", () => {
    const a = ok("--out x");
    expect(a).toMatchObject({ mode: "turntable", out: "x", url: null, port: 5261, step: 0, frames: 48, fps: 24, width: 960, height: 600, sheet: null });
    expect(a.run).toEqual({ world: "eco", setting: "mu40-s20-k1024", seed: 101, size: "256x256x8", renderer: "raymarch", stretch: 1, peel: 0, camera: "oblique" });
  });
  it("takes a world's own defaults", () => {
    expect(ok("--out x --world cyclic").run).toMatchObject({ world: "cyclic", setting: "vacancy", seed: 401, size: "256x256x4" });
  });
  it("reads the demo's flags", () => {
    const a = ok("--out x --setting n12-mu50-s8-k64 --seed 101 --step 30000 --stretch 8 --frames 48 --url http://localhost:5173/slab/");
    expect(a.url).toBe("http://localhost:5173");
    expect(a.run).toMatchObject({ setting: "n12-mu50-s8-k64", seed: 101, stretch: 8 });
    expect(a.step).toBe(30000);
  });
  it("rejects bad arguments with a message naming the flag", () => {
    bad("", /--out <dir> is required/);
    bad("--out x --bogus 1", /unknown flag --bogus/);
    bad("--out x --seed", /--seed needs a value/);
    bad("--out x --seed 1 --seed 2", /given twice/);
    bad("--out x stray", /unexpected argument/);
    bad("--out x --seed -1", /whole number/);
    bad("--out x --seed 1.5", /whole number/);
    bad("--out x --seed 1000000", /from 0 to 999999/);
    bad("--out x --world jar", /cyclic or eco/);
    bad("--out x --setting vacancy", /not a eco setting/);
    bad("--out x --world cyclic --size 256x256x8", /not a cyclic size/);
    bad("--out x --renderer splat", /renderer must be one of/);
    bad("--out x --camera top", /camera must be one of/);
    bad("--out x --stretch 0", /from 1 to 16/);
    bad("--out x --peel 8", /from 0 to 7 for 256x256x8/);
    bad("--out x --world cyclic --peel 4", /from 0 to 3/);
    bad("--out x --width 961", /must be even/);
    bad("--out x --frames 0", /from 1 to 720/);
    bad("--out x --port 80", /from 1024 to 65535/);
    bad("--out x --port 5000 --url http://localhost:5173", /not both/);
    bad("--out x --url https://example.com", /local http origin/);
    bad("--out x --url nope", /not a URL/);
    bad("--out x --cols 3", /--cols needs --sheet/);
    bad("--out x --sheet s.json --frames 4", /for turntables/);
  });
  it("rejects inherited keys as values: an ArgError, never a TypeError", () => {
    for (const v of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
      for (const flag of ["world", "setting", "size", "renderer", "camera"]) {
        expect(() => parseArgs(["--out", "x", `--${flag}`, v]), `--${flag} ${v}`).toThrow(ArgError);
      }
    }
    expect(() => parseArgs(["--out", "x", "--toString", "1"])).toThrow(/unknown flag/);
    expect(() => parseArgs(["--out", "x", "--__proto__", "1"])).toThrow(/unknown flag/);
  });
  it("throws ArgError, which the CLI turns into exit 2", () => {
    expect(() => parseArgs([])).toThrow(ArgError);
  });
});

describe("parseSheet", () => {
  const base = parseArgs(["--out", "x", "--setting", "n12-mu50-s8-k64", "--camera", "side"]).run;
  it("completes entries from the flags, and a different world from its own defaults", () => {
    const e = parseSheet([{ label: "canopy 102", seed: 102 }, { label: "default eco", setting: "mu40-s20-k1024" }, { label: "cyclic", world: "cyclic" }], base);
    expect(e.map((x) => x.label)).toEqual(["canopy 102", "default eco", "cyclic"]);
    expect(e[0]!.run).toMatchObject({ world: "eco", setting: "n12-mu50-s8-k64", seed: 102, camera: "side" });
    expect(e[1]!.run).toMatchObject({ setting: "mu40-s20-k1024", seed: 101 });
    expect(e[2]!.run).toMatchObject({ world: "cyclic", setting: "vacancy", seed: 401, size: "256x256x4", camera: "side" });
  });
  it("rejects bad files", () => {
    expect(() => parseSheet({}, base)).toThrow(/non-empty JSON array/);
    expect(() => parseSheet([], base)).toThrow(/non-empty JSON array/);
    expect(() => parseSheet([{ seed: 1 }], base)).toThrow(/run 1: label/);
    expect(() => parseSheet([{ label: "a", camera: "above" }], base)).toThrow(/unknown key "camera"/);
    expect(() => parseSheet([{ label: "a", step: 5 }], base)).toThrow(/unknown key "step"/);
    expect(() => parseSheet([{ label: "a" }, { label: "b", seed: "7" }], base)).toThrow(/run 2: seed must be a number/);
    expect(() => parseSheet([{ label: "a", world: "cyclic", setting: "mu40-s20-k1024" }], base)).toThrow(/not a cyclic setting/);
    expect(() => parseSheet([{ label: "a", peel: 9 }], base)).toThrow(/peel/);
  });
  it("rejects inherited keys in the file as ArgErrors, and reads nothing from the prototype chain", () => {
    for (const v of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      for (const k of ["world", "setting", "size", "renderer"]) {
        expect(() => parseSheet([{ label: "a", [k]: v }], base), `${k}: ${v}`).toThrow(ArgError);
      }
    }
    expect(() => parseSheet(JSON.parse('[{"label": "a", "__proto__": {"world": "cyclic"}}]'), base)).toThrow(/unknown key "__proto__"/);
    expect(() => parseSheet(JSON.parse('[{"label": "a", "constructor": 1}]'), base)).toThrow(/unknown key "constructor"/);
    // an entry whose prototype carries fields: only own fields count, so this is the base run
    const sneaky = Object.create({ world: "cyclic", seed: 7 }) as Record<string, unknown>;
    sneaky.label = "own";
    expect(parseSheet([sneaky], base)[0]!.run).toEqual(base);
    const noLabel = Object.create({ label: "inherited" });
    expect(() => parseSheet([noLabel], base)).toThrow(/label must be/);
  });
});

describe("captions and links", () => {
  const run = parseArgs(["--out", "x", "--setting", "n12-mu50-s8-k64", "--stretch", "8"]).run;
  it("burns the world, the setting, the seed, the size, the step and how it is drawn", () => {
    expect(captionLines(run, 30000, { index: 3, count: 48, yawDeg: 22.5 })).toEqual([
      "Slab ecology · setting n12-mu50-s8-k64 · seed 101 · 256×256×8 · step 30,000",
      "ray march · depth stretch 8 · peel 0 · camera oblique · frame 4/48 · turn 22.5°",
    ]);
    expect(captionLines({ ...run, world: "cyclic", setting: "none", size: "128x128x4", renderer: "points" }, 0)[1]).toBe("points · depth stretch 8 · peel 0 · camera oblique");
    expect(sheetSubLabel(run)).toBe("eco · n12-mu50-s8-k64 · seed 101 · 256×256×8 · stretch 8");
  });
  it("formats thousands without the machine's locale", () => {
    expect([0, 999, 1000, 20000, 1234567].map(thousands)).toEqual(["0", "999", "1,000", "20,000", "1,234,567"]);
  });
  it("links the slab page with every setting", () => {
    const u = new URL(slabUrl("http://localhost:5261", run));
    expect(u.pathname).toBe("/slab/");
    expect(Object.fromEntries(u.searchParams)).toEqual({ debug: "1", world: "eco", setting: "n12-mu50-s8-k64", seed: "101", size: "256x256x8", display: "volume", renderer: "raymarch", stretch: "8", peel: "0", camera: "oblique" });
  });
  it("turns by index, a full turn over k frames, never accumulating", () => {
    expect(turntableYaw(0.6, 0, 48)).toBe(0.6);
    expect(turntableYaw(0.6, 12, 48)).toBeCloseTo(0.6 + Math.PI / 2, 12);
    expect(turntableYaw(0.6, 48, 48)).toBeCloseTo(0.6 + 2 * Math.PI, 12);
  });
  it("keeps picture plus caption strip even", () => {
    expect(stripHeight(2, 600)).toBe(52);
    expect(stripHeight(2, 601)).toBe(53);
    expect((601 + stripHeight(2, 601)) % 2).toBe(0);
  });
});

describe("sheetLayout", () => {
  it("lays five stills out about square, row by row, labels under each", () => {
    const L = sheetLayout(5, 640, 400, { labelH: 44, gap: 12, top: 34 });
    expect([L.cols, L.rows]).toEqual([3, 2]);
    expect(L.width).toBe(12 + 3 * 652);
    expect(L.height).toBe(34 + 12 + 2 * (444 + 12));
    expect(L.cells[0]).toEqual({ x: 12, y: 46, labelY: 446 });
    expect(L.cells[3]).toEqual({ x: 12, y: 46 + 456, labelY: 46 + 456 + 400 });
    expect(L.cells[4]!.x).toBe(12 + 652);
  });
  it("honours a column count, never more columns than stills, and rounds the sheet up to even", () => {
    expect(sheetLayout(2, 100, 100, { cols: 5 }).cols).toBe(2);
    const L = sheetLayout(3, 101, 101, { cols: 1, labelH: 40, gap: 12 });
    expect([L.cols, L.rows]).toEqual([1, 3]);
    expect(L.width % 2 + L.height % 2).toBe(0);
    expect(() => sheetLayout(0, 10, 10)).toThrow();
  });
});

describe("prepareOut: writes and deletes stay inside --out", () => {
  const files = ["frames/frame-0000.png", "frames/frame-0001.png", "turntable.mp4", "capture.json"];
  const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "volume-capture-")));
  it("creates --out and frames/ and returns --out's real path", () => {
    const t = tmp();
    expect(prepareOut(join(t, "a", "out"), ["frames"], files)).toBe(join(t, "a", "out"));
    expect(prepareOut(join(t, "a", "out"), ["frames"], files)).toBe(join(t, "a", "out")); // again, over its own output
    rmSync(t, { recursive: true });
  });
  it("allows --out itself to be a link (the caller's choice) and returns its target", () => {
    const t = tmp();
    mkdirSync(join(t, "real"));
    symlinkSync(join(t, "real"), join(t, "link"));
    expect(prepareOut(join(t, "link"), ["frames"], files)).toBe(join(t, "real"));
    rmSync(t, { recursive: true });
  });
  it("refuses a symlinked frames/, artifact or stale frame, wherever it points", () => {
    for (const plant of [
      (out: string, away: string) => symlinkSync(away, join(out, "frames")),
      (out: string, away: string) => symlinkSync(join(away, "victim.mp4"), join(out, "turntable.mp4")),
      (out: string, away: string) => { mkdirSync(join(out, "frames")); symlinkSync(join(away, "victim.png"), join(out, "frames", "frame-0099.png")); },
      (out: string, away: string) => { mkdirSync(join(out, "frames")); symlinkSync(join(away, "victim.png"), join(out, "frames", "frame-0001.png")); },
      (out: string) => { mkdirSync(join(out, "inside")); symlinkSync(join(out, "inside"), join(out, "frames")); }, // even pointing inside
    ]) {
      const t = tmp();
      const out = join(t, "out"), away = join(t, "away");
      mkdirSync(out); mkdirSync(away);
      writeFileSync(join(away, "victim.mp4"), "keep"); writeFileSync(join(away, "victim.png"), "keep");
      plant(out, away);
      expect(() => prepareOut(out, ["frames"], files)).toThrow(OutputError);
      expect(readFileSync(join(away, "victim.mp4"), "utf8")).toBe("keep");
      rmSync(t, { recursive: true });
    }
  });
  it("refuses paths that climb out, and an --out that is a file", () => {
    const t = tmp();
    expect(() => prepareOut(join(t, "out"), [], ["../escape.png"])).toThrow(/not under --out/);
    expect(() => prepareOut(join(t, "out"), ["../frames"], [])).toThrow(/not under --out/);
    writeFileSync(join(t, "file"), "x");
    expect(() => prepareOut(join(t, "file"), [], ["sheet.png"])).toThrow(/not a directory/);
    rmSync(t, { recursive: true });
  });
});

describe("the CLI", () => {
  const cli = (args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "tools/volume-capture/capture.ts", ...args], { cwd: REPO, encoding: "utf8", timeout: 120_000 });
  it("exits 2 with the usage on bad arguments, before starting anything", () => {
    for (const args of [[], ["--out", "x", "--seed", "abc"], ["--out", "x", "--sheet", "/nonexistent/runs.json"], ["--out", "x", "--world", "jar"]]) {
      const r = cli(args);
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stderr).toMatch(/volume-capture: .*\n\nUsage:/);
      expect(r.stderr).not.toMatch(/Vite on/);
    }
  }, 300_000);
  it("refuses a symlinked output with exit 2, before starting anything", () => {
    const t = realpathSync(mkdtempSync(join(tmpdir(), "volume-capture-")));
    mkdirSync(join(t, "out")); mkdirSync(join(t, "away"));
    symlinkSync(join(t, "away"), join(t, "out", "frames"));
    const r = cli(["--out", join(t, "out"), "--frames", "2"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/symlink/);
    expect(r.stderr).not.toMatch(/Vite on/);
    rmSync(t, { recursive: true });
  }, 300_000);
  it("on SIGTERM stops Vite and Chrome, frees the strict port and exits nonzero", async () => {
    const port = 5269;
    const free = () => new Promise<boolean>((ok) => { const s = createServer(); s.once("error", () => ok(false)); s.listen(port, "localhost", () => s.close(() => ok(true))); });
    expect(await free(), `port ${port} must be free for this test`).toBe(true);
    const t = mkdtempSync(join(tmpdir(), "volume-capture-"));
    const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "tools/volume-capture/capture.ts", "--out", t, "--frames", "2", "--port", String(port)], { cwd: REPO, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    await new Promise<void>((ok, no) => {
      child.stderr!.on("data", (b: Buffer) => { err += b.toString(); if (/Vite on/.test(err)) ok(); });
      child.once("exit", () => no(new Error(`exited before Vite was up:\n${err}`)));
    });
    child.kill("SIGTERM"); // lands while Chrome starts
    const code = await new Promise<number | null>((ok) => child.once("exit", (c) => ok(c)));
    expect(code, err).toBe(143);
    expect(err).toMatch(/SIGTERM: stopping Chrome and Vite/);
    expect(await free()).toBe(true);
    rmSync(t, { recursive: true });
  }, 300_000);
  it("prints the usage on --help", () => {
    const r = cli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Usage:/);
  }, 300_000);
});
