// Deterministic captures of the slab viewer's Volume view (/slab/) and of the 3D mycelium jar (/mycelium3d/), for judging
// screens by eye: a turntable (PNG frames, an MP4 and a small GIF) of one run, or a contact sheet of several runs (either
// page, mixed) at one step from one camera. Node 24, real Chrome with
// WebGPU (the e2e's flags), the lab's own Vite. Every picture is the page's canvas only, drawn with the renderer's still
// mode (no frame-to-frame jitter or drift) at a camera set absolutely per frame, never by a clock; the caption strip and a
// JSON sidecar carry the settings, the step and a SHA-256 of the read-back frame the picture was drawn from.
//
//   node --experimental-strip-types tools/volume-capture/capture.ts --out <dir> --world eco --setting n12-mu50-s8-k64 \
//     --seed 101 --step 30000 --stretch 8 --frames 48 [--port 5261 | --url http://localhost:5173]
//   node --experimental-strip-types tools/volume-capture/capture.ts --out <dir> --page mycelium3d --size 64x64x32 \
//     --sink fast --trail toll --seed 2 --step 20000 --frames 48 [--bonds off|upkeep|free]
//   node --experimental-strip-types tools/volume-capture/capture.ts --out <dir> --sheet runs.json --step 20000
//
// Flags and the sheet file: lib.ts USAGE. Bad arguments exit 2 before anything starts; a failed capture exits 1.
import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ArgError, CAMERA_POSES, GPU_ARGS, USAGE, anyCaptionLines, anySubLabel, isM3d, parseArgs, parseSheet, runUrl, sheetHeader, sheetLayout, stripHeight, turntableYaw,
  type AnyRun, type CaptureArgs, type M3dRun, type SheetEntry,
} from "./lib.ts";
import { FRAME_FILE, OutputError, prepareOut, writeOutFile } from "./outputs.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const FFMPEG = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
const FONT = "ui-monospace, Menlo, monospace";
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

class CaptureError extends Error {}
/** The FFmpeg child while it encodes, so a signal can stop it (shutdown). */
let encoder: ChildProcess | null = null;
/** Set once shutdown begins: no encoder is started after it. */
let stopped = false;

// ---- server and browser -------------------------------------------------------------------------------------------------

/** Starts the lab's Vite on `port` (strict: a port in use fails) and resolves once it prints its own banner. */
function startVite(port: number, onSpawn: (child: ChildProcess) => void): Promise<{ child: ChildProcess; origin: string }> {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "apps/lab", "--port", String(port), "--strictPort"], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
  onSpawn(child); // known to the signal handlers from here on, before it is ready
  const banner = new RegExp(`Local:\\s+http://(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):${port}/`);
  return new Promise((ok, no) => {
    let log = "";
    const timer = setTimeout(() => { child.kill(); no(new CaptureError(`Vite did not start on port ${port} within 60 s:\n${log}`)); }, 60_000);
    // eslint-disable-next-line no-control-regex
    const read = (b: Buffer) => { log += b.toString().replace(/\x1b\[[0-9;]*m/g, ""); if (banner.test(log)) { clearTimeout(timer); ok({ child, origin: `http://localhost:${port}` }); } };
    child.stdout!.on("data", read);
    child.stderr!.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); no(new CaptureError(`Vite exited (${code}) before it was ready:\n${log}`)); });
  });
}

async function openRun(browser: Browser, origin: string, r: AnyRun, a: CaptureArgs): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: Math.max(1280, a.width + 160), height: Math.max(900, a.height + 300) }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(runUrl(origin, r));
  // the canvas at exactly the asked size, whatever the layout around it does (78vh cap, the narrow-screen aspect ratio)
  await page.addStyleTag({ content: `#volume-canvas { width: ${a.width}px !important; height: ${a.height}px !important; max-height: none !important; aspect-ratio: auto !important; border: 0 !important; box-sizing: content-box !important; }` });
  if (isM3d(r)) { await openJar(page, r); return { page, errors }; }
  await page.waitForFunction(() => { const s = (window as Any).__slab; return s && s.step() >= 0 && s.counts().live === 1 && s.counts().pending === 0; }, null, { timeout: 180_000 });
  const st = await page.evaluate(() => { const s = (window as Any).__slab; return { state: s.state(), volume: s.volume() }; });
  const w = r.world === "cyclic" ? { setting: st.state.cyc.kill, seed: st.state.cyc.seed, size: st.state.cyc.size.join("x") } : { setting: st.state.eco.option, seed: st.state.eco.seed, size: st.state.eco.size.join("x") };
  const seen = { world: st.state.world, ...w, display: st.state.display, renderer: st.volume?.renderer, stretch: st.volume?.stretch };
  const want = { world: r.world, setting: r.setting, seed: r.seed, size: r.size, display: "volume", renderer: r.renderer, stretch: r.stretch };
  if (JSON.stringify(seen) !== JSON.stringify(want)) throw new CaptureError(`the page did not take the settings: asked ${JSON.stringify(want)}, page has ${JSON.stringify(seen)}`);
  return { page, errors };
}

/** The jar page planted what the link asked, on the GPU (a silent fall-back to the CPU engine would change the size). */
async function openJar(page: Page, r: M3dRun) {
  await page.waitForFunction(() => { const m = (window as Any).__m3d; return document.body.dataset.ready === "1" && m?.census() && typeof m.volumeStill === "function"; }, null, { timeout: 180_000 });
  const st = await page.evaluate(() => { const m = (window as Any).__m3d; return { state: m.state(), config: m.config(), volume: m.volume(), gpuError: document.body.dataset.gpuError ?? null }; });
  if (st.state.engine !== "gpu") throw new CaptureError(`the jar is on the ${st.state.engine} engine, not the GPU`);
  if (st.gpuError) throw new CaptureError(`GPU error on the jar page: ${st.gpuError}`);
  const c = st.state.choice, v = st.volume;
  const seen = { size: c.size, seed: c.seed, sink: c.sink, trail: c.trail, bonds: c.bonds, dims: [st.config.width, st.config.height, st.config.depth].join("x"), cfgSeed: st.config.seed, renderer: v.renderer, stretch: v.stretch, waste: v.waste };
  const want = { size: r.size, seed: r.seed, sink: r.sink, trail: r.trail, bonds: r.bonds, dims: r.size, cfgSeed: r.seed, renderer: r.renderer, stretch: r.stretch, waste: r.waste };
  if (JSON.stringify(seen) !== JSON.stringify(want)) throw new CaptureError(`the page did not take the settings: asked ${JSON.stringify(want)}, page has ${JSON.stringify(seen)}`);
}

/** Runs to exactly `step` with the page's own deterministic stepping, then checks the frame on screen is that step's. */
async function runTo(page: Page, r: AnyRun, step: number, say: (m: string) => void) {
  if (isM3d(r)) {
    for (let s = 0; s < step;) {
      s = Math.min(step, s + 2000);
      await page.evaluate((k) => (window as Any).__m3d.runTo(k), s);
      if (s % 10000 === 0 || s === step) say(`step ${s}`);
    }
    const got = await page.evaluate(() => { const m = (window as Any).__m3d; return { step: m.census()?.step, queued: m.state().queued, peel: m.volume().peel }; });
    if (got.step !== step || got.queued !== step) throw new CaptureError(`the jar is at step ${got.step} (queued ${got.queued}), asked ${step}`);
    if (got.peel !== r.peel) throw new CaptureError(`peel on the page is ${got.peel}, asked ${r.peel}`);
    return;
  }
  for (let s = 0; s < step;) {
    s = Math.min(step, s + 2000);
    await page.evaluate((k) => (window as Any).__slab.runTo(k), s);
    if (s % 10000 === 0 || s === step) say(`step ${s}`);
  }
  await page.waitForFunction((want) => { const s = (window as Any).__slab; const v = s.volume(); return s.step() === want.step && v && v.shown === want.shown; },
    { step, shown: `${r.world}:${r.world}@${step}` }, { timeout: 60_000 });
  const vol = await page.evaluate(() => (window as Any).__slab.volume());
  if (vol.peel !== r.peel) throw new CaptureError(`peel on the page is ${vol.peel}, asked ${r.peel}`);
}

/** SHA-256 of the read-back the picture is drawn from (cyclic: labels; ecology: hi, lo, B, P, A; the jar: the whole state,
 *  checkpoint-encoded, with the rule set's own digest too), and the living count (the jar: its particles). */
async function frameDigest(page: Page, r: AnyRun): Promise<{ step: number; sha256: string; channels: string[]; living: number | null; stateDigest?: string; families?: number }> {
  if (isM3d(r)) {
    const d = await page.evaluate(() => (window as Any).__m3d.digest());
    if (!d) throw new CaptureError("the jar page has no state read back");
    return { step: d.step, sha256: d.sha256, channels: ["checkpoint encoding"], living: d.particles, stateDigest: d.stateDigest, families: d.families };
  }
  return page.evaluate(async () => {
    const s = (window as Any).__slab;
    const f = s.frame();
    const channels = f.kind === "cyclic" ? ["labels"] : ["hi", "lo", "B", "P", "A"];
    const parts: Uint8Array[] = channels.map((k) => new Uint8Array(f[k].buffer, f[k].byteOffset, f[k].byteLength));
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
    const living = f.kind === "eco" ? await s.living() : null;
    return { step: f.step, sha256: [...h].map((b) => b.toString(16).padStart(2, "0")).join(""), channels, living };
  });
}

interface Still { url: string; w: number; h: number; yaw: number; pitch: number; dist: number }

/** One still at an absolute yaw (or the pose's own), checked: the asked renderer painted it, at the asked size, with no GPU error. */
async function still(page: Page, r: AnyRun, a: CaptureArgs, yaw?: number): Promise<Still> {
  const hooks = isM3d(r) ? "__m3d" : "__slab";
  const s: Still | null = await page.evaluate(([h, y]) => (window as Any)[h!].volumeStill(y === null ? {} : { yaw: y }), [hooks, yaw ?? null] as const);
  if (!s) throw new CaptureError("the Volume view is not on the page");
  const v = await page.evaluate((h) => (window as Any)[h].volume(), hooks);
  if (v.mounted !== r.renderer || v.painted !== r.renderer) throw new CaptureError(`renderer ${r.renderer} asked, mounted ${v.mounted}, painted ${v.painted}`);
  if (v.errors.length) throw new CaptureError(`GPU errors in the volume view: ${v.errors.join("; ")}`);
  if (isM3d(r) && v.waste !== r.waste) throw new CaptureError(`waste haze ${r.waste ? "on" : "off"} asked, the page has it ${v.waste ? "on" : "off"}`);
  if (s.w !== a.width || s.h !== a.height) throw new CaptureError(`canvas is ${s.w}x${s.h}, asked ${a.width}x${a.height}`);
  return s;
}

/** The page's camera before any turn is the asked preset's pose (an ignored camera= would mislabel every picture). */
function checkPose(s: Still, r: AnyRun) {
  const want = CAMERA_POSES[r.camera];
  const off = Math.max(Math.abs(s.yaw - want.yaw), Math.abs(s.pitch - want.pitch), Math.abs(s.dist - want.dist));
  if (off > 1e-6) throw new CaptureError(`camera ${r.camera} asked (${JSON.stringify(want)}), page pose is yaw ${s.yaw}, pitch ${s.pitch}, dist ${s.dist}`);
}

/** Draws data-URL images and text onto one 2D canvas in the page and returns the PNG bytes and a SHA-256 of the raw pixels. */
async function compose(page: Page, spec: { width: number; height: number; images: { url: string; x: number; y: number }[]; texts: { text: string; x: number; y: number; size: number; bold?: boolean; colour: string }[] }): Promise<{ png: Buffer; pixelSha256: string }> {
  const r = await page.evaluate(async ({ spec, font }) => {
    const c = document.createElement("canvas");
    c.width = spec.width; c.height = spec.height;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0b1015";
    g.fillRect(0, 0, c.width, c.height);
    for (const im of spec.images) {
      const img = new Image();
      img.src = im.url;
      await img.decode();
      g.drawImage(img, im.x, im.y);
    }
    g.textBaseline = "top";
    for (const t of spec.texts) {
      g.font = `${t.bold ? "bold " : ""}${t.size}px ${font}`;
      g.fillStyle = t.colour;
      g.fillText(t.text, t.x, t.y);
    }
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", px));
    return { url: c.toDataURL("image/png"), pixelSha256: [...h].map((b) => b.toString(16).padStart(2, "0")).join("") };
  }, { spec, font: FONT });
  return { png: Buffer.from(r.url.slice(r.url.indexOf(",") + 1), "base64"), pixelSha256: r.pixelSha256 };
}

const LINE_H = 18, PAD = 8, TEXT = "#e7e3da", MUTED = "#a9b0b6";

function captioned(page: Page, s: Still, lines: [string, string]) {
  const strip = stripHeight(2, s.h, LINE_H, PAD);
  return compose(page, {
    width: s.w, height: s.h + strip, images: [{ url: s.url, x: 0, y: 0 }],
    texts: [{ text: lines[0], x: PAD, y: s.h + PAD, size: 14, colour: TEXT }, { text: lines[1], x: PAD, y: s.h + PAD + LINE_H, size: 13, colour: MUTED }],
  });
}

async function provenance(browser: Browser, page: Page) {
  const gpu = await page.evaluate(async () => {
    const ad = await navigator.gpu?.requestAdapter();
    const i = ad?.info;
    return i ? { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description } : null;
  });
  return { chrome: browser.version(), gpuArgs: GPU_ARGS, adapter: gpu };
}

// ---- modes --------------------------------------------------------------------------------------------------------------

async function turntable(browser: Browser, origin: string, a: CaptureArgs, say: (m: string) => void) {
  const r = a.run;
  const framesDir = join(a.out, "frames"); // created and checked by prepareOut: under --out, no symlinks
  for (const f of readdirSync(framesDir)) if (FRAME_FILE.test(f)) rmSync(join(framesDir, f)); // no stale frames from a longer run
  const { page, errors } = await openRun(browser, origin, r, a);
  await runTo(page, r, a.step, say);
  const digest = await frameDigest(page, r);
  if (digest.step !== a.step) throw new CaptureError(`frame on screen is step ${digest.step}, asked ${a.step}`);
  const pose = await still(page, r, a);
  checkPose(pose, r);
  const frames: { file: string; yawRad: number; sha256: string; pixelSha256: string }[] = [];
  for (let i = 0; i < a.frames; i++) {
    const yaw = turntableYaw(pose.yaw, i, a.frames);
    const s = await still(page, r, a, yaw);
    const out = await captioned(page, s, anyCaptionLines(r, a.step, { index: i, count: a.frames, yawDeg: (360 * i) / a.frames }));
    const file = `frames/frame-${String(i).padStart(4, "0")}.png`;
    writeOutFile(join(a.out, file), out.png);
    frames.push({ file, yawRad: yaw, sha256: sha256(out.png), pixelSha256: out.pixelSha256 });
  }
  say(`${a.frames} frames`);
  // the first frame again, after all the others: per-draw state left behind would show here
  const again = await captioned(page, await still(page, r, a, turntableYaw(pose.yaw, 0, a.frames)), anyCaptionLines(r, a.step, { index: 0, count: a.frames, yawDeg: 0 }));
  const recheck = { frame: frames[0]!.file, samePng: sha256(again.png) === frames[0]!.sha256, samePixels: again.pixelSha256 === frames[0]!.pixelSha256 };
  if (errors.length) throw new CaptureError(`page errors: ${errors.join("; ")}`);
  const prov = await provenance(browser, page);
  await page.close();
  const video = join(a.out, "turntable.mp4"), gif = join(a.out, "turntable.gif");
  // Not execFileSync: that would block the event loop, and a SIGTERM during the encode could not stop Vite until FFmpeg ended.
  const ff = (args: string[]) => new Promise<void>((ok, bad) => {
    if (stopped) { bad(new CaptureError("stopped before encoding")); return; }
    const p = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
    encoder = p;
    p.once("error", (e) => { encoder = null; bad(e); });
    p.once("exit", (code, sig) => { encoder = null; if (code === 0) ok(); else bad(new CaptureError(sig ? `ffmpeg was stopped by ${sig}` : `ffmpeg exited with ${code}`)); });
  });
  await ff(["-framerate", String(a.fps), "-i", join(framesDir, "frame-%04d.png"), "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact", video]);
  await ff(["-framerate", String(a.fps), "-i", join(framesDir, "frame-%04d.png"), "-vf", `scale=${a.gifWidth}:-2:flags=lanczos,split[x][y];[x]palettegen=max_colors=128:stats_mode=full[p];[y][p]paletteuse=dither=bayer:bayer_scale=4`, "-loop", "0", gif]);
  const sidecar = {
    tool: "tools/volume-capture/capture.ts", mode: "turntable", run: r, step: a.step,
    picture: { width: a.width, height: a.height, captionStrip: stripHeight(2, a.height, LINE_H, PAD), deviceScaleFactor: 1, still: true },
    turntable: { frames: a.frames, fps: a.fps, startYawRad: pose.yaw, pitchRad: pose.pitch, dist: pose.dist, degreesPerFrame: 360 / a.frames },
    frameDigest: digest, frames, recheckFirstFrame: recheck,
    video: { file: "turntable.mp4", sha256: sha256(readFileSync(video)), codec: "h264", pixFmt: "yuv420p" },
    gif: { file: "turntable.gif", width: a.gifWidth, sha256: sha256(readFileSync(gif)) },
    url: runUrl("", r), ...prov,
  };
  writeOutFile(join(a.out, "capture.json"), JSON.stringify(sidecar, null, 2) + "\n");
  return { out: a.out, frames: a.frames, frameDigest: digest.sha256, living: digest.living, recheck };
}

async function sheet(browser: Browser, origin: string, a: CaptureArgs, entries: SheetEntry[], say: (m: string) => void) {
  const stills: { url: string }[] = [];
  const runs: unknown[] = [];
  let prov: unknown = null;
  for (const [i, e] of entries.entries()) {
    say(`run ${i + 1}/${entries.length}: ${e.label}`);
    const { page, errors } = await openRun(browser, origin, e.run, a);
    await runTo(page, e.run, a.step, say);
    const digest = await frameDigest(page, e.run);
    if (digest.step !== a.step) throw new CaptureError(`frame on screen is step ${digest.step}, asked ${a.step} (${e.label})`);
    const s = await still(page, e.run, a);
    checkPose(s, e.run);
    if (errors.length) throw new CaptureError(`page errors (${e.label}): ${errors.join("; ")}`);
    prov ??= await provenance(browser, page);
    stills.push({ url: s.url });
    runs.push({ label: e.label, run: e.run, frameDigest: digest, pose: { yawRad: s.yaw, pitchRad: s.pitch, dist: s.dist }, stillSha256: sha256(Buffer.from(s.url.slice(s.url.indexOf(",") + 1), "base64")), url: runUrl("", e.run) });
    await page.close();
  }
  const top = 34;
  const L = sheetLayout(entries.length, a.width, a.height, { cols: a.cols, labelH: 44, top });
  // an empty page on the lab's origin: about:blank is not a secure context, so it has no crypto.subtle for the pixel hash
  const page = await browser.newPage();
  await page.route(`${origin}/__volume-capture__`, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>volume capture</title>" }));
  await page.goto(`${origin}/__volume-capture__`);
  const out = await compose(page, {
    width: L.width, height: L.height,
    images: L.cells.map((c, i) => ({ url: stills[i]!.url, x: c.x, y: c.y })),
    texts: [
      { text: sheetHeader(a.step, a.run.camera, a.width, a.height), x: 12, y: 12, size: 15, bold: true, colour: TEXT },
      ...L.cells.flatMap((c, i) => [
        { text: entries[i]!.label, x: c.x + 2, y: c.labelY + 5, size: 15, bold: true, colour: TEXT },
        { text: anySubLabel(entries[i]!.run), x: c.x + 2, y: c.labelY + 25, size: 12, colour: MUTED },
      ]),
    ],
  });
  await page.close();
  writeOutFile(join(a.out, "sheet.png"), out.png);
  writeOutFile(join(a.out, "sheet.json"), JSON.stringify({
    tool: "tools/volume-capture/capture.ts", mode: "sheet", step: a.step, camera: a.run.camera,
    still: { width: a.width, height: a.height, deviceScaleFactor: 1, still: true }, layout: { cols: L.cols, rows: L.rows, width: L.width, height: L.height },
    sheet: { file: "sheet.png", sha256: sha256(out.png), pixelSha256: out.pixelSha256 }, runs, ...(prov as object),
  }, null, 2) + "\n");
  return { out: a.out, runs: entries.length, sheet: join(a.out, "sheet.png") };
}

// ---- main ---------------------------------------------------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  let a: CaptureArgs, entries: SheetEntry[] = [];
  try {
    if (argv.includes("--help")) { console.log(USAGE); return 0; }
    a = parseArgs(argv);
    if (a.sheet) {
      let json: unknown;
      try { json = JSON.parse(readFileSync(resolve(a.sheet), "utf8")); } catch (e) { throw new ArgError(`cannot read the sheet file ${a.sheet}: ${e instanceof Error ? e.message : e}`); }
      entries = parseSheet(json, a.run);
    }
    // everything the capture writes or deletes, checked before anything starts
    const files = a.mode === "sheet" ? ["sheet.png", "sheet.json"]
      : [...Array.from({ length: a.frames }, (_, i) => `frames/frame-${String(i).padStart(4, "0")}.png`), "turntable.mp4", "turntable.gif", "capture.json"];
    a.out = prepareOut(resolve(a.out), a.mode === "sheet" ? [] : ["frames"], files);
  } catch (e) {
    if (e instanceof ArgError) { console.error(`volume-capture: ${e.message}\n\n${USAGE}`); return 2; }
    if (e instanceof OutputError) { console.error(`volume-capture: ${e.message}`); return 2; }
    throw e;
  }
  const say = (m: string) => console.error(`volume-capture: ${m}`);
  let vite: ChildProcess | null = null;
  let browser: Browser | null = null;
  let launching: Promise<Browser> | null = null;
  // Stops Chrome and Vite and waits for both: on the way out, and on SIGINT/SIGTERM/SIGHUP, which skip `finally`.
  const shutdown = async () => {
    const b = browser ?? (await launching?.catch(() => null)) ?? null, v = vite; // a Chrome still starting is waited for
    browser = null; launching = null; vite = null;
    await b?.close().catch(() => {});
    stopped = true;
    const f = encoder;
    if (f && f.exitCode === null && f.signalCode === null) {
      const gone = new Promise<void>((ok) => f.once("exit", () => ok()));
      f.kill("SIGTERM");
      await gone;
    }
    if (v && v.exitCode === null && v.signalCode === null) {
      const gone = new Promise<void>((ok) => v.once("exit", () => ok()));
      v.kill("SIGTERM");
      const t = setTimeout(() => v.kill("SIGKILL"), 5000);
      await gone;
      clearTimeout(t);
    }
  };
  let stopping = false;
  const onSignal = (sig: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    say(`${sig}: stopping Chrome and Vite`);
    void shutdown().finally(() => process.exit(sig === "SIGINT" ? 130 : sig === "SIGHUP" ? 129 : 143));
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, onSignal);
  try {
    let origin = a.url;
    if (!origin) { const v = await startVite(a.port, (c) => { vite = c; }); origin = v.origin; say(`Vite on ${origin}`); }
    // our handlers own the signals (Playwright's own would exit before Vite is stopped)
    launching = chromium.launch({ channel: "chrome", headless: true, args: GPU_ARGS, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
    const b = await launching;
    if (stopping) return 1; // a signal arrived while Chrome was starting: the handler's shutdown closes it
    browser = b;
    launching = null;
    const res = a.mode === "sheet" ? await sheet(b, origin, a, entries, say) : await turntable(b, origin, a, say);
    console.log(JSON.stringify(res));
    return 0;
  } catch (e) {
    console.error(`volume-capture: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await shutdown();
  }
}

process.exitCode = await main(process.argv.slice(2));
