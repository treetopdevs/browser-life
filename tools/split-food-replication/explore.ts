#!/usr/bin/env node
/** One unchanged split-food replication. Importing this module never starts a run. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  HungryWorld, RULES, SPLIT_BAND_TARGET_COUNT, SPLIT_BAND_COLUMNS,
  type DevelopmentCensus, type DevelopmentGenome, type DevelopmentLineageNode, type DevelopmentOrganism,
  type DevelopmentSnapshot, type HungryEnvironment,
} from '../../apps/lab/src/split-food/model.ts';

type Obj = Record<string, any>;
export type StationaryFoodTickRow = { tick:number; population:number; cells:number; births:number; deaths:number; blockedCap:number; blockedSpace:number; cap48:boolean; nearCap47:boolean };
export type StationaryFoodFrame = { tick:number; censusSha256:string; stateSha256:string; foodBase64:string; cells:[number,number][];
  organisms:{id:number;family:number;genome:DevelopmentGenome}[]; ledger:DevelopmentSnapshot['ledger']; frameSha256:string };
export type StationaryFoodSample = { tick:number; census:DevelopmentCensus; environment:HungryEnvironment; censusSha256:string; stateSha256:string; frameSha256:string };
export type StationaryFoodSnapshot = { tick:number; terminal:boolean; environment:HungryEnvironment; state:DevelopmentSnapshot; stateSha256:string };
type TickRow=StationaryFoodTickRow;type Frame=StationaryFoodFrame;type Sample=StationaryFoodSample;type SnapshotRecord=StationaryFoodSnapshot;
export type SplitFoodEvidence = { schemaVersion:1;kind:'hungry-shapes-split-food-replication-arm';
  run:{seed:1203;mode:'split-band';mutation:true;maxTick:3000;finalTick:number;extinctionTick:number|null};
  runtime:{node:string;platform:string;arch:string};rules:typeof RULES;
  provenance:{sourceSha256:Record<string,string>;planSha256:string;baselineArtifactSha256:string;baselineDataSha256:string;baselineIndexSha256:string;
    baselineRegression:{status:'verified';seed:1203;comparedSamples:number;comparedFrames:number;comparedTickRows:number;comparedSnapshots:number;checkpoints:{tick:number;stateSha256:string;compared:true}[]}};
  samples:StationaryFoodSample[];tickRows:StationaryFoodTickRow[];frames:StationaryFoodFrame[];snapshots:StationaryFoodSnapshot[];windows:Obj[];final:Obj;repeat:Obj;numericalGate:Obj;spatialGate:Obj;dataSha256:string };

export const MAX_TICK=3000;
export const SAMPLE_EVERY=20;
export const WINDOWS:readonly {from:number;to:number}[]=Object.freeze([{from:1501,to:2000},{from:2001,to:2500},{from:2501,to:3000}]);
export const FIXED_SNAPSHOTS=Object.freeze([0,500,1500,2500,3000]);
const NODE_VERSION='24.2.0';
const BASELINE_SAMPLE_COUNT=151,BASELINE_FRAME_COUNT=151;
const MAX_ARTIFACT_BYTES=24*1024*1024;
const BASELINE_JSON_URL=new URL('../../docs/creative-prototypes/stationary-food-replication-stationary-band-seed-1203.json',import.meta.url);
const BASELINE_INDEX_URL=new URL('../../docs/creative-prototypes/stationary-food-replication-index-1203.json',import.meta.url);
export const OUTPUT_PATHS=Object.freeze({json:'docs/creative-prototypes/split-food-replication-seed-1203.json',markdown:'docs/creative-prototypes/split-food-replication-seed-1203.md'});
const JSON_URL=new URL(`../../${OUTPUT_PATHS.json}`,import.meta.url);
const MD_URL=new URL(`../../${OUTPUT_PATHS.markdown}`,import.meta.url);
export const SPLIT_FOOD_REPLICATION_PLAN_SHA256='0858e5292d1a9949d1dfd53479519a518fbbe5b849363e577a7e630a0ece384d';
const HISTORICAL_STATIONARY_PLAN_SHA256='74dc68201c7fb51ed9a87ba75d13e0ad79b171ff0d73d7929af4ba4f03fa114a';
const BASELINE_IDENTITY=Object.freeze({
  artifactSha256:'234c3c0eb54b5d6875f400e155b95f9afaa20638b511c0a4285305c9aac2ba7c',
  dataSha256:'236e98377fd6795236f2b6ecf3907bb637324866791e12c478e63ac7e9664ba7',
  indexSha256:'73cf2ebfa0ab266d716d48f1c6b966872ad7cc2a68d7d95fe51729cfab6a16b3',
  pairedMovingArtifactSha256:'000e1ce6a3a60ab216707136ba97edf97bdcde826a63af2d3c27bf54e7810e3d',
  movingArtifactSha256:'8ce7be228812002e2d03a2f68a15b9d1107e6fff022006ae9059003bb66e0c9b',
  movingDataSha256:'eb8a0985950d5de4450b1a911bd602761644a3adb96a9bd8265c5fd1e5af572e',
});
const PINNED_INPUTS=Object.freeze({
  'apps/lab/src/development/model.ts':'49416b11ae8d0491cb9b2ae1f102f36779cd9fe0c72917a7ddf86fbbc63db072',
  'apps/lab/src/hungry-shapes/model.ts':'a33a3312caa6c91a46e2508f5b9267e3394089ff7320145a15157770068123bc',
  'apps/lab/src/moving-food/model.ts':'b7aa0a3f1a0183d574e152e16b7f12c24fc0c9a201e7ddfae6d576915f10d8b0',
  'tools/moving-food/explore.ts':'b77c58eca007727beeca81b1a797978a8ddfbacaa4d3192a094164bf868df63a',
  'tools/moving-food-replication/explore.ts':'a8403864210d575baaa0acfae4a1a8ab684909bf0e8df541a1103394d2e11969',
  'apps/lab/src/stationary-food/model.ts':'7bd5af02243cb0629547a20d889a05cd904246a16227f58df4e420edc84a859f',
  'tools/stationary-food/explore.ts':'ab692de5ede5ece9cfdc1af8d0e44c651a0bc30ff8aa6493b35e6a02672250f6',
  'docs/creative-prototypes/stationary-food-plan.md':'ba835f94fddbd48a823fb6264d3e4f9d8a815014c5bc5e4997fec56e6f7aaa51',
  'tools/stationary-food-replication/explore.ts':'18d9c74da2cd2d803923a544c2b717b06976909738699756e16abaa832b316f4',
  'docs/creative-prototypes/stationary-food-replication-plan.md':HISTORICAL_STATIONARY_PLAN_SHA256,
  'docs/creative-prototypes/split-food-plan.md':'134944138fc636b1c9677e9a40b5c2583d7184d608ce1e8d8c914e2ce8d93515',
  'docs/creative-prototypes/split-food-replication-plan.md':SPLIT_FOOD_REPLICATION_PLAN_SHA256,
  'apps/lab/src/split-food/model.ts':'c6b5c37f20f8daa73858fd9e437d0b25d029c712c065ab11ef495c281b58b506',
  'tools/split-food/explore.ts':'aa2d3aeca0cd7a1a58e405c681cc6e61b5b15da2b0b85262a12c4f6fa95009bd',
  'docs/creative-prototypes/stationary-food-replication-stationary-band-seed-1203.json':BASELINE_IDENTITY.artifactSha256,
  'docs/creative-prototypes/stationary-food-replication-index-1203.json':BASELINE_IDENTITY.indexSha256,
  'docs/creative-prototypes/stationary-food-replication-moving-band-seed-1203.json':BASELINE_IDENTITY.pairedMovingArtifactSha256,
  'docs/creative-prototypes/moving-food-replication-moving-band-seed-1203.json':BASELINE_IDENTITY.movingArtifactSha256,
  'docs/creative-prototypes/moving-food-replication-index-1203.json':'44e02b3416e40cdde5318c1fecea2dd54bda8f9543df97c006aabc29dc24ce16',
  'docs/creative-prototypes/moving-food-moving-band-seed-1201.json':'46017d1db1eaf1ff85b8cc51d92533d928aeac18b3e7cf261a82bb9d0d0816bf',
  'docs/creative-prototypes/moving-food-index.json':'5f2ca66cb2d0bd39c0c017c4372381032746a0ba14076ecef71d8df079cccc57',
  'docs/creative-prototypes/hungry-shapes-seed-1201.json':'2cb6366595e43e2f5f215448bd13a67925e21f2ea11e4747790f6f61470b6520',
  'docs/creative-prototypes/hungry-shapes-seed-1201.md':'0f64a51d0ab22fe346160ed0ef94877a78998700372ce8ff1ffde3ef0f88a0f1',
  'docs/creative-prototypes/hungry-shapes-decision.json':'f935884132cd1f34edb5fec1af57eeaa033d87505448ea07acd05ed772c5d5b0',
  'apps/lab/src/uniform-endurance/model.ts':'b83de32cf42f58c13977dbbd3c74bf9d3068f90b40ec09600b9125ddb0a72009',
  'tools/hungry-shapes/explore.ts':'f49d2a63fc7b464bcd2115c683f3e40ec8381eb28aa8b318889552ea9bc23581',
  'tools/uniform-food/explore.ts':'312c2cffd7102e8c58fc1eabb72173d53692c8527f950b74ba33be4917b4a80c',
  'tools/uniform-endurance/explore.ts':'99099663fd619a644c29ff639bca1e6c884bc9d07161f3ba40fe3ec2f0fd7f77',
  'docs/creative-prototypes/uniform-endurance-seed-1201.json':'6b480bced89b1c7bf9ab759c84fb28c9bfdcd1f9c2a6ecc7e922ddba1a590221',
  'docs/creative-prototypes/uniform-endurance-seed-1201.md':'b7a831f8c6565479f9644d4ad06be86fbe230a41908773158af77116b7b699f2',
  'docs/creative-prototypes/uniform-endurance-seed-1202.json':'a67a99bde41317f59c3b0fdf6521cc561c9a2b4db38d12783ea2f9be0d5f5602',
  'docs/creative-prototypes/uniform-endurance-seed-1202.md':'3de277dc0d3a11acd20501a1c6a55133dd46ed80b0609c643f8111f7806aacda',
  'docs/creative-prototypes/uniform-endurance-seed-1203.json':'94fa6328fb74038793f859d629ef9535e5f610dd22eceeaa74d4677218b2b15d',
  'docs/creative-prototypes/uniform-endurance-seed-1203.md':'0ee0dc77840fa97babf8b1569ce66245b2e978692138cd2dc46cfeed587c1bbd',
  'docs/creative-prototypes/moving-food-replication-plan.md':'72f651acc7f221991b0ce89f7264eed9dd47df54e955d3d164406b4d0a17cc47',
  'docs/creative-prototypes/moving-food-uniform-seed-1201.json':'1ae6bdc3c9f5bedd2b6f6cfb70aa9dc94e8acb8177f4c2ecda9c2859bf1e4458',
  'docs/creative-prototypes/moving-food-uniform-seed-1201.md':'af43523fa6108f6a136d5eb734db3908c6258c862c29bc69edb71f53123d6efe',
  'docs/creative-prototypes/moving-food-moving-band-seed-1201.md':'b2de64b26073439a52ca2ed7fa121d078e559d32205c8737e3252cf1aa7f6471',
});
const DISK_INPUTS=Object.entries(PINNED_INPUTS).map(([path])=>[path,new URL(`../../${path}`,import.meta.url)] as const);
const SELF_URL=new URL('./explore.ts',import.meta.url);
const SPLIT_MODEL_URL=new URL('../../apps/lab/src/split-food/model.ts',import.meta.url);
const CENSUS_FIELDS=['tick','population','cells','familyCounts','births','growths','deaths','effectiveMutations','attemptedMutations','maxGeneration','totalCells','totalEnergy','meanBodyCells','meanEnergy','blockedBirths','blockedSpaceBirths','blockedCapBirths','ledgerResidual','genomeVariantCount'] as const;
const COUNTER_FIELDS=['births','growths','deaths','effectiveMutations','attemptedMutations','blockedSpaceBirths','blockedCapBirths'] as const;
const GENOME_FIELDS=['turnEvery','turn','branchEvery','maxCells'] as const;

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

/** Adapted full per-tick safety validator for this 3,000-tick paired screen. */
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
  const expectedTargets=(env.mode==='split-band'?SPLIT_BAND_TARGET_COUNT:RULES.height*48);
  invariant((env.mode==='moving-band'||env.mode==='stationary-band'||env.mode==='split-band')&&env.pulseBudget===768&&env.targetCount===expectedTargets&&env.accepted===ledger.supplied&&
    env.offered===env.accepted+env.overflow&&env.pulses===Math.floor(world.tick/RULES.foodSupplyEvery)&&env.offered===env.pulses*env.pulseBudget,
    `${label}: food ledger`);
  if(env.mode==='split-band') invariant(env.bandWidth===24&&same(env.bandColumns,SPLIT_BAND_COLUMNS)&&env.bandLeft===undefined,`${label}: split band geometry`);
  else invariant(env.bandWidth===48&&env.bandLeft===(env.mode==='moving-band'?Math.floor(world.tick/50)%RULES.width:0)&&env.bandColumns===undefined,`${label}: band geometry`);
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

function sourceHashes():Record<string,string>{
  const pinned=Object.fromEntries(DISK_INPUTS.map(([name,url])=>[name,hashBytes(readFileSync(url))]));
  return {...pinned,'apps/lab/src/split-food/model.ts':hashBytes(readFileSync(SPLIT_MODEL_URL)),
    'tools/split-food-replication/explore.ts':hashBytes(readFileSync(SELF_URL))};
}
export const LOADED_SOURCE_SHA256=Object.freeze(sourceHashes());
export function assertSourceIdentity(expected:Record<string,string>=LOADED_SOURCE_SHA256,current=sourceHashes()):void{
  invariant(same(expected,current),'Evidence sources changed since runner load; reload before accepting evidence');
}
export function assertPinnedInputs(current=sourceHashes()):void{
  for(const [path,digest] of Object.entries(PINNED_INPUTS))invariant(current[path]===digest,`Pinned input changed: ${path}`);
}
function makeFrame(world:HungryWorld,census:DevelopmentCensus,stateSha256:string):Frame{
  const organisms=world.organisms.map((o)=>({id:o.id,family:o.family,genome:o.genome}));
  const cells:[number,number][]=[];for(const o of world.organisms)for(const c of o.cells)cells.push([c.tile,o.id]);cells.sort((a,b)=>a[0]-b[0]);
  const base={tick:world.tick,censusSha256:hash(census),stateSha256,foodBase64:Buffer.from(world.food).toString('base64'),cells,organisms,ledger:world.ledger};
  return {...base,frameSha256:hash(base)};
}
function frameProjection(s:DevelopmentSnapshot):Pick<Frame,'foodBase64'|'cells'|'organisms'|'ledger'>{
  const cells:[number,number][]=[];for(const o of s.organisms)for(const c of o.cells)cells.push([c.tile,o.id]);cells.sort((a,b)=>a[0]-b[0]);
  return {foodBase64:Buffer.from(s.food).toString('base64'),cells,organisms:s.organisms.map((o)=>({id:o.id,family:o.family,genome:o.genome})),ledger:s.ledger};
}
function frameProjectionFromFrame(f:Frame):Obj{return {foodBase64:f.foodBase64,cells:f.cells,organisms:f.organisms,ledger:f.ledger};}
function makeSample(world:HungryWorld):{sample:Sample;state:DevelopmentSnapshot;frame:Frame}{
  const state=world.snapshot(),environment=world.environment,census=world.census();const stateSha256=hash({state,environment});const frame=makeFrame(world,census,stateSha256);
  return {sample:{tick:world.tick,census,environment,censusSha256:hash(census),stateSha256,frameSha256:frame.frameSha256},state,frame};
}
function tickRow(world:HungryWorld,previous:DevelopmentCensus,census:DevelopmentCensus):TickRow{
  return {tick:world.tick,population:census.population,cells:census.cells,births:census.births-previous.births,deaths:census.deaths-previous.deaths,
    blockedCap:census.blockedCapBirths-previous.blockedCapBirths,blockedSpace:census.blockedSpaceBirths-previous.blockedSpaceBirths,
    cap48:census.population===RULES.maxOrganisms,nearCap47:census.population>=RULES.maxOrganisms-1};
}
export function validateHistoricalIndex(value:unknown,rawSha256:string):void{
  record(value,'historical PR106 stationary index');
  exactKeys(value,['schemaVersion','kind','seed','planSha256','arms','decision'],'historical PR106 stationary index');
  invariant(value.schemaVersion===1&&value.kind==='hungry-shapes-stationary-food-replication-pair'&&value.seed===1203&&
    value.planSha256===HISTORICAL_STATIONARY_PLAN_SHA256,'historical PR106 stationary pair identity mismatch');
  exactKeys(value.arms,['movingBand','stationaryBand'],'historical PR106 arms');
  invariant(value.arms.movingBand.mode==='moving-band'&&value.arms.movingBand.url==='stationary-food-replication-moving-band-seed-1203.json'&&
    value.arms.movingBand.rawSha256===BASELINE_IDENTITY.pairedMovingArtifactSha256,'historical PR106 moving arm binding mismatch');
  invariant(value.arms.stationaryBand.mode==='stationary-band'&&value.arms.stationaryBand.url==='stationary-food-replication-stationary-band-seed-1203.json'&&
    value.arms.stationaryBand.rawSha256===BASELINE_IDENTITY.artifactSha256,'historical PR106 stationary arm binding mismatch');
  record(value.decision,'historical PR106 decision');
  invariant(value.decision.status==='both'&&value.decision.stationaryBandArtifactSha256===BASELINE_IDENTITY.artifactSha256&&
    value.decision.movingBandArtifactSha256===BASELINE_IDENTITY.pairedMovingArtifactSha256,'historical PR106 decision binding mismatch');
  invariant(rawSha256===BASELINE_IDENTITY.artifactSha256,'historical PR106 reference raw SHA mismatch');
}

export function validateHistoricalReference(value:unknown,indexValue:unknown,artifactBytes:Uint8Array,indexBytes:Uint8Array):Obj{
  record(value,'historical PR106 stationary artifact');const data=value as Obj;
  invariant(hashBytes(artifactBytes)===BASELINE_IDENTITY.artifactSha256&&hashBytes(indexBytes)===BASELINE_IDENTITY.indexSha256,
    'pinned PR106 stationary baseline/index bytes changed');
  validateHistoricalIndex(indexValue,hashBytes(artifactBytes));
  invariant(data.dataSha256===BASELINE_IDENTITY.dataSha256&&data.dataSha256===artifactHash(data),'pinned PR106 stationary baseline internal hash mismatch');
  invariant(data.schemaVersion===1&&data.kind==='hungry-shapes-stationary-food-replication-arm'&&data.run?.seed===1203&&data.run.mode==='stationary-band'&&
    data.run.mutation===true&&data.run.maxTick===MAX_TICK&&data.run.finalTick===MAX_TICK&&data.run.extinctionTick===null,
    'pinned PR106 stationary baseline run identity mismatch');
  invariant(same(data.rules,RULES)&&data.provenance?.planSha256===HISTORICAL_STATIONARY_PLAN_SHA256&&
    data.provenance.baselineArtifactSha256===BASELINE_IDENTITY.movingArtifactSha256&&
    data.provenance.baselineDataSha256===BASELINE_IDENTITY.movingDataSha256,'pinned PR106 stationary provenance mismatch');
  exactKeys(data.provenance,['sourceSha256','planSha256','baselineArtifactSha256','baselineDataSha256','prefix'],'historical PR106 provenance');
  exactKeys(data.provenance.prefix,['status','seed','normalization','comparedSamples','comparedFrames','comparedTickRows','comparedSnapshots','checkpoints'],'historical PR106 prefix');
  invariant(data.provenance.prefix.status==='not-applicable'&&data.provenance.prefix.seed===null&&
    data.provenance.prefix.normalization==='none; stationary-band has no moving-reference prefix'&&data.provenance.prefix.comparedSamples===0&&
    data.provenance.prefix.comparedFrames===0&&data.provenance.prefix.comparedTickRows===0&&data.provenance.prefix.comparedSnapshots===0&&
    Array.isArray(data.provenance.prefix.checkpoints)&&data.provenance.prefix.checkpoints.length===0,'historical PR106 stationary prefix declaration mismatch');
  record(data.provenance.sourceSha256,'historical PR106 source map');const pins=PINNED_INPUTS as Record<string,string>;
  for(const [path,digest] of Object.entries(data.provenance.sourceSha256)) invariant(pins[path]===digest,`historical PR106 source pin mismatch: ${path}`);
  invariant(data.samples?.length===151&&data.frames?.length===151&&data.tickRows?.length===3000&&
    same(data.snapshots?.map((s:Obj)=>s.tick),[0,500,1500,2500,3000]),'pinned PR106 stationary payload is incomplete');
  return data;
}

export function baselineData():Obj{
  assertPinnedInputs();
  const bytes=readFileSync(BASELINE_JSON_URL),indexBytes=readFileSync(BASELINE_INDEX_URL);
  return validateHistoricalReference(JSON.parse(bytes.toString('utf8')),JSON.parse(indexBytes.toString('utf8')),bytes,indexBytes);
}

/** Deterministic regression only: full contiguous replay, compared without normalization, no artifact output. */
export function runBaselineRegression(prior:Obj=baselineData()):Obj{
  const world=new HungryWorld(1203,true,'stationary-band');
  invariant(same(world.snapshot(),prior.snapshots[0].state)&&same(world.environment,prior.samples[0].environment),'contiguous baseline tick-zero state differs');
  const samples:Sample[]=[],frames:Frame[]=[],snapshots:SnapshotRecord[]=[],rows:TickRow[]=[];
  let previous=world.census();
  const capture=()=>{
    const captured=makeSample(world);const expectedSample=prior.samples.find((s:Obj)=>s.tick===world.tick),expectedFrame=prior.frames.find((f:Obj)=>f.tick===world.tick);
    invariant(expectedSample&&expectedFrame&&same(captured.sample,expectedSample)&&same(captured.frame,expectedFrame),`contiguous baseline sample/frame differs at ${world.tick}`);
    samples.push(captured.sample);frames.push(captured.frame);
    if(FIXED_SNAPSHOTS.includes(world.tick)){
      const snapshot={tick:world.tick,terminal:false,environment:world.environment,state:captured.state,stateSha256:captured.sample.stateSha256};
      const expected=prior.snapshots.find((s:Obj)=>s.tick===world.tick);
      invariant(expected&&same(snapshot,expected),`contiguous baseline full snapshot differs at ${world.tick}`);snapshots.push(snapshot);
    }
  };
  capture();
  for(let tick=1;tick<=MAX_TICK;tick++){
    world.step(1);assertWorld(world,'contiguous baseline replay');const census=world.census();const row=tickRow(world,previous,census);
    invariant(same(row,prior.tickRows[tick-1]),`contiguous baseline tick row differs at ${tick}`);rows.push(row);
    if(tick%SAMPLE_EVERY===0)capture();previous=census;
    if(world.extinctionTick!==null)throw new Error(`historical contiguous baseline unexpectedly extinct at ${world.tick}`);
  }
  invariant(world.tick===MAX_TICK&&samples.length===BASELINE_SAMPLE_COUNT&&frames.length===BASELINE_FRAME_COUNT&&rows.length===3000&&snapshots.length===5,
    'contiguous baseline replay coverage mismatch');
  return {status:'verified',seed:1203,comparedSamples:samples.length,comparedFrames:frames.length,comparedTickRows:rows.length,
    comparedSnapshots:snapshots.length,checkpoints:snapshots.map((s)=>({tick:s.tick,stateSha256:s.stateSha256,compared:true}))};
}

export function maxEverGenerationAt(lineage:readonly DevelopmentLineageNode[],tick:number|null):number|null{
  if(tick===null)return null;
  const born=lineage.filter((node)=>node.birthTick<=tick);
  return born.length?Math.max(...born.map((node)=>node.generation)):null;
}
export function occupiedTilesByBand(frame:Frame):[number,number]{
  const counts:[number,number]=[0,0];
  for(const [tile] of frame.cells){const column=tile%RULES.width;if(column<24)counts[0]++;else if(column>=48&&column<72)counts[1]++;}
  return counts;
}
export function summarizeWindow(w:{from:number;to:number},rows:TickRow[],samples:Sample[],frames:Frame[],lineage:readonly DevelopmentLineageNode[]):Obj{
  const active=rows.filter((r)=>r.tick>=w.from&&r.tick<=w.to),executedTicks=active.length;
  const status=executedTicks===500?'complete':executedTicks>0?'partial':'not-reached';
  const births=executedTicks?active.reduce((n,r)=>n+r.births,0):null;
  const deaths=executedTicks?active.reduce((n,r)=>n+r.deaths,0):null;
  const cap48Ticks=executedTicks?active.filter((r)=>r.cap48).length:null;
  const nearCap47Ticks=executedTicks?active.filter((r)=>r.nearCap47).length:null;
  const blockedCapAttempts=executedTicks?active.reduce((n,r)=>n+r.blockedCap,0):null;
  const blockedSpaceAttempts=executedTicks?active.reduce((n,r)=>n+r.blockedSpace,0):null;
  const minPopulation=executedTicks?Math.min(...active.map((r)=>r.population)):null;
  const maxPopulation=executedTicks?Math.max(...active.map((r)=>r.population)):null;
  const endpointTick=executedTicks?active.at(-1)!.tick:null;
  const endpointSample=endpointTick===null?undefined:samples.find((s)=>s.tick===endpointTick);
  const endpointFrame=endpointTick===null?undefined:frames.find((f)=>f.tick===endpointTick);
  invariant(endpointTick===null||endpointSample&&endpointFrame,`window endpoint lacks saved sample/frame at ${endpointTick}`);
  const startSample=executedTicks?samples.find((s)=>s.tick===w.from-1):undefined;
  if(executedTicks)invariant(startSample,`window start sample missing at ${w.from-1}`);
  const genomes=new Map<string,{genome:DevelopmentGenome;count:number}>();
  for(const o of endpointFrame?.organisms??[]){const key=JSON.stringify(o.genome),entry=genomes.get(key)??{genome:o.genome,count:0};entry.count++;genomes.set(key,entry);}
  const endpointFood=endpointFrame?Buffer.from(endpointFrame.foodBase64,'base64').reduce((a,b)=>a+b,0):null;
  const occupied=endpointFrame?occupiedTilesByBand(endpointFrame):null;
  const envEnd=endpointSample?.environment,envStart=startSample?.environment;
  const food=executedTicks&&envEnd&&envStart?{offered:envEnd.offered-envStart.offered,accepted:envEnd.accepted-envStart.accepted,overflow:envEnd.overflow-envStart.overflow}:
    {offered:null,accepted:null,overflow:null};
  return {from:w.from,to:w.to,denominatorTicks:500,status,executedTicks,births,deaths,cap48Ticks,nearCap47Ticks,blockedCapAttempts,blockedSpaceAttempts,
    minPopulation,maxPopulation,food,endpoint:{requestedTick:w.to,actualTick:endpointTick,population:endpointSample?.census.population??null,
      cells:endpointSample?.census.cells??null,familyCounts:endpointSample?.census.familyCounts??null,
      genomeCounts:[...genomes.values()].sort((a,b)=>JSON.stringify(a.genome).localeCompare(JSON.stringify(b.genome))),
      maxGeneration:endpointSample?.census.maxGeneration??null,maxEverGeneration:maxEverGenerationAt(lineage,endpointTick),
      foodRemaining:endpointFood,occupiedTilesByBand:occupied}};
}
export function evaluateGate(finalTick:number,census:DevelopmentCensus,windows:Obj[]):Obj{
  const aliveAt3000=finalTick===3000&&census.population>0;
  const atLeastTwoFamiliesAt3000=aliveAt3000&&census.familyCounts.filter((n)=>n>0).length>=2;
  const allWindowsReached=windows.length===WINDOWS.length&&windows.every((w)=>w.status==='complete'&&w.executedTicks===500);
  const eachNewWindowHasBirthsAndDeaths=allWindowsReached&&windows.every((w)=>w.births>0&&w.deaths>0);
  const eachNewWindowCap48AtMost99=allWindowsReached&&windows.every((w)=>w.cap48Ticks<=99);
  return {aliveAt3000,atLeastTwoFamiliesAt3000,allWindowsReached,eachNewWindowHasBirthsAndDeaths,eachNewWindowCap48AtMost99,
    numericalPass:aliveAt3000&&atLeastTwoFamiliesAt3000&&allWindowsReached&&eachNewWindowHasBirthsAndDeaths&&eachNewWindowCap48AtMost99,
    note:'Descriptive trajectory novelty screen only; visual judgment is manual. No claim of tracking, adaptation, fitness improvement, or superiority.'};
}

export function evaluateSpatialGate(checkpoints:{tick:number;occupiedTilesByBand:[number,number]|null}[]):Obj{
  const expected=[2500,3000];
  const complete=checkpoints.length===2&&same(checkpoints.map((x)=>x.tick),expected);
  const evaluated=checkpoints.map((point)=>({tick:point.tick,occupiedTilesByBand:point.occupiedTilesByBand,
    pass:Array.isArray(point.occupiedTilesByBand)&&point.occupiedTilesByBand.length===2&&point.occupiedTilesByBand.every((n)=>Number.isSafeInteger(n)&&n>=10)}));
  return {requiredTilesPerBand:10,checkpoints:evaluated,pass:complete&&evaluated.every((x)=>x.pass)};
}

export function runArm(baselineRegression:Obj):Obj{
  invariant(process.versions.node===NODE_VERSION,`Requires Node ${NODE_VERSION}; found ${process.versions.node}`);
  invariant(process.platform==='darwin'&&process.arch==='arm64',`Accepted runs require darwin/arm64; found ${process.platform}/${process.arch}`);
  assertPinnedInputs();assertSourceIdentity();baselineData();
  invariant(baselineRegression.status==='verified'&&baselineRegression.seed===1203&&baselineRegression.comparedSamples===151&&baselineRegression.comparedFrames===151&&
    baselineRegression.comparedTickRows===3000&&baselineRegression.comparedSnapshots===5,`contiguous baseline regression must pass before split outcome`);
  const primary=new HungryWorld(1203,true,'split-band'),repeat=new HungryWorld(1203,true,'split-band');
  invariant(same(primary.snapshot(),repeat.snapshot())&&same(primary.environment,repeat.environment),`split-band independent initial states differ`);
  const samples:Sample[]=[],frames:Frame[]=[],snapshots:SnapshotRecord[]=[],tickRows:TickRow[]=[];
  let previous=primary.census(),repeatPrevious=repeat.census(),extinctionTick:number|null=null;
  const capture=(terminal=false)=>{
    const a=makeSample(primary),b=makeSample(repeat);
    invariant(same(a.state,b.state)&&same(primary.environment,repeat.environment),`split-band repeat full state differs at ${primary.tick}`);
    invariant(a.frame.frameSha256===b.frame.frameSha256,`split-band repeat frame differs at ${primary.tick}`);
    if(samples.at(-1)?.tick!==primary.tick){samples.push(a.sample);frames.push(a.frame);}
    if(FIXED_SNAPSHOTS.includes(primary.tick)||terminal){snapshots.push({tick:primary.tick,terminal,environment:primary.environment,state:a.state,stateSha256:a.sample.stateSha256});
      invariant(same(frameProjection(a.state),frameProjectionFromFrame(a.frame)),`split-band snapshot/frame projection differs at ${primary.tick}`);}
    return a;
  };
  capture();
  for(let scheduled=1;scheduled<=MAX_TICK;scheduled++){
    if(primary.extinctionTick!==null)break;
    primary.step(1);repeat.step(1);assertWorld(primary,'split-band primary');assertWorld(repeat,'split-band repeat');
    const census=primary.census(),repeatCensus=repeat.census();
    invariant(primary.tick===repeat.tick&&same(census,repeatCensus)&&same(primary.environment,repeat.environment),`split-band repeat census/environment differs at ${scheduled}`);
    invariant(primary.extinctionTick===repeat.extinctionTick,`split-band repeat extinction differs at ${scheduled}`);
    const row=tickRow(primary,previous,census),repeatRow=tickRow(repeat,repeatPrevious,repeatCensus);
    invariant(same(row,repeatRow),`split-band repeat tick row differs at ${scheduled}`);tickRows.push(row);
    if(primary.tick%SAMPLE_EVERY===0||primary.extinctionTick===primary.tick){
      capture(primary.extinctionTick===primary.tick);
    }
    previous=census;repeatPrevious=repeatCensus;
    if(primary.extinctionTick!==null){extinctionTick=primary.extinctionTick;break;}
    if(scheduled===MAX_TICK)invariant(primary.tick===MAX_TICK,'failed to reach frozen 3,000-tick horizon');
  }
  if(primary.tick===MAX_TICK&&extinctionTick===null&&samples.at(-1)?.tick!==MAX_TICK)capture(false);
  invariant(primary.tick===(extinctionTick??MAX_TICK),`split-band terminal tick mismatch`);
  const terminal=primary.snapshot(),environment=primary.environment;
  invariant(terminal.droppedHistory===0&&terminal.droppedLineage===0,`split-band dropped history/lineage observations`);
  const windows=WINDOWS.map((w)=>summarizeWindow(w,tickRows,samples,frames,primary.lineage));
  const spatialGate=evaluateSpatialGate([2500,3000].map((tick)=>{const frame=frames.find((f)=>f.tick===tick);return {tick,occupiedTilesByBand:frame?occupiedTilesByBand(frame):null};}));
  const output:Obj={schemaVersion:1,kind:'hungry-shapes-split-food-replication-arm',run:{seed:1203,mode:'split-band',mutation:true,maxTick:MAX_TICK,finalTick:primary.tick,extinctionTick},
    runtime:{node:process.versions.node,platform:process.platform,arch:process.arch},rules:RULES,
    provenance:{sourceSha256:LOADED_SOURCE_SHA256,planSha256:SPLIT_FOOD_REPLICATION_PLAN_SHA256,baselineArtifactSha256:BASELINE_IDENTITY.artifactSha256,
      baselineDataSha256:BASELINE_IDENTITY.dataSha256,baselineIndexSha256:BASELINE_IDENTITY.indexSha256,baselineRegression},
    samples,tickRows,frames,snapshots,windows,final:{census:primary.census(),environment,ledger:primary.ledger,lineage:primary.lineage,
      deathsByCause:{age:primary.lineage.filter((n)=>n.deathCause==='age').length,starvation:primary.lineage.filter((n)=>n.deathCause==='starvation').length},
      maxEverGeneration:Math.max(0,...primary.lineage.map((n)=>n.generation)),stateSha256:hash({state:terminal,environment})},
    repeat:{verified:true,comparedThroughTick:primary.tick,stateChecks:samples.length,frameChecks:frames.length},
    numericalGate:evaluateGate(primary.tick,primary.census(),windows),spatialGate};
  output.dataSha256=artifactHash(output);validateEvidenceStructure(output,LOADED_SOURCE_SHA256);assertSourceIdentity();
  invariant(Buffer.byteLength(JSON.stringify(output))<=MAX_ARTIFACT_BYTES,`split-band artifact exceeds 24 MiB cap; fail closed`);
  return output;
}

export function validateEnvironment(value:unknown,tick:number,label:string,expectedMode:'split-band'|'stationary-band'):asserts value is HungryEnvironment{
  record(value,label);
  const keys=expectedMode==='split-band'
    ? ['version','mode','pulseBudget','targetCount','pulses','offered','accepted','overflow','initialFoodPerTile','bandColumns','bandWidth']
    : ['version','mode','pulseBudget','targetCount','pulses','offered','accepted','overflow','initialFoodPerTile','bandLeft','bandWidth'];
  exactKeys(value,keys,label);
  const targetCount=expectedMode==='split-band'?SPLIT_BAND_TARGET_COUNT:RULES.height*48;
  invariant(value.version===1&&value.mode===expectedMode&&value.pulseBudget===768&&value.targetCount===targetCount&&value.initialFoodPerTile===RULES.initialFood,`${label}: mode parameters`);
  int(value.pulses,`${label}.pulses`);int(value.offered,`${label}.offered`);int(value.accepted,`${label}.accepted`);int(value.overflow,`${label}.overflow`);
  invariant(value.pulses===Math.floor(tick/RULES.foodSupplyEvery)&&value.offered===value.pulses*768&&value.accepted+value.overflow===value.offered,`${label}: food accounting`);
  if(expectedMode==='split-band') invariant(value.bandWidth===24&&same(value.bandColumns,SPLIT_BAND_COLUMNS),`${label}: split band geometry`);
  else invariant(value.bandLeft===0&&value.bandWidth===48,`${label}: stationary band position/width`);
}
export function validateFrame(value:unknown,label='frame'):asserts value is Frame{
  record(value,label);exactKeys(value,['tick','censusSha256','stateSha256','foodBase64','cells','organisms','ledger','frameSha256'],label);
  int(value.tick,`${label}.tick`,0,MAX_TICK);invariant(/^[a-f0-9]{64}$/.test(value.censusSha256)&&/^[a-f0-9]{64}$/.test(value.stateSha256),`${label}: state binding`);
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
}
export function validateFrameEnergy(frame:Frame,census:DevelopmentCensus,environment:HungryEnvironment,label='frame'):void{
  const food=Buffer.from(frame.foodBase64,'base64');const ledger=frame.ledger;
  invariant(food.reduce((sum,n)=>sum+n,0)+census.totalEnergy===ledger.actual&&ledger.supplied===environment.accepted&&
    ledger.residual===ledger.actual-ledger.expected&&ledger.residual===0&&ledger.expected===ledger.actual&&
    ledger.expected===ledger.initialEnergy+ledger.supplied-ledger.dissipated-ledger.deathLoss,`${label}: frame/census energy mismatch`);
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
  const w=WINDOWS[index]!;const expected=summarizeWindow(w,a.tickRows,a.samples,a.frames,a.final.lineage);
  invariant(same(value,expected),`window ${w.from}-${w.to} differs from observations`);
}
function validateBaselineRegressionProof(proof:unknown,prior:Obj):void{
  record(proof,'baseline regression');exactKeys(proof,['status','seed','comparedSamples','comparedFrames','comparedTickRows','comparedSnapshots','checkpoints'],'baseline regression');
  invariant(proof.status==='verified'&&proof.seed===1203&&proof.comparedSamples===151&&proof.comparedFrames===151&&proof.comparedTickRows===3000&&
    proof.comparedSnapshots===5&&same(prior.snapshots.map((x:Obj)=>x.tick),FIXED_SNAPSHOTS),`contiguous baseline regression proof incomplete`);
  invariant(Array.isArray(proof.checkpoints)&&same(proof.checkpoints.map((x:Obj)=>x.tick),FIXED_SNAPSHOTS),`baseline regression checkpoint coverage mismatch`);
  for(const checkpoint of proof.checkpoints){exactKeys(checkpoint,['tick','stateSha256','compared'],'baseline regression checkpoint');
    invariant(checkpoint.compared===true&&checkpoint.stateSha256===prior.snapshots.find((s:Obj)=>s.tick===checkpoint.tick)?.stateSha256,
      `baseline regression checkpoint mismatch at ${checkpoint.tick}`);}
}

export function validateEvidenceStructure(value:unknown,sources?:Record<string,string>):asserts value is Obj{
  record(value,'evidence');exactKeys(value,['schemaVersion','kind','run','runtime','rules','provenance','samples','tickRows','frames','snapshots','windows','final','repeat','numericalGate','spatialGate','dataSha256'],'evidence');
  invariant(value.schemaVersion===1&&value.kind==='hungry-shapes-split-food-replication-arm',`unsupported evidence schema`);record(value.run,'run');
  exactKeys(value.run,['seed','mode','mutation','maxTick','finalTick','extinctionTick'],'run');
  invariant(value.run.seed===1203&&value.run.mode==='split-band'&&value.run.mutation===true&&value.run.maxTick===MAX_TICK,`run settings mismatch`);
  const seed=1203;int(value.run.finalTick,'final tick',0,MAX_TICK);
  invariant(value.run.extinctionTick===null||Number.isSafeInteger(value.run.extinctionTick)&&value.run.extinctionTick>=1&&value.run.extinctionTick===value.run.finalTick,`extinction/final tick mismatch`);
  invariant(value.run.extinctionTick!==null||value.run.finalTick===MAX_TICK,`live arm did not reach 3000`);
  if(value.run.extinctionTick!==null)invariant(value.final?.census?.population===0,`extinct arm has living terminal population`);
  else invariant(Number.isSafeInteger(value.final?.census?.population)&&value.final.census.population>0,`live arm has zero terminal population`);
  invariant(same(value.rules,RULES)&&value.rules.maxHistory===451&&value.runtime?.node===NODE_VERSION&&value.runtime.platform==='darwin'&&value.runtime.arch==='arm64',`rules/runtime mismatch`);
  record(value.provenance,'provenance');exactKeys(value.provenance,['sourceSha256','planSha256','baselineArtifactSha256','baselineDataSha256','baselineIndexSha256','baselineRegression'],'provenance');
  record(value.provenance.sourceSha256,'source hashes');
  invariant(same(Object.keys(value.provenance.sourceSha256).sort(),Object.keys(LOADED_SOURCE_SHA256).sort()),`source hash fields mismatch`);
  for(const d of Object.values(value.provenance.sourceSha256))invariant(typeof d==='string'&&/^[a-f0-9]{64}$/.test(d),`malformed source hash`);
  assertSourceIdentity();const expectedSources=sources??LOADED_SOURCE_SHA256;invariant(same(value.provenance.sourceSha256,expectedSources),`stale source hash`);
  for(const [path,digest] of Object.entries(PINNED_INPUTS))invariant(value.provenance.sourceSha256[path]===digest,`source pin mismatch: ${path}`);
  invariant(value.provenance.planSha256===SPLIT_FOOD_REPLICATION_PLAN_SHA256&&value.provenance.baselineArtifactSha256===BASELINE_IDENTITY.artifactSha256&&
    value.provenance.baselineDataSha256===BASELINE_IDENTITY.dataSha256&&value.provenance.baselineIndexSha256===BASELINE_IDENTITY.indexSha256,`plan/baseline identity mismatch`);
  const prior=baselineData();validateBaselineRegressionProof(value.provenance.baselineRegression,prior);
  invariant(Array.isArray(value.final?.lineage),`final lineage missing`);validateLineage(value.final.lineage,value.run.finalTick,'final lineage');
  invariant(Array.isArray(value.samples)&&Array.isArray(value.frames)&&Array.isArray(value.snapshots)&&Array.isArray(value.tickRows),`observations missing`);
  for(const s of value.snapshots)if(s?.state)validateSnapshotLineageProjection(s.state,value.final.lineage);
  const cadence=expectedSampleTicks(value.run.finalTick,value.run.extinctionTick);invariant(same(value.samples.map((s:Sample)=>s.tick),cadence),`sample cadence/terminal mismatch`);
  invariant(same(value.frames.map((f:Frame)=>f.tick),cadence),`frame cadence/terminal mismatch`);
  for(let i=0;i<value.samples.length;i++){
    const s=value.samples[i];record(s,`sample[${i}]`);exactKeys(s,['tick','census','environment','censusSha256','stateSha256','frameSha256'],`sample[${i}]`);
    validateCensus(s.census,`sample[${i}].census`,s.tick);invariant(s.census.tick===s.tick&&s.censusSha256===hash(s.census),`sample census digest mismatch`);
    validateEnvironment(s.environment,s.tick,`sample[${i}].environment`,value.run.mode);
    invariant(/^[a-f0-9]{64}$/.test(s.stateSha256)&&/^[a-f0-9]{64}$/.test(s.frameSha256),`sample digest malformed`);
    const f=value.frames[i];validateFrame(f,`frame[${i}]`);invariant(f.tick===s.tick&&f.censusSha256===s.censusSha256&&f.stateSha256===s.stateSha256&&f.frameSha256===s.frameSha256,`frame/sample binding mismatch at ${s.tick}`);
    validateFrameLineage(f,value.final.lineage,s.census,`frame ${s.tick}`);
    invariant(f.cells.length===s.census.cells,`frame/census cell count mismatch`);const families=[0,0,0];for(const o of f.organisms)families[o.family]++;
    invariant(f.organisms.length===s.census.population&&same(families,s.census.familyCounts),`frame/census family mismatch`);
    validateFrameEnergy(f,s.census,s.environment,`frame ${s.tick}`);
    if(i){const p=value.samples[i-1];invariant(s.census.births>=p.census.births&&s.census.deaths>=p.census.deaths&&s.census.growths>=p.census.growths&&
      s.census.effectiveMutations>=p.census.effectiveMutations&&s.environment.accepted>=p.environment.accepted,`sample counters decreased`);}
  }
  invariant(same(value.snapshots.map((s:SnapshotRecord)=>s.tick),expectedSnapshotTicks(value.run.finalTick,value.run.extinctionTick)),`snapshot coverage mismatch`);
  for(let i=0;i<value.snapshots.length;i++){
    const s=value.snapshots[i];record(s,`snapshot[${i}]`);exactKeys(s,['tick','terminal','environment','state','stateSha256'],`snapshot[${i}]`);
    const terminal=value.run.extinctionTick!==null&&s.tick===value.run.extinctionTick;invariant(s.terminal===terminal,`terminal snapshot label mismatch`);
    validateEnvironment(s.environment,s.tick,`snapshot[${i}].environment`,value.run.mode);
    validateSnapshot(s.state,{seed,tick:s.tick,extinctionTick:terminal?s.tick:null},`snapshot[${i}].state`);
    invariant(s.stateSha256===hash({state:s.state,environment:s.environment}),`snapshot digest mismatch at ${s.tick}`);
    const sample=value.samples.find((x:Sample)=>x.tick===s.tick),frame=value.frames.find((x:Frame)=>x.tick===s.tick);
    invariant(sample&&frame&&sample.stateSha256===s.stateSha256&&same(sample.environment,s.environment)&&same(sample.census,censusFromSnapshot(s.state)),`snapshot/sample binding mismatch at ${s.tick}`);
    validateSnapshotHistoryBindings(s.state,value.samples);validateSnapshotLineageProjection(s.state,value.final.lineage);
    invariant(same(frameProjection(s.state),frameProjectionFromFrame(frame)),`snapshot/frame projection mismatch at ${s.tick}`);
  }
  const last=value.snapshots.at(-1);invariant(last.tick===value.run.finalTick&&last.state.droppedHistory===0&&last.state.droppedLineage===0,`terminal state dropped observations`);
  const retainedHistory=new Map(last.state.history.map((row:DevelopmentCensus)=>[row.tick,row]));
  for(const sample of value.samples)invariant(same(sample.census,retainedHistory.get(sample.tick)),`sample differs from terminal retained history at ${sample.tick}`);
  record(value.final,'final');exactKeys(value.final,['census','environment','ledger','lineage','deathsByCause','maxEverGeneration','stateSha256'],'final');
  invariant(same(value.final.census,censusFromSnapshot(last.state))&&same(value.final.environment,last.environment)&&same(value.final.ledger,last.state.ledger)&&
    same(value.final.lineage,last.state.lineage)&&value.final.stateSha256===last.stateSha256,`final state mismatch`);
  invariant(value.final.deathsByCause.age===value.final.lineage.filter((n:DevelopmentLineageNode)=>n.deathCause==='age').length&&
    value.final.deathsByCause.starvation===value.final.lineage.filter((n:DevelopmentLineageNode)=>n.deathCause==='starvation').length&&
    value.final.maxEverGeneration===Math.max(0,...value.final.lineage.map((n:DevelopmentLineageNode)=>n.generation)),`lineage summary mismatch`);
  validateTickRows(value.tickRows,value.run.finalTick,value.run.extinctionTick,value.final.lineage,value.samples);
  invariant(Array.isArray(value.windows)&&value.windows.length===WINDOWS.length,`window count mismatch`);value.windows.forEach((w:unknown,i:number)=>validateWindow(w,i,value));
  invariant(same(value.numericalGate,evaluateGate(value.run.finalTick,value.final.census,value.windows)),`numerical gate mismatch`);
  const spatialCheckpoints=[2500,3000].map((tick)=>{const frame=value.frames.find((x:Frame)=>x.tick===tick);return {tick,occupiedTilesByBand:frame?occupiedTilesByBand(frame):null};});
  invariant(same(value.spatialGate,evaluateSpatialGate(spatialCheckpoints)),`spatial gate mismatch`);
  record(value.repeat,'repeat');exactKeys(value.repeat,['verified','comparedThroughTick','stateChecks','frameChecks'],'repeat');
  invariant(value.repeat.verified===true&&value.repeat.comparedThroughTick===value.run.finalTick&&value.repeat.stateChecks===value.samples.length&&
    value.repeat.frameChecks===value.frames.length,`repeat proof mismatch`);
  invariant(typeof value.dataSha256==='string'&&value.dataSha256===artifactHash(value),`artifact integrity hash mismatch`);
  invariant(Buffer.byteLength(JSON.stringify(value))<=MAX_ARTIFACT_BYTES,`arm artifact exceeds 24 MiB cap`);
}

export function buildMarkdown(data:Obj):string{
  const lines=['# Split-food screen','',`Seed ${data.run.seed}; split-band mode; Node ${data.runtime.node} on ${data.runtime.platform}/${data.runtime.arch}.`,
    `Mutation enabled; stopped at tick ${data.run.finalTick}${data.run.extinctionTick===null?'':' (actual extinction)'}.`,
    'Food is offered to columns 0–23 and 48–71, for 4,608 fixed target tiles total. The two 24-column bands have equal area to the historical contiguous 48-column stationary band; they change which physical tiles receive pulses. Food starts at 20 on every tile and remains after deposition. Each pulse offers 768 units, 384 to each band.','',
    '| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied tiles in each band |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |'];
  for(const w of data.windows){const e=w.endpoint;lines.push(`| ${w.from}–${w.to} | ${w.executedTicks}/500 (${w.status}) | ${w.births??'—'} | ${w.deaths??'—'} | ${w.cap48Ticks??'—'}/500 | ${w.nearCap47Ticks??'—'}/500 | ${w.blockedCapAttempts??'—'}/${w.blockedSpaceAttempts??'—'} | ${w.minPopulation??'—'}–${w.maxPopulation??'—'} | ${e.population??'—'}/${e.cells??'—'} | ${e.maxEverGeneration??'—'} | ${w.food.offered??'—'}/${w.food.accepted??'—'}/${w.food.overflow??'—'} | ${(e.occupiedTilesByBand??['—','—']).join(' / ')} |`);}
  lines.push('',`Numerical screen: ${data.numericalGate.numericalPass?'pass':'fail'}.`,
    `Both-band occupancy screen: ${data.spatialGate.pass?'pass':'fail'} (at least 10 occupied body tiles in each band at ticks 2,500 and 3,000).`,
    `Contiguous stationary baseline regression: ${data.provenance.baselineRegression.status}; compared all ${data.provenance.baselineRegression.comparedSamples} samples, ${data.provenance.baselineRegression.comparedFrames} frames, ${data.provenance.baselineRegression.comparedTickRows} tick rows and ${data.provenance.baselineRegression.comparedSnapshots} snapshots.`,
    'Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. Missing endpoints and partial windows fail; no post-extinction states are fabricated.',
    'This screen does not establish adaptation, improved fitness, durable coexistence, or independent colonies.','');return lines.join('\n');
}
export function parseArgs(argv:string[]):{mode:'--write'|'--check';seed:1203}{
  const actions=['--write','--check'];const mode=argv.find((x)=>actions.includes(x));invariant(mode!==undefined,'Usage: --write|--check --seed 1203');
  invariant(argv.filter((x)=>actions.includes(x)).length===1,'Choose exactly one action');const i=argv.indexOf('--seed');invariant(i>=0&&/^\d+$/.test(argv[i+1]??''),'An explicit --seed is required');
  invariant(argv.every((x,j)=>j===i||j===i+1||actions.includes(x)),'Unknown argument');const seed=Number(argv[i+1]);
  invariant(seed===1203,'This split-food replication is frozen to seed 1203');return{mode:mode as any,seed};
}
function legacyCheck():void{
  try{
    execFileSync(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('../stationary-food-replication/explore.ts',import.meta.url)),'--check','--seed','1203'],{stdio:'pipe'});
  }catch(error){
    const failure=error as {status?:number|null;stdout?:Buffer|string|null;stderr?:Buffer|string|null;message?:string};
    const output=(value:Buffer|string|null|undefined)=>value===undefined||value===null?'':Buffer.isBuffer(value)?value.toString('utf8'):value;
    throw new Error(`historical stationary runner --check failed (exit ${failure.status??'unknown'}):\n${output(failure.stdout)}${output(failure.stderr)}${failure.stdout||failure.stderr?'':failure.message??''}`);
  }
}
export function checkHistoricalReferences():Obj{
  legacyCheck();return baselineData();
}
export function formatCompletedOutcome(data:Obj):string{
  return JSON.stringify({seed:data.run.seed,mode:data.run.mode,finalTick:data.run.finalTick,extinctionTick:data.run.extinctionTick,
    census:data.final.census,environment:data.final.environment,numericalGate:data.numericalGate,spatialGate:data.spatialGate,windows:data.windows,dataSha256:data.dataSha256});
}
async function writeEvidence(seed:1203):Promise<void>{
  invariant(seed===1203,'This split-food replication is frozen to seed 1203');assertPinnedInputs();assertSourceIdentity();
  process.stdout.write(`Attempt intent: seed ${seed}, split-band only, horizon 3,000 or actual extinction; historical contiguous baseline regression first.\n`);
  legacyCheck();const prior=baselineData();
  for(const url of [JSON_URL,MD_URL]){try{await readFile(url);throw new Error(`Refusing to overwrite ${url.pathname}`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  const baselineRegression=runBaselineRegression(prior);assertSourceIdentity();
  process.stdout.write(`Completed predetermined contiguous baseline regression before split outcome: ${JSON.stringify(baselineRegression)}\n`);
  const data=runArm(baselineRegression);assertSourceIdentity();
  process.stdout.write(`Completed split-band outcome before writing artifact: ${formatCompletedOutcome(data)}\n`);
  const jsonText=`${JSON.stringify(data)}\n`;invariant(Buffer.byteLength(jsonText)<=MAX_ARTIFACT_BYTES,'split-band JSON exceeds 24 MiB cap');
  await writeFile(JSON_URL,jsonText,{flag:'wx'});try{await writeFile(MD_URL,buildMarkdown(data),{flag:'wx'});}
  catch(e){throw new Error(`JSON written but Markdown failed for ${JSON_URL.pathname}; preserve it and investigate: ${String(e)}`);}
  process.stdout.write(`Wrote split-food replication seed ${seed} split-band evidence.\n`);
}
async function checkEvidence(seed:1203):Promise<void>{
  assertPinnedInputs();assertSourceIdentity();checkHistoricalReferences();
  const data=JSON.parse(await readFile(JSON_URL,'utf8')) as Obj;validateEvidenceStructure(data,LOADED_SOURCE_SHA256);
  invariant(data.run.seed===seed&&data.run.mode==='split-band'&&data.kind==='hungry-shapes-split-food-replication-arm','artifact identity differs');
  invariant(await readFile(MD_URL,'utf8')===buildMarkdown(data),'Markdown differs from split-food JSON');
  assertSourceIdentity();process.stdout.write(`Split-food replication seed ${seed} arm structure, provenance, accounting, spatial gate, and Markdown passed.\n`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const {mode,seed}=parseArgs(process.argv.slice(2));if(mode==='--write')await writeEvidence(seed);else await checkEvidence(seed);}
