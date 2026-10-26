/** Engineered toy ecology; deliberately separate from the conserved 3D research kernel. */
export const RULES = { version: 4, size: 96, resourceCap: 8, renewal: 1.2, uptake: 2.4,
  baseCost: 0.45, attackCost: 0.25, defenseCost: 0.35, birthThreshold: 10,
  maxAge: 160, mutationRate: 0.04, predationFood: 3, introductionSize: 24 } as const;
export const REFUGES = [[0.28, 0.35, 0.13], [0.73, 0.68, 0.13]] as const;
export const FAMILIES = ["Jade", "Amber", "Violet", "Protected", "Hunter"];
export const COLORS = ["#65d6a0", "#efb75c", "#ab98ed", "#6dd9ed", "#f18599"];
export interface Cell { family: number; attack: number; defense: number; energy: number; age: number; born: number }
export interface Sample { tick: number; counts: number[]; population: number; attack: number; defense: number; classes: number; diversity: number; births: number; deaths: number; mutations: number }
export interface Notice { tick: number; text: string }
export interface Drought { x: number; y: number; radius: number; until: number }
function streamSeed(seed: number, channel: number): number {
  let x = (Math.imul(seed, 0x9e3779b1) + Math.imul(channel, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ x >>> 16, 0x7feb352d); x = Math.imul(x ^ x >>> 15, 0x846ca68b);
  return (x ^ x >>> 16) >>> 0;
}
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function upkeep(cell: Pick<Cell, "attack" | "defense">): number {
  return RULES.baseCost + cell.attack * RULES.attackCost + cell.defense * RULES.defenseCost;
}
export function canAttack(a: number, b: number): boolean {
  return [[1], [2, 4], [0, 3], [1], [3]][a]?.includes(b) ?? false;
}
export function attackChance(a: Cell, b: Cell, refuge: boolean): number {
  // Engineered immunity: the founding predator cannot breach strong protection.
  if (a.family === 2 && b.family === 3 && b.defense >= 2) return 0;
  return Math.max(0.03, Math.min(0.9, 0.35 + 0.16 * (a.attack - b.defense))) * (refuge ? 0.25 : 1);
}
export class Ecosystem {
  readonly size: number;
  readonly seed: number;
  readonly cells: (Cell | null)[];
  readonly food: Float64Array;
  readonly fertility: Float64Array;
  readonly refuge: Uint8Array;
  private readonly order: Uint32Array;
  private readonly schedule: () => number;
  private readonly birthRandom: () => number;
  private readonly combat: () => number;
  private readonly weatherRandom: () => number;
  private readonly introduction: () => number;
  tick = 0;
  mutation = true;
  weather = true;
  readonly staged: boolean;
  introduced = [false, false];
  births = 0; deaths = 0; mutations = 0;
  notices: Notice[] = [];
  history: Sample[] = [];
  droppedNotices = 0; droppedSamples = 0;
  drought: Drought | null = null;
  private priorCounts = [0, 0, 0, 0, 0];
  private peaks = [0, 0, 0, 0, 0];
  private depleted = [false, false, false, false, false];
  constructor(seed = 1101, size = RULES.size as number, staged = true) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Seed must be an integer from 0 to 4294967295");
    if (!Number.isInteger(size) || size < 16 || size > 128) throw new Error("Size must be 16–128");
    this.seed = seed; this.size = size; this.staged = staged;
    this.schedule = rng(streamSeed(seed, 1)); this.birthRandom = rng(streamSeed(seed, 2)); this.combat = rng(streamSeed(seed, 3));
    this.weatherRandom = rng(streamSeed(seed, 4)); this.introduction = rng(streamSeed(seed, 5));
    const initial = rng(streamSeed(seed, 6)), n = size * size;
    this.cells = Array(n).fill(null); this.food = new Float64Array(n); this.fertility = new Float64Array(n);
    this.refuge = new Uint8Array(n); this.order = Uint32Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < n; i++) {
      const x = i % size, y = Math.floor(i / size);
      this.fertility[i] = 1 + 0.55 * Math.sin(x / size * Math.PI * 4) * Math.cos(y / size * Math.PI * 4);
      this.refuge[i] = Number(REFUGES.some(([cx, cy, radius]) => this.distance(x, y, size * cx, size * cy) < size * radius));
      this.food[i] = 4;
      if (initial() < 0.55) this.cells[i] = { family: Math.floor(x / size * 3), attack: 2, defense: 1, energy: 4 + initial() * 8, age: Math.floor(initial() * 80), born: -1 };
    }
    this.note("World planted: three cyclic families. Food regrows from an external supply."); this.sample();
  }
  private distance(x: number, y: number, cx: number, cy: number): number {
    const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
    return Math.hypot(Math.min(dx, this.size - dx), Math.min(dy, this.size - dy));
  }
  note(text: string): void {
    this.notices.push({ tick: this.tick, text });
    if (this.notices.length > 100) { this.notices.shift(); this.droppedNotices++; }
  }
  setOption(key: "mutation" | "weather", value: boolean): void {
    this[key] = value; this.note(`${key === "mutation" ? "Mutation" : "Automatic weather"} ${value ? "on" : "off"} (manual).`);
  }
  renewalAt(i: number): number {
    const d = this.drought;
    return RULES.renewal * this.fertility[i] * (d && this.tick < d.until && this.distance(i % this.size, Math.floor(i / this.size), d.x, d.y) < d.radius ? 0.08 : 1);
  }
  dry(manual = true): void {
    if (this.drought) this.note("Earlier drought replaced by a new dry patch.");
    this.drought = { x: this.weatherRandom() * this.size, y: this.weatherRandom() * this.size, radius: this.size * 0.18, until: this.tick + 120 };
    this.note(`${manual ? "Manual" : "Seasonal"} drought: one patch, 120 ticks. Food renewal slows; no cells are directly killed.`);
  }
  introduce(family: 3 | 4, manual = false): void {
    const index = family - 3;
    if (!manual && this.introduced[index]) return;
    this.introduced[index] = true;
    let center = Math.floor(this.size * 0.35) * this.size + Math.floor(this.size * 0.28);
    if (family === 3) {
      // Plant at a rich Amber frontier so the protected lineage can feed and spread.
      let best = -Infinity;
      for (let i = 0; i < this.cells.length; i++) if (this.cells[i]?.family === 1 && this.fertility[i] > best) { best = this.fertility[i]; center = i; }
    }
    if (family === 4) { const protectedSites = this.cells.flatMap((c, i) => c?.family === 3 ? [i] : []); if (protectedSites.length) center = protectedSites[Math.floor(this.introduction() * protectedSites.length)]; }
    const targets = new Set<number>();
    while (targets.size < RULES.introductionSize) {
      const x = ((center % this.size) + Math.floor(this.introduction() * 9) - 4 + this.size) % this.size;
      const y = (Math.floor(center / this.size) + Math.floor(this.introduction() * 9) - 4 + this.size) % this.size;
      targets.add(y * this.size + x);
    }
    for (const i of targets) {
      if (this.cells[i]) this.deaths++;
      this.cells[i] = { family, attack: family === 3 ? 1 : 4, defense: family === 3 ? 3 : 0, energy: 20, age: 0, born: this.tick };
    }
    // An introduction is not a spontaneous recovery from low numbers.
    this.depleted[family] = false;
    this.peaks[family] = this.cells.filter(c => c?.family === family).length;
    this.note(`${manual ? "Manual" : "Staged"} introduction: 24 ${FAMILIES[family]} cells planted; occupants replaced, energy supplied.`);
  }
  private offspring(parent: Cell): Cell {
    const child = { ...parent, age: 0, born: this.tick };
    // Always consume the same trait draws, including when mutation is off.
    const roll = this.birthRandom(), trait = this.birthRandom() < 0.5 ? "attack" : "defense", delta = this.birthRandom() < 0.5 ? -1 : 1;
    if (this.mutation && roll < RULES.mutationRate) {
      let value = child[trait] + delta;
      if (value < 0) value = 1; if (value > 4) value = 3;
      child[trait] = value; this.mutations++;
    }
    parent.energy /= 2; child.energy = parent.energy; this.births++;
    return child;
  }
  step(): void {
    this.tick++;
    if (this.staged && this.tick === 100) this.introduce(3);
    if (this.staged && this.tick === 300) this.introduce(4);
    if (this.drought && this.tick >= this.drought.until) { this.drought = null; this.note("Rain returns: drought patch begins refilling."); }
    if (this.weather && this.tick % 500 === 0) this.dry(false);
    for (let i = 0; i < this.cells.length; i++) this.food[i] = Math.min(RULES.resourceCap, this.food[i] + this.renewalAt(i));
    for (let k = this.order.length - 1; k > 0; k--) {
      const j = Math.floor(this.schedule() * (k + 1)); [this.order[k], this.order[j]] = [this.order[j], this.order[k]];
    }
    const acted = new Set<Cell>();
    for (const i of this.order) {
      const c = this.cells[i];
      if (!c || c.born === this.tick || acted.has(c)) continue;
      acted.add(c);
      const meal = Math.min(RULES.uptake, this.food[i]); this.food[i] -= meal;
      c.energy = Math.min(24, c.energy + meal - upkeep(c)); c.age++;
      if (c.energy <= 0 || c.age > RULES.maxAge) { this.cells[i] = null; this.deaths++; continue; }
      const direction = Math.floor(this.schedule() * 8);
      const dx = [-1, 0, 1, -1, 1, -1, 0, 1][direction], dy = [-1, -1, -1, 0, 0, 1, 1, 1][direction];
      const j = ((Math.floor(i / this.size) + dy + this.size) % this.size) * this.size + ((i % this.size + dx + this.size) % this.size);
      const other = this.cells[j];
      if (!other) {
        if (c.energy >= RULES.birthThreshold) this.cells[j] = this.offspring(c);
        else if (this.schedule() < 0.3) { this.cells[j] = c; this.cells[i] = null; }
      } else if (other.born !== this.tick && canAttack(c.family, other.family) && this.combat() < attackChance(c, other, !!this.refuge[j])) {
        c.energy = Math.min(24, c.energy + RULES.predationFood);
        this.cells[j] = this.offspring(c); this.deaths++;
      }
    }
    if (this.tick % 10 === 0) this.sample();
  }
  census(): Sample {
    const counts = [0, 0, 0, 0, 0], traits = new Map<string, number>(); let attack = 0, defense = 0, population = 0;
    for (const c of this.cells) if (c) {
      counts[c.family]++; attack += c.attack; defense += c.defense; population++;
      const key = `${c.family}:${c.attack}:${c.defense}`; traits.set(key, (traits.get(key) ?? 0) + 1);
    }
    let diversity = 0; for (const count of traits.values()) { const p = count / population; diversity -= p * Math.log(p); }
    return { tick: this.tick, counts, population, attack: population ? attack / population : 0, defense: population ? defense / population : 0, classes: traits.size, diversity, births: this.births, deaths: this.deaths, mutations: this.mutations };
  }
  sample(): Sample {
    const s = this.census(), counts = s.counts;
    for (let f = 0; f < 5; f++) {
      if (!counts[f] && this.priorCounts[f]) this.note(`${FAMILIES[f]} disappeared (census). No automatic rescue.`);
      if (counts[f] > 0 && this.peaks[f] > 100 && counts[f] < this.peaks[f] * 0.2) this.depleted[f] = true;
      if (this.depleted[f] && counts[f] > this.peaks[f] * 0.5) { this.note(`${FAMILIES[f]} recovered from below 20% to above 50% of its earlier peak.`); this.depleted[f] = false; }
      this.peaks[f] = Math.max(this.peaks[f], counts[f]);
    }
    this.priorCounts = counts;
    if (this.history.at(-1)?.tick === this.tick) this.history.pop();
    this.history.push(s); if (this.history.length > 300) { this.history.shift(); this.droppedSamples++; }
    return s;
  }
  exportSnapshot(): object {
    return { format: "engineered-ecosystem-observation-v1", rules: RULES, seed: this.seed, size: this.size, tick: this.tick,
      settings: { mutation: this.mutation, weather: this.weather, staged: this.staged },
      note: "Observation snapshot, not replay/checkpoint. Same seed and unchanged controls reproduce a reset trajectory in the same browser. This model is not the Candidate 9 kernel.",
      retention: { sampleLimit: 300, noticeLimit: 100, droppedSamples: this.droppedSamples, droppedNotices: this.droppedNotices },
      current: this.census(), history: this.history, notices: this.notices, cells: this.cells, food: Array.from(this.food), drought: this.drought };
  }
}
