// The link-preview card for a world (social-card.html?world=<id>&steps=<n>), or the site's own card (&home). The
// jar holds the real world: planted from its preset, run on the GPU for `steps` steps and drawn by the lab's own
// renderer. The words come from the world catalogue, so the card says what the Worlds page says.
// scripts/social-cards.ts screenshots this page; window.card reports what it drew, for the cards' manifest.
import { CH, PRESETS, initWorld, presetConfig, worldH, worldW, type WorldState } from "@bl/schema";
import { applyBoundary, cellsAtBoundary, pondContext } from "@bl/runner";
import { GpuSim, Renderer, requestDevice } from "@bl/sim-gpu";
import { byId, familyOf, noteOf, worldTraits } from "./worlds.ts";

export interface CardInfo { id: string; name: string; family: string; asks: string; traits: string[]; seed: number; steps: number }
declare global { interface Window { card?: CardInfo | { error: string }; worldIds?: string[] } }

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
/** The lab's census cadence (sim.worker.ts); every host transform's period is a multiple of it. */
const CENSUS_EVERY = 100;
window.worldIds = PRESETS.map((p) => p.id);

/**
 * Sizes the headline and lede down until the copy column fits, so long names and questions still read whole; if
 * the smallest size still overflows, drops trait chips from the end. Throws rather than draw a clipped card.
 */
function fit() {
  const copy = document.querySelector<HTMLElement>(".copy")!;
  const fits = () => copy.scrollHeight <= copy.clientHeight;
  const chips = $("chips");
  for (;;) {
    for (let size = 66, lede = 25; size >= 44; size -= 2, lede = Math.max(20, lede - 0.5)) {
      document.documentElement.style.setProperty("--headline", `${size}px`);
      document.documentElement.style.setProperty("--lede", `${lede}px`);
      if (fits()) return;
    }
    if (!chips.lastElementChild) throw new Error("the card's words do not fit");
    chips.lastElementChild.remove();
  }
}

/**
 * The top-left corner of the w by h window (wrapping) holding the most biomass and membrane: every window on a
 * 4-cell grid is scored exactly from a summed-area table, then the best is moved to centre on the mass inside it if
 * that keeps at least as much in view.
 */
function liveliest(cells: Uint32Array, W: number, H: number, w: number, h: number): { x: number; y: number } {
  const n = W * H;
  const mass = (x: number, y: number) => { const i = (y % H) * W + (x % W); return cells[CH.B * n + i] + cells[CH.P * n + i]; };
  // A window taller than the world sees every row (wrapping), so only its columns matter, and likewise for width.
  const ww = Math.min(w, W), hh = Math.min(h, H);
  const SW = 2 * W + 1, sat = new Float64Array(SW * (2 * H + 1));
  for (let y = 1; y <= 2 * H; y++) for (let x = 1; x <= 2 * W; x++)
    sat[y * SW + x] = mass(x - 1, y - 1) + sat[(y - 1) * SW + x] + sat[y * SW + x - 1] - sat[(y - 1) * SW + x - 1];
  const sum = (x0: number, y0: number) => {
    const x = ((Math.round(x0) % W) + W) % W, y = ((Math.round(y0) % H) + H) % H;
    return sat[(y + hh) * SW + x + ww] - sat[y * SW + x + ww] - sat[(y + hh) * SW + x] + sat[y * SW + x];
  };
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) {
    const v = sum(x, y);
    if (v > best) { best = v; bx = x; by = y; }
  }
  let mx = 0, my = 0, m = 0;
  for (let j = 0; j < hh; j++) for (let k = 0; k < ww; k++) {
    const v = mass(bx + k, by + j);
    mx += v * (k + 0.5); my += v * (j + 0.5); m += v;
  }
  if (m > 0) {
    const cx = bx + mx / m - ww / 2, cy = by + my / m - hh / 2;
    if (sum(cx, cy) >= best) { bx = Math.round(cx); by = Math.round(cy); }
  }
  return { x: bx - (w - ww) / 2, y: by - (h - hh) / 2 };
}

/**
 * Grows the world as the lab and the headless runner do: the GPU steps in census-sized chunks, and at each step
 * the host transforms that fall there (migration, the pond cycle with its arm's own donors, declared-cell births)
 * through the runner's shared helpers, so the card shows the history the lab would grow from this seed.
 */
async function grow(sim: GpuSim, start: WorldState, steps: number) {
  const ponds = pondContext(start);
  while (sim.step < steps) {
    sim.run(Math.min(CENSUS_EVERY - (sim.step % CENSUS_EVERY), steps - sim.step));
    await sim.drainLedger();
    const boundary = await applyBoundary(sim, sim.step, ponds);
    await cellsAtBoundary(sim, sim.step, boundary.state);
  }
}

async function draw(id: string, seed: number, steps: number) {
  const preset = byId(id);
  if (!preset) throw new Error(`no world ${id}`);
  const cfg = presetConfig(preset, seed);
  const device = await requestDevice(navigator.gpu, cfg);
  const start = initWorld(cfg, preset.init);
  const sim = await GpuSim.create(device, start);
  await grow(sim, start, steps);
  // The jar's shape, at most 256 cells across, framed where the most living mass is; the field wraps, as in the lab.
  const jar = document.querySelector<HTMLElement>(".jar")!;
  const W = worldW(cfg), H = worldH(cfg);
  const w = Math.min(W, Number(params.get("view")) || 256);
  const h = Math.round((w * jar.clientHeight) / jar.clientWidth);
  const { x, y } = liveliest((await sim.readSnapshot()).cells, W, H, w, h);
  const canvas = $("field") as HTMLCanvasElement;
  canvas.width = w * 2;
  canvas.height = h * 2;
  const format = navigator.gpu.getPreferredCanvasFormat();
  const ctx = canvas.getContext("webgpu")!;
  ctx.configure({ device, format, alphaMode: "opaque" });
  const renderer = new Renderer(device, ctx, format, sim);
  renderer.draw("composite", { x, y, w, h }, canvas.width, canvas.height);
  await device.queue.onSubmittedWorkDone();
}

async function main() {
  const id = params.get("world") ?? "soup";
  const seed = Number(params.get("seed") ?? 42);
  const steps = Number(params.get("steps") ?? 3000);
  const preset = byId(id);
  const note = noteOf(id);
  const family = familyOf(id);
  if (!preset || !note || !family) throw new Error(`no catalogue entry for ${id}`);
  const traits = worldTraits(preset).map((t) => t.label).slice(0, 3);
  if (params.has("home")) {
    $("eyebrow").textContent = "Artificial life in your browser";
    $("headline").innerHTML = "Grow something <em>surprising.</em>";
    $("lede").textContent = "Tiny sealed worlds that evolve on your GPU. Plant one, feed it, wound it, see what grows back.";
  } else {
    $("eyebrow").textContent = `A world in the garden · ${family.name}`;
    $("headline").textContent = preset.name;
    $("lede").textContent = note.asks;
    for (const t of traits) $("chips").append(Object.assign(document.createElement("li"), { textContent: t }));
    $("url").innerHTML = "cadence.garden <span>· plant it in your browser</span>";
  }
  await document.fonts.ready;
  fit();
  await draw(id, seed, steps);
  const shown = [...$("chips").children].map((li) => li.textContent ?? "");
  window.card = { id, name: preset.name, family: family.name, asks: note.asks, traits: shown, seed, steps };
}

main().catch((e) => { window.card = { error: String(e?.stack ?? e) }; });
