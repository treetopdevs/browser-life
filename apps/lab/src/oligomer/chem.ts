/**
 * Conserved binary oligomer chemistry (L = 1..4, 30 molecular species).
 *
 * Every unit of matter is a conserved monomer ('0' or '1').
 * Species index layout:
 *   len 1: indices  0.. 1  (2 species: '0', '1')
 *   len 2: indices  2.. 5  (4 species: '00'..'11')
 *   len 3: indices  6..13  (8 species: '000'..'111')
 *   len 4: indices 14..29 (16 species: '0000'..'1111')
 *
 * Balanced amphiphilic tetramers (n0 === 2, n1 === 2) form the wall class W (6 species):
 *   0011 (17), 0101 (19), 0110 (20), 1001 (23), 1010 (24), 1100 (26).
 */

export const NUM_SPECIES = 30;
export const MAX_LEN = 4;

export interface SpeciesInfo {
  readonly id: number;
  readonly len: number;
  readonly bits: number;
  readonly label: string;
  readonly n0: number;
  readonly n1: number;
  readonly bonds: number;
  readonly isWall: boolean;
  readonly wallIndex: number; // 0..5 if isWall, else -1
}

export const LEN_OFFSET = [0, 0, 2, 6, 14] as const;

export function speciesId(len: number, bits: number): number {
  return LEN_OFFSET[len] + bits;
}

const _species: SpeciesInfo[] = [];
const _wallSpecies: number[] = [];

for (let len = 1; len <= MAX_LEN; len++) {
  const count = 1 << len;
  for (let bits = 0; bits < count; bits++) {
    let n1 = 0;
    let label = '';
    for (let b = len - 1; b >= 0; b--) {
      const bit = (bits >> b) & 1;
      n1 += bit;
      label += bit ? '1' : '0';
    }
    const n0 = len - n1;
    const isWall = len === 4 && n0 === 2 && n1 === 2;
    const wallIndex = isWall ? _wallSpecies.length : -1;
    const id = _species.length;
    if (isWall) _wallSpecies.push(id);
    _species.push({
      id,
      len,
      bits,
      label,
      n0,
      n1,
      bonds: len - 1,
      isWall,
      wallIndex,
    });
  }
}

export const SPECIES: readonly SpeciesInfo[] = _species;
export const WALL_SPECIES: readonly number[] = _wallSpecies;
export const NUM_WALL_SPECIES = _wallSpecies.length; // 6

export function speciesByLabel(label: string): number {
  const len = label.length;
  if (len < 1 || len > MAX_LEN) throw new Error(`Invalid oligomer label: ${label}`);
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const ch = label[i];
    if (ch !== '0' && ch !== '1') throw new Error(`Invalid oligomer label: ${label}`);
    bits = (bits << 1) | (ch === '1' ? 1 : 0);
  }
  return speciesId(len, bits);
}

/**
 * Cleave species `id` at `splitPos` (1 <= splitPos < len).
 * Returns [leftId, rightId] such that concat(left, right) === id.
 */
export function cleaveSpecies(id: number, splitPos: number): [number, number] {
  const sp = SPECIES[id];
  const rightLen = sp.len - splitPos;
  const leftBits = sp.bits >> rightLen;
  const rightBits = sp.bits & ((1 << rightLen) - 1);
  return [speciesId(splitPos, leftBits), speciesId(rightLen, rightBits)];
}

/**
 * Ligate species `leftId` and `rightId` (left.len + right.len <= MAX_LEN).
 */
export function ligateSpecies(leftId: number, rightId: number): number {
  const l = SPECIES[leftId];
  const r = SPECIES[rightId];
  return speciesId(l.len + r.len, (l.bits << r.len) | r.bits);
}

/** Precomputed cleavage table: CLEAVE_LEFT[id * 4 + splitPos], CLEAVE_RIGHT[id * 4 + splitPos]. */
export const CLEAVE_LEFT = new Int8Array(NUM_SPECIES * 4).fill(-1);
export const CLEAVE_RIGHT = new Int8Array(NUM_SPECIES * 4).fill(-1);

for (let id = 0; id < NUM_SPECIES; id++) {
  const sp = SPECIES[id];
  for (let pos = 1; pos < sp.len; pos++) {
    const [l, r] = cleaveSpecies(id, pos);
    CLEAVE_LEFT[id * 4 + pos] = l;
    CLEAVE_RIGHT[id * 4 + pos] = r;
  }
}

/**
 * Catalyst operations:
 *   0 = NOP
 *   1 = CLEAVE_INT  (cleave matching internal oligomer -> left + right, +eBond)
 *   2 = LIGATE_INT  (join left + right -> matching internal oligomer, -eLig)
 *   3 = IMPORT      (facilitated pore: pull matching oligomer from ext -> int)
 *   4 = LYSE_WALL   (cleave matching wall oligomer on neighbor [and self if worn])
 */
export const OP_NOP = 0;
export const OP_CLEAVE = 1;
export const OP_LIGATE = 2;
export const OP_IMPORT = 3;
export const OP_LYSE = 4;
export const NUM_OPS = 5;

/**
 * Packed 16-bit catalyst encoding:
 *   bits  0.. 3: pattern (4 bits; low `targetLen` bits used)
 *   bits  4.. 7: mask    (4 bits; 1 = must match, 0 = wildcard; low `targetLen` bits used)
 *   bits  8.. 9: lenCode (0 -> len 2, 1 -> len 3, 2 -> len 4, 3 -> len 4)
 *   bits 10..11: splitCode (maps into 1..targetLen-1)
 *   bits 12..14: op (0..4; values 5..7 treated as NOP)
 */
export interface DecodedCatalyst {
  readonly op: number;
  readonly targetLen: number;
  readonly pattern: number;
  readonly mask: number;
  readonly splitPos: number;
  readonly wildcards: number;
}

export function packCatalyst(
  op: number,
  targetLen: number,
  pattern: number,
  mask: number,
  splitPos: number,
): number {
  const lenCode = Math.max(0, Math.min(2, targetLen - 2));
  const lenMask = (1 << targetLen) - 1;
  const p = pattern & lenMask;
  const m = mask & lenMask;
  const sp = Math.max(1, Math.min(targetLen - 1, splitPos)) - 1; // 0..2
  return (
    ((op & 0x7) << 12) |
    ((sp & 0x3) << 10) |
    ((lenCode & 0x3) << 8) |
    ((m & 0xf) << 4) |
    (p & 0xf)
  );
}

export function decodeCatalyst(raw: number): DecodedCatalyst {
  const rawOp = (raw >>> 12) & 0x7;
  const op = rawOp < NUM_OPS ? rawOp : OP_NOP;
  const lenCode = (raw >>> 8) & 0x3;
  const targetLen = lenCode === 0 ? 2 : lenCode === 1 ? 3 : 4;
  const lenMask = (1 << targetLen) - 1;
  const pattern = raw & lenMask;
  const mask = (raw >>> 4) & lenMask;
  const rawSplit = ((raw >>> 10) & 0x3) + 1;
  const splitPos = rawSplit < targetLen ? rawSplit : targetLen - 1;

  // Count wildcards (0 bits within the active targetLen bits of mask)
  let wildcards = 0;
  for (let b = 0; b < targetLen; b++) {
    if (((mask >>> b) & 1) === 0) wildcards++;
  }
  return { op, targetLen, pattern, mask, splitPos, wildcards };
}

export function catalystMatches(cat: DecodedCatalyst, spId: number): boolean {
  const sp = SPECIES[spId];
  if (sp.len !== cat.targetLen) return false;
  return (sp.bits & cat.mask) === (cat.pattern & cat.mask);
}

/**
 * List all species IDs matched by a decoded catalyst.
 */
export function matchedSpecies(cat: DecodedCatalyst): number[] {
  if (cat.op === OP_NOP) return [];
  const start = LEN_OFFSET[cat.targetLen];
  const count = 1 << cat.targetLen;
  const out: number[] = [];
  for (let bits = 0; bits < count; bits++) {
    if ((bits & cat.mask) === (cat.pattern & cat.mask)) {
      out.push(start + bits);
    }
  }
  return out;
}

/**
 * Precomputed catalyst rate multiplier in Q16 (65536 = 1.0).
 * Convex specificity tradeoff: rate(w) = 1 / 4^w (or 1.0 when flat=true).
 */
export function specificityScaleQ16(wildcards: number, flatTradeoff: boolean): number {
  if (flatTradeoff || wildcards <= 0) return 65536;
  const shift = wildcards * 2; // divide by 4^w
  return Math.max(256, 65536 >>> shift);
}

export function formatCatalyst(raw: number): string {
  const c = decodeCatalyst(raw);
  if (c.op === OP_NOP) return 'NOP';
  const opNames = ['NOP', 'CLV', 'LIG', 'IMP', 'LYS'];
  let pat = '';
  for (let b = c.targetLen - 1; b >= 0; b--) {
    if (((c.mask >>> b) & 1) === 0) pat += '*';
    else pat += ((c.pattern >>> b) & 1) ? '1' : '0';
  }
  if (c.op === OP_CLEAVE || c.op === OP_LIGATE || c.op === OP_LYSE) {
    return `${opNames[c.op]}(${pat.slice(0, c.splitPos)}|${pat.slice(c.splitPos)})`;
  }
  return `${opNames[c.op]}(${pat})`;
}

/** Convenience helper to build a catalyst from a string pattern like '01*1' (using '*' for wildcard). */
export function makeCatalyst(op: number, patternStr: string, splitPos = 2): number {
  const len = patternStr.length;
  if (len < 2 || len > MAX_LEN) throw new Error(`Invalid pattern: ${patternStr}`);
  let pattern = 0;
  let mask = 0;
  for (let i = 0; i < len; i++) {
    const ch = patternStr[i];
    pattern <<= 1;
    mask <<= 1;
    if (ch === '0') {
      mask |= 1;
    } else if (ch === '1') {
      pattern |= 1;
      mask |= 1;
    } else if (ch !== '*') {
      throw new Error(`Invalid pattern char '${ch}' in ${patternStr}`);
    }
  }
  return packCatalyst(op, len, pattern, mask, splitPos);
}
