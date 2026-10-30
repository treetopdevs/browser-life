// BFF program soup (Agüera y Arcas et al. 2024, "Computational Life: How
// Well-formed, Self-replicating Programs Emerge from Simple Interaction",
// arXiv 2406.19108). A port of the reference implementation, Google's cubff
// (github.com/paradigms-of-intelligence/cubff, bff.inc.h and
// common_language.h), meant to match it byte for byte on the same seed.
//
// Spec, as cubff implements it:
// - A soup of `num` programs of 64 bytes, initially random.
// - Each epoch shuffles the soup (Fisher–Yates) and pairs consecutive entries.
//   Each pair is concatenated into a 128-byte tape, mutated (each byte replaced
//   by a random byte with probability mutationProb / 2^30, default 2^18, which
//   is 1/4096, the paper's 0.024%), run for at most 8192 steps, and split back.
// - Instructions: < > move head0, { } move head1, + - change tape[head0],
//   . copies tape[head0] to tape[head1], , copies tape[head1] to tape[head0],
//   [ jumps past the matching ] when tape[head0] is 0, ] jumps back to the
//   matching [ when it is not. Other bytes are no-ops. Heads wrap mod 128.
//   An unmatched bracket or the instruction pointer leaving the tape halts.
// - "noheads" (the paper's language, cubff --lang bff_noheads) starts both
//   heads at 0 and the instruction pointer at 0. "heads" (cubff --lang bff)
//   reads the starting heads from tape bytes 0 and 1 and starts at byte 2.
// - Grid soups (cubff --interaction_pattern from make_2d_pattern.py) let each
//   program meet only programs within `radius` cells on a width x height grid
//   (square neighbourhood, no wraparound). Each epoch visits programs in the
//   shuffled order; each picks neighbour seed(seed(epoch) ^ seed(i)) % degree
//   and pairs with it if both are still free. Programs left without a partner
//   are mutated in leftover pairs but not run.
// - All randomness is SplitMix64 keyed on (seed, epoch, pair, byte), so a run
//   is replayable from its seed.

export const TAPE = 64;
export const STEPS = 8 * 1024;
export const DEFAULT_MUTATION = 1 << 18; // out of 2^30

export const MAX_NUM = 2 ** 24;
export type Lang = "noheads" | "heads";

// ---- SplitMix64 on two u32 halves (no BigInt in the hot loop) ----

let oh = 0, ol = 0; // output of mul64 / splitmix

function mul64(ah: number, al: number, bh: number, bl: number): void {
  const a0 = al & 0xffff, a1 = al >>> 16, b0 = bl & 0xffff, b1 = bl >>> 16;
  const p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  ol = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0;
  const hi = p11 + Math.floor(p01 / 65536) + Math.floor(p10 / 65536) + Math.floor(mid / 65536);
  oh = (hi + Math.imul(al, bh) + Math.imul(ah, bl)) >>> 0;
}

function splitmix(hi: number, lo: number): void {
  const l = lo + 0x7f4a7c15;
  lo = l >>> 0;
  hi = (hi + 0x9e3779b9 + (l > 0xffffffff ? 1 : 0)) >>> 0;
  lo = (lo ^ ((lo >>> 30) | (hi << 2))) >>> 0;
  hi = (hi ^ (hi >>> 30)) >>> 0;
  mul64(hi, lo, 0xbf58476d, 0x1ce4e5b9);
  hi = oh; lo = ol;
  lo = (lo ^ ((lo >>> 27) | (hi << 5))) >>> 0;
  hi = (hi ^ (hi >>> 27)) >>> 0;
  mul64(hi, lo, 0x94d049bb, 0x133111eb);
  hi = oh; lo = ol;
  ol = (lo ^ ((lo >>> 31) | (hi << 1))) >>> 0;
  oh = (hi ^ (hi >>> 31)) >>> 0;
}

/** SplitMix64 as a BigInt, for tests and cold paths. */
export function splitmix64(x: bigint): bigint {
  const v = BigInt.asUintN(64, x);
  splitmix(Number(v >> 32n), Number(v & 0xffffffffn));
  return (BigInt(oh) << 32n) | BigInt(ol);
}

// ---- interpreter ----

const OP = new Uint8Array(256).fill(0); // 0 = no-op
const [LS, LE, PLUS, MINUS, C01, C10, D0, I0, D1, I1] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
OP["[".charCodeAt(0)] = LS; OP["]".charCodeAt(0)] = LE;
OP["+".charCodeAt(0)] = PLUS; OP["-".charCodeAt(0)] = MINUS;
OP[".".charCodeAt(0)] = C01; OP[",".charCodeAt(0)] = C10;
OP["<".charCodeAt(0)] = D0; OP[">".charCodeAt(0)] = I0;
OP["{".charCodeAt(0)] = D1; OP["}".charCodeAt(0)] = I1;

/** Runs a 128-byte tape in place. Returns the number of non-no-op instructions executed. */
export function evaluate(tape: Uint8Array, lang: Lang = "noheads", steps = STEPS): number {
  const N = 2 * TAPE, M = N - 1;
  let h0 = 0, h1 = 0, pc = 0;
  if (lang === "heads") { h0 = tape[0] % N; h1 = tape[1] % N; pc = 2; }
  let i = 0, skip = 0;
  for (; i < steps; i++) {
    h0 &= M; h1 &= M;
    switch (OP[tape[pc]]) {
      case D0: h0--; break;
      case I0: h0++; break;
      case D1: h1--; break;
      case I1: h1++; break;
      case PLUS: tape[h0] = (tape[h0] + 1) & 255; break;
      case MINUS: tape[h0] = (tape[h0] - 1) & 255; break;
      case C01: tape[h1] = tape[h0]; break;
      case C10: tape[h0] = tape[h1]; break;
      case LS:
        if (tape[h0] === 0) {
          let depth = 1;
          pc++;
          for (; pc < N && depth > 0; pc++) {
            const k = OP[tape[pc]];
            if (k === LE) depth--;
            else if (k === LS) depth++;
          }
          pc--;
          if (depth !== 0) pc = N;
        }
        break;
      case LE:
        if (tape[h0] !== 0) {
          let depth = 1;
          pc--;
          for (; pc >= 0 && depth > 0; pc--) {
            const k = OP[tape[pc]];
            if (k === LE) depth++;
            else if (k === LS) depth--;
          }
          pc++;
          if (depth !== 0) pc = -1;
        }
        break;
      default: skip++;
    }
    if (pc < 0) { i++; break; }
    pc++;
    if (pc >= N) { i++; break; }
  }
  return i - skip;
}

// ---- soup ----

export interface Grid { width: number; height: number; radius?: number }
export interface SoupParams { num: number; seed: number; lang?: Lang; mutation?: number; grid?: Grid }

/** Neighbour lists in make_2d_pattern.py order, as CSR: neighbours of i are list[start[i] .. start[i+1]). */
export function gridNeighbours(g: Grid): { start: Uint32Array; list: Uint32Array } {
  const r = g.radius ?? 2, n = g.width * g.height;
  const start = new Uint32Array(n + 1), list: number[] = [];
  for (let i = 0; i < g.height; i++) {
    for (let j = 0; j < g.width; j++) {
      start[i * g.width + j] = list.length;
      for (let ii = -r; ii <= r; ii++) {
        for (let jj = -r; jj <= r; jj++) {
          const y = i + ii, x = j + jj;
          if (y >= 0 && y < g.height && x >= 0 && x < g.width && (ii !== 0 || jj !== 0)) list.push(y * g.width + x);
        }
      }
    }
  }
  start[n] = list.length;
  return { start, list: Uint32Array.from(list) };
}

export class Soup {
  readonly num: number;
  readonly lang: Lang;
  readonly mutation: number;
  readonly programs: Uint8Array<ArrayBuffer>;
  epoch = 0;
  ops = 0; // instructions executed since last reset
  runs = 0;
  private readonly baseH: number;
  private readonly baseL: number;
  private readonly order: Uint32Array<ArrayBuffer>;
  private readonly tape = new Uint8Array(2 * TAPE);
  readonly grid: Grid | null;
  private readonly nb: { start: Uint32Array; list: Uint32Array } | null;
  private readonly tmp: Uint32Array;
  private readonly used: Uint8Array;

  constructor(p: SoupParams) {
    if (p.num % 2 !== 0 || p.num < 2) throw new Error("num must be even");
    // Limits that keep every key and modulo exact in u32 halves and doubles.
    if (p.num > MAX_NUM) throw new Error(`num must be at most 2^24`);
    if (!Number.isSafeInteger(p.seed) || p.seed < 0 || p.seed >= 2 ** 32) throw new Error("seed must be an integer in [0, 2^32)");
    this.num = p.num;
    this.lang = p.lang ?? "noheads";
    this.mutation = p.mutation ?? DEFAULT_MUTATION;
    this.programs = new Uint8Array(p.num * TAPE);
    this.order = new Uint32Array(p.num);
    this.grid = p.grid ?? null;
    if (this.grid && this.grid.width * this.grid.height !== p.num) throw new Error("grid width * height must equal num");
    this.nb = this.grid ? gridNeighbours(this.grid) : null;
    this.tmp = new Uint32Array(this.grid ? p.num : 0);
    this.used = new Uint8Array(this.grid ? p.num : 0);
    splitmix(Math.floor(p.seed / 2 ** 32) >>> 0, p.seed >>> 0);
    this.baseH = oh; this.baseL = ol;
    // InitPrograms: byte = SplitMix64(64*num*seed(0) + 64*index + i) % 256
    this.seedOf(0, 0);
    mul64(oh, ol, 0, (TAPE * p.num) >>> 0);
    const sh = oh, sl = ol;
    for (let k = 0; k < p.num * TAPE; k++) {
      const l = sl + k;
      splitmix((sh + (l > 0xffffffff ? 1 : 0)) >>> 0, l >>> 0);
      this.programs[k] = ol & 255;
    }
  }

  /** cubff's seed(x) = SplitMix64(SplitMix64(params.seed) ^ SplitMix64(x)); result in oh/ol. */
  private seedOf(hi: number, lo: number): void {
    splitmix(hi, lo);
    splitmix((oh ^ this.baseH) >>> 0, (ol ^ this.baseL) >>> 0);
  }

  /** Overwrites the start of slot `index` with `bytes`, leaving the rest (as cubff --initial_program does for slot 0). */
  plant(index: number, bytes: Uint8Array): void {
    this.programs.set(bytes.subarray(0, TAPE), index * TAPE);
  }

  step(): void {
    const { order, eh, el, active } = this.prepare();
    this.runPairs(order, eh, el, active);
    this.epoch++;
  }

  /**
   * This epoch's pairing (pair p is order[2p], order[2p+1]; pairs p >= active
   * are mutated but not run) and its mutation key base num * seed(epoch) as
   * u32 halves. The GPU soup uses this too.
   */
  prepare(): { order: Uint32Array<ArrayBuffer>; eh: number; el: number; active: number } {
    const { num, nb } = this;
    const order = nb ? this.tmp : this.order;
    const epoch = this.epoch;
    if ((epoch + 1) * num > Number.MAX_SAFE_INTEGER) throw new Error("epoch * num exceeds 2^53");
    for (let i = 0; i < num; i++) order[i] = i;
    for (let i = num; i-- > 0;) {
      const x = epoch * num + i;
      this.seedOf(Math.floor(x / 2 ** 32) >>> 0, x >>> 0);
      splitmix(oh, ol);
      const m = i + 1;
      const j = ((oh % m) * (2 ** 32 % m) + (ol % m)) % m;
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    this.seedOf(Math.floor(epoch / 2 ** 32) >>> 0, epoch >>> 0);
    const sh = oh, sl = ol; // seed(epoch)
    let active = num / 2;
    if (nb) {
      const { used } = this, s = this.order;
      used.fill(0);
      active = 0;
      for (let k = 0; k < num; k++) {
        const i = order[k];
        const deg = nb.start[i + 1] - nb.start[i];
        if (deg === 0) continue;
        this.seedOf(0, i);
        this.seedOf((oh ^ sh) >>> 0, (ol ^ sl) >>> 0); // seed(seed(epoch) ^ seed(i))
        const idx = ((oh % deg) * (2 ** 32 % deg) + (ol % deg)) % deg;
        const j = nb.list[nb.start[i] + idx];
        if (used[i] || used[j]) continue;
        used[i] = used[j] = 1;
        s[2 * active] = i; s[2 * active + 1] = j;
        active++;
      }
      let w = 2 * active;
      for (let i = 0; i < num; i++) if (!used[i]) s[w++] = i;
    }
    mul64(sh, sl, 0, num); // num * seed(epoch)
    return { order: this.order, eh: oh, el: ol, active };
  }

  private runPairs(order: Uint32Array, eh: number, el: number, active: number): void {
    const { num, programs, tape } = this;
    const mut = this.mutation;
    let ops = 0;
    for (let p = 0; p < num / 2; p++) {
      const a = order[2 * p] * TAPE, b = order[2 * p + 1] * TAPE;
      for (let i = 0; i < TAPE; i++) { tape[i] = programs[a + i]; tape[i + TAPE] = programs[b + i]; }
      // rng key = (num*seed(epoch) + p) * 128 + i, i.e. ((...) << 7) + i
      const l = el + p;
      const kh = (eh + (l > 0xffffffff ? 1 : 0)) >>> 0, kl = l >>> 0;
      const bh = ((kh << 7) | (kl >>> 25)) >>> 0, bl = (kl << 7) >>> 0;
      for (let i = 0; i < 2 * TAPE; i++) {
        splitmix(bh, (bl | i) >>> 0);
        // prob_rng = (rng >> 8) & (2^30 - 1)
        const prob = ((ol >>> 8) | ((oh & 0x3f) << 24)) >>> 0;
        if (prob < mut) tape[i] = ol & 255;
      }
      if (p < active) ops += evaluate(tape, this.lang);
      for (let i = 0; i < TAPE; i++) { programs[a + i] = tape[i]; programs[b + i] = tape[i + TAPE]; }
    }
    this.ops += ops;
    this.runs += active;
  }
}

// ---- replication probe ----

/**
 * Does `prog` copy itself into a partner? Pairs it with `trials` random
 * partners, on each side, runs each tape once (no mutation) and returns the
 * best mean fraction of the partner half that ends up equal to `prog`. A
 * self-replicator scores near 1; a high-entropy but inert soup scores near 0.
 */
export function copyScore(prog: Uint8Array, lang: Lang = "noheads", trials = 16, seed = 1): number {
  const t = new Uint8Array(2 * TAPE);
  let best = 0;
  for (const side of [0, 1]) {
    let sum = 0;
    for (let k = 0; k < trials; k++) {
      for (let i = 0; i < TAPE; i++) {
        splitmix(seed >>> 0, (k * TAPE + i) >>> 0);
        t[i + (side ? 0 : TAPE)] = ol & 255;
      }
      t.set(prog.subarray(0, TAPE), side ? TAPE : 0);
      evaluate(t, lang);
      const off = side ? 0 : TAPE;
      let same = 0;
      for (let i = 0; i < TAPE; i++) if (t[off + i] === prog[i]) same++;
      sum += same / TAPE;
    }
    best = Math.max(best, sum / trials);
  }
  return best;
}

// ---- display ----

const CMDS = "[]+-.,<>{}";
/** cubff-style text: commands as themselves, 0 as "0", other bytes as "·". */
export function show(bytes: Uint8Array): string {
  let s = "";
  for (const c of bytes) {
    const ch = String.fromCharCode(c);
    s += c === 0 ? "0" : CMDS.includes(ch) ? ch : "·";
  }
  return s;
}

/** Parses commands and "0"; any other character becomes a zero-op filler byte (1). */
export function parse(text: string): Uint8Array {
  return Uint8Array.from([...text], (ch) => ch === "0" ? 0 : CMDS.includes(ch) ? ch.charCodeAt(0) : 1);
}
