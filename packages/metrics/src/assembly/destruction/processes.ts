// Processes under test: the original patch (init stream), the damage (damage stream), the regrowth (regrow stream).
// Pure integer functions of (process, replicate, namespace). Three separate PRNG streams, keyed so that processes sharing a
// patch kind share the original patch and the lesion (paired comparison) and an ablation arm shares its parent's regrowth stream.
import { rnd } from "../../predictability/movie.ts";
import { canonicalKey } from "../grammar.ts";
import { COMPOSITE_12, SQUARE_4X4, growShape } from "../fixtures.ts";
import { DPROTOCOL, type Damage, type ProcessId, type SeedNs } from "./protocol.ts";
import { lesionPartial, lesionTotal, occupiedOf, paint, scramble, type Damaged, type Obj } from "./damage.ts";
import { regrow, storeFor, type RegrowResult } from "./regrow.ts";

const W = DPROTOCOL.patch.w, H = DPROTOCOL.patch.h, M = DPROTOCOL.patch.mass;

export type PatchKind = "hier" | "dup12" | "crystal" | "scatter";
export const KIND_OF: Record<ProcessId, PatchKind> = {
  "builder-hier12": "hier", "template-hier12": "hier", "stored-image-renderer": "hier", "wrong-store-builder": "hier",
  "template-dup12": "dup12", "fresh-random-dup12": "dup12", "accretion-crystal": "crystal", "inert-scatter": "scatter",
};
const KIND_INDEX: Record<PatchKind, number> = { hier: 1, dup12: 2, crystal: 3, scatter: 4 };
export const processIndex = (id: ProcessId): number => DPROTOCOL.processes.indexOf(id) + 1;

export interface Original { kind: PatchKind; objs: Obj[]; frame: Uint8Array; targetKey: string; objectSize: number }

function slotList(pitch: number, seed: number, rep: number): [number, number][] {
  const cols = Math.floor(W / pitch), rows = Math.floor(H / pitch);
  const all: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) all.push([c * pitch, r * pitch]);
  for (let i = all.length - 1; i > 0; i--) { const j = rnd(seed, rep, 0x5107 + i) % (i + 1); [all[i], all[j]] = [all[j], all[i]]; }
  return all;
}

/** The original patch of a kind (init stream). Exactly M occupied cells. */
export function original(kind: PatchKind, rep: number, ns: SeedNs): Original {
  const seed = rnd(DPROTOCOL.seeds[ns].init, KIND_INDEX[kind], rep);
  let objs: Obj[];
  let cells: number[];
  let pitch: number;
  let copies: number;
  switch (kind) {
    case "hier": cells = COMPOSITE_12; pitch = DPROTOCOL.pitch.object; copies = M / COMPOSITE_12.length; break;
    case "dup12": cells = growShape(12, DPROTOCOL.motifBox, rnd(seed, 0x4d, 0)); pitch = DPROTOCOL.pitch.object; copies = M / 12; break;
    case "crystal": cells = SQUARE_4X4; pitch = DPROTOCOL.pitch.crystal; copies = M / SQUARE_4X4.length; break;
    case "scatter": {
      const frame = new Uint8Array(W * H);
      let placed = 0;
      for (let attempt = 0; placed < M; attempt++) {
        if (attempt >= 200000) throw new Error("scatter: attempt cap reached");
        const x = rnd(seed, 2 * attempt, 0x5ca) % W, y = rnd(seed, 2 * attempt + 1, 0x5ca) % H;
        let free = true;
        for (let dy = -1; dy <= 1 && free; dy++) for (let dx = -1; dx <= 1; dx++) if (frame[((y + dy + H) % H) * W + ((x + dx + W) % W)]) { free = false; break; }
        if (free) { frame[y * W + x] = 1; placed++; }
      }
      const objs1: Obj[] = [];
      for (let i = 0; i < frame.length; i++) if (frame[i]) objs1.push({ cells: [0], at: [i % W, (i - (i % W)) / W] });
      return { kind, objs: objs1, frame, targetKey: "0", objectSize: 1 };
    }
  }
  const sl = slotList(pitch, seed, 0);
  objs = Array.from({ length: copies }, (_, i) => ({ cells, at: sl[i] }));
  const frame = paint(objs);
  if (occupiedOf(frame) !== M) throw new Error(`${kind} r${rep}: mass ${occupiedOf(frame)} != ${M}`);
  return { kind, objs, frame, targetKey: canonicalKey(cells), objectSize: cells.length };
}

export interface RunResult {
  process: ProcessId;
  damage: Damage;
  ablated: boolean;
  /** Scorer-only: the reference key and the original patch. Never given to regrow(). */
  original: Original;
  damaged: Damaged | null;
  regrown: RegrowResult | null;
  scrambled: Uint8Array | null;
}

export function damageSeed(kind: PatchKind, ns: SeedNs): number { return rnd(DPROTOCOL.seeds[ns].damage, KIND_INDEX[kind], 0xda); }
export function regrowSeed(id: ProcessId, rep: number, ns: SeedNs): number { return rnd(rnd(DPROTOCOL.seeds[ns].regrow, processIndex(id), rep), 0x72, 0); }

export function runProcess(id: ProcessId, rep: number, ns: SeedNs, damage: Damage, ablated = false): RunResult {
  const kind = KIND_OF[id];
  const orig = original(kind, rep, ns);
  const dseed = damageSeed(kind, ns);
  if (damage === "scramble") return { process: id, damage, ablated, original: orig, damaged: null, regrown: null, scrambled: scramble(M, dseed, rep) };
  const damaged = damage === "lesion-partial"
    ? lesionPartial(orig.objs, dseed, rep)
    : lesionTotal(orig.objs, (o) => canonicalKey(o.cells) === orig.targetKey);
  // regrow() sees (process, store, seed, surviving whole objects): no pre-damage patch, no reference key
  const store = storeFor(id, ablated, COMPOSITE_12);
  const res = regrow(id, store, regrowSeed(id, rep, ns), damaged.intact);
  return { process: id, damage, ablated, original: orig, damaged, regrown: res, scrambled: null };
}
