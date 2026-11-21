/**
 * The Reef — Mechanochemical Morphogenesis in a 2D Vertical Water Column (Direction C).
 *
 * Core invariants:
 * - Closed in matter: sum(nut) + sum(det) + sum(cell.mass + cell.nut) === initialMatter (residual === 0).
 * - Open in energy: directional sunlight enters at y = 0 (casting real shadows downward) and leaves as heat.
 * - No Organism class, no named cell types: bodies are emergent connected graphs of spring-hinge bonded cells.
 * - Bit-deterministic: seeded integer PRNG only, zero Math.random().
 */

export const GRN_IN = 8;
export const GRN_HID = 6;
export const GRN_OUT = 9;
export const GENOME_LEN = GRN_IN * GRN_HID + GRN_HID * GRN_OUT; // 48 + 54 = 102 int8 weights

export interface ReefConfig {
  /** Grid width in tiles (periodic in x). */
  gw: number;
  /** Grid height in tiles (y = 0 sunlit surface, y = gh - 1 seabed). */
  gh: number;
  /** World units per tile. */
  tileSize: number;
  /** Initial dissolved nutrient quanta per tile. */
  initNutPerTile: number;
  /** Initial seabed detritus quanta per bottom tile. */
  initDetSeabed: number;
  /** Sunlight intensity at y = 0 (0 = dark world). */
  lightIntensity: number;
  /** Enable real shadow casting & depth attenuation (false = NO_SHADOW control). */
  shadows: boolean;
  /** Enable gravity on cells & detritus sinking (false = NO_GRAVITY control). */
  gravity: boolean;
  /** Enable cell-cell bonding on division (false = NO_BONDS unicellular control). */
  bonds: boolean;
  /** Enable genome mutation on division. */
  mutation: boolean;
  /** Per-weight mutation probability on division. */
  mutRate: number;
  /** Max int8 delta per mutated weight. */
  mutStep: number;
  /** Base shading opacity per cell. */
  shadeBase: number;
  /** Additional shading opacity scaled by pigment. */
  shadePigment: number;
  /** Clear-water light attenuation per vertical strip. */
  waterAtten: number;
  /** Maximum live cells (safety cap; division stalls if reached). */
  maxCells: number;
  /** Maximum bonds per cell. */
  maxBondsPerCell: number;
  /** Soft cell radius in world units. */
  cellRadius: number;
  /** Mass threshold for cell division (quanta). */
  divMass: number;
  /** Minimum mass before cell death (quanta). */
  minMass: number;
  /** Energy threshold for division. */
  divEnergy: number;
  /** Energy cost to convert 1 nut quantum -> 1 mass quantum. */
  growEnergyCost: number;
  /** Photosynthesis energy gain multiplier. */
  kPhoto: number;
  /** Energy gained per quantum of detritus digested. */
  eDetritus: number;
  /** Base maintenance energy per step. */
  eMaintBase: number;
  /** Maintenance cost per unit pigment. */
  eMaintPigment: number;
  /** Maintenance cost per unit armor. */
  eMaintArmor: number;
  /** Maintenance cost per unit digest. */
  eMaintDigest: number;
  /** Maintenance cost per unit contractility. */
  eMaintContract: number;
  /** Max cell age before senescence hazard ramps up (steps). */
  senescenceAge: number;
  /** Background abiotic mineralization rate (det -> nut) per step. */
  kMineralize: number;
  /** Detritus sinking fraction per step (when gravity is on). */
  kSink: number;
  /** Nutrient diffusion rate per step. */
  kDiffNut: number;
  /** Enable Rung 2 mechanical contact grazing (false in Rung 0–1). */
  grazing: boolean;
  /** Enable Rung 2 contractile swimming & steering thrust (false in Rung 0–1). */
  swimming: boolean;
  /** Contact grazing rate multiplier (Rung 2). */
  kGraze: number;
  /** Energy gained per quantum of living biomass grazed (strictly < growEnergyCost). */
  eGraze: number;
  /** Contractile swimming thrust multiplier (Rung 2). */
  kSwim: number;
  /** Seed for deterministic PRNG. */
  seed: number;
}

export function defaultReefConfig(overrides: Partial<ReefConfig> = {}): ReefConfig {
  return {
    gw: 48,
    gh: 24,
    tileSize: 8,
    initNutPerTile: 3,
    initDetSeabed: 110,
    lightIntensity: 1.0,
    shadows: true,
    gravity: true,
    bonds: true,
    mutation: true,
    mutRate: 0.08,
    mutStep: 20,
    shadeBase: 0.05,
    shadePigment: 0.55,
    waterAtten: 0.032,
    maxCells: 1800,
    maxBondsPerCell: 4,
    cellRadius: 3.0,
    divMass: 24,
    minMass: 6,
    divEnergy: 8.0,
    growEnergyCost: 2.2,
    kPhoto: 1.55,
    eDetritus: 1.5,
    eMaintBase: 0.025,
    eMaintPigment: 0.035,
    eMaintArmor: 0.028,
    eMaintDigest: 0.03,
    eMaintContract: 0.03,
    senescenceAge: 5000,
    kMineralize: 0.003,
    kSink: 0.28,
    kDiffNut: 0.006,
    grazing: false,
    swimming: false,
    kGraze: 0.24,
    eGraze: 1.95,
    kSwim: 0.34,
    seed: 1,
    ...overrides,
  };
}

export interface ReefCell {
  id: number;
  lineageId: number;
  founderId: number;
  age: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  theta: number;
  omega: number;
  /** Conserved living biomass quanta (exact integer). */
  mass: number;
  /** Conserved internal unassimilated nutrient quanta (exact integer). */
  nut: number;
  /** Transient free energy pool. */
  energy: number;
  /** Local light received this step after shadows (0..1). */
  light: number;
  /** Expressed continuous traits in [0, 1] (divAngle in [-1, 1]). */
  pigment: number;
  armor: number;
  digest: number;
  anchor: number;
  contract: number;
  bondKeep: number;
  divAngle: number;
  /** Bond-diffused developmental morphogens in [0, 1]. */
  morph0: number;
  morph1: number;
  /** Target morphogen secretions from GRN. */
  morph0Target: number;
  morph1Target: number;
  /** Compact fixed-size GRN weights (102 int8 values). */
  genome: Int8Array;
  /** Current number of active bonds. */
  bondCount: number;
  /** Scratch flag for death cleanup. */
  dead: boolean;
  /** Cumulative energy earned via photosynthesis, detritivory, and grazing (observer-only diagnostics). */
  photoEarned: number;
  detEarned: number;
  grazeEarned: number;
}

export interface ReefBond {
  a: ReefCell;
  b: ReefCell;
  restLen: number;
  /** Rest angle of vector (a -> b) in cell a's local frame. */
  phiA: number;
  /** Rest angle of vector (b -> a) in cell b's local frame. */
  phiB: number;
  age: number;
}

/** Deterministic xorshift32 PRNG. */
class Rng {
  state: number;
  constructor(seed: number) {
    this.state = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0;
  }
  nextU32(): number {
    let x = this.state | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return x >>> 0;
  }
  nextFloat(): number {
    return this.nextU32() / 4294967296;
  }
  /** Exact unbiased stochastic rounding for non-negative x. */
  stochRound(x: number): number {
    if (x <= 0) return 0;
    const f = Math.floor(x);
    const frac = x - f;
    return frac > 0 && this.nextFloat() < frac ? f + 1 : f;
  }
}

export function wrapX(x: number, w: number): number {
  let r = x % w;
  if (r < 0) r += w;
  return r;
}

export function wrapDx(dx: number, w: number): number {
  const half = w * 0.5;
  if (dx > half) return dx - w;
  if (dx < -half) return dx + w;
  return dx;
}

export function wrapAngle(a: number): number {
  let r = (a + Math.PI) % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r - Math.PI;
}

function sigmoid(x: number): number {
  if (x > 12) return 1;
  if (x < -12) return 0;
  return 1 / (1 + Math.exp(-x));
}

function tanhClamped(x: number): number {
  if (x > 6) return 1;
  if (x < -6) return -1;
  return Math.tanh(x);
}

/**
 * Simple viable unicellular/facultative founder genome:
 * moderate pigment, low armor, mild digest & anchor, bondKeep near 0.45
 * so evolution can easily branch into unicellular, anchored stalks, or benthic decomposers.
 */
export function createFounderGenome(): Int8Array {
  const g = new Int8Array(GENOME_LEN);
  // Hidden unit 0 driven by bias (input 0) -> baseline expression
  g[0 * GRN_HID + 0] = 48;
  // Hidden unit 1 driven by light (input 1)
  g[1 * GRN_HID + 1] = 48;
  // Hidden unit 2 driven by onFloor (input 4)
  g[4 * GRN_HID + 2] = 48;
  // Hidden unit 3 driven by detEnv (input 3)
  g[3 * GRN_HID + 3] = 48;
  // Hidden unit 4 driven by morph0 (input 6)
  g[6 * GRN_HID + 4] = 32;
  // Hidden unit 5 driven by bondCount (input 5)
  g[5 * GRN_HID + 5] = 32;

  const outBase = GRN_IN * GRN_HID;
  // Outputs from hidden 0 (bias):
  // 0: pigment (~0.62)
  g[outBase + 0 * GRN_OUT + 0] = 20;
  // 1: armor (~0.25)
  g[outBase + 0 * GRN_OUT + 1] = -40;
  // 2: digest (~0.25)
  g[outBase + 0 * GRN_OUT + 2] = -40;
  // 3: anchor (~0.28)
  g[outBase + 0 * GRN_OUT + 3] = -36;
  // 4: morph0Out (~0.2)
  g[outBase + 0 * GRN_OUT + 4] = -48;
  // 5: morph1Out (~0.2)
  g[outBase + 0 * GRN_OUT + 5] = -48;
  // 6: bondKeep (~0.45, just below 0.5 threshold)
  g[outBase + 0 * GRN_OUT + 6] = -8;
  // 7: divAngle (~0 = upward)
  g[outBase + 0 * GRN_OUT + 7] = 0;
  // 8: contract (~0.15)
  g[outBase + 0 * GRN_OUT + 8] = -56;

  // Mild positive coupling from light -> pigment
  g[outBase + 1 * GRN_OUT + 0] = 16;
  // Mild positive coupling from detEnv -> digest
  g[outBase + 3 * GRN_OUT + 2] = 16;
  return g;
}

/**
 * Hand-built differentiated stalk genome for Rung 0 symplastic-bridge test:
 * - Touching floor (onFloor=1): high anchor, low pigment, keeps bonds, divides straight up.
 * - In sunlight (light>0.3): high pigment, stiff armor, keeps bonds, divides upward.
 */
export function createStalkTestGenome(): Int8Array {
  const g = new Int8Array(GENOME_LEN);
  g[0 * GRN_HID + 0] = 64; // bias
  g[1 * GRN_HID + 1] = 80; // light
  g[4 * GRN_HID + 2] = 80; // onFloor

  const outBase = GRN_IN * GRN_HID;
  // Baseline: moderate armor (0.55), keep bonds (0.85), divAngle 0 (up)
  g[outBase + 0 * GRN_OUT + 0] = -24; // low pigment in dark
  g[outBase + 0 * GRN_OUT + 1] = 12; // sturdy armor
  g[outBase + 0 * GRN_OUT + 2] = 0; // modest digest
  g[outBase + 0 * GRN_OUT + 3] = -48; // anchor off away from floor
  g[outBase + 0 * GRN_OUT + 6] = 64; // bondKeep > 0.5
  g[outBase + 0 * GRN_OUT + 7] = 0; // upward division

  // Light -> high pigment
  g[outBase + 1 * GRN_OUT + 0] = 96;
  // onFloor -> high anchor, high digest
  g[outBase + 2 * GRN_OUT + 3] = 110;
  g[outBase + 2 * GRN_OUT + 2] = 64;
  return g;
}

export class ReefWorld {
  readonly config: ReefConfig;
  readonly width: number;
  readonly height: number;
  readonly gw: number;
  readonly gh: number;
  readonly tileSize: number;

  /** Dissolved inorganic nutrients (exact integer quanta per tile). */
  readonly nut: Int32Array;
  /** Sinking organic detritus (exact integer quanta per tile). */
  readonly det: Int32Array;
  /** Tile-averaged light field (updated every step; used by renderer/observer). */
  readonly lightGrid: Float32Array;

  readonly cells: ReefCell[] = [];
  readonly bonds: ReefBond[] = [];

  stepCount = 0;
  nextCellId = 1;
  nextLineageId = 1;
  totalDivisions = 0;
  totalDeaths = 0;
  totalBondsBroken = 0;
  totalBites = 0;
  totalMassGrazed = 0;
  readonly initialMatter: number;

  private readonly rng: Rng;
  private readonly nutDelta: Int32Array;
  private readonly detDelta: Int32Array;
  private readonly nCols: number;
  private readonly nRows: number;
  private readonly rayLight: Float32Array;
  private readonly rowBuckets: ReefCell[][];
  private readonly hashBuckets: ReefCell[][];
  private readonly grnIn = new Float32Array(GRN_IN);
  private readonly grnHid = new Float32Array(GRN_HID);

  constructor(config: ReefConfig) {
    this.config = { ...config };
    this.gw = config.gw;
    this.gh = config.gh;
    this.tileSize = config.tileSize;
    this.width = this.gw * this.tileSize;
    this.height = this.gh * this.tileSize;

    const nTiles = this.gw * this.gh;
    this.nut = new Int32Array(nTiles);
    this.det = new Int32Array(nTiles);
    this.lightGrid = new Float32Array(nTiles);
    this.nutDelta = new Int32Array(nTiles);
    this.detDelta = new Int32Array(nTiles);

    this.nCols = this.gw * 2;
    this.nRows = this.gh * 2;
    this.rayLight = new Float32Array(this.nCols);
    this.rowBuckets = Array.from({ length: this.nRows }, () => []);
    this.hashBuckets = Array.from({ length: nTiles }, () => []);
    this.rng = new Rng(config.seed);

    let matter = 0;
    for (let ty = 0; ty < this.gh; ty++) {
      for (let tx = 0; tx < this.gw; tx++) {
        const idx = ty * this.gw + tx;
        this.nut[idx] = config.initNutPerTile;
        matter += config.initNutPerTile;
        if (ty === this.gh - 1) {
          this.det[idx] = config.initDetSeabed;
          matter += config.initDetSeabed;
        }
      }
    }
    this.initialMatter = matter;
  }

  /**
   * Seed a cell by drawing its mass & nut from the local tile's nutrient/detritus pool
   * (so total matter never changes!). If the local tile lacks quanta, draws from nearest seabed/water.
   */
  seedCell(
    x: number,
    y: number,
    genome: Int8Array,
    founderId: number,
    mass = 16,
    nut = 4,
    energy = 6.0,
  ): ReefCell | null {
    const needed = mass + nut;
    if (!this.withdrawMatter(x, y, needed)) return null;

    const wx = wrapX(x, this.width);
    const wy = Math.max(this.config.cellRadius, Math.min(this.height - this.config.cellRadius, y));
    const cell: ReefCell = {
      id: this.nextCellId++,
      lineageId: this.nextLineageId++,
      founderId,
      age: 0,
      x: wx,
      y: wy,
      vx: 0,
      vy: 0,
      theta: -Math.PI / 2, // pointing upward by default
      omega: 0,
      mass,
      nut,
      energy,
      light: this.config.lightIntensity,
      pigment: 0.5,
      armor: 0.2,
      digest: 0.2,
      anchor: 0.2,
      contract: 0.1,
      bondKeep: 0.45,
      divAngle: 0,
      morph0: 0,
      morph1: 0,
      morph0Target: 0,
      morph1Target: 0,
      genome: new Int8Array(genome),
      bondCount: 0,
      dead: false,
      photoEarned: 0,
      detEarned: 0,
      grazeEarned: 0,
    };
    this.cells.push(cell);
    this.evaluateGrn(cell, 1.0);
    return cell;
  }

  /** Create a mechanical spring-hinge bond between two existing cells. */
  addBond(a: ReefCell, b: ReefCell): ReefBond | null {
    if (a === b) return null;
    if (a.bondCount >= this.config.maxBondsPerCell || b.bondCount >= this.config.maxBondsPerCell) {
      return null;
    }
    const dx = wrapDx(b.x - a.x, this.width);
    const dy = b.y - a.y;
    const angAB = Math.atan2(dy, dx);
    const angBA = wrapAngle(angAB + Math.PI);
    const bond: ReefBond = {
      a,
      b,
      restLen: this.config.cellRadius * 2.02,
      phiA: wrapAngle(angAB - a.theta),
      phiB: wrapAngle(angBA - b.theta),
      age: 0,
    };
    this.bonds.push(bond);
    a.bondCount++;
    b.bondCount++;
    return bond;
  }

  /** Seed a default population of simple founders across the lower/mid water column. */
  seedDefaultFounders(count = 24): void {
    const base = createFounderGenome();
    for (let i = 0; i < count; i++) {
      const x = ((i + 0.5) / count) * this.width;
      const y = this.height - this.config.cellRadius * (1.2 + (i % 3) * 2.2);
      const g = new Int8Array(base);
      if (this.config.mutation) {
        // Small initial standing variation so founders aren't bit-identical clones
        for (let k = 0; k < 4; k++) {
          const idx = this.rng.nextU32() % GENOME_LEN;
          const delta = (this.rng.nextU32() % 21) - 10;
          g[idx] = Math.max(-127, Math.min(127, g[idx] + delta));
        }
      }
      this.seedCell(x, y, g, i + 1, 16, 4, 8.0);
    }
  }

  private withdrawMatter(x: number, y: number, amount: number): boolean {
    let rem = amount;
    const tx0 = this.tileX(x);
    const ty0 = this.tileY(y);
    const idx0 = ty0 * this.gw + tx0;

    // First try local tile nut, then local det
    const takeNut0 = Math.min(rem, this.nut[idx0]);
    this.nut[idx0] -= takeNut0;
    rem -= takeNut0;
    if (rem > 0) {
      const takeDet0 = Math.min(rem, this.det[idx0]);
      this.det[idx0] -= takeDet0;
      rem -= takeDet0;
    }
    if (rem === 0) return true;

    // Fallback: scan tiles deterministically to keep exact conservation
    const nTiles = this.gw * this.gh;
    for (let i = 0; i < nTiles && rem > 0; i++) {
      const idx = (idx0 + i) % nTiles;
      const tn = Math.min(rem, this.nut[idx]);
      this.nut[idx] -= tn;
      rem -= tn;
      if (rem > 0) {
        const td = Math.min(rem, this.det[idx]);
        this.det[idx] -= td;
        rem -= td;
      }
    }
    return rem === 0;
  }

  private tileX(x: number): number {
    const tx = Math.floor(wrapX(x, this.width) / this.tileSize);
    return tx >= this.gw ? this.gw - 1 : tx < 0 ? 0 : tx;
  }

  private tileY(y: number): number {
    const ty = Math.floor(y / this.tileSize);
    return ty >= this.gh ? this.gh - 1 : ty < 0 ? 0 : ty;
  }

  private tileIdx(x: number, y: number): number {
    return this.tileY(y) * this.gw + this.tileX(x);
  }

  /** Advance the simulation by one deterministic step. */
  step(): void {
    this.stepCount++;
    this.updateLightAndShadows();
    this.updateGrnsAndMorphogens();
    this.updateMechanics();
    this.updateMetabolismAndDivision();
    this.updateEnvironmentFields();
  }

  stepN(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /** 1. Directional sunlight + vertical raycast shadow sweep. */
  private updateLightAndShadows(): void {
    const { lightIntensity, shadows, shadeBase, shadePigment, waterAtten, cellRadius } = this.config;
    const nCols = this.nCols;
    const nRows = this.nRows;
    const colW = this.width / nCols;
    const rowH = this.height / nRows;

    if (!shadows || lightIntensity <= 0) {
      for (let i = 0; i < this.cells.length; i++) {
        this.cells[i].light = lightIntensity;
      }
      this.lightGrid.fill(lightIntensity);
      return;
    }

    // Clear row buckets
    for (let r = 0; r < nRows; r++) this.rowBuckets[r].length = 0;
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      let r = Math.floor(c.y / rowH);
      if (r < 0) r = 0;
      else if (r >= nRows) r = nRows - 1;
      this.rowBuckets[r].push(c);
    }

    this.rayLight.fill(lightIntensity);
    this.lightGrid.fill(0);

    for (let r = 0; r < nRows; r++) {
      const bucket = this.rowBuckets[r];
      // Record tile-averaged light before cell shading in this row
      const ty = r >> 1;
      for (let c = 0; c < nCols; c++) {
        this.lightGrid[ty * this.gw + (c >> 1)] += this.rayLight[c] * 0.25;
      }

      // First pass: cells read incoming light symmetrically
      for (let i = 0; i < bucket.length; i++) {
        const cell = bucket[i];
        const cLeft = Math.floor((cell.x - cellRadius) / colW);
        const cRight = Math.floor((cell.x + cellRadius) / colW);
        let sum = 0;
        let cnt = 0;
        for (let ci = cLeft; ci <= cRight; ci++) {
          const col = ((ci % nCols) + nCols) % nCols;
          sum += this.rayLight[col];
          cnt++;
        }
        cell.light = cnt > 0 ? sum / cnt : 0;
      }

      // Second pass: cells cast shadows onto rays passing below them
      for (let i = 0; i < bucket.length; i++) {
        const cell = bucket[i];
        const cLeft = Math.floor((cell.x - cellRadius) / colW);
        const cRight = Math.floor((cell.x + cellRadius) / colW);
        const opacity = Math.min(0.85, shadeBase + shadePigment * cell.pigment);
        const keep = 1 - opacity;
        for (let ci = cLeft; ci <= cRight; ci++) {
          const col = ((ci % nCols) + nCols) % nCols;
          this.rayLight[col] *= keep;
        }
      }

      // Gentle clear-water depth attenuation
      if (waterAtten > 0) {
        const wKeep = 1 - waterAtten;
        for (let c = 0; c < nCols; c++) this.rayLight[c] *= wKeep;
      }
    }
  }

  /** 2. Compact fixed-size GRN evaluation + bond-only morphogen diffusion. */
  private evaluateGrn(cell: ReefCell, blend: number): void {
    const idx = this.tileIdx(cell.x, cell.y);
    const onFloor = cell.y >= this.height - this.config.cellRadius - 2.5 ? 1.0 : 0.0;

    const inp = this.grnIn;
    inp[0] = 1.0;
    inp[1] = cell.light;
    inp[2] = Math.min(1.0, this.nut[idx] / 24.0);
    inp[3] = Math.min(1.0, this.det[idx] / 32.0);
    inp[4] = onFloor;
    inp[5] = Math.min(1.0, cell.bondCount / this.config.maxBondsPerCell);
    inp[6] = cell.morph0;
    inp[7] = cell.morph1;

    const g = cell.genome;
    const hid = this.grnHid;
    const scale = 1 / 32;

    for (let h = 0; h < GRN_HID; h++) {
      let sum = 0;
      for (let i = 0; i < GRN_IN; i++) {
        sum += inp[i] * (g[i * GRN_HID + h] * scale);
      }
      hid[h] = tanhClamped(sum);
    }

    const outBase = GRN_IN * GRN_HID;
    let o0 = 0, o1 = 0, o2 = 0, o3 = 0, o4 = 0, o5 = 0, o6 = 0, o7 = 0, o8 = 0;
    for (let h = 0; h < GRN_HID; h++) {
      const hv = hid[h];
      const row = outBase + h * GRN_OUT;
      o0 += hv * (g[row + 0] * scale);
      o1 += hv * (g[row + 1] * scale);
      o2 += hv * (g[row + 2] * scale);
      o3 += hv * (g[row + 3] * scale);
      o4 += hv * (g[row + 4] * scale);
      o5 += hv * (g[row + 5] * scale);
      o6 += hv * (g[row + 6] * scale);
      o7 += hv * (g[row + 7] * scale);
      o8 += hv * (g[row + 8] * scale);
    }

    const inv = 1 - blend;
    cell.pigment = inv * cell.pigment + blend * sigmoid(o0);
    cell.armor = inv * cell.armor + blend * sigmoid(o1);
    cell.digest = inv * cell.digest + blend * sigmoid(o2);
    cell.anchor = inv * cell.anchor + blend * sigmoid(o3);
    cell.morph0Target = sigmoid(o4);
    cell.morph1Target = sigmoid(o5);
    cell.bondKeep = inv * cell.bondKeep + blend * sigmoid(o6);
    cell.divAngle = inv * cell.divAngle + blend * tanhClamped(o7);
    cell.contract = inv * cell.contract + blend * sigmoid(o8);
  }

  private updateGrnsAndMorphogens(): void {
    const evalNow = (this.stepCount & 3) === 0;
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (evalNow) this.evaluateGrn(c, 0.25);
      // Local morphogen synthesis & gentle decay
      c.morph0 = c.morph0 * 0.92 + c.morph0Target * 0.08;
      c.morph1 = c.morph1 * 0.92 + c.morph1Target * 0.08;
    }

    // Morphogens diffuse ONLY along physical bonds (tissue signaling)
    const kDiff = 0.14;
    for (let i = 0; i < this.bonds.length; i++) {
      const b = this.bonds[i];
      const dm0 = (b.b.morph0 - b.a.morph0) * kDiff;
      const dm1 = (b.b.morph1 - b.a.morph1) * kDiff;
      b.a.morph0 += dm0;
      b.b.morph0 -= dm0;
      b.a.morph1 += dm1;
      b.b.morph1 -= dm1;
    }
  }

  /** Surface-receptor kin check (protects clonal siblings & same-body cells from immediate self-grazing). */
  private areKin(a: ReefCell, b: ReefCell): boolean {
    if (a.lineageId === b.lineageId) return true;
    const ga = a.genome;
    const gb = b.genome;
    let dist = 0;
    for (let i = 0; i < GENOME_LEN; i += 4) {
      dist += Math.abs(ga[i] - gb[i]);
      if (dist > 72) return false;
    }
    return true;
  }

  /** Finite cytoplasmic packing factor: pigment + digest + contract compete for internal cell volume. */
  private cytoScale(c: ReefCell): number {
    const load = c.pigment + c.digest + c.contract;
    return load > 1.0 ? 1.0 / load : 1.0;
  }

  /** Rung 2: Mechanical contact grazing (exact integer mass transfer, resisted by victim armor & tissue cohesion). */
  private tryGraze(attacker: ReefCell, victim: ReefCell): void {
    const effDig = attacker.digest * this.cytoScale(attacker);
    if (effDig <= 0.18 || victim.mass <= 0 || attacker.nut >= 24 || attacker.energy <= 0.2) {
      return;
    }
    // Armor + multicellular tissue cohesion (bonded interior stems resist micro-grazers; exposed tips are grazable)
    const cohesion = Math.min(0.45, victim.bondCount * 0.14);
    const defense = Math.min(0.95, 0.10 + 0.80 * victim.armor + cohesion);
    const rate = this.config.kGraze * effDig * Math.max(0, 1 - defense) * (1 - 0.45 * attacker.armor);
    if (rate <= 1e-4) return;
    const q = Math.min(2, victim.mass, 24 - attacker.nut, this.rng.stochRound(rate));
    if (q <= 0) return;

    victim.mass -= q;
    attacker.nut += q;
    const gain = q * this.config.eGraze;
    attacker.energy = Math.min(24.0, Math.max(0, attacker.energy + gain - 0.06));
    attacker.grazeEarned += gain;
    this.totalBites++;
    this.totalMassGrazed += q;
  }

  /** 3. Soft-body steric repulsion, gravity/buoyancy, seabed holdfast, spring-hinge bonds. */
  private updateMechanics(): void {
    const { width, height, gw, gh } = this;
    const R = this.config.cellRadius;
    const minDist = R * 2.0;
    const minDistSq = minDist * minDist;
    const nTiles = gw * gh;

    // Spatial hash build
    for (let i = 0; i < nTiles; i++) this.hashBuckets[i].length = 0;
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      const idx = this.tileIdx(c.x, c.y);
      this.hashBuckets[idx].push(c);
    }

    // Steric soft-body repulsion & Rung 2 mechanical contact grazing (pairwise across 3x3 neighbor tiles)
    const kRepel = 0.22;
    const doGraze = this.config.grazing;
    const grazeDistSq = (minDist * 1.18) * (minDist * 1.18);
    for (let i = 0; i < this.cells.length; i++) {
      const a = this.cells[i];
      const tx0 = this.tileX(a.x);
      const ty0 = this.tileY(a.y);

      for (let dty = -1; dty <= 1; dty++) {
        const ty = ty0 + dty;
        if (ty < 0 || ty >= gh) continue;
        for (let dtx = -1; dtx <= 1; dtx++) {
          const tx = (tx0 + dtx + gw) % gw;
          const bucket = this.hashBuckets[ty * gw + tx];
          for (let j = 0; j < bucket.length; j++) {
            const b = bucket[j];
            if (b.id <= a.id) continue;
            const dx = wrapDx(b.x - a.x, width);
            const dy = b.y - a.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < minDistSq) {
              if (d2 > 1e-6) {
                const dist = Math.sqrt(d2);
                const overlap = minDist - dist;
                const f = (kRepel * overlap) / dist;
                const fx = f * dx;
                const fy = f * dy;
                a.vx -= fx;
                a.vy -= fy;
                b.vx += fx;
                b.vy += fy;
              } else {
                // Deterministic tie-breaker for exact overlap
                const ang = ((a.id * 2654435761) & 255) * ((2 * Math.PI) / 256);
                const fx = Math.cos(ang) * 0.25;
                const fy = Math.sin(ang) * 0.25;
                a.vx -= fx;
                a.vy -= fy;
                b.vx += fx;
                b.vy += fy;
              }
            }
            if (doGraze && d2 < grazeDistSq && !this.areKin(a, b)) {
              this.tryGraze(a, b);
              this.tryGraze(b, a);
            }
          }
        }
      }
    }

    // Spring-hinge bond forces & rupture
    const kSpring = 0.32;
    const kBendBase = 0.24;
    const maxBondLen = R * 4.8;
    let writeBond = 0;

    for (let i = 0; i < this.bonds.length; i++) {
      const bond = this.bonds[i];
      bond.age++;
      const a = bond.a;
      const b = bond.b;
      const dx = wrapDx(b.x - a.x, width);
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);

      if (dist > maxBondLen || a.dead || b.dead) {
        a.bondCount--;
        b.bondCount--;
        this.totalBondsBroken++;
        continue;
      }

      if (dist > 1e-4) {
        const ux = dx / dist;
        const uy = dy / dist;
        // Axial spring
        const fs = kSpring * (dist - bond.restLen);
        a.vx += fs * ux;
        a.vy += fs * uy;
        b.vx -= fs * ux;
        b.vy -= fs * uy;

        // Angular / hinge stiffness scales strongly with armor (stiff stems stand upright!)
        const stiff = kBendBase * (0.12 + 0.88 * 0.5 * (a.armor + b.armor));
        let waveOffset = 0;
        if (this.config.swimming) {
          const avgCon = 0.5 * (a.contract + b.contract);
          if (avgCon > 0.15) {
            waveOffset = 0.32 * avgCon * Math.sin(this.stepCount * 0.16 + (a.id & 31) * 0.4);
          }
        }
        const angAB = Math.atan2(dy, dx);
        const errA = wrapAngle(angAB - (a.theta + bond.phiA + waveOffset));
        const angBA = wrapAngle(angAB + Math.PI);
        const errB = wrapAngle(angBA - (b.theta + bond.phiB - waveOffset));

        const tauA = stiff * errA;
        const tauB = stiff * errB;
        a.omega += tauA * 0.35;
        b.omega += tauB * 0.35;

        // Equal & opposite tangential restoring force perpendicular to bond
        const tx = -uy;
        const ty = ux;
        const fTan = (tauA + tauB) / Math.max(dist, R);
        a.vx += fTan * tx;
        a.vy += fTan * ty;
        b.vx -= fTan * tx;
        b.vy -= fTan * ty;
      }

      this.bonds[writeBond++] = bond;
    }
    this.bonds.length = writeBond;

    // Gravity, buoyancy, seabed holdfast, fluid drag & integration
    const hasGravity = this.config.gravity;
    const floorY = height - R;
    const ceilY = R;

    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      const cyto = this.cytoScale(c);
      const effPig = c.pigment * cyto;
      const effCon = c.contract * cyto;

      if (hasGravity) {
        // Dense/unbonded cells sink; bonded sunlit photosynthetic fronds gain pneumatocyst buoyancy (tall kelp towers!)
        let grav = 0.015 + 0.012 * c.armor + 0.004 * c.pigment;
        if (c.bondCount > 0 && effPig > 0.25 && c.light > 0.08) {
          const buoy = 0.055 * effPig * c.light * (1 - 0.55 * c.armor);
          grav -= buoy;
        }
        c.vy += grav;
      }

      // Gentle stochastic Brownian/micro-current jitter
      const jx = (this.rng.nextFloat() - 0.5) * 0.04;
      const jy = (this.rng.nextFloat() - 0.5) * 0.04;
      c.vx += jx;
      c.vy += jy;

      // Rung 2: Contractile swimming & steering thrust (effCon^1.65: phototrophs sink into kelp, dedicated grazers cruise freely)
      if (this.config.swimming && effCon > 0.14 && c.energy > 0.5) {
        const agility = (1 - 0.70 * c.armor) * (1 - 0.85 * c.anchor);
        const drive = Math.pow(effCon, 1.65);
        const thrust = this.config.kSwim * drive * agility;
        if (thrust > 1e-4) {
          c.vx += Math.cos(c.theta) * thrust;
          c.vy += Math.sin(c.theta) * thrust;
          c.omega += 0.065 * effCon * c.divAngle;
          // Active propulsion burns ATP proportional to power output
          c.energy = Math.max(0, c.energy - 0.10 * drive * agility);
        }
      }

      // Fluid drag (overdamped Stokes regime)
      let drag = 0.72;
      let rotDrag = 0.65;
      // Seabed holdfast adhesion & elastic substrate anchoring torque
      if (c.y >= floorY - 2.0 && c.anchor > 0.05) {
        const hold = c.anchor;
        drag *= 1 - 0.82 * hold;
        rotDrag *= 1 - 0.85 * hold;
        if (hasGravity) {
          c.vy += 0.05 * hold;
          const uprightErr = wrapAngle(-Math.PI / 2 - c.theta);
          c.omega += 0.08 * hold * (0.2 + 0.8 * c.armor) * uprightErr;
        }
      }

      c.vx *= drag;
      c.vy *= drag;
      c.omega *= rotDrag;

      // Clamp max displacement per step for rock-solid numerical stability
      const speed = Math.hypot(c.vx, c.vy);
      if (speed > 1.8) {
        const s = 1.8 / speed;
        c.vx *= s;
        c.vy *= s;
      }
      if (c.omega > 0.25) c.omega = 0.25;
      else if (c.omega < -0.25) c.omega = -0.25;

      c.x = wrapX(c.x + c.vx, width);
      c.y += c.vy;
      c.theta = wrapAngle(c.theta + c.omega);

      if (c.y < ceilY) {
        c.y = ceilY;
        if (c.vy < 0) c.vy = -c.vy * 0.3;
        // Reflect swimmer heading downward off the water surface instead of stalling on the ceiling
        if (this.config.swimming && c.bondCount === 0 && Math.sin(c.theta) < 0) {
          c.theta = wrapAngle(-c.theta + (this.rng.nextFloat() - 0.5) * 0.5);
        }
      } else if (c.y > floorY) {
        c.y = floorY;
        if (c.vy > 0) c.vy = 0;
        if (this.config.swimming && c.bondCount === 0 && c.anchor < 0.3 && Math.sin(c.theta) > 0) {
          c.theta = wrapAngle(-c.theta + (this.rng.nextFloat() - 0.5) * 0.5);
        }
      }
    }
  }

  /** 4. Symplastic bond transport, photosynthesis, detritivory, uptake, growth, division, death. */
  private updateMetabolismAndDivision(): void {
    const cfg = this.config;

    // 4a. Symplastic transport along bonds (nut moves down nut gradient, energy down energy gradient)
    for (let i = 0; i < this.bonds.length; i++) {
      const bond = this.bonds[i];
      const a = bond.a;
      const b = bond.b;

      // Exact integer nut exchange (roots pump nut up to sunlit leaves!)
      const nutDiff = a.nut - b.nut;
      if (nutDiff >= 2) {
        const q = Math.min(3, nutDiff >> 1);
        a.nut -= q;
        b.nut += q;
      } else if (nutDiff <= -2) {
        const q = Math.min(3, (-nutDiff) >> 1);
        b.nut -= q;
        a.nut += q;
      } else if (nutDiff === 1 && this.rng.nextFloat() < 0.35) {
        a.nut -= 1;
        b.nut += 1;
      } else if (nutDiff === -1 && this.rng.nextFloat() < 0.35) {
        b.nut -= 1;
        a.nut += 1;
      }

      // Free energy sharing (sunlit leaves pump energy down to dark roots!)
      const dE = (a.energy - b.energy) * 0.32;
      a.energy -= dE;
      b.energy += dE;
    }

    // 4b. Per-cell metabolism, growth, division, death
    const newborns: ReefCell[] = [];
    const newBonds: [ReefCell, ReefCell][] = [];

    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      c.age++;
      const idx = this.tileIdx(c.x, c.y);
      const armorPenalty = 1 - 0.55 * c.armor;
      const cyto = this.cytoScale(c);
      const effPig = c.pigment * cyto;
      const effDig = c.digest * cyto;

      // Photosynthesis (open energy input from directional light)
      if (c.light > 0 && effPig > 0.01) {
        const dEp = cfg.kPhoto * c.light * effPig * armorPenalty;
        c.energy += dEp;
        c.photoEarned += dEp;
      }

      // Detritivory / decomposition (converts local det -> cell.nut + energy, exact integer)
      if (this.det[idx] > 0 && effDig > 0.05 && c.nut < 24) {
        const rate = 0.14 * effDig * armorPenalty;
        const maxTake = Math.min(2, this.det[idx], 24 - c.nut);
        const q = Math.min(maxTake, this.rng.stochRound(this.det[idx] * rate));
        if (q > 0) {
          this.det[idx] -= q;
          c.nut += q;
          const dEd = q * cfg.eDetritus;
          c.energy += dEd;
          c.detEarned += dEd;
        }
      }

      // Dissolved nutrient uptake (nut[idx] -> cell.nut, boosted by anchor/root expression)
      if (this.nut[idx] > 0 && c.nut < 24) {
        const rootBoost = 1 + 0.8 * c.anchor;
        const rate = 0.08 * armorPenalty * rootBoost;
        const maxTake = Math.min(2, this.nut[idx], 24 - c.nut);
        const q = Math.min(maxTake, this.rng.stochRound(this.nut[idx] * rate));
        if (q > 0) {
          this.nut[idx] -= q;
          c.nut += q;
        }
      }

      // Maintenance & dissipation (thermodynamic anti-cheat)
      const maint =
        cfg.eMaintBase +
        cfg.eMaintPigment * c.pigment +
        cfg.eMaintArmor * c.armor +
        cfg.eMaintDigest * c.digest +
        cfg.eMaintContract * c.contract;
      c.energy = Math.min(24.0, c.energy - maint);

      // Growth: convert internal nut -> living mass
      if (c.energy >= cfg.growEnergyCost && c.nut >= 1 && c.mass < cfg.divMass + 4) {
        c.nut -= 1;
        c.mass += 1;
        c.energy -= cfg.growEnergyCost;
      }

      // Starvation catabolism (mass -> det)
      if (c.energy <= 0) {
        c.energy = 0;
        if (c.mass > 0) {
          c.mass -= 1;
          this.det[idx] += 1;
          c.energy += 0.35; // small catabolic yield, still net dissipative
        }
      }

      // Gentle senescence hazard after senescenceAge (prevents immortal frozen reefs)
      let senescentDeath = false;
      if (c.age > cfg.senescenceAge) {
        const excess = (c.age - cfg.senescenceAge) / 2000;
        if (this.rng.nextFloat() < Math.min(0.05, 0.0008 + 0.002 * excess)) {
          senescentDeath = true;
        }
      }

      // Death: exact conservation dump into local tile
      if (c.mass < cfg.minMass || senescentDeath) {
        this.det[idx] += c.mass;
        this.nut[idx] += c.nut;
        c.mass = 0;
        c.nut = 0;
        c.dead = true;
        this.totalDeaths++;
        continue;
      }

      // Mechanical division (no fitness function; triggered purely by mass & energy threshold)
      if (
        c.mass >= cfg.divMass &&
        c.energy >= cfg.divEnergy &&
        this.cells.length + newborns.length < cfg.maxCells
      ) {
        const childMass = c.mass >> 1;
        const childNut = c.nut >> 1;
        c.mass -= childMass;
        c.nut -= childNut;
        const childEnergy = c.energy * 0.45;
        c.energy *= 0.45; // 10% lost to division heat

        // Division angle relative to upward axis (-PI/2) or parent orientation
        const baseAngle = c.bondCount > 0 ? c.theta : -Math.PI / 2;
        const angle = wrapAngle(baseAngle + c.divAngle * Math.PI * 0.75);
        const sep = cfg.cellRadius * 1.95;
        const cx = wrapX(c.x + Math.cos(angle) * sep, this.width);
        const cy = Math.max(
          cfg.cellRadius,
          Math.min(this.height - cfg.cellRadius, c.y + Math.sin(angle) * sep),
        );

        const childGenome = new Int8Array(c.genome);
        let childLineage = c.lineageId;
        if (cfg.mutation) {
          let mutated = false;
          for (let w = 0; w < GENOME_LEN; w++) {
            if (this.rng.nextFloat() < cfg.mutRate) {
              let delta = (this.rng.nextU32() % (2 * cfg.mutStep + 1)) - cfg.mutStep;
              if (delta === 0) delta = 1;
              const nv = Math.max(-127, Math.min(127, childGenome[w] + delta));
              if (nv !== childGenome[w]) {
                childGenome[w] = nv;
                mutated = true;
              }
            }
          }
          if (mutated) childLineage = this.nextLineageId++;
        }

        const child: ReefCell = {
          id: this.nextCellId++,
          lineageId: childLineage,
          founderId: c.founderId,
          age: 0,
          x: cx,
          y: cy,
          vx: c.vx * 0.5,
          vy: c.vy * 0.5,
          theta: angle,
          omega: 0,
          mass: childMass,
          nut: childNut,
          energy: childEnergy,
          light: c.light,
          pigment: c.pigment,
          armor: c.armor,
          digest: c.digest,
          anchor: c.anchor,
          contract: c.contract,
          bondKeep: c.bondKeep,
          divAngle: c.divAngle,
          morph0: c.morph0,
          morph1: c.morph1,
          morph0Target: c.morph0Target,
          morph1Target: c.morph1Target,
          genome: childGenome,
          bondCount: 0,
          dead: false,
          photoEarned: 0,
          detEarned: 0,
          grazeEarned: 0,
        };
        newborns.push(child);
        this.totalDivisions++;

        if (cfg.bonds && c.bondKeep > 0.5 && c.bondCount < cfg.maxBondsPerCell) {
          newBonds.push([c, child]);
        }
      }
    }

    // Compact dead cells & prune bonds attached to dead cells
    if (this.totalDeaths > 0) {
      let writeCell = 0;
      for (let i = 0; i < this.cells.length; i++) {
        if (!this.cells[i].dead) this.cells[writeCell++] = this.cells[i];
      }
      if (writeCell !== this.cells.length) {
        this.cells.length = writeCell;
        let writeBond = 0;
        for (let i = 0; i < this.bonds.length; i++) {
          const b = this.bonds[i];
          if (b.a.dead || b.b.dead) {
            if (!b.a.dead) b.a.bondCount--;
            if (!b.b.dead) b.b.bondCount--;
            this.totalBondsBroken++;
          } else {
            this.bonds[writeBond++] = b;
          }
        }
        this.bonds.length = writeBond;
      }
    }

    // Add newborns & their bonds
    for (let i = 0; i < newborns.length; i++) {
      this.cells.push(newborns[i]);
    }
    for (let i = 0; i < newBonds.length; i++) {
      this.addBond(newBonds[i][0], newBonds[i][1]);
    }
  }

  /** 5. Exact integer sinking, diffusion & abiotic mineralization of nut/det fields. */
  private updateEnvironmentFields(): void {
    const { gw, gh } = this;
    const { gravity, kSink, kDiffNut, kMineralize } = this.config;

    // 5a. Detritus sinking (bottom-up exact integer transfer) OR isotropic diffusion in NO_GRAVITY
    if (gravity) {
      for (let ty = gh - 2; ty >= 0; ty--) {
        const row = ty * gw;
        const below = (ty + 1) * gw;
        for (let tx = 0; tx < gw; tx++) {
          const d = this.det[row + tx];
          if (d > 0) {
            const q = Math.min(d, this.rng.stochRound(d * kSink));
            this.det[row + tx] -= q;
            this.det[below + tx] += q;
          }
        }
      }
    } else {
      this.diffuseFieldExact(this.det, this.detDelta, kDiffNut);
    }

    // 5b. Dissolved nutrient 2D diffusion (exact integer pairwise flux)
    this.diffuseFieldExact(this.nut, this.nutDelta, kDiffNut);

    // 5c. Abiotic mineralization (det -> nut, slightly faster on seabed)
    for (let ty = 0; ty < gh; ty++) {
      const rate = ty === gh - 1 ? kMineralize * 1.6 : kMineralize;
      const row = ty * gw;
      for (let tx = 0; tx < gw; tx++) {
        const idx = row + tx;
        const d = this.det[idx];
        if (d > 0) {
          const q = Math.min(d, this.rng.stochRound(d * rate));
          this.det[idx] -= q;
          this.nut[idx] += q;
        }
      }
    }
  }

  /** Exact integer conservative diffusion on a periodic-x, clamped-y grid. */
  private diffuseFieldExact(field: Int32Array, delta: Int32Array, rate: number): void {
    const { gw, gh } = this;
    delta.fill(0);

    // Each tile allocates at most 1/4 of its stock to each of its 4 neighbors -> strictly non-negative!
    const perDir = Math.min(0.24, rate);
    for (let ty = 0; ty < gh; ty++) {
      const row = ty * gw;
      for (let tx = 0; tx < gw; tx++) {
        const idx = row + tx;
        const val = field[idx];
        if (val <= 0) continue;

        let out = 0;
        const qL = this.rng.stochRound(val * perDir);
        const qR = this.rng.stochRound(val * perDir);
        const qU = ty > 0 ? this.rng.stochRound(val * perDir) : 0;
        const qD = ty < gh - 1 ? this.rng.stochRound(val * perDir) : 0;

        // Clamp total outflow strictly <= val
        let sum = qL + qR + qU + qD;
        if (sum > val) {
          // Deterministic trim from largest
          const scale = val / sum;
          const cL = Math.floor(qL * scale);
          const cR = Math.floor(qR * scale);
          const cU = Math.floor(qU * scale);
          const cD = Math.floor(qD * scale);
          const leftIdx = row + ((tx - 1 + gw) % gw);
          const rightIdx = row + ((tx + 1) % gw);
          delta[leftIdx] += cL;
          delta[rightIdx] += cR;
          if (ty > 0) delta[idx - gw] += cU;
          if (ty < gh - 1) delta[idx + gw] += cD;
          out = cL + cR + cU + cD;
        } else {
          const leftIdx = row + ((tx - 1 + gw) % gw);
          const rightIdx = row + ((tx + 1) % gw);
          delta[leftIdx] += qL;
          delta[rightIdx] += qR;
          if (ty > 0) delta[idx - gw] += qU;
          if (ty < gh - 1) delta[idx + gw] += qD;
          out = sum;
        }
        delta[idx] -= out;
      }
    }

    for (let i = 0; i < field.length; i++) {
      field[i] += delta[i];
    }
  }
}
