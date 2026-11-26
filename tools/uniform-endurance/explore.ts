#!/usr/bin/env node
/** Frozen, replayable uniform-food longevity screen. Importing this module never starts a run. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  HungryWorld, RULES, type DevelopmentCensus, type DevelopmentGenome, type DevelopmentLineageNode,
  type DevelopmentOrganism, type DevelopmentSnapshot, type FoodMode, type HungryEnvironment,
} from '../../apps/lab/src/uniform-endurance/model.ts';

type Obj = Record<string, any>;
export type UniformEnduranceTickRow = { tick: number; population: number; cells: number; births: number; deaths: number; blockedCap: number;
  blockedSpace: number; cap48: boolean; nearCap47: boolean };
export type UniformEnduranceFrame = { tick: number; censusSha256: string; stateSha256: string; normalizedStateSha256: string|null;
  normalizedFrameSha256: string|null; foodBase64: string;
  cells: [number, number][]; organisms: { id: number; family: number; genome: DevelopmentGenome }[];
  ledger: DevelopmentSnapshot['ledger']; frameSha256: string };
export type UniformEnduranceSample = { tick: number; census: DevelopmentCensus; environment: HungryEnvironment; censusSha256: string;
  stateSha256: string; normalizedStateSha256: string|null; frameSha256: string };
export type UniformEnduranceSnapshot = { tick: number; terminal: boolean; environment: HungryEnvironment; state: DevelopmentSnapshot; stateSha256: string };
type TickRow=UniformEnduranceTickRow;type Frame=UniformEnduranceFrame;type Sample=UniformEnduranceSample;type SnapshotRecord=UniformEnduranceSnapshot;
export type UniformEnduranceEvidence = {
  schemaVersion: 1; kind: 'hungry-shapes-uniform-endurance';
  run: { seed: 1201|1202|1203; mode: 'uniform'; mutation: true; maxTick: 9000; finalTick: number; extinctionTick: number|null };
  runtime: { node: string; platform: string; arch: string }; rules: typeof RULES;
  provenance: { sourceSha256: Record<string,string>; priorArtifactSha256: string; priorDataSha256: string;
    prefix: { status: 'verified'; seed: number; normalization: string; comparedSamples: number; comparedFrames: number;
      comparedTickRows: number; comparedSnapshots: number; checkpoints: {tick:number;normalizedStateSha256:string;compared:true}[] } };
  samples: UniformEnduranceSample[]; tickRows: UniformEnduranceTickRow[]; frames: UniformEnduranceFrame[]; snapshots: UniformEnduranceSnapshot[];
  windows: Obj[]; final: Obj; repeat: Obj; numericalGate: Obj; dataSha256: string;
};

export const MAX_TICK = 9000;
export const SAMPLE_EVERY = 20;
export const FRAME_EVERY = 20;
export const WINDOWS = Object.freeze([
  Object.freeze({ from: 5501, to: 6000 }), Object.freeze({ from: 6501, to: 7000 }),
  Object.freeze({ from: 7501, to: 8000 }), Object.freeze({ from: 8501, to: 9000 }),
]);
export const FIXED_SNAPSHOTS = Object.freeze([0, 6000, 7000, 8000, 9000]);
const NODE_VERSION = '24.2.0';
const PREFIX_END = 6000;
const PREFIX_SAMPLE_COUNT = 301;
const PREFIX_FRAME_COUNT = 301;
const PREFIX_TICKROW_COUNT = 6000;
const OLD_CHECKPOINT_TICKS = Object.freeze([0, 3000, 4000, 5000, 6000]);
const MAX_ARTIFACT_BYTES = 24 * 1024 * 1024;
const JSON_URL = (seed: number) => new URL(`../../docs/creative-prototypes/uniform-endurance-seed-${seed}.json`, import.meta.url);
const MD_URL = (seed: number) => new URL(`../../docs/creative-prototypes/uniform-endurance-seed-${seed}.md`, import.meta.url);
const PRIOR_JSON_URL = (seed:number) => new URL(`../../docs/creative-prototypes/uniform-food-seed-${seed}.json`, import.meta.url);
const PRIOR_MD_URL = (seed:number) => new URL(`../../docs/creative-prototypes/uniform-food-seed-${seed}.md`, import.meta.url);
const BASE_MODEL_URL = new URL('../../apps/lab/src/hungry-shapes/model.ts', import.meta.url);
const MODEL_URL = new URL('../../apps/lab/src/uniform-endurance/model.ts', import.meta.url);
const MODEL_PROVENANCE_COMMENT = '// Uniform-endurance provenance: literal hungry-shapes model copy; only maxHistory is raised from 301 to 451 for observations.\n';
const PRIOR_IDENTITIES = Object.freeze({
  1201: { artifactSha256:'af3c651b4b6115ff084b3089ccdf87143d541a7833c87636efe6fb77c2313850', dataSha256:'39ddc124f20f7e61d7d125e877c125a502941e65ddbdd159c1ee666b663b1c76', markdownSha256:'4c5006d62f6884a3443e06ba98424d208f17af5394b4e4c60005455f050b050f' },
  1202: { artifactSha256:'9c2c0cf304fb8a015e746b96ee1d1c137404f4d3022767f207de57fe9bd092c7', dataSha256:'4dff34b745ac6d77394c6a4411db0764d8f286deb58dcd9d47638899437dbb81', markdownSha256:'b3f847a9d2239ab04a739fec7f2f31a4900958ba8f78feeb5ad08a24f84ca362' },
  1203: { artifactSha256:'96fe9be0c678fa40cea90341dae25d1f83f474b1813a4fc40fa19a0c547f86ae', dataSha256:'858bcf1f71057641184cf884cd2dbc8eca6b437fc5875db9677dbd25b6a2d75b', markdownSha256:'bd494561481c21526b7ebad1edb4edad7849ae0f0605aab842d0844c358d1561' },
});
const PINNED_INPUTS = Object.freeze({
  'apps/lab/src/development/model.ts': '49416b11ae8d0491cb9b2ae1f102f36779cd9fe0c72917a7ddf86fbbc63db072',
  'apps/lab/src/hungry-shapes/model.ts': 'a33a3312caa6c91a46e2508f5b9267e3394089ff7320145a15157770068123bc',
  'apps/lab/src/uniform-endurance/model.ts': 'b83de32cf42f58c13977dbbd3c74bf9d3068f90b40ec09600b9125ddb0a72009',
  'tools/hungry-shapes/explore.ts': 'f49d2a63fc7b464bcd2115c683f3e40ec8381eb28aa8b318889552ea9bc23581',
  'tools/uniform-food/explore.ts': '312c2cffd7102e8c58fc1eabb72173d53692c8527f950b74ba33be4917b4a80c',
  'docs/creative-prototypes/hungry-shapes-seed-1201.json': '2cb6366595e43e2f5f215448bd13a67925e21f2ea11e4747790f6f61470b6520',
  'docs/creative-prototypes/hungry-shapes-seed-1201.md': '0f64a51d0ab22fe346160ed0ef94877a78998700372ce8ff1ffde3ef0f88a0f1',
  'docs/creative-prototypes/hungry-shapes-decision.json': 'f935884132cd1f34edb5fec1af57eeaa033d87505448ea07acd05ed772c5d5b0',
});
const DISK_INPUTS = Object.entries(PINNED_INPUTS).map(([path]) => [path, new URL(`../../${path}`, import.meta.url)] as const);
const SELF_URL = new URL('./explore.ts', import.meta.url);
const CENSUS_FIELDS = ['tick','population','cells','familyCounts','births','growths','deaths','effectiveMutations','attemptedMutations',
  'maxGeneration','totalCells','totalEnergy','meanBodyCells','meanEnergy','blockedBirths','blockedSpaceBirths','blockedCapBirths',
  'ledgerResidual','genomeVariantCount'] as const;
const COUNTER_FIELDS = ['births','growths','deaths','effectiveMutations','attemptedMutations','blockedSpaceBirths','blockedCapBirths'] as const;
const GENOME_FIELDS = ['turnEvery','turn','branchEvery','maxCells'] as const;

function invariant(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function hashBytes(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function hash(value: unknown): string { return hashBytes(JSON.stringify(value)); }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function artifactHash(data: Obj): string { const copy = { ...data }; delete copy.dataSha256; return hash(copy); }
function record(value: unknown, label: string): asserts value is Obj {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
}
function exactKeys(value: Obj, keys: readonly string[], label: string): void {
  invariant(Object.keys(value).sort().join('|') === [...keys].sort().join('|'), `${label}: required fields mismatch`);
}
function int(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  invariant(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, `${label}: invalid integer`);
}
function isConnected(org: DevelopmentOrganism): boolean {
  if (org.cells.length <= 1) return true;
  const tiles = new Set(org.cells.map((cell) => cell.tile));
  if (tiles.size !== org.cells.length) return false;
  const reached = new Set([org.cells[0]!.tile]); const todo = [org.cells[0]!.tile];
  while (todo.length) {
    const tile = todo.pop()!; const x = tile % RULES.width; const y = Math.floor(tile / RULES.width);
    const neighbors = [(x + 1) % RULES.width + y * RULES.width, ((x + RULES.width - 1) % RULES.width) + y * RULES.width,
      x + ((y + 1) % RULES.height) * RULES.width, x + ((y + RULES.height - 1) % RULES.height) * RULES.width];
    for (const next of neighbors) if (tiles.has(next) && !reached.has(next)) { reached.add(next); todo.push(next); }
  }
  return reached.size === tiles.size;
}
function validateGenome(g: any, label: string): asserts g is DevelopmentGenome {
  record(g, label); exactKeys(g, GENOME_FIELDS, label);
  int(g.turnEvery, `${label}.turnEvery`, 2, 8); invariant(g.turn === -1 || g.turn === 0 || g.turn === 1, `${label}.turn invalid`);
  int(g.branchEvery, `${label}.branchEvery`, 2, 6); int(g.maxCells, `${label}.maxCells`, 16, RULES.maxCellsPerOrganism);
}

/** Adapted full per-tick safety validator for the 9,000-tick endurance horizon. */
export function assertWorld(world: HungryWorld, label = 'world'): void {
  int(world.tick, `${label}.tick`, 0, MAX_TICK);
  const food = world.food; const occupancy = world.occupancy; const organisms = world.organisms; const lineage = world.lineage;
  invariant(food.length === RULES.tileCount && [...food].every((n) => Number.isInteger(n) && n >= 0 && n <= RULES.maxFood), `${label}: food bounds`);
  invariant(occupancy.length === RULES.tileCount && [...occupancy].every((n) => Number.isSafeInteger(n) && n >= 0), `${label}: occupancy bounds`);
  invariant(organisms.length <= RULES.maxOrganisms && organisms.reduce((n, org) => n + org.cells.length, 0) <= RULES.maxOccupied, `${label}: population/cell cap`);
  const byID = new Map(lineage.map((n) => [n.id, n])); const ids = new Set<number>(); const tiles = new Set<number>();
  for (const org of organisms) {
    int(org.id, `${label}.id`, 1); invariant(!ids.has(org.id), `${label}: duplicate id`); ids.add(org.id);
    int(org.family, `${label}.family`, 0, 2); int(org.generation, `${label}.generation`); int(org.age, `${label}.age`, 0, RULES.maxAge - 1);
    int(org.store, `${label}.store`, 0, RULES.storeCap); int(org.births, `${label}.births`); validateGenome(org.genome, `${label}.genome`);
    invariant(org.cells.length > 0 && org.cells.length <= org.genome.maxCells && org.cells.length <= RULES.maxCellsPerOrganism, `${label}: body size`);
    invariant(org.parentID === null || (Number.isSafeInteger(org.parentID) && org.parentID > 0), `${label}: parent id`);
    invariant(Number.isSafeInteger(org.growthCursor) && org.growthCursor >= 0 && org.growthCursor <= org.growthQueue.length && org.growthQueue.length <= org.cells.length * 3 &&
      org.growthQueue.every((a) => Number.isSafeInteger(a.parentCell) && a.parentCell >= 0 && a.parentCell < org.cells.length && Number.isInteger(a.direction) && a.direction >= 0 && a.direction < 4), `${label}: growth queue`);
    invariant(isConnected(org), `${label}: disconnected body ${org.id}`);
    const node = byID.get(org.id);
    invariant(node && node.deathTick === null && node.parentID === org.parentID && node.family === org.family && node.generation === org.generation && same(node.genome, org.genome), `${label}: living body/lineage mismatch`);
    for (const cell of org.cells) {
      int(cell.tile, `${label}.tile`, 0, RULES.tileCount - 1); int(cell.heading, `${label}.heading`, 0, 3); int(cell.depth, `${label}.depth`);
      invariant(!tiles.has(cell.tile) && occupancy[cell.tile] === org.id, `${label}: overlap/occupancy mismatch`); tiles.add(cell.tile);
    }
  }
  for (let i = 0; i < occupancy.length; i++) invariant(occupancy[i] === 0 ? !tiles.has(i) : ids.has(occupancy[i]!) && tiles.has(i), `${label}: dangling occupancy`);
  const census = world.census(); const ledger = world.ledger; const env = world.environment;
  invariant(census.population === organisms.length && census.cells === tiles.size && census.familyCounts.reduce((a,b) => a+b,0) === census.population&&
    census.totalCells===census.cells&&census.blockedBirths===census.blockedSpaceBirths+census.blockedCapBirths&&census.ledgerResidual===world.ledger.residual, `${label}: census mismatch`);
  const bodyEnergy=organisms.reduce((n,o)=>n+o.store+RULES.structurePerCell*o.cells.length,0);
  invariant([ledger.initialEnergy,ledger.supplied,ledger.dissipated,ledger.deathLoss,ledger.expected,ledger.actual,ledger.residual].every(Number.isSafeInteger) &&
    ledger.actual===ledger.expected&&ledger.actual===[...food].reduce((a,b)=>a+b,0)+bodyEnergy&&ledger.expected===ledger.initialEnergy+ledger.supplied-ledger.dissipated-ledger.deathLoss&&ledger.residual === 0, `${label}: energy ledger`);
  invariant(env.mode==='uniform'&&env.pulseBudget===768&&env.targetCount===RULES.tileCount&&env.accepted === ledger.supplied && env.offered === env.accepted + env.overflow && env.pulses === Math.floor(world.tick / RULES.foodSupplyEvery) &&
    env.offered === env.pulses * env.pulseBudget, `${label}: food ledger`);
  const counters = world.countersView; invariant(Object.values(counters).every((n) => Number.isSafeInteger(n) && n >= 0), `${label}: counters`);
  const state=world.snapshot();invariant(lineage.length <= RULES.maxLineage && state.droppedHistory === 0 && state.droppedLineage === 0, `${label}: dropped/capped observations`);
  invariant(lineage.filter((n)=>n.deathTick===null).length===organisms.length&&lineage.filter((n)=>n.parentID!==null).length===counters.births&&
    lineage.filter((n)=>n.deathTick!==null).length===counters.deaths&&lineage.filter((n)=>n.mutation!==null).length===counters.effectiveMutations,`${label}: lineage counters`);
  invariant(organisms.length===0?world.extinctionTick===world.tick:world.extinctionTick===null,`${label}: extinction metadata`);
  validateLineage(lineage, world.tick, label);
}

export function validateLineage(nodes: readonly DevelopmentLineageNode[], tick: number, label = 'lineage'): void {
  const byID = new Map(nodes.map((n) => [n.id, n])); invariant(byID.size === nodes.length, `${label}: duplicate lineage node`);
  for (const n of nodes) {
    record(n,`${label}.lineage`);exactKeys(n as unknown as Obj,['id','parentID','family','generation','birthTick','genome','mutation','deathTick','deathCause','parentRecordDropped'],`${label}.lineage`);
    int(n.id, `${label}.lineage.id`, 1); int(n.family, `${label}.lineage.family`, 0, 2); int(n.generation, `${label}.lineage.generation`);
    int(n.birthTick, `${label}.lineage.birthTick`, 0, tick); validateGenome(n.genome, `${label}.lineage.genome`);
    invariant(n.parentID===null||Number.isSafeInteger(n.parentID)&&n.parentID>0,`${label}: invalid lineage parent`);
    invariant(n.deathTick === null || (Number.isSafeInteger(n.deathTick) && n.deathTick >= n.birthTick && n.deathTick <= tick), `${label}: lineage death tick`);
    invariant(n.deathTick === null ? n.deathCause === null : n.deathCause === 'age' || n.deathCause === 'starvation', `${label}: lineage death cause`);
    if(n.mutation!==null){record(n.mutation,`${label}.lineage.mutation`);exactKeys(n.mutation as unknown as Obj,['field','from','to'],`${label}.lineage.mutation`);
      invariant(GENOME_FIELDS.includes(n.mutation.field)&&Number.isSafeInteger(n.mutation.from)&&Number.isSafeInteger(n.mutation.to),`${label}: invalid mutation record`);}
    invariant(typeof n.parentRecordDropped==='boolean',`${label}: invalid parentRecordDropped`);
    if (n.parentID === null) invariant(n.generation === 0 && n.mutation === null && !n.parentRecordDropped, `${label}: invalid founder`);
    else {
      const parent = byID.get(n.parentID); invariant(parent && !n.parentRecordDropped, `${label}: missing lineage parent`);
      invariant(n.generation === parent.generation + 1 && n.family === parent.family, `${label}: parent lineage mismatch`);
      const changed = GENOME_FIELDS.filter((field) => n.genome[field] !== parent.genome[field]);
      if (n.mutation === null) invariant(changed.length === 0, `${label}: unrecorded genome change`);
      else invariant(changed.length === 1 && changed[0] === n.mutation.field && n.mutation.from === (parent.genome as any)[n.mutation.field] &&
        n.mutation.to === (n.genome as any)[n.mutation.field] && n.mutation.from !== n.mutation.to, `${label}: mutation lineage mismatch`);
    }
  }
}

export function censusFromSnapshot(s: DevelopmentSnapshot): DevelopmentCensus {
  const familyCounts: [number,number,number] = [0,0,0]; let cells = 0, totalEnergy = 0, maxGeneration = 0; const variants = new Set<string>();
  for (const org of s.organisms) { familyCounts[org.family]++; cells += org.cells.length; totalEnergy += org.store + RULES.structurePerCell * org.cells.length;
    maxGeneration = Math.max(maxGeneration, org.generation); variants.add(JSON.stringify(GENOME_FIELDS.map((k) => (org.genome as any)[k]))); }
  const c = s.counters;
  return { tick:s.tick,population:s.organisms.length,cells,familyCounts,births:c.births,growths:c.growths,deaths:c.deaths,
    effectiveMutations:c.effectiveMutations,attemptedMutations:c.attemptedMutations,maxGeneration,totalCells:cells,totalEnergy,
    meanBodyCells:s.organisms.length?cells/s.organisms.length:0,meanEnergy:s.organisms.length?totalEnergy/s.organisms.length:0,
    blockedBirths:c.blockedSpaceBirths+c.blockedCapBirths,blockedSpaceBirths:c.blockedSpaceBirths,blockedCapBirths:c.blockedCapBirths,
    ledgerResidual:s.ledger.residual,genomeVariantCount:variants.size };
}
function validateCensus(v: unknown, label: string, maxTick=MAX_TICK): asserts v is DevelopmentCensus {
  record(v,label); exactKeys(v,CENSUS_FIELDS,label); int(v.tick,`${label}.tick`,0,maxTick); int(v.population,`${label}.population`,0,RULES.maxOrganisms);
  int(v.cells,`${label}.cells`,0,RULES.maxOccupied); invariant(Array.isArray(v.familyCounts)&&v.familyCounts.length===3,`${label}: familyCounts`);
  v.familyCounts.forEach((x:unknown)=>int(x,`${label}.familyCount`,0,RULES.maxOrganisms));
  invariant(v.familyCounts.reduce((a:number,b:number)=>a+b,0)===v.population,`${label}: family population sum`);
  for (const k of ['births','growths','deaths','effectiveMutations','attemptedMutations','maxGeneration','totalCells','totalEnergy','blockedBirths','blockedSpaceBirths','blockedCapBirths','genomeVariantCount']) int(v[k],`${label}.${k}`);
  invariant(v.totalCells===v.cells&&v.blockedBirths===v.blockedSpaceBirths+v.blockedCapBirths&&v.effectiveMutations<=v.attemptedMutations&&
    v.effectiveMutations<=v.births&&v.genomeVariantCount<=v.population&&v.ledgerResidual===0,`${label}: census identities`);
  invariant(Number.isFinite(v.meanBodyCells)&&v.meanBodyCells===(v.population?v.cells/v.population:0)&&Number.isFinite(v.meanEnergy)&&
    v.meanEnergy===(v.population?v.totalEnergy/v.population:0),`${label}: census means`);
}

export function validateSnapshot(value: unknown, expected:{seed:number;tick:number;extinctionTick:number|null}, label='snapshot'): asserts value is DevelopmentSnapshot {
  record(value,label); const s=value as DevelopmentSnapshot;
  exactKeys(value,['schemaVersion','description','runtime','rules','seed','mutation','tick','extinctionTick','food','occupancy','organisms','ledger','counters','history','droppedHistory','lineage','droppedLineage'],label);
  invariant(s.schemaVersion===1&&s.description==='observation only; not a resume checkpoint'&&s.runtime===`Node ${NODE_VERSION}`&&same(s.rules,RULES),`${label}: metadata`);
  invariant(s.seed===expected.seed&&s.mutation===true&&s.tick===expected.tick&&s.extinctionTick===expected.extinctionTick,`${label}: state identity`);
  invariant(Array.isArray(s.food)&&s.food.length===RULES.tileCount&&s.food.every((n)=>Number.isSafeInteger(n)&&n>=0&&n<=RULES.maxFood),`${label}: food array`);
  invariant(Array.isArray(s.occupancy)&&s.occupancy.length===RULES.tileCount&&s.occupancy.every((n)=>Number.isSafeInteger(n)&&n>=0),`${label}: occupancy array`);
  invariant(Array.isArray(s.organisms)&&s.organisms.length<=RULES.maxOrganisms&&Array.isArray(s.lineage),`${label}: organism/lineage arrays`);
  const nodes=new Map(s.lineage.map((n)=>[n.id,n])); const ids=new Set<number>(), tiles=new Set<number>(); let occupied=0;
  for(const o of s.organisms){
    record(o,`${label}.organism`);exactKeys(o as unknown as Obj,['id','parentID','family','generation','age','store','genome','births','cells','growthQueue','growthCursor'],`${label}.organism`);
    int(o.id,`${label}.organism.id`,1);invariant(!ids.has(o.id),`${label}: duplicate organism id`);ids.add(o.id);
    int(o.family,`${label}.family`,0,2);int(o.generation,`${label}.generation`);int(o.age,`${label}.age`,0,RULES.maxAge-1);
    int(o.store,`${label}.store`,0,RULES.storeCap);int(o.births,`${label}.births`);validateGenome(o.genome,`${label}.genome`);
    invariant(o.cells.length>0&&o.cells.length<=o.genome.maxCells&&o.cells.length<=RULES.maxCellsPerOrganism,`${label}: body size`);
    invariant(Array.isArray(o.growthQueue)&&Number.isSafeInteger(o.growthCursor)&&o.growthCursor>=0&&o.growthCursor<=o.growthQueue.length&&o.growthQueue.length<=o.cells.length*3&&o.growthQueue.every((a)=>{
      record(a,`${label}.attempt`);exactKeys(a as unknown as Obj,['parentCell','direction'],`${label}.attempt`);
      return Number.isSafeInteger(a.parentCell)&&a.parentCell>=0&&a.parentCell<o.cells.length&&Number.isInteger(a.direction)&&a.direction>=0&&a.direction<4;}),`${label}: growth queue`);
    invariant(isConnected(o as DevelopmentOrganism),`${label}: disconnected body`);const node=nodes.get(o.id);
    invariant(node&&node.deathTick===null&&node.parentID===o.parentID&&node.family===o.family&&node.generation===o.generation&&same(node.genome,o.genome),`${label}: organism/lineage`);
    for(const cell of o.cells){record(cell,`${label}.cell`);exactKeys(cell as unknown as Obj,['tile','heading','depth'],`${label}.cell`);int(cell.tile,`${label}.tile`,0,RULES.tileCount-1);int(cell.heading,`${label}.heading`,0,3);int(cell.depth,`${label}.depth`);
      invariant(!tiles.has(cell.tile)&&s.occupancy[cell.tile]===o.id,`${label}: duplicate tile/occupancy`);tiles.add(cell.tile);}
    occupied+=o.cells.length;
  }
  invariant(occupied<=RULES.maxOccupied,`${label}: occupied cap`);
  for(let i=0;i<s.occupancy.length;i++) invariant(s.occupancy[i]===0?!tiles.has(i):ids.has(s.occupancy[i]!)&&tiles.has(i),`${label}: dangling occupancy`);
  invariant(s.droppedHistory===0&&s.droppedLineage===0&&s.lineage.length<=RULES.maxLineage,`${label}: dropped observations`);
  validateLineage(s.lineage,s.tick,label);exactKeys(s.counters as Obj,COUNTER_FIELDS,`${label}.counters`);
  for(const k of COUNTER_FIELDS)int((s.counters as any)[k],`${label}.counter.${k}`);
  invariant(s.counters.births===s.lineage.filter((n)=>n.parentID!==null).length&&s.counters.deaths===s.lineage.filter((n)=>n.deathTick!==null).length&&
    s.counters.effectiveMutations===s.lineage.filter((n)=>n.mutation!==null).length,`${label}: lineage counters`);
  const l=s.ledger; exactKeys(l as Obj,['initialEnergy','supplied','dissipated','deathLoss','expected','actual','residual'],`${label}.ledger`);
  for(const k of ['initialEnergy','supplied','dissipated','deathLoss','expected','actual','residual'] as const)int(l[k],`${label}.ledger.${k}`);
  const foodSum=s.food.reduce((a,b)=>a+b,0);const bodyEnergy=s.organisms.reduce((a,o)=>a+o.store+RULES.structurePerCell*o.cells.length,0);
  invariant(l.actual===foodSum+bodyEnergy&&l.expected===l.initialEnergy+l.supplied-l.dissipated-l.deathLoss&&l.residual===l.actual-l.expected&&l.residual===0,`${label}: energy conservation`);
  const historyTicks=[0];for(let t=20;t<=s.tick;t+=20)historyTicks.push(t);if(s.extinctionTick!==null&&!historyTicks.includes(s.extinctionTick))historyTicks.push(s.extinctionTick);historyTicks.sort((a,b)=>a-b);
  invariant(Array.isArray(s.history)&&s.history.map((r)=>r.tick).join(',')===historyTicks.join(','),`${label}: history schedule`);
  s.history.forEach((row,i)=>validateCensus(row,`${label}.history[${i}]`,s.tick));
  invariant(same(s.history.at(-1),censusFromSnapshot(s)),`${label}: history final census mismatch`);
}

function sourceHashes(): Record<string,string> {
  const pinned=Object.fromEntries(DISK_INPUTS.map(([name,url])=>[name,hashBytes(readFileSync(url))]));
  return { ...pinned, 'tools/uniform-endurance/explore.ts': hashBytes(readFileSync(SELF_URL)) };
}
export const LOADED_SOURCE_SHA256=Object.freeze(sourceHashes());
export function assertSourceIdentity(expected:Record<string,string>=LOADED_SOURCE_SHA256,current=sourceHashes()):void {
  invariant(same(expected,current),'Evidence sources changed since runner load; reload and rerun');
}
export function assertPinnedInputs(current=sourceHashes()):void {
  for(const [path,digest] of Object.entries(PINNED_INPUTS))invariant(current[path]===digest,`Pinned input changed: ${path}`);
  const base=readFileSync(BASE_MODEL_URL,'utf8');const copy=readFileSync(MODEL_URL,'utf8');
  invariant(copy.split(MODEL_PROVENANCE_COMMENT).length===2,'model provenance comment missing or duplicated');
  const restored=copy.replace(MODEL_PROVENANCE_COMMENT,'');
  invariant((restored.match(/maxHistory: 451,/g)??[]).length===1,'model copy must have exactly one maxHistory 451 token');
  invariant(restored.replace('maxHistory: 451,','maxHistory: 301,')===base,'uniform-endurance model is not an exact observation-only copy');
}

export function normalizePrefixState(state:DevelopmentSnapshot):DevelopmentSnapshot {
  const copy=JSON.parse(JSON.stringify(state)) as DevelopmentSnapshot;
  (copy.rules as any).maxHistory=301;
  return copy;
}
export function normalizedFrameDigest(frame:Frame,normalizedHash:string):string {
  return hash({tick:frame.tick,censusSha256:frame.censusSha256,stateSha256:normalizedHash,
    foodBase64:frame.foodBase64,cells:frame.cells,organisms:frame.organisms,ledger:frame.ledger});
}
function makeFrame(world:HungryWorld,census:DevelopmentCensus,stateSha256:string,normalizedHash:string|null):Frame {
  const food=Buffer.from(world.food); const organisms=world.organisms.map((o)=>({id:o.id,family:o.family,genome:o.genome}));
  const cells:[number,number][]=[];for(const o of world.organisms)for(const c of o.cells)cells.push([c.tile,o.id]);cells.sort((a,b)=>a[0]-b[0]);
  const base={tick:world.tick,censusSha256:hash(census),stateSha256,normalizedStateSha256:normalizedHash,
    normalizedFrameSha256:null as string|null,foodBase64:food.toString('base64'),cells,organisms,ledger:world.ledger};
  if(normalizedHash!==null)base.normalizedFrameSha256=normalizedFrameDigest(base as Frame,normalizedHash);
  return {...base,frameSha256:hash(base)};
}
function frameProjection(s:DevelopmentSnapshot):Pick<Frame,'foodBase64'|'cells'|'organisms'|'ledger'> {
  const cells:[number,number][]=[];for(const o of s.organisms)for(const c of o.cells)cells.push([c.tile,o.id]);cells.sort((a,b)=>a[0]-b[0]);
  return {foodBase64:Buffer.from(s.food).toString('base64'),cells,organisms:s.organisms.map((o)=>({id:o.id,family:o.family,genome:o.genome})),ledger:s.ledger};
}
function makeSample(world:HungryWorld):{sample:Sample;state:DevelopmentSnapshot;frame:Frame} {
  const state=world.snapshot();const env=world.environment;const census=world.census();const stateSha256=hash({state,environment:env});
  const normalizedHash=world.tick<=PREFIX_END?hash({state:normalizePrefixState(state),environment:env}):null;
  const frame=makeFrame(world,census,stateSha256,normalizedHash);return {sample:{tick:world.tick,census,environment:env,censusSha256:hash(census),stateSha256,
    normalizedStateSha256:normalizedHash,frameSha256:frame.frameSha256},state,frame};
}
function tickRow(world:HungryWorld,previous:DevelopmentCensus,census:DevelopmentCensus):TickRow {
  return {tick:world.tick,population:census.population,cells:census.cells,births:census.births-previous.births,deaths:census.deaths-previous.deaths,
    blockedCap:census.blockedCapBirths-previous.blockedCapBirths,blockedSpace:census.blockedSpaceBirths-previous.blockedSpaceBirths,
    cap48:census.population===RULES.maxOrganisms,nearCap47:census.population>=RULES.maxOrganisms-1};
}
function prefixData(seed:number):Obj {
  const identity=PRIOR_IDENTITIES[seed as keyof typeof PRIOR_IDENTITIES];const jsonURL=PRIOR_JSON_URL(seed),mdURL=PRIOR_MD_URL(seed);
  const bytes=readFileSync(jsonURL);invariant(hashBytes(bytes)===identity.artifactSha256,`seed ${seed} prior artifact bytes differ from pin`);
  invariant(hashBytes(readFileSync(mdURL))===identity.markdownSha256,`seed ${seed} prior Markdown bytes differ from pin`);
  const d=JSON.parse(bytes.toString('utf8')) as Obj;
  invariant(d.dataSha256===identity.dataSha256&&d.dataSha256===artifactHash(d),`seed ${seed} prior internal digest mismatch`);
  invariant(d.run?.seed===seed&&d.kind==='hungry-shapes-uniform-long-run'&&d.run.maxTick===6000&&d.run.finalTick===6000&&d.run.extinctionTick===null,
    `seed ${seed} prior run identity mismatch`);
  return d;
}

function runUniform(seed:number):Obj {
  invariant(process.versions.node===NODE_VERSION,`Requires Node ${NODE_VERSION}; found ${process.versions.node}`);
  invariant(process.platform==='darwin'&&process.arch==='arm64',`Accepted runs require darwin/arm64; found ${process.platform}/${process.arch}`);
  assertPinnedInputs();assertSourceIdentity();
  const primary=new HungryWorld(seed,true,'uniform');const repeat=new HungryWorld(seed,true,'uniform');
  invariant(same(primary.snapshot(),repeat.snapshot()),'independent initial states differ');
  const samples:Sample[]=[];const frames:Frame[]=[];const snapshots:SnapshotRecord[]=[];const tickRows:TickRow[]=[];
  let extinctionTick:number|null=null;let prior=primary.census();let repeatPrior=repeat.census();
  const old=prefixData(seed);const prefixCheckpoints:{tick:number;normalizedStateSha256:string;compared:true}[]=[];
  const capture=(terminal=false)=>{
    const a=makeSample(primary);const b=makeSample(repeat);
    invariant(same(a.state,b.state)&&same(primary.environment,repeat.environment),'repeat full state mismatch at '+primary.tick);
    invariant(a.frame.frameSha256===b.frame.frameSha256,'repeat frame mismatch at '+primary.tick);
    if(samples.at(-1)?.tick!==primary.tick){samples.push(a.sample);frames.push(a.frame);}
    const wanted=FIXED_SNAPSHOTS.includes(primary.tick)||terminal;
    if(wanted){snapshots.push({tick:primary.tick,terminal,environment:primary.environment,state:a.state,stateSha256:a.sample.stateSha256});
      const projected=frameProjection(a.state);invariant(same(projected,{foodBase64:a.frame.foodBase64,cells:a.frame.cells,organisms:a.frame.organisms,ledger:a.frame.ledger}),`snapshot/frame projection mismatch at ${primary.tick}`);}
    return a;
  };
  const initial=capture();
  validatePrefixInitial(initial.sample,initial.state,initial.frame,old,prefixCheckpoints);
  for(let scheduled=1;scheduled<=MAX_TICK;scheduled++){
    if(primary.extinctionTick!==null)break;
    primary.step(1);repeat.step(1);assertWorld(primary,'primary');assertWorld(repeat,'repeat');
    const census=primary.census();const repeatCensus=repeat.census();
    invariant(primary.tick===repeat.tick&&same(census,repeatCensus)&&same(primary.environment,repeat.environment),`repeat census/environment mismatch at ${scheduled}`);
    invariant(primary.extinctionTick===repeat.extinctionTick,`repeat extinction mismatch at ${scheduled}`);
    const row=tickRow(primary,prior,census);const repeatRow=tickRow(repeat,repeatPrior,repeatCensus);
    invariant(same(row,repeatRow),`repeat tick row mismatch at ${scheduled}`);tickRows.push(row);
    validatePrefixTick(scheduled,prior,census,primary,old,prefixCheckpoints);
    if(primary.tick%SAMPLE_EVERY===0||primary.extinctionTick===primary.tick){
      const captured=capture(primary.extinctionTick===primary.tick);
      if(primary.tick<=PREFIX_END)validatePrefixSample(captured.sample,captured.frame,old);
    }
    prior=census;repeatPrior=repeatCensus;
    if(primary.extinctionTick!==null){extinctionTick=primary.extinctionTick;break;}
    if(scheduled===MAX_TICK)invariant(primary.tick===MAX_TICK,'failed to reach frozen horizon');
  }
  if(primary.tick===MAX_TICK&&primary.extinctionTick===null&&samples.at(-1)?.tick!==MAX_TICK)capture(false);
  invariant(primary.tick===(extinctionTick??MAX_TICK),`actual terminal tick mismatch: ${primary.tick}`);
  const terminal=primary.snapshot();const env=primary.environment;
  invariant(terminal.droppedHistory===0&&terminal.droppedLineage===0,'history or lineage cap dropped observations');
  const windows=WINDOWS.map((w)=>summarizeWindow(w,tickRows,samples,snapshots,terminal,env,extinctionTick));
  const stateSha256=hash({state:terminal,environment:env});
  const output:Obj={schemaVersion:1,kind:'hungry-shapes-uniform-endurance',run:{seed,mode:'uniform',mutation:true,maxTick:MAX_TICK,finalTick:primary.tick,extinctionTick},
    runtime:{node:process.versions.node,platform:process.platform,arch:process.arch},rules:RULES,
    provenance:{sourceSha256:LOADED_SOURCE_SHA256,priorArtifactSha256:PRIOR_IDENTITIES[seed as keyof typeof PRIOR_IDENTITIES].artifactSha256,
      priorDataSha256:PRIOR_IDENTITIES[seed as keyof typeof PRIOR_IDENTITIES].dataSha256,
      prefix:{status:'verified',seed,normalization:'For ticks <=6000, copy new state and set only rules.maxHistory 451->301; hash SHA256(JSON.stringify({state,environment})). Compare all retained samples, frames, tick rows, and old snapshots.',
        comparedSamples:PREFIX_SAMPLE_COUNT,comparedFrames:PREFIX_FRAME_COUNT,comparedTickRows:PREFIX_TICKROW_COUNT,comparedSnapshots:OLD_CHECKPOINT_TICKS.length,
        checkpoints:prefixCheckpoints}},
    samples,tickRows,frames,snapshots,windows,final:{census:primary.census(),environment:env,ledger:primary.ledger,lineage:primary.lineage,
      deathsByCause:{age:primary.lineage.filter((n)=>n.deathCause==='age').length,starvation:primary.lineage.filter((n)=>n.deathCause==='starvation').length},
      maxEverGeneration:Math.max(0,...primary.lineage.map((n)=>n.generation)),stateSha256},
    repeat:{verified:true,comparedThroughTick:primary.tick,stateChecks:samples.length,frameChecks:frames.length},
    numericalGate:evaluateGate(primary.tick,primary.census(),windows)};
  output.dataSha256=artifactHash(output);validateEvidenceStructure(output,LOADED_SOURCE_SHA256);assertSourceIdentity();
  invariant(Buffer.byteLength(JSON.stringify(output))<=MAX_ARTIFACT_BYTES,'evidence exceeds 24 MiB cap; fail closed without dropping observations');
  return output;
}

function validatePrefixInitial(sample:Sample,state:DevelopmentSnapshot,frame:Frame,prior:Obj,checkpoints:{tick:number;normalizedStateSha256:string;compared:true}[]):void {
  const oldSample=prior.samples[0];const oldFrame=prior.frames[0];const oldState=prior.snapshots.find((s:Obj)=>s.tick===0)?.state;
  invariant(oldSample&&oldFrame&&oldState&&sample.tick===0&&same(sample.census,oldSample.census)&&same(sample.environment,oldSample.environment),`prefix tick 0 census/environment mismatch`);
  invariant(sample.normalizedStateSha256===oldSample.stateSha256&&same(normalizePrefixState(state),oldState),`prefix initial normalized full state mismatch`);
  invariant(frame.normalizedFrameSha256===oldFrame.frameSha256&&same(frameProjection(state),frameProjection(oldState)),`prefix initial frame mismatch`);
  checkpoints.push({tick:0,normalizedStateSha256:sample.normalizedStateSha256!,compared:true});
}
function validatePrefixSample(sample:Sample,frame:Frame,prior:Obj):void {
  const oldSample=prior.samples.find((s:Obj)=>s.tick===sample.tick);const oldFrame=prior.frames.find((f:Obj)=>f.tick===sample.tick);
  invariant(oldSample&&oldFrame&&same(sample.census,oldSample.census)&&same(sample.environment,oldSample.environment)&&
    sample.normalizedStateSha256===oldSample.stateSha256,`retained prefix census/state mismatch at ${sample.tick}`);
  invariant(frame.normalizedFrameSha256===oldFrame.frameSha256&&same(frameProjectionFromFrame(frame),frameProjectionFromFrame(oldFrame)),`retained prefix frame mismatch at ${sample.tick}`);
}
function frameProjectionFromFrame(f:Frame):Obj{return {foodBase64:f.foodBase64,cells:f.cells,organisms:f.organisms,ledger:f.ledger};}
export function validatePrefixTick(tick:number,previous:DevelopmentCensus,census:DevelopmentCensus,world:HungryWorld,prior:Obj,checkpoints:{tick:number;normalizedStateSha256:string;compared:true}[]):void {
  if(tick>PREFIX_END)return;
  const old=prior.tickRows[tick-1];const current={tick,population:census.population,cells:census.cells,births:census.births-previous.births,
    deaths:census.deaths-previous.deaths,blockedCap:census.blockedCapBirths-previous.blockedCapBirths,
    blockedSpace:census.blockedSpaceBirths-previous.blockedSpaceBirths,cap48:census.population===RULES.maxOrganisms,nearCap47:census.population>=RULES.maxOrganisms-1};
  invariant(old&&same(current,old),`retained prefix tick row mismatch at ${tick}`);
  if(OLD_CHECKPOINT_TICKS.includes(tick)){
    const oldState=prior.snapshots.find((s:Obj)=>s.tick===tick)?.state;const state=world.snapshot();const normalizedHash=hash({state:normalizePrefixState(state),environment:world.environment});
    invariant(oldState&&same(normalizePrefixState(state),oldState)&&normalizedHash===prior.samples.find((s:Obj)=>s.tick===tick)?.stateSha256,
      `retained prefix full snapshot mismatch at ${tick}`);
    checkpoints.push({tick,normalizedStateSha256:normalizedHash,compared:true});
  }
}

function summarizeWindow(w:{from:number;to:number},rows:TickRow[],samples:Sample[],snapshots:SnapshotRecord[],terminal:DevelopmentSnapshot,env:HungryEnvironment,extinctionTick:number|null):Obj {
  const active=rows.filter((r)=>r.tick>=w.from&&r.tick<=w.to);const e=active.length;
  const births=active.reduce((a,r)=>a+r.births,0),deaths=active.reduce((a,r)=>a+r.deaths,0);
  const cap48Ticks=active.filter((r)=>r.cap48).length,nearCap47Ticks=active.filter((r)=>r.nearCap47).length;
  const endpointTick=Math.min(w.to,terminal.tick);const endpointState=snapshots.find((s)=>s.tick===endpointTick)?.state??(endpointTick===terminal.tick?terminal:null);
  const endpointSample=samples.find((s)=>s.tick===endpointTick);const endpointCensus=endpointSample?.census??(endpointState?censusFromSnapshot(endpointState):null);
  const startTick=Math.min(w.from-1,terminal.tick);const startSample=samples.find((s)=>s.tick===startTick);
  const actualEnv=endpointSample?.environment??env;
  const genomes=new Map<string,{genome:DevelopmentGenome;count:number}>();
  for(const o of endpointState?.organisms??[]){const key=JSON.stringify(o.genome);const entry=genomes.get(key)??{genome:o.genome,count:0};entry.count++;genomes.set(key,entry);}
  return {from:w.from,to:w.to,denominatorTicks:500,executedTicks:e,zeroOccupancyTicks:500-e,births,deaths,cap48Ticks,nearCap47Ticks,
    blockedCapAttempts:active.reduce((a,r)=>a+r.blockedCap,0),blockedSpaceAttempts:active.reduce((a,r)=>a+r.blockedSpace,0),
    minPopulation:e?Math.min(...active.map((r)=>r.population)):null,maxPopulation:e?Math.max(...active.map((r)=>r.population)):null,
    endpoint:{requestedTick:w.to,actualTick:endpointTick,population:endpointCensus?.population??0,cells:endpointCensus?.cells??0,
      familyCounts:endpointCensus?.familyCounts??[0,0,0],genomeCounts:[...genomes.values()].sort((a,b)=>JSON.stringify(a.genome).localeCompare(JSON.stringify(b.genome)))},
    start:{requestedTick:w.from-1,actualTick:startSample?.tick??Math.min(w.from-1,terminal.tick),environment:startSample?.environment??null},
    endEnvironment:actualEnv,postExtinctionSlots:500-e,extinctionTick};
}
export function evaluateGate(finalTick:number,census:DevelopmentCensus,windows:Obj[]):Obj {
  const criterion=windows.slice(1).every((w)=>w.births>0&&w.deaths>0&&w.cap48Ticks<=99);
  const twoFamilies=census.familyCounts.filter((n)=>n>0).length>=2;
  return {aliveAt9000:finalTick===9000&&census.population>0,eachNewWindowHasBirthsAndDeaths:windows.slice(1).every((w)=>w.births>0&&w.deaths>0),
    eachNewWindowCap48AtMost99:windows.slice(1).every((w)=>w.cap48Ticks<=99),atLeastTwoFamiliesAt9000:twoFamilies,
    numericalPass:finalTick===9000&&census.population>0&&criterion&&twoFamilies,
    note:'Numerical screen only; visual judgment is manual and required for the plan gate.'};
}

function validateEnvironment(value:unknown,tick:number,label:string):asserts value is HungryEnvironment {
  record(value,label);exactKeys(value,['version','mode','pulseBudget','targetCount','pulses','offered','accepted','overflow','initialFoodPerTile'],label);
  invariant(value.version===1&&value.mode==='uniform'&&value.pulseBudget===768&&value.targetCount===RULES.tileCount&&value.initialFoodPerTile===RULES.initialFood,`${label}: mode parameters`);
  int(value.pulses,`${label}.pulses`);int(value.offered,`${label}.offered`);int(value.accepted,`${label}.accepted`);int(value.overflow,`${label}.overflow`);
  invariant(value.pulses===Math.floor(tick/RULES.foodSupplyEvery)&&value.offered===value.pulses*768&&value.accepted+value.overflow===value.offered,`${label}: food accounting`);
}
export function validateFrame(value:unknown,label='frame'):asserts value is Frame {
  record(value,label);exactKeys(value,['tick','censusSha256','stateSha256','normalizedStateSha256','normalizedFrameSha256','foodBase64','cells','organisms','ledger','frameSha256'],label);
  int(value.tick,`${label}.tick`,0,MAX_TICK);invariant(/^[a-f0-9]{64}$/.test(value.censusSha256)&&/^[a-f0-9]{64}$/.test(value.stateSha256),`${label}: state binding`);
  const inPrefix=value.tick<=PREFIX_END;
  invariant(inPrefix?typeof value.normalizedStateSha256==='string'&&/^[a-f0-9]{64}$/.test(value.normalizedStateSha256)&&
    typeof value.normalizedFrameSha256==='string'&&/^[a-f0-9]{64}$/.test(value.normalizedFrameSha256):value.normalizedStateSha256===null&&value.normalizedFrameSha256===null,
    `${label}: normalized prefix hashes`);
  invariant(typeof value.foodBase64==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.foodBase64),`${label}: malformed food bytes`);
  const food=Buffer.from(value.foodBase64,'base64');invariant(food.length===RULES.tileCount&&food.every((n)=>n<=RULES.maxFood),`${label}: food bounds`);
  invariant(Array.isArray(value.cells)&&Array.isArray(value.organisms)&&value.organisms.length<=RULES.maxOrganisms,`${label}: frame cells/organisms`);
  const orgs=new Map<number,any>();for(const o of value.organisms){record(o,`${label}.organism`);exactKeys(o,['id','family','genome'],`${label}.organism`);
    int(o.id,`${label}.organism.id`,1,RULES.maxLineage);int(o.family,`${label}.organism.family`,0,2);validateGenome(o.genome,`${label}.organism.genome`);
    invariant(!orgs.has(o.id),`${label}: duplicate organism`);orgs.set(o.id,o);}
  const seen=new Set<number>();let previous=-1;for(const cell of value.cells){invariant(Array.isArray(cell)&&cell.length===2,`${label}: malformed cell tuple`);const [tile,id]=cell;
    int(tile,`${label}.tile`,0,RULES.tileCount-1);int(id,`${label}.bodyID`,1,RULES.maxLineage);
    invariant(tile>previous&&!seen.has(tile),`${label}: duplicate/unsorted tile`);previous=tile;seen.add(tile);invariant(orgs.has(id),`${label}: cell has no organism palette`);}
  invariant(value.cells.length<=RULES.maxOccupied&&new Set(value.cells.map((c:any)=>c[1])).size===orgs.size,`${label}: body palette mismatch`);
  for(const id of orgs.keys())invariant(value.cells.some((c:any)=>c[1]===id),`${label}: organism has no cells`);
  record(value.ledger,`${label}.ledger`);exactKeys(value.ledger,['initialEnergy','supplied','dissipated','deathLoss','expected','actual','residual'],`${label}.ledger`);
  for(const k of ['initialEnergy','supplied','dissipated','deathLoss','expected','actual','residual'])int(value.ledger[k],`${label}.ledger.${k}`);
  invariant(value.ledger.residual===value.ledger.actual-value.ledger.expected&&value.ledger.residual===0&&value.ledger.expected===value.ledger.actual&&
    value.ledger.expected===value.ledger.initialEnergy+value.ledger.supplied-value.ledger.dissipated-value.ledger.deathLoss&&
    food.reduce((a,b)=>a+b,0)+value.cells.length*RULES.structurePerCell<=value.ledger.actual,`${label}: frame energy ledger`);
  const copy={...value};delete copy.frameSha256;invariant(value.frameSha256===hash(copy),`${label}: frame digest mismatch`);
  if(inPrefix)invariant(value.normalizedFrameSha256===normalizedFrameDigest(value as Frame,value.normalizedStateSha256 as string),`${label}: normalized frame digest mismatch`);
}
function lineageAt(nodes:readonly DevelopmentLineageNode[],tick:number):DevelopmentLineageNode[]{
  return nodes.filter((n)=>n.birthTick<=tick&&(n.deathTick===null||n.deathTick>tick)).sort((a,b)=>a.id-b.id);
}
export function validateFrameLineage(frame:Frame,nodes:readonly DevelopmentLineageNode[],census:DevelopmentCensus,label='frame'):void{
  const living=lineageAt(nodes,frame.tick);const expected=living.map((n)=>({id:n.id,family:n.family,genome:n.genome}));
  invariant(same(frame.organisms,expected),`${label}: frame body IDs/family/genome differ from living lineage`);
  const families=[0,0,0];for(const n of living)families[n.family]++;
  const variants=new Set(living.map((n)=>JSON.stringify(n.genome)));
  invariant(same(families,census.familyCounts)&&living.length===census.population&&variants.size===census.genomeVariantCount&&
    living.reduce((m,n)=>Math.max(m,n.generation),0)===census.maxGeneration,`${label}: lineage census mismatch`);
  invariant(nodes.filter((n)=>n.parentID!==null&&n.birthTick<=frame.tick).length===census.births&&
    nodes.filter((n)=>n.deathTick!==null&&n.deathTick<=frame.tick).length===census.deaths&&
    nodes.filter((n)=>n.mutation!==null&&n.birthTick<=frame.tick).length===census.effectiveMutations,`${label}: cumulative lineage/census mismatch`);
}
function projectLineageAt(nodes:readonly DevelopmentLineageNode[],tick:number):DevelopmentLineageNode[]{
  return nodes.filter((n)=>n.birthTick<=tick).map((n)=>{
    const deadByTick=n.deathTick!==null&&n.deathTick<=tick;
    return {...n,deathTick:deadByTick?n.deathTick:null,deathCause:deadByTick?n.deathCause:null,parentRecordDropped:false};
  }).sort((a,b)=>a.id-b.id);
}
export function validateSnapshotLineageProjection(snapshot:DevelopmentSnapshot,finalLineage:readonly DevelopmentLineageNode[]):void{
  invariant(same(snapshot.lineage,projectLineageAt(finalLineage,snapshot.tick)),`snapshot lineage differs from final lineage projection at ${snapshot.tick}`);
}
export function validateSnapshotHistoryBindings(snapshot:DevelopmentSnapshot,samples:readonly Sample[]):void{
  for(const row of snapshot.history){const sample=samples.find((x)=>x.tick===row.tick);invariant(sample&&same(sample.census,row),`snapshot history/sample mismatch at ${snapshot.tick}/${row.tick}`);}
}
export function expectedSampleTicks(finalTick:number,extinctionTick:number|null):number[]{const a=[0];for(let t=20;t<=finalTick;t+=20)a.push(t);if(extinctionTick!==null&&!a.includes(extinctionTick))a.push(extinctionTick);return a.sort((x,y)=>x-y);}
export function expectedSnapshotTicks(finalTick:number,extinctionTick:number|null):number[]{const a=FIXED_SNAPSHOTS.filter((t)=>t<=finalTick&&(extinctionTick===null||t<extinctionTick));if(extinctionTick!==null)a.push(extinctionTick);return [...new Set(a)].sort((x,y)=>x-y);}

export function validateTickRows(rows:unknown,finalTick:number,extinctionTick:number|null,lineage:DevelopmentLineageNode[],samples:Sample[]):asserts rows is TickRow[]{
  invariant(Array.isArray(rows)&&rows.length===finalTick,`tick row coverage mismatch`);
  const born=new Map<number,number>(),died=new Map<number,number>();for(const n of lineage){if(n.parentID!==null)born.set(n.birthTick,(born.get(n.birthTick)??0)+1);if(n.deathTick!==null)died.set(n.deathTick,(died.get(n.deathTick)??0)+1);}
  let population=12;const totals={births:0,deaths:0,blockedCap:0,blockedSpace:0};
  for(let i=0;i<rows.length;i++){
    const r=rows[i];record(r,`tickRows[${i}]`);exactKeys(r,['tick','population','cells','births','deaths','blockedCap','blockedSpace','cap48','nearCap47'],`tickRows[${i}]`);
    const tick=i+1;invariant(r.tick===tick,`tick rows are not contiguous at ${tick}`);int(r.population,`tick ${tick} population`,0,RULES.maxOrganisms);int(r.cells,`tick ${tick} cells`,0,RULES.maxOccupied);
    for(const k of ['births','deaths','blockedCap','blockedSpace'])int(r[k],`tick ${tick} ${k}`);
    invariant(r.population===population+r.births-r.deaths,`population transition mismatch at ${tick}`);
    invariant(r.population>0||tick===finalTick,`population reached extinction before terminal tick ${tick}`);
    invariant(r.cap48===(r.population===RULES.maxOrganisms)&&r.nearCap47===(r.population>=RULES.maxOrganisms-1),`cap flags mismatch at ${tick}`);
    invariant(r.births===(born.get(tick)??0)&&r.deaths===(died.get(tick)??0),`lineage event delta mismatch at ${tick}`);
    population=r.population;totals.births+=r.births;totals.deaths+=r.deaths;totals.blockedCap+=r.blockedCap;totals.blockedSpace+=r.blockedSpace;
    if(tick%20===0||tick===finalTick){const s=samples.find((x)=>x.tick===tick);invariant(s,`missing sample at ${tick}`);
      invariant(s.census.population===r.population&&s.census.cells===r.cells&&s.census.births===totals.births&&s.census.deaths===totals.deaths&&
        s.census.blockedCapBirths===totals.blockedCap&&s.census.blockedSpaceBirths===totals.blockedSpace,`sample counters disagree with ticks at ${tick}`);}
  }
  invariant(extinctionTick===null||rows.length===extinctionTick,`extinction row coverage mismatch`);
}
function validateWindow(value:unknown,index:number,a:Obj):void{
  const w=WINDOWS[index]!;const expected=summarizeWindow(w,a.tickRows,a.samples,a.snapshots,a.snapshots.at(-1).state,a.snapshots.at(-1).environment,a.run.extinctionTick);
  invariant(same(value,expected),`window ${w.from}-${w.to} differs from observations`);
}
export function validatePrefixRecord(a:Obj,prior:Obj):void{
  const p=a.provenance.prefix;exactKeys(p,['status','seed','normalization','comparedSamples','comparedFrames','comparedTickRows','comparedSnapshots','checkpoints'],'prefix proof');
  invariant(p.status==='verified'&&p.seed===a.run.seed&&p.normalization==='For ticks <=6000, copy new state and set only rules.maxHistory 451->301; hash SHA256(JSON.stringify({state,environment})). Compare all retained samples, frames, tick rows, and old snapshots.',`prefix proof identity mismatch`);
  invariant(p.comparedSamples===PREFIX_SAMPLE_COUNT&&p.comparedFrames===PREFIX_FRAME_COUNT&&p.comparedTickRows===PREFIX_TICKROW_COUNT&&p.comparedSnapshots===OLD_CHECKPOINT_TICKS.length,`prefix proof coverage counts mismatch`);
  invariant(prior.run.seed===a.run.seed&&prior.run.finalTick===PREFIX_END&&prior.samples.length===PREFIX_SAMPLE_COUNT&&prior.frames.length===PREFIX_FRAME_COUNT&&prior.tickRows.length===PREFIX_TICKROW_COUNT,`wrong-seed or incomplete pinned prefix`);
  const prefixSamples=a.samples.filter((s:Sample)=>s.tick<=PREFIX_END);const prefixFrames=a.frames.filter((f:Frame)=>f.tick<=PREFIX_END);
  invariant(prefixSamples.length===PREFIX_SAMPLE_COUNT&&prefixFrames.length===PREFIX_FRAME_COUNT,`prefix sample/frame coverage mismatch`);
  for(let i=0;i<PREFIX_SAMPLE_COUNT;i++){
    const x=prefixSamples[i]!,y=prior.samples[i],xf=prefixFrames[i]!,yf=prior.frames[i];
    invariant(y&&x.tick===y.tick&&same(x.census,y.census)&&same(x.environment,y.environment)&&x.normalizedStateSha256===y.stateSha256,`prefix sample mismatch at ${x.tick}`);
    invariant(yf&&xf.tick===yf.tick&&xf.normalizedFrameSha256===yf.frameSha256&&same(frameProjectionFromFrame(xf),frameProjectionFromFrame(yf)),`prefix frame mismatch at ${xf.tick}`);
  }
  invariant(same(a.tickRows.slice(0,PREFIX_TICKROW_COUNT),prior.tickRows),`prefix tick rows mismatch`);
  invariant(same(p.checkpoints.map((x:Obj)=>x.tick),OLD_CHECKPOINT_TICKS),`prefix checkpoint coverage mismatch`);
  for(const x of p.checkpoints){exactKeys(x,['tick','normalizedStateSha256','compared'],'prefix checkpoint');int(x.tick,'prefix checkpoint tick',0,PREFIX_END);
    const oldState=prior.snapshots.find((s:Obj)=>s.tick===x.tick)?.state;const oldSample=prior.samples.find((s:Obj)=>s.tick===x.tick);
    invariant(x.compared===true&&oldState&&oldSample&&x.normalizedStateSha256===oldSample.stateSha256,`prefix checkpoint hash mismatch at ${x.tick}`);
    const retained=a.snapshots.find((s:SnapshotRecord)=>s.tick===x.tick);if(retained)invariant(same(normalizePrefixState(retained.state),oldState),`retained full prefix state mismatch at ${x.tick}`);}
  invariant(same(a.rules,{...prior.rules,maxHistory:451})&&same(RULES,{...prior.rules,maxHistory:451}),`rules differ beyond maxHistory normalization`);
  const nw=a.windows[0],ow=prior.windows[3];invariant(nw.from===5501&&nw.to===6000&&nw.executedTicks===ow.executedTicks&&nw.births===ow.births&&nw.deaths===ow.deaths&&
    nw.cap48Ticks===ow.cap48Ticks&&nw.nearCap47Ticks===ow.nearCap47Ticks&&nw.blockedCapAttempts===ow.blockedCapAttempts&&nw.blockedSpaceAttempts===ow.blockedSpaceAttempts,
    `reference window 5501-6000 differs from pinned prior result`);
}

export function validateEvidenceStructure(value:unknown,sources?:Record<string,string>):asserts value is Obj{
  record(value,'evidence');exactKeys(value,['schemaVersion','kind','run','runtime','rules','provenance','samples','tickRows','frames','snapshots','windows','final','repeat','numericalGate','dataSha256'],'evidence');
  invariant(value.schemaVersion===1&&value.kind==='hungry-shapes-uniform-endurance',`unsupported evidence schema`);record(value.run,'run');
  exactKeys(value.run,['seed','mode','mutation','maxTick','finalTick','extinctionTick'],'run');int(value.run.seed,'seed',1201,1203);
  invariant(value.run.mode==='uniform'&&value.run.mutation===true&&value.run.maxTick===MAX_TICK,`run settings mismatch`);int(value.run.finalTick,'final tick',0,MAX_TICK);
  invariant(value.run.extinctionTick===null||Number.isSafeInteger(value.run.extinctionTick)&&value.run.extinctionTick>=1&&value.run.extinctionTick===value.run.finalTick,`extinction/final tick mismatch`);
  invariant(value.run.extinctionTick!==null||value.run.finalTick===MAX_TICK,`live run did not reach 9000`);
  if(value.run.extinctionTick!==null)invariant(value.final?.census?.population===0,`extinct run has living terminal population`);
  else invariant(Number.isSafeInteger(value.final?.census?.population)&&value.final.census.population>0,`live run has zero terminal population`);
  invariant(same(value.rules,RULES)&&value.rules.maxHistory===451&&value.runtime?.node===NODE_VERSION&&value.runtime.platform==='darwin'&&value.runtime.arch==='arm64',`rules/runtime mismatch`);
  record(value.provenance,'provenance');exactKeys(value.provenance,['sourceSha256','priorArtifactSha256','priorDataSha256','prefix'],'provenance');record(value.provenance.sourceSha256,'source hashes');
  invariant(same(Object.keys(value.provenance.sourceSha256).sort(),Object.keys(LOADED_SOURCE_SHA256).sort()),`source hash fields mismatch`);
  for(const d of Object.values(value.provenance.sourceSha256))invariant(typeof d==='string'&&/^[a-f0-9]{64}$/.test(d),`malformed source hash`);
  assertSourceIdentity();const expectedSources=sources??LOADED_SOURCE_SHA256;invariant(same(value.provenance.sourceSha256,expectedSources),`stale source hash`);
  for(const [path,digest] of Object.entries(PINNED_INPUTS))invariant(value.provenance.sourceSha256[path]===digest,`source pin mismatch: ${path}`);
  const prior=prefixData(value.run.seed);const priorIdentity=PRIOR_IDENTITIES[value.run.seed as keyof typeof PRIOR_IDENTITIES];
  invariant(value.provenance.priorArtifactSha256===priorIdentity.artifactSha256&&value.provenance.priorDataSha256===priorIdentity.dataSha256,`pinned prior identity mismatch`);
  record(value.provenance.prefix,'prefix proof');
  invariant(Array.isArray(value.final?.lineage),`final lineage missing`);validateLineage(value.final.lineage,value.run.finalTick,'final lineage');
  invariant(Array.isArray(value.samples)&&Array.isArray(value.frames)&&Array.isArray(value.snapshots)&&Array.isArray(value.tickRows),`observations missing`);
  for(const s of value.snapshots)if(s?.state)validateSnapshotLineageProjection(s.state,value.final.lineage);
  const cadence=expectedSampleTicks(value.run.finalTick,value.run.extinctionTick);invariant(same(value.samples.map((s:Sample)=>s.tick),cadence),`sample cadence/terminal mismatch`);
  invariant(same(value.frames.map((f:Frame)=>f.tick),cadence),`frame cadence/terminal mismatch`);
  for(let i=0;i<value.samples.length;i++){
    const s=value.samples[i];record(s,`sample[${i}]`);exactKeys(s,['tick','census','environment','censusSha256','stateSha256','normalizedStateSha256','frameSha256'],`sample[${i}]`);
    validateCensus(s.census,`sample[${i}].census`,s.tick);invariant(s.census.tick===s.tick&&s.censusSha256===hash(s.census),`sample census digest mismatch`);
    validateEnvironment(s.environment,s.tick,`sample[${i}].environment`);invariant(/^[a-f0-9]{64}$/.test(s.stateSha256)&&/^[a-f0-9]{64}$/.test(s.frameSha256),`sample digest malformed`);
    const f=value.frames[i];validateFrame(f,`frame[${i}]`);invariant(f.tick===s.tick&&f.censusSha256===s.censusSha256&&f.stateSha256===s.stateSha256&&
      f.normalizedStateSha256===s.normalizedStateSha256&&f.frameSha256===s.frameSha256,`frame/sample binding mismatch at ${s.tick}`);
    invariant(s.tick<=PREFIX_END?typeof s.normalizedStateSha256==='string'&&/^[a-f0-9]{64}$/.test(s.normalizedStateSha256):s.normalizedStateSha256===null,`sample normalized state hash mismatch at ${s.tick}`);
    validateFrameLineage(f,value.final.lineage,s.census,`frame ${s.tick}`);
    invariant(f.cells.length===s.census.cells,`frame/census cell count mismatch`);const families=[0,0,0];for(const o of f.organisms)families[o.family]++;
    invariant(f.organisms.length===s.census.population&&same(families,s.census.familyCounts),`frame/census family mismatch`);
    const food=Buffer.from(f.foodBase64,'base64');invariant(food.reduce((x,y)=>x+y,0)+s.census.totalEnergy===f.ledger.actual&&f.ledger.supplied===s.environment.accepted&&
      f.ledger.residual===f.ledger.actual-f.ledger.expected&&f.ledger.residual===0&&f.ledger.expected===f.ledger.initialEnergy+f.ledger.supplied-f.ledger.dissipated-f.ledger.deathLoss,`frame/census energy mismatch at ${s.tick}`);
    if(i){const p=value.samples[i-1];invariant(s.census.births>=p.census.births&&s.census.deaths>=p.census.deaths&&s.census.growths>=p.census.growths&&s.census.effectiveMutations>=p.census.effectiveMutations&&s.environment.accepted>=p.environment.accepted,`sample counters decreased`);}
  }
  invariant(same(value.snapshots.map((s:SnapshotRecord)=>s.tick),expectedSnapshotTicks(value.run.finalTick,value.run.extinctionTick)),`snapshot coverage mismatch`);
  for(let i=0;i<value.snapshots.length;i++){
    const s=value.snapshots[i];record(s,`snapshot[${i}]`);exactKeys(s,['tick','terminal','environment','state','stateSha256'],`snapshot[${i}]`);
    const terminal=value.run.extinctionTick!==null&&s.tick===value.run.extinctionTick;invariant(s.terminal===terminal,`terminal snapshot label mismatch`);
    validateEnvironment(s.environment,s.tick,`snapshot[${i}].environment`);validateSnapshot(s.state,{seed:value.run.seed,tick:s.tick,extinctionTick:terminal?s.tick:null},`snapshot[${i}].state`);
    invariant(s.stateSha256===hash({state:s.state,environment:s.environment}),`snapshot digest mismatch at ${s.tick}`);
    const sample=value.samples.find((x:Sample)=>x.tick===s.tick),frame=value.frames.find((x:Frame)=>x.tick===s.tick);
    invariant(sample&&frame&&sample.stateSha256===s.stateSha256&&same(sample.environment,s.environment)&&same(sample.census,censusFromSnapshot(s.state)),`snapshot/sample binding mismatch at ${s.tick}`);
    validateSnapshotHistoryBindings(s.state,value.samples);
    validateSnapshotLineageProjection(s.state,value.final.lineage);
    invariant(same(frameProjection(s.state),{foodBase64:frame.foodBase64,cells:frame.cells,organisms:frame.organisms,ledger:frame.ledger}),`snapshot/frame projection mismatch at ${s.tick}`);
  }
  const last=value.snapshots.at(-1);invariant(last.tick===value.run.finalTick&&last.state.droppedHistory===0&&last.state.droppedLineage===0,`terminal state dropped observations`);
  const retainedHistory=new Map(last.state.history.map((row:DevelopmentCensus)=>[row.tick,row]));
  for(const sample of value.samples)invariant(same(sample.census,retainedHistory.get(sample.tick)),`sample differs from terminal retained history at ${sample.tick}`);
  record(value.final,'final');exactKeys(value.final,['census','environment','ledger','lineage','deathsByCause','maxEverGeneration','stateSha256'],'final');
  invariant(same(value.final.census,censusFromSnapshot(last.state))&&same(value.final.environment,last.environment)&&same(value.final.ledger,last.state.ledger)&&same(value.final.lineage,last.state.lineage)&&value.final.stateSha256===last.stateSha256,`final state mismatch`);
  invariant(value.final.deathsByCause.age===value.final.lineage.filter((n:DevelopmentLineageNode)=>n.deathCause==='age').length&&value.final.deathsByCause.starvation===value.final.lineage.filter((n:DevelopmentLineageNode)=>n.deathCause==='starvation').length&&value.final.maxEverGeneration===Math.max(0,...value.final.lineage.map((n:DevelopmentLineageNode)=>n.generation)),`lineage summary mismatch`);
  validateTickRows(value.tickRows,value.run.finalTick,value.run.extinctionTick,value.final.lineage,value.samples);
  invariant(Array.isArray(value.windows)&&value.windows.length===4,`window count mismatch`);value.windows.forEach((w:unknown,i:number)=>validateWindow(w,i,value));
  invariant(same(value.numericalGate,evaluateGate(value.run.finalTick,value.final.census,value.windows)),`numerical gate mismatch`);
  record(value.repeat,'repeat');exactKeys(value.repeat,['verified','comparedThroughTick','stateChecks','frameChecks'],'repeat');
  invariant(value.repeat.verified===true&&value.repeat.comparedThroughTick===value.run.finalTick&&value.repeat.stateChecks===value.samples.length&&value.repeat.frameChecks===value.frames.length,`repeat proof mismatch`);
  validatePrefixRecord(value,prior);invariant(typeof value.dataSha256==='string'&&value.dataSha256===artifactHash(value),`artifact integrity hash mismatch`);
  invariant(Buffer.byteLength(JSON.stringify(value))<=MAX_ARTIFACT_BYTES,`artifact exceeds 24 MiB cap`);
}

export function buildMarkdown(data:Obj):string{
  const lines=['# Uniform food endurance screen','',`Seed ${data.run.seed}; Node ${data.runtime.node} on ${data.runtime.platform}/${data.runtime.arch}.`,`Uniform food, mutation enabled; stopped at ${data.run.finalTick}${data.run.extinctionTick===null?'':' (extinct)'}.`,
    'Descriptive engineered-rule longevity screen. This does not test adaptation or compare a rerun original/patches arm.','',
    '| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Cap blocked | Space blocked | Population min–max | Endpoint population/cells |','| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |'];
  for(const w of data.windows)lines.push(`| ${w.from}–${w.to} | ${w.executedTicks}/500 | ${w.births} | ${w.deaths} | ${w.cap48Ticks}/500 | ${w.nearCap47Ticks}/500 | ${w.blockedCapAttempts} | ${w.blockedSpaceAttempts} | ${w.minPopulation??'—'}–${w.maxPopulation??'—'} | ${w.endpoint.population}/${w.endpoint.cells} |`);
  lines.push('',`Numerical gate: ${data.numericalGate.numericalPass?'pass':'fail'}. Manual visual decision is separate and compares adjacent 6000→7000→8000→9000 frames.`,`Prefix: ${data.provenance.prefix.status} through 6000; artifact SHA-256 ${data.dataSha256}.`,
    'Frames are every 20 actual ticks plus any off-cadence terminal tick. Post-extinction ticks are zero-occupancy window slots, not simulated observations.','No claim of adaptation, fitness improvement, or general survival benefit.','');return lines.join('\n');
}
export function parseArgs(argv:string[]):{mode:'--write'|'--check'|'--replay-check';seed:number}{
  const actions=['--write','--check','--replay-check'];const mode=argv.find((x)=>actions.includes(x));invariant(mode!==undefined,'Usage: --write|--check|--replay-check --seed 1201|1202|1203');
  invariant(argv.filter((x)=>actions.includes(x)).length===1,'Choose exactly one action');const i=argv.indexOf('--seed');invariant(i>=0&&/^\d+$/.test(argv[i+1]??''),'An explicit --seed is required');
  invariant(argv.every((x,j)=>j===i||j===i+1||actions.includes(x)),'Unknown argument');const seed=Number(argv[i+1]);int(seed,'seed',1201,1203);return{mode:mode as any,seed};
}
async function writeEvidence(seed:number):Promise<void>{
  assertPinnedInputs();assertSourceIdentity();const jsonURL=JSON_URL(seed),mdURL=MD_URL(seed);
  execFileSync(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('../uniform-food/explore.ts',import.meta.url)),'--check','--seed',String(seed)],{stdio:'pipe'});
  for(const url of [jsonURL,mdURL]){try{await readFile(url);throw new Error(`Refusing to overwrite seed ${seed} evidence`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  const data=runUniform(seed);assertSourceIdentity();const markdown=buildMarkdown(data);const json=`${JSON.stringify(data)}\n`;invariant(Buffer.byteLength(json)<=MAX_ARTIFACT_BYTES,`JSON exceeds 24 MiB cap`);
  await writeFile(jsonURL,json,{flag:'wx'});try{await writeFile(mdURL,markdown,{flag:'wx'});}catch(e){throw new Error(`JSON written but Markdown failed; preserve JSON and investigate: ${String(e)}`);}
  process.stdout.write(`Wrote uniform-endurance seed ${seed} evidence.\n`);
}
async function checkEvidence(seed:number):Promise<void>{
  assertPinnedInputs();assertSourceIdentity();const data=JSON.parse(await readFile(JSON_URL(seed),'utf8')) as Obj;validateEvidenceStructure(data,LOADED_SOURCE_SHA256);
  invariant(data.run.seed===seed,`artifact seed differs`);invariant(await readFile(MD_URL(seed),'utf8')===buildMarkdown(data),`Markdown differs from JSON`);assertSourceIdentity();
  process.stdout.write(`Uniform-endurance seed ${seed} structure, provenance, accounting, and Markdown passed.\n`);
}
async function replayCheck(seed:number):Promise<void>{
  assertPinnedInputs();assertSourceIdentity();const prior=JSON.parse(await readFile(JSON_URL(seed),'utf8')) as Obj;const current=runUniform(seed);
  invariant(same(prior,current),`fresh independent replay differs`);invariant(await readFile(MD_URL(seed),'utf8')===buildMarkdown(current),`replay Markdown differs`);assertSourceIdentity();
  process.stdout.write(`Uniform-endurance seed ${seed} fresh replay matches.\n`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const {mode,seed}=parseArgs(process.argv.slice(2));if(mode==='--write')await writeEvidence(seed);else if(mode==='--check')await checkEvidence(seed);else await replayCheck(seed);}
