// tools/volume-capture: the pure parts (arguments, the sheet file, captions, the sheet layout), the copies of the slab and
// jar pages' id tables against their sources, the WebGPU flags against playwright.config.ts, and the CLI's exit on bad arguments
// (which happens before it starts Vite or Chrome, so this starts neither).
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRESETS } from "../../apps/lab/src/volume3d/camera.ts";
import { CANOPY_OPTIONS, CYCLIC_SIZES, DEFAULT_CYCLIC, DEFAULT_ECO, ECO_OPTIONS, ECO_SIZES, JAR_OPTIONS, JAR_SIZES, KILL_OPTIONS } from "../../apps/lab/src/slab/settings.ts";
import { RENDERERS } from "../../apps/lab/src/volume3d/approaches/registry.ts";
import { BONDS, DEFAULT_CHOICE, SEED_MAX, SINKS, SIZES, STRETCH_RANGE, TRAILS, VIEW_IDS, describeChoice, type Bonds, type Trail } from "../../apps/lab/src/mycelium3d/settings.ts";
import {
  ArgError, CAMERA_IDS, CAMERA_POSES, GPU_ARGS, M3D, M3D_BOND_WORDS, M3D_TRAIL_WORDS, RENDERER_IDS, WORLDS, anyCaptionLines, anySubLabel, captionLines, m3dCaptionLines, m3dSubLabel, m3dUrl,
  parseArgs, parseSheet, runUrl, sheetLayout, sheetSubLabel, slabUrl, stripHeight, thousands, turntableYaw, type M3dRun, type RunSettings,
} from "../volume-capture/lib.ts";
import { OutputError, prepareOut } from "../volume-capture/outputs.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

describe("copies of the page's tables", () => {
  it("worlds, settings, sizes and defaults match apps/lab/src/slab/settings.ts", () => {
    expect(WORLDS.cyclic.settings).toEqual(KILL_OPTIONS.map((k) => k.id));
    expect(WORLDS.eco.settings).toEqual([...ECO_OPTIONS, ...CANOPY_OPTIONS, ...JAR_OPTIONS].map((o) => o.id));
    expect(WORLDS.cyclic.sizes).toEqual(CYCLIC_SIZES.map((s) => s.join("x")));
    expect(WORLDS.eco.sizes).toEqual([...ECO_SIZES, ...JAR_SIZES].map((s) => s.join("x")));
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
  it("the jar's sizes, sinks, trails, bonds, defaults, ways of drawing and ranges match apps/lab/src/mycelium3d/", () => {
    expect([...M3D.sizes]).toEqual(Object.keys(SIZES));
    expect([...M3D.sinks]).toEqual(Object.keys(SINKS));
    expect([...M3D.trails]).toEqual(Object.keys(TRAILS));
    expect([...M3D.bonds]).toEqual(Object.keys(BONDS));
    expect(M3D.defaults).toEqual(DEFAULT_CHOICE);
    expect([...M3D.renderers]).toEqual([...VIEW_IDS]);
    expect(M3D.stretch).toEqual(STRETCH_RANGE);
    expect(M3D.seedMax).toBe(SEED_MAX);
    // the page's inputs carry the same ranges, and its menu is built from VIEW_IDS
    const html = readFileSync(`${REPO}apps/lab/mycelium3d/index.html`, "utf8");
    const input = (id: string) => new RegExp(`<input id="${id}"[^>]*>`).exec(html)![0];
    const attr = (tag: string, k: string) => Number(new RegExp(`\\b${k}="(\\d+)"`).exec(tag)![1]);
    expect([attr(input("stretch"), "min"), attr(input("stretch"), "max")]).toEqual([M3D.stretch.min, M3D.stretch.max]);
    expect([attr(input("seed"), "min"), attr(input("seed"), "max")]).toEqual([0, M3D.seedMax]);
    const page = readFileSync(`${REPO}apps/lab/src/mycelium3d/page.ts`, "utf8");
    expect(page).toMatch(/const MENU: ApproachEntry\[\] = VIEW_IDS\.map\(\(id\) => VIEWS\[id\]\);/);
    // the trail rules' caption words are the page's own
    for (const t of M3D.trails) expect(describeChoice({ ...DEFAULT_CHOICE, trail: t as Trail })).toContain(`trail rule ${M3D_TRAIL_WORDS[t]}`);
    // and the bond choices' words too; without bonds the words add nothing
    expect(M3D_BOND_WORDS.off).toBe("");
    expect(describeChoice({ ...DEFAULT_CHOICE, bonds: "off" })).toBe(describeChoice(DEFAULT_CHOICE));
    for (const b of M3D.bonds.filter((x) => x !== "off")) expect(describeChoice({ ...DEFAULT_CHOICE, bonds: b as Bonds })).toContain(`, ${M3D_BOND_WORDS[b]}`);
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
  it("runs a jar setting at the jar size, and refuses any other pairing of a jar setting and a size", () => {
    expect(ok("--out x --setting jar-sink --seed 102").run).toMatchObject({ world: "eco", setting: "jar-sink", seed: 102, size: "64x64x64" });
    expect(ok("--out x --setting jar-rps --size 64x64x64 --peel 10").run).toMatchObject({ size: "64x64x64", peel: 10 });
    bad("--out x --setting jar-sink --size 256x256x8", /jar settings run only at 64x64x64/);
    bad("--out x --size 64x64x64", /jar settings run only at 64x64x64/);
    expect(parseSheet([{ label: "a", setting: "jar-all" }, { label: "b", setting: "mu30-s8-k256" }], parseArgs(["--out", "x", "--setting", "jar-base", "--sheet", "s.json"]).run).map((e) => e.run.size)).toEqual(["64x64x64", "256x256x8"]);
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

describe("parseArgs --page mycelium3d", () => {
  const ok = (s: string) => parseArgs(s.split(" "));
  const bad = (s: string, msg: RegExp) => expect(() => parseArgs(s.split(" "))).toThrow(msg);
  it("leaves the slab the default page, its run without a page key", () => {
    const a = ok("--out x");
    expect(a.page).toBe("slab");
    expect("page" in a.run).toBe(false);
  });
  it("fills the jar's defaults: the default world, particles and haze, waste haze on", () => {
    const a = ok("--out x --page mycelium3d");
    expect(a.page).toBe("mycelium3d");
    expect(a.run).toEqual({ page: "mycelium3d", size: "32x32x16", seed: 1, sink: "off", trail: "none", bonds: "off", renderer: "particles", stretch: 1, peel: 0, camera: "oblique", waste: true });
  });
  it("reads the demo's flags", () => {
    const a = ok("--out x --page mycelium3d --size 64x64x32 --sink fast --trail toll --bonds free --seed 2 --step 20000 --waste off --peel 31 --stretch 4 --renderer slices --camera side");
    expect(a.run).toEqual({ page: "mycelium3d", size: "64x64x32", seed: 2, sink: "fast", trail: "toll", bonds: "free", renderer: "slices", stretch: 4, peel: 31, camera: "side", waste: false });
    expect(ok("--out x --page mycelium3d --seed 4294967295").run.seed).toBe(4294967295);
  });
  it("rejects the other page's flags and values outside the jar's lists", () => {
    bad("--out x --page jar", /--page must be slab or mycelium3d/);
    bad("--out x --page mycelium3d --world eco", /--world is not a mycelium3d flag/);
    bad("--out x --page mycelium3d --setting vacancy", /--setting is not a mycelium3d flag/);
    bad("--out x --sink fast", /--sink is not a slab flag/);
    bad("--out x --page slab --waste off", /--waste is not a slab flag/);
    bad("--out x --bonds free", /--bonds is not a slab flag/);
    bad("--out x --page mycelium3d --bonds on", /bonds must be one of off, upkeep, free/);
    bad("--out x --page mycelium3d --size 256x256x8", /size must be one of 32x32x16/);
    bad("--out x --page mycelium3d --sink medium", /sink must be one of off, slow, fast/);
    bad("--out x --page mycelium3d --trail public", /trail must be one of none, toll, owner/);
    bad("--out x --page mycelium3d --renderer points", /renderer must be one of particles, raymarch, slices/);
    bad("--out x --page mycelium3d --stretch 5", /stretch must be a whole number from 1 to 4/);
    bad("--out x --page mycelium3d --peel 16", /peel must be a whole number from 0 to 15 for 32x32x16/);
    bad("--out x --page mycelium3d --size 64x64x64 --peel 64", /from 0 to 63/);
    bad("--out x --page mycelium3d --waste yes", /--waste must be on or off/);
    bad("--out x --page mycelium3d --seed 4294967296", /from 0 to 4294967295/);
    bad("--out x --page mycelium3d --camera top", /camera must be one of/);
  });
  it("rejects inherited keys as values: an ArgError, never a TypeError", () => {
    for (const v of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
      for (const flag of ["page", "size", "sink", "trail", "bonds", "renderer", "camera", "waste"]) {
        expect(() => parseArgs(["--out", "x", ...(flag === "page" ? [] : ["--page", "mycelium3d"]), `--${flag}`, v]), `--${flag} ${v}`).toThrow(ArgError);
      }
    }
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

describe("parseSheet with the jar", () => {
  const slabBase = parseArgs(["--out", "x", "--camera", "side"]).run;
  const jarBase = parseArgs(["--out", "x", "--page", "mycelium3d", "--size", "64x64x32", "--seed", "1", "--camera", "above"]).run;
  it("completes jar entries from jar flags, and a page given against the flags from its own defaults", () => {
    const e = parseSheet([
      { label: "fast owner", sink: "fast", trail: "owner", bonds: "upkeep" },
      { label: "slab eco", page: "slab", seed: 5 },
      { label: "jar from slab flags", page: "mycelium3d", trail: "toll", waste: false },
    ], jarBase);
    expect(e[0]!.run).toEqual({ page: "mycelium3d", size: "64x64x32", seed: 1, sink: "fast", trail: "owner", bonds: "upkeep", renderer: "particles", stretch: 1, peel: 0, camera: "above", waste: true });
    expect(e[1]!.run).toEqual({ world: "eco", setting: "mu40-s20-k1024", seed: 5, size: "256x256x8", renderer: "raymarch", stretch: 1, peel: 0, camera: "above" });
    expect(parseSheet([{ label: "j", page: "mycelium3d", trail: "toll", waste: false }], slabBase)[0]!.run)
      .toEqual({ page: "mycelium3d", size: "32x32x16", seed: 1, sink: "off", trail: "toll", bonds: "off", renderer: "particles", stretch: 1, peel: 0, camera: "side", waste: false });
    expect(e[2]!.run).toMatchObject({ page: "mycelium3d", size: "64x64x32", trail: "toll", waste: false });
  });
  it("rejects bad jar entries", () => {
    expect(() => parseSheet([{ label: "a", page: "jar" }], jarBase)).toThrow(/page must be slab or mycelium3d/);
    expect(() => parseSheet([{ label: "a", world: "eco" }], jarBase)).toThrow(/unknown key "world" for a mycelium3d run/);
    expect(() => parseSheet([{ label: "a", page: "slab", sink: "fast" }], jarBase)).toThrow(/unknown key "sink"/);
    expect(() => parseSheet([{ label: "a", camera: "side" }], jarBase)).toThrow(/unknown key "camera"/);
    expect(() => parseSheet([{ label: "a", waste: "off" }], jarBase)).toThrow(/waste must be true or false/);
    expect(() => parseSheet([{ label: "a", seed: "7" }], jarBase)).toThrow(/seed must be a number/);
    expect(() => parseSheet([{ label: "a", peel: 32 }], jarBase)).toThrow(/from 0 to 31 for 64x64x32/);
    expect(() => parseSheet([{ label: "a", renderer: "points" }], jarBase)).toThrow(/renderer must be one of/);
    expect(() => parseSheet([{ label: "a", bonds: "on" }], jarBase)).toThrow(/bonds must be one of off, upkeep, free/);
    expect(() => parseSheet([{ label: "a", bonds: true }], jarBase)).toThrow(/bonds must be a string/);
  });
  it("rejects inherited keys in jar entries and reads nothing from the prototype chain", () => {
    for (const v of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      for (const k of ["page", "size", "sink", "trail", "bonds", "renderer"]) {
        expect(() => parseSheet([{ label: "a", [k]: v }], jarBase), `${k}: ${v}`).toThrow(ArgError);
      }
    }
    expect(() => parseSheet(JSON.parse('[{"label": "a", "__proto__": {"page": "slab"}}]'), jarBase)).toThrow(/unknown key "__proto__"/);
    const sneaky = Object.create({ page: "slab", sink: "fast" }) as Record<string, unknown>;
    sneaky.label = "own";
    expect(parseSheet([sneaky], jarBase)[0]!.run).toEqual(jarBase);
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

describe("the jar's captions and links", () => {
  const run = parseArgs(["--out", "x", "--page", "mycelium3d", "--size", "64x64x32", "--sink", "fast", "--trail", "toll", "--seed", "2"]).run as M3dRun;
  it("burns the size, the seed, both rules, the step and how it is drawn", () => {
    expect(m3dCaptionLines(run, 20000, { index: 0, count: 48, yawDeg: 0 })).toEqual([
      "Mycelium in a jar · 64×64×32 · seed 2 · sinking fast · trail rule toll road · step 20,000",
      "particles and haze · depth stretch 1 · peel 0 · camera oblique · waste haze on · frame 1/48 · turn 0.0°",
    ]);
    expect(anyCaptionLines(run, 0)).toEqual(m3dCaptionLines(run, 0));
    expect(m3dSubLabel(run)).toBe("mycelium3d · 64×64×32 · seed 2 · sinking fast · trail toll road");
    expect(anySubLabel({ ...run, trail: "owner", waste: false, renderer: "slices", peel: 3 })).toBe("mycelium3d · 64×64×32 · seed 2 · sinking fast · trail owner conduit with gate · peel 3 · slices · waste haze off");
    // bonds on add their words after the trail rule; off leaves the words above unchanged
    expect(m3dCaptionLines({ ...run, bonds: "free" }, 20000)[0]).toBe("Mycelium in a jar · 64×64×32 · seed 2 · sinking fast · trail rule toll road · bonds free · step 20,000");
    expect(m3dSubLabel({ ...run, bonds: "upkeep" })).toBe("mycelium3d · 64×64×32 · seed 2 · sinking fast · trail toll road · bonds with upkeep");
    const slab = parseArgs(["--out", "x"]).run as RunSettings;
    expect(anyCaptionLines(slab, 5)).toEqual(captionLines(slab, 5));
    expect(anySubLabel(slab)).toBe(sheetSubLabel(slab));
  });
  it("links the jar page with every setting, and the slab's link is unchanged", () => {
    const u = new URL(m3dUrl("http://localhost:5261", run));
    expect(u.pathname).toBe("/mycelium3d/");
    expect(Object.fromEntries(u.searchParams)).toEqual({ debug: "1", size: "64x64x32", seed: "2", sink: "fast", trail: "toll", bonds: "off", renderer: "particles", stretch: "1", peel: "0", camera: "oblique", waste: "on" });
    expect(runUrl("", run)).toBe(m3dUrl("", run));
    const slab = parseArgs(["--out", "x"]).run as RunSettings;
    expect(runUrl("http://localhost:1", slab)).toBe(slabUrl("http://localhost:1", slab));
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
    for (const args of [[], ["--out", "x", "--seed", "abc"], ["--out", "x", "--sheet", "/nonexistent/runs.json"], ["--out", "x", "--world", "jar"], ["--out", "x", "--page", "mycelium3d", "--sink", "toString"], ["--out", "x", "--page", "mycelium3d", "--world", "eco"]]) {
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
