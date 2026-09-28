/** Pure, exact cell-packet operations. This module never runs a simulation. */
import { createHash } from "node:crypto";
import {
  CELL_CHANNELS, CH, G, GENOME_CHANNELS, MAX_STEP, RING_CELL_MASK, canonicalConfig, cellCount,
  cloneState, stateHash, totalsOf, validateConfig, validateState, worldW,
  type WorldConfig, type WorldState,
} from "@bl/schema";

export interface CellWords {
  sourceIndex: number;
  cells: number[]; // A,B,C,P,E,S,MOT, in channel order
  genome: number[]; // all 44 words, including lineage address
}
export interface Inventory {
  A: string; B: string; C: string; P: string; E: string; S: string;
  matter: string; energy: string;
}
export interface CellPacket {
  format: 1;
  arm: "intact" | "genome-only";
  sourceStateHash: string;
  sourceStep: number;
  sourceConfig: WorldConfig;
  sourceConfigCanonical: string;
  sourceWorldW: number;
  sourceWorldH: number;
  cells: CellWords[]; // sorted, unique source indices
  inventory: Inventory;
  /** Genome-only arms retain the exact morphology/resources of this intact packet. */
  templatePacketSha256: string | null;
  sha256: string;
}
export interface LineageId { hi: number; lo: number }
export interface LineageRelabel { from: LineageId; to: LineageId }
export interface ToroidalPlacement {
  sourceTileX: number; sourceTileY: number;
  destinationTileX: number; destinationTileY: number;
  shiftX: number; shiftY: number;
}
export interface TransplantAudit {
  before: Inventory;
  imported: Inventory;
  exported: Inventory;
  after: Inventory;
  /** Full prior destination words, including environmental pools and stale empty-site genome words. */
  exportedCells: { destinationIndex: number; cells: number[]; genome: number[] }[];
  mapping: { sourceIndex: number; destinationIndex: number }[];
  beforeStateHash: string;
  afterStateHash: string;
  ledgerUnchanged: boolean;
}

const hex = (value: string) => createHash("sha256").update(value).digest("hex");
const u32 = (v: number) => Number.isSafeInteger(v) && v >= 0 && v <= 0xffff_ffff;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const idKey = (id: LineageId) => `${id.hi}:${id.lo}`;
const rowId = (row: CellWords): LineageId => ({ hi: row.genome[G.LIN_HI], lo: row.genome[G.LIN_LO] });
const isZero = (id: LineageId) => (id.hi | id.lo) === 0;
const packetPayload = (packet: CellPacket) => ({ ...packet, sha256: undefined });
const packetHash = (packet: CellPacket) => hex(JSON.stringify(packetPayload(packet)));

function insistState(state: WorldState): void {
  const errors = validateState(state);
  if (errors.length) throw new Error(`invalid state: ${errors.join("; ")}`);
}

function inventory(rows: readonly { cells: readonly number[] }[], cfg: WorldConfig): Inventory {
  const sums = Array.from({ length: 6 }, (_, ch) => rows.reduce((v, row) => v + BigInt(row.cells[ch]), 0n));
  const [A, B, C, P, E, S] = sums;
  return { A: String(A), B: String(B), C: String(C), P: String(P), E: String(E), S: String(S),
    matter: String(A + B + C + P),
    energy: String(A * BigInt(cfg.eA) + B * BigInt(cfg.eB) + C * BigInt(cfg.eC) + P * BigInt(cfg.eP) + E + S) };
}

function worldInventory(state: WorldState): Inventory {
  const t = totalsOf(state.cfg, state.cells);
  return { A: String(t.A), B: String(t.B), C: String(t.C), P: String(t.P), E: String(t.E), S: String(t.S),
    matter: String(t.matter), energy: String(t.energy) };
}

function readWords(state: WorldState, index: number): CellWords {
  const n = cellCount(state.cfg);
  return { sourceIndex: index,
    cells: Array.from({ length: CELL_CHANNELS }, (_, ch) => state.cells[ch * n + index]),
    genome: Array.from({ length: GENOME_CHANNELS }, (_, g) => state.genome[g * n + index]) };
}

function writeWords(state: WorldState, index: number, row: CellWords): void {
  const n = cellCount(state.cfg);
  for (let ch = 0; ch < CELL_CHANNELS; ch++) state.cells[ch * n + index] = row.cells[ch];
  for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + index] = row.genome[g];
}

function freshPacket(base: Omit<CellPacket, "sha256">): CellPacket {
  const packet = { ...base, sha256: "" };
  packet.sha256 = packetHash(packet);
  return packet;
}

/** Validate even JSON-deserialised packets before interpreting their words. Mixed labels/genomes are unsupported. */
export function validateCellPacket(packet: CellPacket): void {
  if (!packet || packet.format !== 1 || !["intact", "genome-only"].includes(packet.arm) ||
      !/^[a-f0-9]{16}$/.test(packet.sourceStateHash) || !Number.isSafeInteger(packet.sourceStep) ||
      packet.sourceStep < 0 || packet.sourceStep > MAX_STEP ||
      !packet.sourceConfig || validateConfig(packet.sourceConfig).length)
    throw new Error("invalid packet source identity/configuration");
  const cfg = packet.sourceConfig;
  const n = cellCount(cfg);
  if (packet.sourceConfigCanonical !== canonicalConfig(cfg) || packet.sourceWorldW !== worldW(cfg) ||
      packet.sourceWorldH !== cfg.tileH * cfg.tilesY || !Array.isArray(packet.cells) || packet.cells.length === 0)
    throw new Error("packet source geometry/configuration mismatch");
  let last = -1;
  let firstId = "";
  let firstGenome: number[] | null = null;
  for (const row of packet.cells) {
    if (!Number.isSafeInteger(row.sourceIndex) || row.sourceIndex <= last || row.sourceIndex >= n ||
        !Array.isArray(row.cells) || row.cells.length !== CELL_CHANNELS || !row.cells.every(u32) ||
        !Array.isArray(row.genome) || row.genome.length !== GENOME_CHANNELS || !row.genome.every(u32))
      throw new Error("packet has duplicate, unordered, out-of-range or malformed cell words");
    last = row.sourceIndex;
    const id = rowId(row);
    if (isZero(id) || row.cells[CH.B] + row.cells[CH.P] === 0) throw new Error("packet contains unlabelled or unbound cell");
    if (id.hi > packet.sourceStep || (cfg.ringNamespace === undefined ? id.lo : id.lo & RING_CELL_MASK) >= n)
      throw new Error("packet contains a future or unrepresentable lineage ID");
    if (!firstId) { firstId = idKey(id); firstGenome = row.genome; }
    else if (idKey(id) !== firstId || !same(row.genome, firstGenome)) throw new Error("mixed lineage/genome packet is unsupported");
  }
  if (!same(packet.inventory, inventory(packet.cells, cfg))) throw new Error("packet inventory does not match cell words");
  if ((packet.arm === "intact" && packet.templatePacketSha256 !== null) ||
      (packet.arm === "genome-only" && !/^[a-f0-9]{64}$/.test(packet.templatePacketSha256 ?? "")))
    throw new Error("packet arm/template identity invalid");
  if (packet.sha256 !== packetHash(packet)) throw new Error("packet SHA-256 mismatch");
}

/** Exact extraction: copies every channel and genome word, without altering the source. */
export function extractCellPacket(source: WorldState, indices: readonly number[]): CellPacket {
  insistState(source);
  const n = cellCount(source.cfg);
  if (!indices.length || indices.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= n) || new Set(indices).size !== indices.length)
    throw new Error("packet indices must be nonempty, unique and in range");
  const rows = [...indices].sort((a, b) => a - b).map((i) => readWords(source, i));
  const packet = freshPacket({ format: 1, arm: "intact", sourceStateHash: stateHash(source), sourceStep: source.step,
    sourceConfig: JSON.parse(canonicalConfig(source.cfg)) as WorldConfig, sourceConfigCanonical: canonicalConfig(source.cfg),
    sourceWorldW: worldW(source.cfg), sourceWorldH: source.cfg.tileH * source.cfg.tilesY,
    cells: rows, inventory: inventory(rows, source.cfg), templatePacketSha256: null });
  validateCellPacket(packet);
  return packet;
}

/** Removes exactly the packet's source words; all external cells and ledgers remain untouched. */
export function exciseCellPacket(source: WorldState, packet: CellPacket): WorldState {
  validateCellPacket(packet);
  insistState(source);
  if (packet.arm !== "intact" || stateHash(source) !== packet.sourceStateHash ||
      canonicalConfig(source.cfg) !== packet.sourceConfigCanonical || source.step !== packet.sourceStep)
    throw new Error("packet is not from this exact source state");
  const out = cloneState(source);
  for (const row of packet.cells) {
    if (!same(readWords(source, row.sourceIndex), row)) throw new Error("source words differ from packet");
    writeWords(out, row.sourceIndex, { sourceIndex: row.sourceIndex,
      cells: Array(CELL_CHANNELS).fill(0), genome: Array(GENOME_CHANNELS).fill(0) });
  }
  insistState(out);
  return out;
}

/** Restoration is accepted only when the complete original physics hash returns. */
export function restoreCellPacket(excised: WorldState, packet: CellPacket): WorldState {
  validateCellPacket(packet);
  insistState(excised);
  if (packet.arm !== "intact" || canonicalConfig(excised.cfg) !== packet.sourceConfigCanonical || excised.step !== packet.sourceStep)
    throw new Error("restoration requires the intact source configuration and step");
  const out = cloneState(excised);
  for (const row of packet.cells) {
    const existing = readWords(out, row.sourceIndex);
    if (existing.cells.some((v) => v !== 0) || existing.genome.some((v) => v !== 0))
      throw new Error("restoration destination is not fully excised");
    writeWords(out, row.sourceIndex, row);
  }
  if (stateHash(out) !== packet.sourceStateHash) throw new Error("restoration did not reproduce source state hash");
  insistState(out);
  return out;
}

/** Replace only genotype words 2..43 on a shared structural template. The resulting arm cannot be restored to the source. */
export function genomeOnlyArm(template: CellPacket, genotypeWords: readonly number[]): CellPacket {
  validateCellPacket(template);
  if (template.arm !== "intact" || genotypeWords.length !== GENOME_CHANNELS ||
      genotypeWords[0] !== 0 || genotypeWords[1] !== 0 || !genotypeWords.every(u32))
    throw new Error("genome-only arm requires an intact template and an unlabelled 44-word genotype");
  const cells = template.cells.map((row) => ({ sourceIndex: row.sourceIndex, cells: [...row.cells],
    genome: [row.genome[0], row.genome[1], ...genotypeWords.slice(2)] }));
  const packet = freshPacket({ ...template, arm: "genome-only", cells,
    inventory: inventory(cells, template.sourceConfig), templatePacketSha256: template.sha256 });
  validateCellPacket(packet);
  return packet;
}

/** True only for identical structural inocula; intact packets are never labelled genome-only matched arms. */
export function matchedGenomeOnlyInocula(a: CellPacket, b: CellPacket): boolean {
  validateCellPacket(a); validateCellPacket(b);
  return a.arm === "genome-only" && b.arm === "genome-only" &&
    a.templatePacketSha256 === b.templatePacketSha256 &&
    same(a.cells.map((r) => [r.sourceIndex, r.cells]), b.cells.map((r) => [r.sourceIndex, r.cells]));
}

function relabelPacket(packet: CellPacket, garden: WorldState, relabels: readonly LineageRelabel[]): CellWords[] {
  if (!relabels.length) throw new Error("explicit injective lineage relabel map required");
  const from = new Map<string, LineageId>();
  const to = new Set<string>();
  const n = cellCount(garden.cfg);
  for (const entry of relabels) {
    if (!u32(entry.from.hi) || !u32(entry.from.lo) || !u32(entry.to.hi) || !u32(entry.to.lo) ||
        isZero(entry.to) || entry.to.hi > garden.step ||
        (garden.cfg.ringNamespace === undefined ? entry.to.lo : entry.to.lo & RING_CELL_MASK) >= n ||
        from.has(idKey(entry.from)) || to.has(idKey(entry.to)))
      throw new Error("lineage relabel map is noninjective, invalid or from the future");
    from.set(idKey(entry.from), entry.to);
    to.add(idKey(entry.to));
  }
  const packetIds = new Set(packet.cells.map((row) => idKey(rowId(row))));
  if (from.size !== packetIds.size || [...from.keys()].some((key) => !packetIds.has(key)))
    throw new Error("lineage relabel map must cover packet IDs exactly");
  for (let i = 0; i < n; i++) {
    const key = `${garden.genome[G.LIN_HI * n + i]}:${garden.genome[G.LIN_LO * n + i]}`;
    if (to.has(key)) throw new Error("lineage relabel target already exists in garden");
  }
  return packet.cells.map((row) => {
    const target = from.get(idKey(rowId(row)))!;
    const genome = [...row.genome];
    genome[G.LIN_HI] = target.hi; genome[G.LIN_LO] = target.lo;
    return { sourceIndex: row.sourceIndex, cells: [...row.cells], genome };
  });
}

/** Tile-local toroidal translation; a bijection on the tile, then restricted to packet members. */
export function toroidalMapping(packet: CellPacket, gardenCfg: WorldConfig, placement: ToroidalPlacement): { sourceIndex: number; destinationIndex: number }[] {
  validateCellPacket(packet);
  const src = packet.sourceConfig;
  if (src.tileW !== gardenCfg.tileW || src.tileH !== gardenCfg.tileH)
    throw new Error("source and garden tile geometry differ");
  const { sourceTileX: sx, sourceTileY: sy, destinationTileX: dx, destinationTileY: dy, shiftX, shiftY } = placement;
  if (![sx, sy, dx, dy, shiftX, shiftY].every(Number.isSafeInteger) || sx < 0 || sx >= src.tilesX || sy < 0 || sy >= src.tilesY ||
      dx < 0 || dx >= gardenCfg.tilesX || dy < 0 || dy >= gardenCfg.tilesY)
    throw new Error("invalid toroidal placement or tile coordinates");
  const mod = (v: number, size: number) => ((v % size) + size) % size;
  const localShiftX = mod(shiftX, src.tileW), localShiftY = mod(shiftY, src.tileH);
  const srcW = packet.sourceWorldW, dstW = worldW(gardenCfg);
  const mapping = packet.cells.map((row) => {
    const x = row.sourceIndex % srcW, y = Math.floor(row.sourceIndex / srcW);
    if (Math.floor(x / src.tileW) !== sx || Math.floor(y / src.tileH) !== sy)
      throw new Error("packet spans another source tile; one-tile placement required");
    const destinationIndex = (dy * src.tileH + mod(y % src.tileH + localShiftY, src.tileH)) * dstW +
      dx * src.tileW + mod(x % src.tileW + localShiftX, src.tileW);
    return { sourceIndex: row.sourceIndex, destinationIndex };
  });
  if (new Set(mapping.map((m) => m.destinationIndex)).size !== mapping.length)
    throw new Error("toroidal mapping collision");
  return mapping;
}

/** Replace vacant destination sites exactly. Returned export makes environmental displacement explicit. */
export function transplantCellPacket(garden: WorldState, packet: CellPacket, placement: ToroidalPlacement,
  relabels: readonly LineageRelabel[]): { state: WorldState; audit: TransplantAudit } {
  insistState(garden); validateCellPacket(packet);
  if (garden.cfg.mutRate !== 0) throw new Error("transplant garden must have mutation disabled");
  if (garden.cfg.ruleVersion !== packet.sourceConfig.ruleVersion ||
      ["eA", "eB", "eC", "eP"].some((key) => garden.cfg[key as keyof WorldConfig] !== packet.sourceConfig[key as keyof WorldConfig]))
    throw new Error("source/garden rule or energy coefficients differ");
  const mapping = toroidalMapping(packet, garden.cfg, placement);
  const rows = relabelPacket(packet, garden, relabels);
  const exportedCells = mapping.map((m) => {
    const row = readWords(garden, m.destinationIndex);
    if (row.cells[CH.B] !== 0 || row.cells[CH.P] !== 0 || !isZero(rowId(row)))
      throw new Error(`destination collision at cell ${m.destinationIndex}`);
    return { destinationIndex: m.destinationIndex, cells: row.cells, genome: row.genome };
  });
  const before = worldInventory(garden);
  const imported = inventory(rows, garden.cfg);
  const exported = inventory(exportedCells, garden.cfg);
  const out = cloneState(garden);
  mapping.forEach((m, k) => writeWords(out, m.destinationIndex, rows[k]));
  insistState(out); // catches per-cell pool and total-matter overflow, and genome-ID consistency
  const after = worldInventory(out);
  for (const key of ["A", "B", "C", "P", "E", "S", "matter", "energy"] as const)
    if (BigInt(after[key]) !== BigInt(before[key]) + BigInt(imported[key]) - BigInt(exported[key]))
      throw new Error(`transplant ${key} accounting mismatch`);
  const ledgerUnchanged = out.lightIn === garden.lightIn && out.heatOut === garden.heatOut &&
    out.flux.length === garden.flux.length && out.flux.every((value, i) => value === garden.flux[i]);
  if (!ledgerUnchanged) throw new Error("transplant altered cumulative ledgers");
  return { state: out, audit: { before, imported, exported, after, exportedCells, mapping,
    beforeStateHash: stateHash(garden), afterStateHash: stateHash(out), ledgerUnchanged } };
}
