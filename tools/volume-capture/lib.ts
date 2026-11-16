// The pure parts of tools/volume-capture/capture.ts: argument parsing and validation, the two pages' links (/slab/ and
// /mycelium3d/), caption text and the contact-sheet layout. No browser, no files, no processes, so vitest covers it
// (tools/test/volume-capture.test.ts). The id lists below copy the pages' own tables (apps/lab/src/slab/settings.ts,
// apps/lab/src/mycelium3d/settings.ts, volume3d/camera.ts and the renderer registry), because plain Node cannot import those
// (they pull in @bl/* through the bundler's aliases); the test checks each copy against its source.

/** Chrome's WebGPU flags, as playwright.config.ts gives the e2e (the test checks the two lists match). */
export const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"];

export type WorldId = "cyclic" | "eco";
export const WORLDS: Record<WorldId, { title: string; settings: readonly string[]; sizes: readonly string[]; defaults: { setting: string; seed: number; size: string } }> = {
  cyclic: {
    title: "Cyclic competition",
    settings: ["vacancy", "removal", "none"],
    sizes: ["256x256x4", "128x128x4"],
    defaults: { setting: "vacancy", seed: 401, size: "256x256x4" },
  },
  eco: {
    title: "Slab ecology",
    settings: ["mu40-s20-k1024", "mu30-s8-k256", "mu60-s12-k256", "mu20-s12-k1024", "n12-mu50-s8-k64", "jar-base", "jar-surface", "jar-sink", "jar-floor", "jar-upwell", "jar-all", "jar-rps"],
    sizes: ["256x256x8", "128x128x8", "64x64x64"],
    defaults: { setting: "mu40-s20-k1024", seed: 101, size: "256x256x8" },
  },
};
/** The slab page's jar settings (settings.ts JAR_OPTIONS) run only at the jar size, and the other ecology settings never do. */
export const JAR_SIZE = "64x64x64";
export const isJarSetting = (setting: string) => setting.startsWith("jar-");
/** The size a run takes when none is given: the jar's for a jar setting, else `fallback`. */
const sizeFor = (setting: string, given: string | undefined, fallback: string) => given ?? (isJarSetting(setting) ? JAR_SIZE : fallback);

/** True only for the two world ids (own keys: "toString" or "__proto__" are not worlds). */
export const isWorld = (w: unknown): w is WorldId => typeof w === "string" && Object.hasOwn(WORLDS, w);
export const RENDERER_IDS = ["raymarch", "slices", "points"] as const;
export const CAMERA_IDS = ["oblique", "above", "side", "below"] as const;
/** Each camera preset's pose (volume3d/camera.ts PRESETS), so a capture can check the page took the asked camera. */
export const CAMERA_POSES: Record<(typeof CAMERA_IDS)[number], { yaw: number; pitch: number; dist: number }> = {
  oblique: { yaw: 0.6, pitch: 0.62, dist: 1.45 },
  above: { yaw: 0, pitch: 1.5, dist: 1.6 },
  side: { yaw: 0.6, pitch: 0.12, dist: 1.6 },
  below: { yaw: 0.6, pitch: -0.7, dist: 1.75 },
};
export type RendererId = (typeof RENDERER_IDS)[number];
export type CameraId = (typeof CAMERA_IDS)[number];

export const PAGES = ["slab", "mycelium3d"] as const;
export type PageId = (typeof PAGES)[number];
const isPage = (p: unknown): p is PageId => typeof p === "string" && (PAGES as readonly string[]).includes(p);

/** The /mycelium3d/ page's tables (apps/lab/src/mycelium3d/settings.ts and its index.html's seed and stretch inputs). */
export const M3D = {
  title: "Mycelium in a jar",
  sizes: ["32x32x16", "64x64x32", "64x64x64"],
  sinks: ["off", "slow", "fast"],
  trails: ["none", "toll", "owner"],
  renderers: ["particles", "raymarch", "slices"],
  stretch: { min: 1, max: 4 },
  seedMax: 0xffffffff,
  defaults: { size: "32x32x16", seed: 1, sink: "off", trail: "none" },
} as const;
export type M3dRendererId = (typeof M3D.renderers)[number];
/** The trail rules in the page's own words (describeChoice in settings.ts). */
export const M3D_TRAIL_WORDS: Record<(typeof M3D.trails)[number], string> = { none: "none", toll: "toll road", owner: "owner conduit with gate" };
const M3D_RENDERER_TITLES: Record<M3dRendererId, string> = { particles: "particles and haze", raymarch: "cells, ray-marched", slices: "slices" };

/** One 3D mycelium jar on screen: what the /mycelium3d/ page's link carries. */
export interface M3dRun {
  page: "mycelium3d";
  size: string;
  seed: number;
  sink: string;
  trail: string;
  renderer: M3dRendererId;
  stretch: number;
  peel: number;
  camera: CameraId;
  waste: boolean;
}
/** A run on either page: slab runs carry no `page` key (their links and sidecars are as they always were). */
export type AnyRun = RunSettings | M3dRun;
export const isM3d = (r: AnyRun): r is M3dRun => "page" in r && r.page === "mycelium3d";
const m3dDefaults = (camera: CameraId): M3dRun => ({ page: "mycelium3d", ...M3D.defaults, renderer: "particles", stretch: 1, peel: 0, camera, waste: true });
const slabDefaults = (camera: CameraId): RunSettings => ({ world: "eco", ...WORLDS.eco.defaults, renderer: "raymarch", stretch: 1, peel: 0, camera });

/** One world on screen: what the slab page's link carries. */
export interface RunSettings {
  world: WorldId;
  setting: string;
  seed: number;
  size: string;
  renderer: RendererId;
  stretch: number;
  peel: number;
  camera: CameraId;
}

export interface CaptureArgs {
  mode: "turntable" | "sheet";
  out: string;
  /** Reuse a running lab dev server at this origin instead of starting one. */
  url: string | null;
  port: number;
  step: number;
  frames: number;
  fps: number;
  width: number;
  height: number;
  gifWidth: number;
  /** The page the flags describe (--page). */
  page: PageId;
  /** Turntable: the one run. Sheet: the defaults each entry starts from (its camera is every entry's camera). */
  run: AnyRun;
  sheet: string | null;
  cols: number | null;
}

export class ArgError extends Error {}

export const USAGE = `Usage: node --experimental-strip-types tools/volume-capture/capture.ts --out <dir> [options]
  Turntable (default): one run, K frames turning 360 degrees, PNG frames + MP4 + GIF + capture.json.
  --sheet <runs.json>: one still per run at --step from --camera, in a grid PNG + sheet.json.
Server:   --port <1024..65535> (default 5261, starts Vite)  |  --url <http://localhost:PORT> (reuse a running one)
Page:     --page slab|mycelium3d (default slab)
Slab:     --world cyclic|eco (default eco)  --setting <id>  --seed <0..999999>  --size WxHxD
          --renderer raymarch|slices|points  --stretch <1..16>  --peel <0..15>
Jar:      (--page mycelium3d) --size 32x32x16|64x64x32|64x64x64 (default 32x32x16)  --seed <0..4294967295> (default 1)
          --sink off|slow|fast  --trail none|toll|owner  --waste on|off (default on)
          --renderer particles|raymarch|slices (default particles)  --stretch <1..4>  --peel <0..depth-1>
Picture:  --camera oblique|above|side|below (either page)
Capture:  --step <0..1000000> (default 0)  --frames <1..720> (default 48)  --fps <1..60> (default 24)
          --width <even 64..2048> (default 960)  --height <even 64..2048> (default 600)  --gif-width <even 64..1024> (default 320)
Sheet:    --cols <1..12> (default: about square). runs.json is an array of runs, each {label, page?, ...}: a slab run
          {world?, setting?, seed?, size?, renderer?, stretch?, peel?}, a jar run (page "mycelium3d") {size?, seed?, sink?,
          trail?, renderer?, stretch?, peel?, waste? (true or false)}. Missing keys take the flags' values when the run is
          on the flags' page, else that page's defaults.`;

const FLAGS = new Set(["out", "url", "port", "step", "frames", "fps", "width", "height", "gif-width", "page", "world", "setting", "seed", "size", "renderer", "stretch", "peel", "camera", "sink", "trail", "waste", "sheet", "cols"]);
const SLAB_ONLY = ["world", "setting"], M3D_ONLY = ["sink", "trail", "waste"];

function intIn(name: string, raw: string, lo: number, hi: number, even = false): number {
  if (!/^\d+$/.test(raw)) throw new ArgError(`--${name} must be a whole number, got ${JSON.stringify(raw)}`);
  const n = Number(raw);
  if (n < lo || n > hi) throw new ArgError(`--${name} must be from ${lo} to ${hi}, got ${n}`);
  if (even && n % 2) throw new ArgError(`--${name} must be even (H.264 needs even sizes), got ${n}`);
  return n;
}

/** Checks one run's settings against the page's tables; `where` names it in the message. */
export function checkRun(r: RunSettings, where: string): RunSettings {
  if (!isWorld(r.world)) throw new ArgError(`${where}: world must be cyclic or eco, got ${JSON.stringify(r.world)}`);
  const w = WORLDS[r.world];
  if (!w.settings.includes(r.setting)) throw new ArgError(`${where}: setting ${JSON.stringify(r.setting)} is not a ${r.world} setting (${w.settings.join(", ")})`);
  if (!w.sizes.includes(r.size)) throw new ArgError(`${where}: size ${JSON.stringify(r.size)} is not a ${r.world} size (${w.sizes.join(", ")})`);
  if (r.world === "eco" && isJarSetting(r.setting) !== (r.size === JAR_SIZE)) throw new ArgError(`${where}: the jar settings run only at ${JAR_SIZE}, and the other ecology settings never do (setting ${r.setting}, size ${r.size})`);
  if (!Number.isInteger(r.seed) || r.seed < 0 || r.seed > 999999) throw new ArgError(`${where}: seed must be a whole number from 0 to 999999, got ${JSON.stringify(r.seed)}`);
  if (!(RENDERER_IDS as readonly string[]).includes(r.renderer)) throw new ArgError(`${where}: renderer must be one of ${RENDERER_IDS.join(", ")}, got ${JSON.stringify(r.renderer)}`);
  if (!(CAMERA_IDS as readonly string[]).includes(r.camera)) throw new ArgError(`${where}: camera must be one of ${CAMERA_IDS.join(", ")}, got ${JSON.stringify(r.camera)}`);
  if (!Number.isInteger(r.stretch) || r.stretch < 1 || r.stretch > 16) throw new ArgError(`${where}: stretch must be a whole number from 1 to 16, got ${JSON.stringify(r.stretch)}`);
  const depth = Number(r.size.split("x")[2]);
  if (!Number.isInteger(r.peel) || r.peel < 0 || r.peel > depth - 1) throw new ArgError(`${where}: peel must be a whole number from 0 to ${depth - 1} for ${r.size}, got ${JSON.stringify(r.peel)}`);
  return r;
}

/** Checks one jar run against the /mycelium3d/ page's tables; `where` names it in the message. */
export function checkM3d(r: M3dRun, where: string): M3dRun {
  const one = (name: string, v: unknown, list: readonly string[]) => {
    if (typeof v !== "string" || !list.includes(v)) throw new ArgError(`${where}: ${name} must be one of ${list.join(", ")}, got ${JSON.stringify(v)}`);
  };
  one("size", r.size, M3D.sizes);
  one("sink", r.sink, M3D.sinks);
  one("trail", r.trail, M3D.trails);
  one("renderer", r.renderer, M3D.renderers);
  one("camera", r.camera, CAMERA_IDS);
  if (!Number.isInteger(r.seed) || r.seed < 0 || r.seed > M3D.seedMax) throw new ArgError(`${where}: seed must be a whole number from 0 to ${M3D.seedMax}, got ${JSON.stringify(r.seed)}`);
  const { min, max } = M3D.stretch;
  if (!Number.isInteger(r.stretch) || r.stretch < min || r.stretch > max) throw new ArgError(`${where}: stretch must be a whole number from ${min} to ${max}, got ${JSON.stringify(r.stretch)}`);
  const depth = Number(r.size.split("x")[2]);
  if (!Number.isInteger(r.peel) || r.peel < 0 || r.peel > depth - 1) throw new ArgError(`${where}: peel must be a whole number from 0 to ${depth - 1} for ${r.size}, got ${JSON.stringify(r.peel)}`);
  if (typeof r.waste !== "boolean") throw new ArgError(`${where}: waste must be true or false, got ${JSON.stringify(r.waste)}`);
  return r;
}

export function parseArgs(argv: readonly string[]): CaptureArgs {
  const got = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new ArgError(`unexpected argument ${JSON.stringify(a)}`);
    const name = a.slice(2);
    if (!FLAGS.has(name)) throw new ArgError(`unknown flag ${a}`);
    if (got.has(name)) throw new ArgError(`${a} given twice`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new ArgError(`${a} needs a value`);
    got.set(name, v);
    i++;
  }
  const out = got.get("out");
  if (!out) throw new ArgError("--out <dir> is required");
  if (got.has("url") && got.has("port")) throw new ArgError("give --url or --port, not both");
  let url: string | null = null;
  if (got.has("url")) {
    let u: URL;
    try { u = new URL(got.get("url")!); } catch { throw new ArgError(`--url is not a URL: ${got.get("url")}`); }
    if (u.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) throw new ArgError("--url must be a local http origin, e.g. http://localhost:5173");
    url = u.origin;
  }
  const page = got.get("page") ?? "slab";
  if (!isPage(page)) throw new ArgError(`--page must be slab or mycelium3d, got ${JSON.stringify(page)}`);
  for (const k of page === "slab" ? M3D_ONLY : SLAB_ONLY) if (got.has(k)) throw new ArgError(`--${k} is not a ${page} flag`);
  const seedRaw = got.get("seed");
  let run: AnyRun;
  if (page === "mycelium3d") {
    const waste = got.get("waste") ?? "on";
    if (waste !== "on" && waste !== "off") throw new ArgError(`--waste must be on or off, got ${JSON.stringify(waste)}`);
    run = checkM3d({
      page,
      size: got.get("size") ?? M3D.defaults.size,
      seed: seedRaw === undefined ? M3D.defaults.seed : intIn("seed", seedRaw, 0, M3D.seedMax),
      sink: got.get("sink") ?? M3D.defaults.sink,
      trail: got.get("trail") ?? M3D.defaults.trail,
      renderer: (got.get("renderer") ?? "particles") as M3dRendererId,
      stretch: intIn("stretch", got.get("stretch") ?? "1", 1, 16),
      peel: intIn("peel", got.get("peel") ?? "0", 0, 63),
      camera: (got.get("camera") ?? "oblique") as CameraId,
      waste: waste === "on",
    }, "flags");
  } else run = slabRun(got, seedRaw);
  return finishArgs(got, page, run, out, url);
}

function slabRun(got: Map<string, string>, seedRaw: string | undefined): RunSettings {
  const world = (got.get("world") ?? "eco") as WorldId;
  if (!isWorld(world)) throw new ArgError(`--world must be cyclic or eco, got ${JSON.stringify(world)}`);
  const d = WORLDS[world].defaults;
  const setting = got.get("setting") ?? d.setting;
  return checkRun({
    world,
    setting,
    seed: seedRaw === undefined ? d.seed : intIn("seed", seedRaw, 0, 999999),
    size: sizeFor(setting, got.get("size"), d.size),
    renderer: (got.get("renderer") ?? "raymarch") as RendererId,
    stretch: intIn("stretch", got.get("stretch") ?? "1", 1, 16),
    peel: intIn("peel", got.get("peel") ?? "0", 0, 15),
    camera: (got.get("camera") ?? "oblique") as CameraId,
  }, "flags");
}

function finishArgs(got: Map<string, string>, page: PageId, run: AnyRun, out: string, url: string | null): CaptureArgs {
  const sheet = got.get("sheet") ?? null;
  if (!sheet && got.has("cols")) throw new ArgError("--cols needs --sheet");
  if (sheet && (got.has("frames") || got.has("fps") || got.has("gif-width"))) throw new ArgError("--frames, --fps and --gif-width are for turntables, not --sheet");
  return {
    mode: sheet ? "sheet" : "turntable",
    out, url,
    port: intIn("port", got.get("port") ?? "5261", 1024, 65535),
    step: intIn("step", got.get("step") ?? "0", 0, 1_000_000),
    frames: intIn("frames", got.get("frames") ?? "48", 1, 720),
    fps: intIn("fps", got.get("fps") ?? "24", 1, 60),
    width: intIn("width", got.get("width") ?? "960", 64, 2048, true),
    height: intIn("height", got.get("height") ?? "600", 64, 2048, true),
    gifWidth: intIn("gif-width", got.get("gif-width") ?? "320", 64, 1024, true),
    page, run, sheet,
    cols: got.has("cols") ? intIn("cols", got.get("cols")!, 1, 12) : null,
  };
}

export interface SheetEntry { label: string; run: AnyRun }
const ENTRY_KEYS = new Set(["label", "page", "world", "setting", "seed", "size", "renderer", "stretch", "peel"]);
const M3D_ENTRY_KEYS = new Set(["label", "page", "size", "seed", "sink", "trail", "renderer", "stretch", "peel", "waste"]);

/**
 * The sheet file's runs, each completed from `base`. A run on the other page than the flags' (its own `page` key) starts
 * from that page's defaults, and a slab world given without a setting, seed or size takes that world's defaults (not the
 * flags', which may belong to the other world). Camera is the sheet's, never an entry's.
 */
export function parseSheet(json: unknown, base: AnyRun): SheetEntry[] {
  if (!Array.isArray(json) || json.length === 0) throw new ArgError("the sheet file must be a non-empty JSON array of runs");
  if (json.length > 48) throw new ArgError(`a sheet holds at most 48 runs, got ${json.length}`);
  return json.map((e: unknown, i) => {
    const where = `sheet run ${i + 1}`;
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new ArgError(`${where} must be an object`);
    const raw = e as Record<string, unknown>;
    const pageRaw = Object.hasOwn(raw, "page") ? raw.page : undefined;
    if (pageRaw !== undefined && !isPage(pageRaw)) throw new ArgError(`${where}: page must be slab or mycelium3d, got ${JSON.stringify(pageRaw)}`);
    const page: PageId = pageRaw ?? (isM3d(base) ? "mycelium3d" : "slab");
    const keys = page === "slab" ? ENTRY_KEYS : M3D_ENTRY_KEYS;
    for (const k of Object.keys(raw)) if (!keys.has(k)) throw new ArgError(`${where}: unknown key ${JSON.stringify(k)}${page === "slab" ? "" : " for a mycelium3d run"} (camera and step are the sheet's, set by flags)`);
    // own fields only: nothing is ever read from the prototype chain
    const o: Record<string, unknown> = Object.fromEntries([...keys].map((k) => [k, Object.hasOwn(raw, k) ? raw[k] : undefined]));
    if (typeof o.label !== "string" || !o.label.trim() || o.label.length > 80) throw new ArgError(`${where}: label must be a non-empty string of at most 80 characters`);
    for (const k of ["seed", "stretch", "peel"] as const) if (o[k] !== undefined && typeof o[k] !== "number") throw new ArgError(`${where}: ${k} must be a number`);
    if (page === "mycelium3d") {
      for (const k of ["size", "sink", "trail", "renderer"] as const) if (o[k] !== undefined && typeof o[k] !== "string") throw new ArgError(`${where}: ${k} must be a string`);
      if (o.waste !== undefined && typeof o.waste !== "boolean") throw new ArgError(`${where}: waste must be true or false`);
      const own = isM3d(base) ? base : m3dDefaults(base.camera);
      return {
        label: o.label.trim(),
        run: checkM3d({
          page,
          size: (o.size as string | undefined) ?? own.size,
          seed: (o.seed as number | undefined) ?? own.seed,
          sink: (o.sink as string | undefined) ?? own.sink,
          trail: (o.trail as string | undefined) ?? own.trail,
          renderer: ((o.renderer as string | undefined) ?? own.renderer) as M3dRendererId,
          stretch: (o.stretch as number | undefined) ?? own.stretch,
          peel: (o.peel as number | undefined) ?? own.peel,
          camera: base.camera,
          waste: (o.waste as boolean | undefined) ?? own.waste,
        }, where),
      };
    }
    const slab = isM3d(base) ? slabDefaults(base.camera) : base;
    if (o.world !== undefined && !isWorld(o.world)) throw new ArgError(`${where}: world must be cyclic or eco, got ${JSON.stringify(o.world)}`);
    const world = (o.world as WorldId | undefined) ?? slab.world;
    const own = world === slab.world ? slab : { ...slab, ...WORLDS[world].defaults };
    for (const k of ["setting", "size", "renderer"] as const) if (o[k] !== undefined && typeof o[k] !== "string") throw new ArgError(`${where}: ${k} must be a string`);
    const setting = (o.setting as string | undefined) ?? own.setting;
    return {
      label: o.label.trim(),
      run: checkRun({
        world,
        setting,
        seed: (o.seed as number | undefined) ?? own.seed,
        size: o.size === undefined && isJarSetting(setting) !== isJarSetting(own.setting) ? sizeFor(setting, undefined, WORLDS[world].defaults.size) : (o.size as string | undefined) ?? own.size,
        renderer: ((o.renderer as string | undefined) ?? slab.renderer) as RendererId,
        stretch: (o.stretch as number | undefined) ?? slab.stretch,
        peel: (o.peel as number | undefined) ?? slab.peel,
        camera: slab.camera,
      }, where),
    };
  });
}

/** The slab page's link for a run, with the debug hooks and the Volume view on. */
export function slabUrl(origin: string, r: RunSettings): string {
  const q = new URLSearchParams({
    debug: "1", world: r.world, setting: r.setting, seed: String(r.seed), size: r.size, display: "volume",
    renderer: r.renderer, stretch: String(r.stretch), peel: String(r.peel), camera: r.camera,
  });
  return `${origin}/slab/?${q}`;
}

/** The /mycelium3d/ page's link for a jar run, with the debug hooks on. */
export function m3dUrl(origin: string, r: M3dRun): string {
  const q = new URLSearchParams({
    debug: "1", size: r.size, seed: String(r.seed), sink: r.sink, trail: r.trail,
    renderer: r.renderer, stretch: String(r.stretch), peel: String(r.peel), camera: r.camera, waste: r.waste ? "on" : "off",
  });
  return `${origin}/mycelium3d/?${q}`;
}
/** Either page's link. */
export const runUrl = (origin: string, r: AnyRun) => (isM3d(r) ? m3dUrl(origin, r) : slabUrl(origin, r));

/** Thousands with commas, independent of the machine's locale. */
export const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const RENDERER_TITLES: Record<RendererId, string> = { raymarch: "ray march", slices: "slices", points: "points" };

/** A sheet still's second label line: the run's settings, so the sheet reads without its JSON. */
export function sheetSubLabel(r: RunSettings): string {
  return `${r.world} · ${r.setting} · seed ${r.seed} · ${r.size.replace(/x/g, "×")}${r.stretch === 1 ? "" : ` · stretch ${r.stretch}`}${r.peel ? ` · peel ${r.peel}` : ""}${r.renderer === "raymarch" ? "" : ` · ${RENDERER_TITLES[r.renderer]}`}`;
}

/** A jar still's second label line. */
export function m3dSubLabel(r: M3dRun): string {
  return `mycelium3d · ${r.size.replace(/x/g, "×")} · seed ${r.seed} · sinking ${r.sink} · trail ${M3D_TRAIL_WORDS[r.trail as keyof typeof M3D_TRAIL_WORDS]}${r.stretch === 1 ? "" : ` · stretch ${r.stretch}`}${r.peel ? ` · peel ${r.peel}` : ""}${r.renderer === "particles" ? "" : ` · ${M3D_RENDERER_TITLES[r.renderer]}`}${r.waste ? "" : " · waste haze off"}`;
}
export const anySubLabel = (r: AnyRun) => (isM3d(r) ? m3dSubLabel(r) : sheetSubLabel(r));

/** The sheet's header line. */
export const sheetHeader = (step: number, camera: CameraId, w: number, h: number) => `Contact sheet · step ${thousands(step)} · camera ${camera} · each still ${w}×${h}`;

/** The caption burned under every frame: the world and its setting, then how it is drawn. No clock time, ever. */
export function captionLines(r: RunSettings, step: number, frame?: { index: number; count: number; yawDeg: number }): [string, string] {
  const [W, H, D] = r.size.split("x");
  const first = `${WORLDS[r.world].title} · setting ${r.setting} · seed ${r.seed} · ${W}×${H}×${D} · step ${thousands(step)}`;
  const parts = [RENDERER_TITLES[r.renderer], `depth stretch ${r.stretch}`, `peel ${r.peel}`, `camera ${r.camera}`];
  if (frame) parts.push(`frame ${frame.index + 1}/${frame.count}`, `turn ${frame.yawDeg.toFixed(1)}°`);
  return [first, parts.join(" · ")];
}

/** A jar frame's caption: the size, seed and the two rules, then how it is drawn. No clock time, ever. */
export function m3dCaptionLines(r: M3dRun, step: number, frame?: { index: number; count: number; yawDeg: number }): [string, string] {
  const first = `${M3D.title} · ${r.size.replace(/x/g, "×")} · seed ${r.seed} · sinking ${r.sink} · trail rule ${M3D_TRAIL_WORDS[r.trail as keyof typeof M3D_TRAIL_WORDS]} · step ${thousands(step)}`;
  const parts = [M3D_RENDERER_TITLES[r.renderer], `depth stretch ${r.stretch}`, `peel ${r.peel}`, `camera ${r.camera}`, `waste haze ${r.waste ? "on" : "off"}`];
  if (frame) parts.push(`frame ${frame.index + 1}/${frame.count}`, `turn ${frame.yawDeg.toFixed(1)}°`);
  return [first, parts.join(" · ")];
}
export const anyCaptionLines = (r: AnyRun, step: number, frame?: { index: number; count: number; yawDeg: number }) => (isM3d(r) ? m3dCaptionLines(r, step, frame) : captionLines(r, step, frame));

/** Turntable yaw of frame i of k: the pose's own yaw plus i/k of a full turn, computed from i (never accumulated). */
export const turntableYaw = (yaw0: number, i: number, k: number) => yaw0 + (2 * Math.PI * i) / k;

/** Height of the caption strip for `lines` lines, rounded up so picture plus strip stays even. */
export function stripHeight(lines: number, pictureH: number, lineH = 18, pad = 8): number {
  const h = lines * lineH + 2 * pad;
  return (pictureH + h) % 2 ? h + 1 : h;
}

export interface SheetLayout {
  cols: number; rows: number; width: number; height: number;
  cells: { x: number; y: number; labelY: number }[];
}

/**
 * A grid of `n` stills of w by h, each with a label strip of `labelH` under it, `gap` pixels apart and around, below a header
 * band of `top`; filled row by row; width and height rounded up to even.
 */
export function sheetLayout(n: number, w: number, h: number, opts: { cols?: number | null; labelH?: number; gap?: number; top?: number } = {}): SheetLayout {
  if (!Number.isInteger(n) || n < 1) throw new Error("a sheet needs at least one still");
  const labelH = opts.labelH ?? 40, gap = opts.gap ?? 12, top = opts.top ?? 0;
  const cols = Math.min(n, opts.cols ?? Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  const cellH = h + labelH;
  let width = gap + cols * (w + gap), height = top + gap + rows * (cellH + gap);
  if (width % 2) width++;
  if (height % 2) height++;
  const cells = Array.from({ length: n }, (_, i) => {
    const x = gap + (i % cols) * (w + gap), y = top + gap + Math.floor(i / cols) * (cellH + gap);
    return { x, y, labelY: y + h };
  });
  return { cols, rows, width, height, cells };
}
