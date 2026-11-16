// The volume view: owns one canvas, the two 3D textures and the live-voxel buffer, the orbit camera and the chosen renderer.
// It draws on demand (a new frame, a camera move, a setting) and every animation frame only while the turntable runs, so it
// takes no GPU time from the simulation when nothing changes. Frames come in through `upload`, packed on the CPU by
// pack.ts; nothing here reads the simulator. The only file in volume3d/ besides the page that touches the DOM.
import { OrbitCamera, PRESETS } from "./camera.ts";
import { boxExtent, texSize, voxelCount, type Approach, type FrameInfo, type ParamValue, type VolumeDims, type VolumeSource } from "./contract.ts";
import { Disposer } from "./approaches/disposer.ts";
import { RENDERERS, type ApproachEntry } from "./approaches/registry.ts";
import { packFrame, type PackOptions, type Packed } from "./pack.ts";
import type { Frame } from "../slab/render.ts";

export const BACKGROUND: [number, number, number] = [0.035, 0.05, 0.065];
const MAX_DPR = 2;
const MAX_SIDE = 2048;

export class VolumeView {
  readonly cam = new OrbitCamera();
  /** Uncaptured GPU errors seen since the device was attached (shown on debug pages, and logged). */
  readonly errors: string[] = [];
  renderer: ApproachEntry["id"] = "raymarch";
  peel = 0;
  cut = 1;
  turntable = false;
  /** Viewing aid: how many times thicker each layer is drawn (1 is the true shape). Changes the picture only. */
  stretch = 1;
  /** Captures (tools/volume-capture): renderers drop per-frame jitter and drift, so a picture depends only on its inputs. */
  still = false;
  /** Frames drawn so far, and the renderer that drew the last one (debug). */
  draws = 0;
  lastPainted: string | null = null;
  private device: GPUDevice | null = null;
  private dims: VolumeDims | null = null;
  private src: VolumeSource | null = null;
  private tex = new Disposer();
  private approach: Approach | null = null;
  private mounted: string | null = null;
  private params = new Map<string, Record<string, ParamValue>>();
  private packed: Packed | undefined;
  private hasFrame = false;
  private dirty = true;
  private raf = 0;
  private lastT = 0;
  private active = false;
  private chain: Promise<unknown> = Promise.resolve();

  /** `renderers` is the menu (tests pass stand-ins with mounts they resolve by hand). */
  constructor(readonly canvas: HTMLCanvasElement, private onChange: () => void = () => {}, private renderers: readonly ApproachEntry[] = RENDERERS) {
    this.cam.setPose(PRESETS.oblique!.pose);
    new ResizeObserver(() => this.request()).observe(canvas);
    attachCameraControls(canvas, this.cam, () => { this.request(); });
  }

  attach(device: GPUDevice) {
    if (this.device === device) return;
    this.device = device;
    this.dims = null;
    this.tex.disposeAll();
    this.src = null;
    this.approach?.unmount();
    this.approach = null;
    this.mounted = null;
    device.addEventListener("uncapturederror", (e) => {
      const m = (e as GPUUncapturedErrorEvent).error.message;
      this.errors.push(m);
      console.error("WebGPU (volume view):", m);
    });
  }

  /** Starts or stops drawing; a hidden view draws nothing. */
  setActive(on: boolean) {
    this.active = on;
    if (on) this.request(); else cancelAnimationFrame(this.raf);
  }

  /** Packs a frame and writes it to the textures. */
  upload(f: Frame, opts: PackOptions) {
    if (!this.device) return;
    this.uploadPacked(packFrame(f, opts, this.packed));
  }

  /** Writes textures a page packed itself (another world's packer, with the same channels; pack.ts is the slab's). */
  uploadPacked(p: Packed) {
    if (!this.device) return;
    this.packed = p;
    const fresh = !this.dims || this.dims.W !== p.dims.W || this.dims.H !== p.dims.H || this.dims.D !== p.dims.D;
    if (fresh) this.makeTextures(p.dims);
    const [w, h, d] = texSize(p.dims);
    const q = this.device.queue;
    q.writeTexture({ texture: this.src!.vox }, p.vox, { bytesPerRow: w * 4, rowsPerImage: h }, [w, h, d]);
    q.writeTexture({ texture: this.src!.aux }, p.aux, { bytesPerRow: w * 4, rowsPerImage: h }, [w, h, d]);
    if (p.liveCount > 0) q.writeBuffer(this.src!.live, 0, p.live, 0, p.liveCount);
    this.hasFrame = true;
    if (fresh) { this.mounted = null; this.peel = Math.min(this.peel, p.dims.D - 1); this.onChange(); }
    this.request();
  }

  /** Forgets the picture: the next draw shows only the backdrop until a frame of the new world arrives. */
  clear() {
    this.hasFrame = false;
    if (this.packed) this.packed.liveCount = 0;
    this.request();
  }

  get layers() { return this.dims?.D ?? 0; }
  /** The renderer actually on the canvas (debug and tests); equals `renderer` once a switch has settled. */
  get mountedRenderer() { return this.mounted; }
  get liveCount() { return this.hasFrame ? this.packed?.liveCount ?? 0 : 0; }

  setRenderer(id: ApproachEntry["id"]) { this.renderer = id; this.request(); }
  paramsOf(id: string): Record<string, ParamValue> {
    let v = this.params.get(id);
    if (!v) { v = {}; this.params.set(id, v); }
    return v;
  }
  setParam(key: string, value: ParamValue) {
    this.paramsOf(this.renderer)[key] = value;
    if (this.mounted === this.renderer) this.approach?.setParam(key, value);
    this.request();
  }
  setStretch(k: number) {
    this.stretch = Math.max(1, Math.min(16, k));
    if (this.dims) this.cam.setBox(boxExtent(this.dims, this.stretch));
    this.request();
  }
  setTurntable(on: boolean) { this.turntable = on; this.request(); }
  setPose(id: string) { const p = PRESETS[id]; if (p) { this.cam.setPose(p.pose); this.request(); } }

  request() {
    this.dirty = true;
    if (!this.active) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Draws now, waiting for a renderer switch in flight (debug and tests). */
  drawNow(): Promise<void> {
    this.dirty = true;
    return this.serial(0);
  }

  /** Mounting is async, so every mount and paint goes through one chain: two callers can never mount twice. */
  private serial(dt: number): Promise<void> {
    const p = this.chain.then(() => this.ensureApproach()).then(() => this.paint(dt));
    this.chain = p.catch((e) => { console.error(e); });
    return p;
  }

  private frame(t: number) {
    const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    if (!this.active) return;
    if (this.turntable) { this.cam.orbit(dt * 0.25, 0); this.dirty = true; }
    if (this.dirty) void this.serial(dt).catch(() => {});
    if (this.turntable) this.raf = requestAnimationFrame((tt) => this.frame(tt));
    else this.lastT = 0;
  }

  private makeTextures(dims: VolumeDims) {
    const device = this.device!;
    this.approach?.unmount();
    this.approach = null;
    this.mounted = null;
    this.tex.disposeAll();
    const mk = (label: string) => this.tex.add(device.createTexture({ label, dimension: "3d", size: texSize(dims), format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }));
    const vox = mk("volume3d-vox");
    const aux = mk("volume3d-aux");
    const live = this.tex.add(device.createBuffer({ label: "volume3d-live", size: voxelCount(dims) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
    this.dims = { ...dims };
    this.cam.setBox(boxExtent(dims, this.stretch));
    this.src = {
      device, dims: this.dims, vox, aux, live,
      voxView: vox.createView({ dimension: "3d" }), auxView: aux.createView({ dimension: "3d" }),
      liveCount: () => this.liveCount,
    };
  }

  private async ensureApproach(): Promise<void> {
    if (!this.src || this.mounted === this.renderer) return;
    const entry = this.renderers.find((r) => r.id === this.renderer)!;
    this.approach?.unmount();
    this.approach = null;
    this.mounted = null; // nothing is mounted now: a later return to the old renderer must mount it again
    const src = this.src;
    const a = await entry.load();
    await a.mount(this.canvas, src);
    // A frame with new dims replaced the textures while this mounted (its bind groups point at destroyed views), or another
    // renderer was chosen meanwhile: drop this mount and mount what is wanted now.
    if (this.src !== src || this.renderer !== entry.id) { a.unmount(); return this.ensureApproach(); }
    for (const [k, v] of Object.entries(this.paramsOf(entry.id))) a.setParam(k, v);
    this.approach = a;
    this.mounted = entry.id;
  }

  /** The chosen renderer's settings, as currently set. */
  async specs() {
    const entry = this.renderers.find((r) => r.id === this.renderer)!;
    const a = this.mounted === entry.id && this.approach ? this.approach : await entry.load();
    const set = this.paramsOf(entry.id);
    return a.params.map((p) => ({ ...p, value: set[p.key] ?? p.value } as typeof p));
  }

  private paint(dt: number) {
    // only the chosen renderer paints; otherwise stay dirty so the next frame mounts and paints it
    if (!this.approach || !this.src || !this.dims || this.mounted !== this.renderer) return;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.min(MAX_SIDE, Math.round(this.canvas.clientWidth * dpr)));
    const h = Math.max(1, Math.min(MAX_SIDE, Math.round(this.canvas.clientHeight * dpr)));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.dirty = false;
    this.draws++;
    if (!this.hasFrame) {
      // no frame of the current world yet: the backdrop only, never the previous world's picture
      const ctx = this.canvas.getContext("webgpu") as GPUCanvasContext;
      const enc = this.src.device.createCommandEncoder({ label: "volume3d-blank" });
      const [r, g, b] = BACKGROUND;
      enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r, g, b, a: 1 } }] }).end();
      this.src.device.queue.submit([enc.finish()]);
      return;
    }
    const f: FrameInfo = {
      camera: this.cam.info(w / h), ext: boxExtent(this.dims, this.stretch), dims: this.dims, dt,
      sunDir: [0, 1, 0], size: { w, h, dpr }, peel: this.peel, cut: this.cut, background: BACKGROUND, still: this.still,
    };
    this.approach.render(f);
    this.lastPainted = this.mounted;
  }
}

/** Orbit by drag, pan by shift- or right-drag, zoom by wheel or pinch (ported from the sandbox's HUD). */
export function attachCameraControls(target: HTMLElement, cam: OrbitCamera, onMove: () => void) {
  target.style.touchAction = "none";
  const pts = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  let panning = false;
  target.addEventListener("contextmenu", (e) => e.preventDefault());
  target.addEventListener("pointerdown", (e) => {
    target.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    panning = e.shiftKey || e.button === 2;
    if (pts.size === 2) pinch = dist();
  });
  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a!.x - b!.x, a!.y - b!.y);
  };
  target.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const h = target.clientHeight || 1;
    if (pts.size === 2) {
      const d = dist();
      if (pinch > 0 && d > 0) cam.zoom(pinch / d);
      pinch = d;
    } else if (panning) cam.pan(dx / h, dy / h);
    else cam.orbit(-dx * 0.008, dy * 0.008);
    onMove();
  });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0; };
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
  target.addEventListener("wheel", (e) => {
    e.preventDefault();
    cam.zoom(Math.exp(e.deltaY * 0.0012));
    onMove();
  }, { passive: false });
  // Keyboard: arrows orbit, + and - zoom, so the view works without a pointer.
  target.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowLeft") cam.orbit(0.12, 0);
    else if (k === "ArrowRight") cam.orbit(-0.12, 0);
    else if (k === "ArrowUp") cam.orbit(0, 0.08);
    else if (k === "ArrowDown") cam.orbit(0, -0.08);
    else if (k === "+" || k === "=") cam.zoom(0.9);
    else if (k === "-" || k === "_") cam.zoom(1 / 0.9);
    else return;
    e.preventDefault();
    onMove();
  });
}
