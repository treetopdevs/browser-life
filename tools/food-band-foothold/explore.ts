#!/usr/bin/env node
/** One scheduled food-band foothold screen. Importing never starts simulation. */
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  HungryWorld, RULES, SPLIT_BAND_TARGET_COUNT, ALTERNATING_BAND_TARGET_COUNT, SPLIT_BAND_COLUMNS, alternatingBandAtPulse, alternatingBandPulseTargetTile,
  type DevelopmentCensus, type DevelopmentGenome, type DevelopmentLineageNode, type DevelopmentOrganism,
  type DevelopmentSnapshot, type HungryEnvironment,
} from '../../apps/lab/src/food-band-foothold/model.ts';

type Obj = Record<string, any>;
export type AlternatingFoodTickRow = { tick:number; population:number; cells:number; births:number; deaths:number; blockedCap:number; blockedSpace:number; cap48:boolean; nearCap47:boolean };
export type AlternatingFoodFrame = { tick:number; censusSha256:string; stateSha256:string; foodBase64:string; cells:[number,number][];
  organisms:{id:number;family:number;genome:DevelopmentGenome}[]; ledger:DevelopmentSnapshot['ledger']; frameSha256:string };
export type AlternatingFoodSample = { tick:number; census:DevelopmentCensus; environment:HungryEnvironment; censusSha256:string; stateSha256:string; frameSha256:string };
export type AlternatingFoodSnapshot = { tick:number; terminal:boolean; environment:HungryEnvironment; state:DevelopmentSnapshot; stateSha256:string };
type TickRow=AlternatingFoodTickRow;type Frame=AlternatingFoodFrame;type Sample=AlternatingFoodSample;type SnapshotRecord=AlternatingFoodSnapshot;
export type AlternatingFoodEvidence = { schemaVersion:1;kind:'hungry-shapes-food-band-foothold-arm';
  run:{seed:1202;mode:'foothold-band';mutation:true;maxTick:3000;finalTick:number;extinctionTick:number|null};
  runtime:{node:string;platform:string;arch:string};rules:typeof RULES;
  provenance:{sourceSha256:Record<string,string>;planSha256:string;baselineArtifactSha256:string;baselineDataSha256:string;baselineIndexSha256:string;
    baselineRegression:{status:'verified';seed:1202;comparedSamples:number;comparedFrames:number;comparedTickRows:number;comparedSnapshots:number;checkpoints:{tick:number;stateSha256:string;compared:true}[]}};
  samples:AlternatingFoodSample[];tickRows:AlternatingFoodTickRow[];frames:AlternatingFoodFrame[];snapshots:AlternatingFoodSnapshot[];windows:Obj[];final:Obj;repeat:Obj;numericalGate:Obj;spatialGate:Obj;seasonalGate:Obj;baselineSeasonalReference:Obj;dataSha256:string };

export const MAX_TICK=3000;
export const SAMPLE_EVERY=20;
export const WINDOWS:readonly {from:number;to:number}[]=Object.freeze([{from:1501,to:2000},{from:2001,to:2500},{from:2501,to:3000}]);
export const FIXED_SNAPSHOTS=Object.freeze([0,500,1000,1500,2000,2500,3000]);
export const BASELINE_SNAPSHOTS=Object.freeze([0,500,1000,1500,2000,2500,3000]);
const NODE_VERSION='24.2.0';
const BASELINE_SAMPLE_COUNT=151,BASELINE_FRAME_COUNT=151;
const MAX_ARTIFACT_BYTES=24*1024*1024;
const BASELINE_JSON_URL=new URL('../../docs/creative-prototypes/alternating-food-replication-seed-1202.json',import.meta.url);
const BASELINE_INDEX_URL=new URL('../../docs/creative-prototypes/alternating-food-replication-index-1202.json',import.meta.url);
export const OUTPUT_PATHS=Object.freeze({json:'docs/creative-prototypes/food-band-foothold-seed-1202.json',markdown:'docs/creative-prototypes/food-band-foothold-seed-1202.md'});
const JSON_URL=new URL(`../../${OUTPUT_PATHS.json}`,import.meta.url);
const MD_URL=new URL(`../../${OUTPUT_PATHS.markdown}`,import.meta.url);
export const FOOTHOLD_PLAN_SHA256='88040ed2b87042ee5907f8db85dfccfbe8794feabe2865df31e3bcac3bfbab27';
const BASELINE_IDENTITY=Object.freeze({artifactSha256:'69f00e582d085d69964f087f337cc8175392ee2bd48afcb0708a76b8f83d8117',dataSha256:'7ceae251dc216935c5dc72dad091958ec4d2d8d84ef9ea1610fa50745a86fec6',indexSha256:'28d9880651da421c0fe8a11b7d15c819106598280ee177e0443fb4ede8c18d1a'});
const PINNED_INPUTS=Object.freeze({
  'docs/creative-prototypes/food-band-foothold-plan.md':FOOTHOLD_PLAN_SHA256,
  'apps/lab/src/food-band-foothold/model.ts':'d3e0b36594b43a40d77befbe846d4365b25655d7d670c50d74f6fadefa988403',
  'apps/lab/src/alternating-food/model.ts':'5dc6ce46ee36d2d008f802e81e0f7aae80d7bfeaa58984512d13cad714729b31',
  'tools/alternating-food-replication/explore.ts':'f616b0b1fa6ab1194e224ad7040f972c7b55ad65b6a5a2425e16b81a2ce7c162',
  'docs/creative-prototypes/alternating-food-replication-seed-1202.json':BASELINE_IDENTITY.artifactSha256,
  'docs/creative-prototypes/alternating-food-replication-index-1202.json':BASELINE_IDENTITY.indexSha256,
  'docs/creative-prototypes/alternating-food-replication-validation.md':'dcffcae8fda5c852b9fb3c6db5bb61d758f7b6e9b895d33a634e67ca7ccb06b2',
  'tools/food-band-foothold/launch.sh':'24036351704f71fd3d16a372f294b19701e036e4a174acfa4052c62aa6c87490',
});
const DISK_INPUTS=Object.entries(PINNED_INPUTS).map(([name])=>[name,new URL(`../../${name}`,import.meta.url)] as const);
const SELF_URL=new URL('./explore.ts',import.meta.url);
const ALTERNATING_MODEL_URL=new URL('../../apps/lab/src/food-band-foothold/model.ts',import.meta.url);
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

export function validateBandAccounting(env:HungryEnvironment,label='environment'):void{
  if(env.mode!=='foothold-band'&&env.mode!=='alternating-band')return;
  for(const [name,values] of [['bandOffered',env.bandOffered],['bandAccepted',env.bandAccepted],['bandOverflow',env.bandOverflow]] as const){
    invariant(Array.isArray(values)&&values.length===2&&values.every((n)=>Number.isSafeInteger(n)&&n>=0),`${label}: ${name} must contain two nonnegative safe integers`);
  }
  invariant(env.bandAccepted![0]<=env.bandOffered![0]&&env.bandAccepted![1]<=env.bandOffered![1]&&env.bandOverflow![0]<=env.bandOffered![0]&&env.bandOverflow![1]<=env.bandOffered![1],`${label}: per-band accepted/overflow exceeds offered`);
  invariant(env.bandAccepted![0]+env.bandOverflow![0]===env.bandOffered![0]&&env.bandAccepted![1]+env.bandOverflow![1]===env.bandOffered![1]&&env.bandOffered![0]+env.bandOffered![1]===env.offered&&env.bandAccepted![0]+env.bandAccepted![1]===env.accepted&&env.bandOverflow![0]+env.bandOverflow![1]===env.overflow,`${label}: per-band ledger sums`);
}

/** Cumulative ledgers may not move accepted food or overflow backward between bands. */
export function validateBandProgress(previous:HungryEnvironment,current:HungryEnvironment,label='sample'):void{
  for(const band of [0,1]){
    const acceptedDelta=current.bandAccepted![band]!-previous.bandAccepted![band]!;
    const overflowDelta=current.bandOverflow![band]!-previous.bandOverflow![band]!;
    const offeredDelta=current.bandOffered![band]!-previous.bandOffered![band]!;
    invariant(acceptedDelta>=0&&overflowDelta>=0,`${label}: cumulative per-band accepted/overflow decreased in band ${band}`);
    invariant(offeredDelta>=0&&acceptedDelta<=offeredDelta,`${label}: per-band accepted delta exceeds offered delta in band ${band}`);
  }
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
  const expectedTargets=env.mode==='alternating-band'?ALTERNATING_BAND_TARGET_COUNT:env.mode==='split-band'||env.mode==='foothold-band'?SPLIT_BAND_TARGET_COUNT:RULES.height*48;
  invariant((env.mode==='moving-band'||env.mode==='stationary-band'||env.mode==='split-band'||env.mode==='alternating-band'||env.mode==='foothold-band')&&env.pulseBudget===768&&env.targetCount===expectedTargets&&env.accepted===ledger.supplied&&
    env.offered===env.accepted+env.overflow&&env.pulses===Math.floor(world.tick/RULES.foodSupplyEvery)&&env.offered===env.pulses*env.pulseBudget,`${label}: food ledger`);
  if(env.mode==='split-band') invariant(env.bandWidth===24&&same(env.bandColumns,SPLIT_BAND_COLUMNS)&&env.bandLeft===undefined,`${label}: split band geometry`);
  else if(env.mode==='alternating-band'||env.mode==='foothold-band') validateEnvironment(env,world.tick,`${label}.environment`,env.mode);
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
  return {...pinned,'apps/lab/src/food-band-foothold/model.ts':hashBytes(readFileSync(ALTERNATING_MODEL_URL)),'tools/food-band-foothold/explore.ts':hashBytes(readFileSync(SELF_URL))};
}
export const LOADED_SOURCE_SHA256=Object.freeze(sourceHashes());
export function assertSourceIdentity(expected:Record<string,string>=LOADED_SOURCE_SHA256,current=sourceHashes()):void{invariant(same(expected,current),'Evidence sources changed since runner load; reload before accepting evidence');}
export function assertPinnedInputs(current=sourceHashes()):void{for(const [path,digest] of Object.entries(PINNED_INPUTS))invariant(current[path]===digest,`Pinned input changed: ${path}`);}
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
export function validateHistoricalReference(value:unknown,indexValue:unknown,artifactBytes:Uint8Array,indexBytes:Uint8Array):Obj{
  record(value,'historical alternating-food artifact');const data=value as Obj;record(indexValue,'historical alternating-food index');
  invariant(hashBytes(artifactBytes)===BASELINE_IDENTITY.artifactSha256&&hashBytes(indexBytes)===BASELINE_IDENTITY.indexSha256,'pinned alternating baseline/index bytes changed');
  invariant((indexValue as Obj).kind==='hungry-shapes-alternating-food-replication-pair'&&(indexValue as Obj).arms?.alternating?.rawSha256===BASELINE_IDENTITY.artifactSha256,'alternating index binding mismatch');
  invariant(data.dataSha256===BASELINE_IDENTITY.dataSha256&&data.dataSha256===artifactHash(data),'pinned alternating baseline internal hash mismatch');
  invariant(data.schemaVersion===1&&data.kind==='hungry-shapes-alternating-food-replication-arm'&&data.run?.seed===1202&&data.run.mode==='alternating-band'&&data.run.finalTick===MAX_TICK&&data.run.extinctionTick===null,'pinned alternating run identity mismatch');
  invariant(same(data.rules,RULES)&&data.samples?.length===151&&data.frames?.length===151&&data.tickRows?.length===3000&&same(data.snapshots?.map((x:Obj)=>x.tick),BASELINE_SNAPSHOTS),'pinned alternating payload incomplete');
  return data;
}
export function baselineData():Obj{
  assertPinnedInputs();const bytes=readFileSync(BASELINE_JSON_URL),indexBytes=readFileSync(BASELINE_INDEX_URL);
  return validateHistoricalReference(JSON.parse(bytes.toString('utf8')),JSON.parse(indexBytes.toString('utf8')),bytes,indexBytes);
}
export type AttemptFailureClass='invalid'|'inconclusive';
function classifyAttemptFailure(error:unknown):AttemptFailureClass{const message=error instanceof Error?error.message:String(error);return /24 MiB|10,000|maxLineage|lineage capacity|history capacity|dropped\/capped observations/i.test(message)?'inconclusive':'invalid';}
function fsyncPath(path:string):void{const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
export class AttemptRecorder{
  readonly directory:string;
  constructor(directory:string){this.directory=directory;}
  append(name:string,value:unknown):void{const path=resolve(this.directory,name);appendFileSync(path,`${JSON.stringify(value)}\n`);fsyncPath(path);}
  save(name:string,value:unknown):void{const path=resolve(this.directory,name);writeFileSync(path,`${JSON.stringify(value)}\n`,{flag:'wx'});fsyncPath(path);}
  failure(stage:string,error:unknown,details:Obj={}):void{const message=error instanceof Error?error.message:String(error);this.append('failures.jsonl',{classification:classifyAttemptFailure(error),stage,message,recordedUtc:new Date().toISOString(),...details});}
}
export function claimAttemptStart(directory:string):void{
  const names=readdirSync(directory).sort();invariant(names.includes('intent.json')&&names.every((name)=>['intent.json','stdout.log','stderr.log'].includes(name)),`attempt directory contains unexpected or prior-run files`);
  for(const name of ['stdout.log','stderr.log'])if(names.includes(name))invariant(statSync(resolve(directory,name)).size===0,`attempt ${name} is nonempty before runner start`);
  let fd:number;try{fd=openSync(resolve(directory,'runner-start.json'),'wx');}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('attempt runner already started; retries require separately reviewed repair');throw error;}
  try{writeSync(fd,`${JSON.stringify({status:'runner-started',startedUtc:new Date().toISOString()})}\n`);fsyncSync(fd);}finally{closeSync(fd);}
}
export function verifyAttemptReservation(directory:string,attemptsRootOverride?:string):AttemptRecorder{
  const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim(),attemptsRoot=attemptsRootOverride?resolve(attemptsRootOverride):resolve(root,'runs/food-band-foothold/attempts'),attemptDir=resolve(directory);
  invariant(attemptDir.startsWith(`${attemptsRoot}/`),`write requires a reviewed attempt directory under runs/food-band-foothold/attempts`);
  invariant(readdirSync(attemptsRoot).filter((entry)=>entry!=='reservation.lock'&&entry!=='reservation.json').join('|')===basename(attemptDir),`another or prior attempt is already reserved`);
  invariant(readdirSync(resolve(attemptsRoot,'reservation.lock')).length===0,`invalid attempt reservation lock`);
  const intentPath=resolve(attemptDir,'intent.json'),reservationPath=resolve(attemptsRoot,'reservation.json');
  const intentBytes=readFileSync(intentPath),intent=JSON.parse(intentBytes.toString('utf8')) as Obj,reservation=JSON.parse(readFileSync(reservationPath,'utf8')) as Obj;
  exactKeys(intent,['schemaVersion','status','runId','gitHead','prelaunchUtc','intentDurability','seed','mode','maxTick','stop','planSha256','modelSha256','runnerSha256','packageJsonSha256','pnpmLockSha256','historicalArtifactSha256','historicalDataSha256','historicalIndexSha256','historicalValidationSha256','copySourceModelSha256','historicalRunnerSha256','launcherSha256','nodeVersion','environment','command'],'attempt intent');
  exactKeys(reservation,['schemaVersion','status','runId','attemptDir','prelaunchUtc','gitHead','intentSha256'],'attempt reservation');
  const runId=basename(attemptDir).replace(/^run-/,'');
  invariant(intent.schemaVersion===1&&intent.status==='intent-recorded-before-launch'&&intent.intentDurability==='fsynced-before-runner'&&intent.runId===runId&&intent.seed===1202&&intent.mode==='foothold-band'&&intent.maxTick===MAX_TICK&&intent.stop==='actual extinction or tick 3000',`attempt intent does not match frozen run`);
  invariant(intent.gitHead===execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()&&intent.prelaunchUtc===reservation.prelaunchUtc&&reservation.schemaVersion===1&&reservation.status==='reserved'&&reservation.runId===runId&&reservation.attemptDir===basename(attemptDir)&&reservation.gitHead===intent.gitHead&&reservation.intentSha256===hashBytes(intentBytes),`attempt reservation/intent binding mismatch`);
  invariant(intent.planSha256===PINNED_INPUTS['docs/creative-prototypes/food-band-foothold-plan.md']&&intent.modelSha256===LOADED_SOURCE_SHA256['apps/lab/src/food-band-foothold/model.ts']&&intent.runnerSha256===LOADED_SOURCE_SHA256['tools/food-band-foothold/explore.ts']&&intent.launcherSha256===PINNED_INPUTS['tools/food-band-foothold/launch.sh']&&intent.nodeVersion===NODE_VERSION&&same(intent.environment,{NODE_NO_WARNINGS:'1'})&&intent.packageJsonSha256===hashBytes(readFileSync(resolve(root,'package.json')))&&intent.pnpmLockSha256===hashBytes(readFileSync(resolve(root,'pnpm-lock.yaml'))),`attempt source/dependency hashes mismatch`);
  invariant(intent.historicalArtifactSha256===BASELINE_IDENTITY.artifactSha256&&intent.historicalDataSha256===BASELINE_IDENTITY.dataSha256&&intent.historicalIndexSha256===BASELINE_IDENTITY.indexSha256&&intent.historicalValidationSha256===PINNED_INPUTS['docs/creative-prototypes/alternating-food-replication-validation.md']&&intent.copySourceModelSha256===PINNED_INPUTS['apps/lab/src/alternating-food/model.ts']&&intent.historicalRunnerSha256===PINNED_INPUTS['tools/alternating-food-replication/explore.ts'],`attempt historical pins mismatch`);
  invariant(Array.isArray(intent.command)&&same(intent.command,[process.execPath,'--experimental-strip-types','tools/food-band-foothold/explore.ts','--write','--seed','1202','--attempt-dir',attemptDir]),`attempt command does not match runner invocation`);
  claimAttemptStart(attemptDir);return new AttemptRecorder(attemptDir);
}
/** Historical alternating regression; full exact replay of the accepted alternating artifact, with no output. */
export function runBaselineRegression(prior:Obj=baselineData(),recorder?:AttemptRecorder):Obj{
  const world=new HungryWorld(1202,true,'alternating-band');
  invariant(same(world.snapshot(),prior.snapshots[0].state)&&same(world.environment,prior.samples[0].environment),'alternating baseline tick-zero state differs');
  const samples:Sample[]=[],frames:Frame[]=[],snapshots:SnapshotRecord[]=[],rows:TickRow[]=[];let previous=world.census();
  const capture=()=>{const c=makeSample(world),es=prior.samples.find((x:Obj)=>x.tick===world.tick),ef=prior.frames.find((x:Obj)=>x.tick===world.tick);invariant(es&&ef&&same(c.sample,es)&&same(c.frame,ef),`alternating baseline sample/frame differs at ${world.tick}`);samples.push(c.sample);frames.push(c.frame);recorder?.append('baseline-samples.jsonl',{sample:c.sample,frame:c.frame});if(BASELINE_SNAPSHOTS.includes(world.tick)){const snap={tick:world.tick,terminal:false,environment:world.environment,state:c.state,stateSha256:c.sample.stateSha256};const expected=prior.snapshots.find((x:Obj)=>x.tick===world.tick);invariant(expected&&same(snap,expected),`alternating baseline snapshot differs at ${world.tick}`);snapshots.push(snap);recorder?.append('baseline-snapshots.jsonl',snap);}};
  try{capture();}catch(error){recorder?.failure('historical-alternating-baseline-tick-zero',error,{tick:world.tick,census:world.census(),environment:world.environment,state:world.snapshot()});throw error;}for(let t=1;t<=MAX_TICK;t++){try{world.step(1);assertWorld(world,'alternating baseline replay');const census=world.census(),row=tickRow(world,previous,census);invariant(same(row,prior.tickRows[t-1]),`alternating baseline tick row differs at ${t}`);rows.push(row);recorder?.append('baseline-ticks.jsonl',{tick:t,row,census,environment:world.environment});if(t%SAMPLE_EVERY===0)capture();previous=census;if(world.extinctionTick!==null)throw new Error(`alternating baseline unexpectedly extinct at ${world.tick}`);}catch(error){recorder?.failure('historical-alternating-baseline-regression',error,{tick:world.tick,census:world.census(),environment:world.environment,state:world.snapshot(),collected:{rows:rows.length,samples:samples.length,frames:frames.length,snapshots:snapshots.length}});throw error;}}
  invariant(samples.length===151&&frames.length===151&&rows.length===3000&&snapshots.length===7,'alternating baseline replay coverage mismatch');
  return {status:'verified',seed:1202,comparedSamples:151,comparedFrames:151,comparedTickRows:3000,comparedSnapshots:7,checkpoints:snapshots.map(x=>({tick:x.tick,stateSha256:x.stateSha256,compared:true}))};
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

export const SEASONAL_BLOCKS=Object.freeze([{from:1500,to:2000,fedBand:1 as const},{from:2000,to:2500,fedBand:0 as const},{from:2500,to:3000,fedBand:1 as const}]);
export function evaluateSeasonalGate(input:Obj[]):Obj{
  const blocks=SEASONAL_BLOCKS.map((expected,i)=>{
    const actual=input[i];const from=actual?.fromOccupiedTilesByBand??null,to=actual?.toOccupiedTilesByBand??null;
    const deltasByBand=Array.isArray(from)&&Array.isArray(to)&&from.length===2&&to.length===2?[to[0]-from[0],to[1]-from[1]]:[null,null];
    const fedBand=expected.fedBand,pass=deltasByBand[fedBand]!==null&&deltasByBand[fedBand]!>=20&&deltasByBand[1-fedBand]!==null&&deltasByBand[1-fedBand]!<=-20;
    return {from:expected.from,to:expected.to,fedBand,fromOccupiedTilesByBand:from,toOccupiedTilesByBand:to,deltasByBand,pass};
  });
  return {blocks,pass:blocks.some(b=>b.pass)};
}
function seasonalInput(frames:Frame[]):Obj[]{return SEASONAL_BLOCKS.map(b=>({fromOccupiedTilesByBand:frames.find(f=>f.tick===b.from)?occupiedTilesByBand(frames.find(f=>f.tick===b.from)!):null,toOccupiedTilesByBand:frames.find(f=>f.tick===b.to)?occupiedTilesByBand(frames.find(f=>f.tick===b.to)!):null}));}

export function runArm(baselineRegression:Obj,recorder?:AttemptRecorder):Obj{
  invariant(process.versions.node===NODE_VERSION,`Requires Node ${NODE_VERSION}; found ${process.versions.node}`);
  invariant(process.platform==='darwin'&&process.arch==='arm64',`Accepted runs require darwin/arm64; found ${process.platform}/${process.arch}`);
  assertPinnedInputs();assertSourceIdentity();const baseline=baselineData();
  invariant(baselineRegression.status==='verified'&&baselineRegression.seed===1202&&baselineRegression.comparedSamples===151&&baselineRegression.comparedFrames===151&&
    baselineRegression.comparedTickRows===3000&&baselineRegression.comparedSnapshots===7,`historical alternating baseline regression must pass before foothold outcome`);
  const primary=new HungryWorld(1202,true,'foothold-band'),repeat=new HungryWorld(1202,true,'foothold-band');
  invariant(same(primary.snapshot(),repeat.snapshot())&&same(primary.environment,repeat.environment),`foothold-band independent initial states differ`);
  const samples:Sample[]=[],frames:Frame[]=[],snapshots:SnapshotRecord[]=[],tickRows:TickRow[]=[];
  let previous=primary.census(),repeatPrevious=repeat.census(),extinctionTick:number|null=null;
  const capture=(terminal=false)=>{
    const a=makeSample(primary),b=makeSample(repeat);
    invariant(same(a.state,b.state)&&same(primary.environment,repeat.environment),`foothold-band repeat full state differs at ${primary.tick}`);
    invariant(a.frame.frameSha256===b.frame.frameSha256,`foothold-band repeat frame differs at ${primary.tick}`);
    if(samples.at(-1)?.tick!==primary.tick){samples.push(a.sample);frames.push(a.frame);recorder?.append('samples.jsonl',{sample:a.sample,frame:a.frame});}
    if(FIXED_SNAPSHOTS.includes(primary.tick)||terminal){const snapshot={tick:primary.tick,terminal,environment:primary.environment,state:a.state,stateSha256:a.sample.stateSha256};snapshots.push(snapshot);recorder?.append('snapshots.jsonl',snapshot);
      invariant(same(frameProjection(a.state),frameProjectionFromFrame(a.frame)),`foothold-band snapshot/frame projection differs at ${primary.tick}`);}
    return a;
  };
  try{capture();}catch(error){recorder?.failure('foothold-initial-state',error,{tick:primary.tick,census:primary.census(),environment:primary.environment,state:primary.snapshot()});throw error;}
  for(let scheduled=1;scheduled<=MAX_TICK;scheduled++){
    if(primary.extinctionTick!==null)break;
    try{
      primary.step(1);repeat.step(1);assertWorld(primary,'foothold-band primary');assertWorld(repeat,'foothold-band repeat');
      const census=primary.census(),repeatCensus=repeat.census();
      invariant(primary.tick===repeat.tick&&same(census,repeatCensus)&&same(primary.environment,repeat.environment),`foothold-band repeat census/environment differs at ${scheduled}`);
      invariant(primary.extinctionTick===repeat.extinctionTick,`foothold-band repeat extinction differs at ${scheduled}`);
      const row=tickRow(primary,previous,census),repeatRow=tickRow(repeat,repeatPrevious,repeatCensus);
      invariant(same(row,repeatRow),`foothold-band repeat tick row differs at ${scheduled}`);tickRows.push(row);recorder?.append('ticks.jsonl',{tick:scheduled,row,census,environment:primary.environment});
      if(primary.tick%SAMPLE_EVERY===0||primary.extinctionTick===primary.tick)capture(primary.extinctionTick===primary.tick);
      previous=census;repeatPrevious=repeatCensus;
      if(primary.extinctionTick!==null){extinctionTick=primary.extinctionTick;break;}
      if(scheduled===MAX_TICK)invariant(primary.tick===MAX_TICK,'failed to reach frozen 3,000-tick horizon');
    }catch(error){recorder?.failure('foothold-simulation-validation',error,{tick:primary.tick,census:primary.census(),environment:primary.environment,state:primary.snapshot(),collected:{rows:tickRows.length,samples:samples.length,frames:frames.length,snapshots:snapshots.length}});throw error;}
  }
  if(primary.tick===MAX_TICK&&extinctionTick===null&&samples.at(-1)?.tick!==MAX_TICK)capture(false);
  invariant(primary.tick===(extinctionTick??MAX_TICK),`foothold-band terminal tick mismatch`);
  const terminal=primary.snapshot(),environment=primary.environment;
  invariant(terminal.droppedHistory===0&&terminal.droppedLineage===0,`foothold-band dropped history/lineage observations`);
  const windows=WINDOWS.map((w)=>summarizeWindow(w,tickRows,samples,frames,primary.lineage));
  const seasonalGate=evaluateSeasonalGate(seasonalInput(frames));
  const baselineSeasonalReference=evaluateSeasonalGate(seasonalInput(baseline.frames));
  const spatialGate=evaluateSpatialGate([2500,3000].map((tick)=>{const frame=frames.find((f)=>f.tick===tick);return {tick,occupiedTilesByBand:frame?occupiedTilesByBand(frame):null};}));
  const output:Obj={schemaVersion:1,kind:'hungry-shapes-food-band-foothold-arm',run:{seed:1202,mode:'foothold-band',mutation:true,maxTick:MAX_TICK,finalTick:primary.tick,extinctionTick},
    runtime:{node:process.versions.node,platform:process.platform,arch:process.arch},rules:RULES,
    provenance:{sourceSha256:LOADED_SOURCE_SHA256,planSha256:FOOTHOLD_PLAN_SHA256,baselineArtifactSha256:BASELINE_IDENTITY.artifactSha256,
      baselineDataSha256:BASELINE_IDENTITY.dataSha256,baselineIndexSha256:BASELINE_IDENTITY.indexSha256,baselineRegression},
    samples,tickRows,frames,snapshots,windows,final:{census:primary.census(),environment,ledger:primary.ledger,lineage:primary.lineage,
      deathsByCause:{age:primary.lineage.filter((n)=>n.deathCause==='age').length,starvation:primary.lineage.filter((n)=>n.deathCause==='starvation').length},
      maxEverGeneration:Math.max(0,...primary.lineage.map((n)=>n.generation)),stateSha256:hash({state:terminal,environment})},
    repeat:{verified:true,comparedThroughTick:primary.tick,stateChecks:samples.length,frameChecks:frames.length},
    numericalGate:evaluateGate(primary.tick,primary.census(),windows),spatialGate,seasonalGate,baselineSeasonalReference};
  output.dataSha256=artifactHash(output);recorder?.save('candidate-evidence.json',output);validateEvidenceStructure(output,LOADED_SOURCE_SHA256);assertSourceIdentity();
  invariant(Buffer.byteLength(JSON.stringify(output))<=MAX_ARTIFACT_BYTES,`foothold-band artifact exceeds 24 MiB cap; fail closed`);
  return output;
}

export function validateEnvironment(value:unknown,tick:number,label:string,expectedMode:'alternating-band'|'foothold-band'):asserts value is HungryEnvironment{
  record(value,label);const foothold=expectedMode==='foothold-band';
  exactKeys(value,['version','mode','pulseBudget','targetCount','pulses','offered','accepted','overflow','initialFoodPerTile','bandColumns','bandWidth','activeBand','bandOffered','bandAccepted','bandOverflow',...(foothold?['floorPerBand','alternatingBudget']:[])],label);
  invariant(value.version===1&&value.mode===expectedMode&&value.pulseBudget===768&&value.targetCount===(foothold?SPLIT_BAND_TARGET_COUNT:ALTERNATING_BAND_TARGET_COUNT)&&value.initialFoodPerTile===RULES.initialFood,`${label}: mode parameters`);
  if(foothold)invariant(value.floorPerBand===96&&value.alternatingBudget===576,`${label}: floor/allocation parameters`);
  int(value.pulses,`${label}.pulses`);int(value.offered,`${label}.offered`);int(value.accepted,`${label}.accepted`);int(value.overflow,`${label}.overflow`);
  invariant(value.pulses===Math.floor(tick/RULES.foodSupplyEvery)&&value.offered===value.pulses*768&&value.accepted+value.overflow===value.offered,`${label}: food accounting`);
  const active=value.pulses===0?0:alternatingBandAtPulse(value.pulses-1);invariant(value.bandWidth===24&&same(value.bandColumns,SPLIT_BAND_COLUMNS)&&value.activeBand===active,`${label}: geometry/majority band`);
  const first=Math.floor(value.pulses/200)*100+Math.min(100,value.pulses%200),second=Math.floor(value.pulses/200)*100+Math.max(0,value.pulses%200-100);
  const expectedOffers=foothold?[value.pulses*96+first*576,value.pulses*96+second*576]:[first*768,second*768];
  for(const key of ['bandOffered','bandAccepted','bandOverflow'])invariant(Array.isArray(value[key])&&value[key].length===2&&value[key].every((n:unknown)=>Number.isSafeInteger(n)&&n>=0),`${label}: ${key} malformed`);
  validateBandAccounting(value,label);
  invariant(same(value.bandOffered,expectedOffers),`${label}: per-band food accounting`);
}
export function validateFrame(value:unknown,label='frame'):asserts value is Frame{
  record(value,label);exactKeys(value,['tick','censusSha256','stateSha256','foodBase64','cells','organisms','ledger','frameSha256'],label);
  int(value.tick,`${label}.tick`,0,MAX_TICK);invariant(/^[a-f0-9]{64}$/.test(value.censusSha256)&&/^[a-f0-9]{64}$/.test(value.stateSha256),`${label}: state binding`);
  invariant(typeof value.foodBase64==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.foodBase64),`${label}: malformed food bytes`);
  const food=Buffer.from(value.foodBase64,'base64');invariant(food.length===RULES.tileCount&&food.every((n)=>n<=RULES.maxFood),`${label}: food bounds`);
  invariant(Array.isArray(value.cells)&&Array.isArray(value.organisms)&&value.organisms.length<=RULES.maxOrganisms,`${label}: frame cells/organisms`);
  const orgs=new Map<number,any>(),tilesByOrganism=new Map<number,number[]>();for(const o of value.organisms){record(o,`${label}.organism`);exactKeys(o,['id','family','genome'],`${label}.organism`);
    int(o.id,`${label}.organism.id`,1,RULES.maxLineage);int(o.family,`${label}.organism.family`,0,2);validateGenome(o.genome,`${label}.organism.genome`);
    invariant(!orgs.has(o.id),`${label}: duplicate organism`);orgs.set(o.id,o);tilesByOrganism.set(o.id,[]);}
  const seen=new Set<number>();let previous=-1;for(const cell of value.cells){invariant(Array.isArray(cell)&&cell.length===2,`${label}: malformed cell tuple`);const [tile,id]=cell;
    int(tile,`${label}.tile`,0,RULES.tileCount-1);int(id,`${label}.bodyID`,1,RULES.maxLineage);
    invariant(tile>previous&&!seen.has(tile),`${label}: duplicate/unsorted tile`);previous=tile;seen.add(tile);invariant(orgs.has(id),`${label}: cell has no organism palette`);tilesByOrganism.get(id)!.push(tile);}
  invariant(value.cells.length<=RULES.maxOccupied&&new Set(value.cells.map((c:any)=>c[1])).size===orgs.size,`${label}: body palette mismatch`);
  for(const [id,tiles] of tilesByOrganism){const genome=orgs.get(id).genome;invariant(tiles.length>0,`${label}: organism has no cells`);
    invariant(tiles.length<=genome.maxCells&&tiles.length<=RULES.maxCellsPerOrganism,`${label}: body cell cap exceeded for ${id}`);
    invariant(isConnected({cells:tiles.map((tile)=>({tile}))} as DevelopmentOrganism),`${label}: disconnected body ${id}`);}
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
  invariant(proof.status==='verified'&&proof.seed===1202&&proof.comparedSamples===151&&proof.comparedFrames===151&&proof.comparedTickRows===3000&&
    proof.comparedSnapshots===7&&same(prior.snapshots.map((x:Obj)=>x.tick),BASELINE_SNAPSHOTS),`historical alternating baseline regression proof incomplete`);
  invariant(Array.isArray(proof.checkpoints)&&same(proof.checkpoints.map((x:Obj)=>x.tick),BASELINE_SNAPSHOTS),`baseline regression checkpoint coverage mismatch`);
  for(const checkpoint of proof.checkpoints){exactKeys(checkpoint,['tick','stateSha256','compared'],'baseline regression checkpoint');
    invariant(checkpoint.compared===true&&checkpoint.stateSha256===prior.snapshots.find((s:Obj)=>s.tick===checkpoint.tick)?.stateSha256,
      `baseline regression checkpoint mismatch at ${checkpoint.tick}`);}
}

export function validateRepeatProof(value:unknown,finalTick:number,sampleCount:number,frameCount:number):void{
  record(value,'repeat');exactKeys(value,['verified','comparedThroughTick','stateChecks','frameChecks'],'repeat');
  invariant(value.verified===true&&value.comparedThroughTick===finalTick&&value.stateChecks===sampleCount&&value.frameChecks===frameCount,`repeat proof mismatch`);
}
export function validateEvidenceStructure(value:unknown,sources?:Record<string,string>):asserts value is Obj{
  record(value,'evidence');exactKeys(value,['schemaVersion','kind','run','runtime','rules','provenance','samples','tickRows','frames','snapshots','windows','final','repeat','numericalGate','spatialGate','seasonalGate','baselineSeasonalReference','dataSha256'],'evidence');
  invariant(value.schemaVersion===1&&value.kind==='hungry-shapes-food-band-foothold-arm',`unsupported evidence schema`);record(value.run,'run');
  exactKeys(value.run,['seed','mode','mutation','maxTick','finalTick','extinctionTick'],'run');
  invariant(value.run.seed===1202&&value.run.mode==='foothold-band'&&value.run.mutation===true&&value.run.maxTick===MAX_TICK,`run settings mismatch`);
  const seed=1202;int(value.run.finalTick,'final tick',0,MAX_TICK);
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
  invariant(value.provenance.planSha256===FOOTHOLD_PLAN_SHA256&&value.provenance.baselineArtifactSha256===BASELINE_IDENTITY.artifactSha256&&
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
      s.census.effectiveMutations>=p.census.effectiveMutations&&s.environment.accepted>=p.environment.accepted,`sample counters decreased`);validateBandProgress(p.environment,s.environment,`sample ${s.tick}`);}
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
  invariant(same(value.seasonalGate,evaluateSeasonalGate(seasonalInput(value.frames))),`seasonal gate mismatch`);
  invariant(same(value.baselineSeasonalReference,evaluateSeasonalGate(seasonalInput(prior.frames))),`historical baseline seasonal reference mismatch`);
  validateRepeatProof(value.repeat,value.run.finalTick,value.samples.length,value.frames.length);
  invariant(typeof value.dataSha256==='string'&&value.dataSha256===artifactHash(value),`artifact integrity hash mismatch`);
  invariant(Buffer.byteLength(JSON.stringify(value))<=MAX_ARTIFACT_BYTES,`arm artifact exceeds 24 MiB cap`);
}

export function buildMarkdown(data:Obj):string{
  const lines=['# Food-band foothold screen','',`Seed ${data.run.seed}; foothold-band mode; Node ${data.runtime.node} on ${data.runtime.platform}/${data.runtime.arch}.`,
    `Mutation enabled; stopped at tick ${data.run.finalTick}${data.run.extinctionTick===null?'':' (actual extinction)'}.`,
    'Food starts at 20 everywhere and persists. Each pulse offers 768 units to both bands: 96 units each continuously, plus 576 to the majority band alternating every 100 pulses (672/96 total). The fixed floor reaches 288 distinct tiles per band; total reachable supply is 2,016 per band, not all 2,304 geometric tiles. Historical alternating reference deltas are descriptive only; the historical comparison does not establish a general causal benefit of the floor.','',
    '| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied tiles in each band |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |'];
  for(const w of data.windows){const e=w.endpoint;lines.push(`| ${w.from}–${w.to} | ${w.executedTicks}/500 (${w.status}) | ${w.births??'—'} | ${w.deaths??'—'} | ${w.cap48Ticks??'—'}/500 | ${w.nearCap47Ticks??'—'}/500 | ${w.blockedCapAttempts??'—'}/${w.blockedSpaceAttempts??'—'} | ${w.minPopulation??'—'}–${w.maxPopulation??'—'} | ${e.population??'—'}/${e.cells??'—'} | ${e.maxEverGeneration??'—'} | ${w.food.offered??'—'}/${w.food.accepted??'—'}/${w.food.overflow??'—'} | ${(e.occupiedTilesByBand??['—','—']).join(' / ')} |`);}
  lines.push('',`Numerical screen: ${data.numericalGate.numericalPass?'pass':'fail'}.`,
    `Both-band occupancy screen: ${data.spatialGate.pass?'pass':'fail'} (at least 10 occupied body tiles in each band at ticks 2,500 and 3,000).`,
    `Seasonal response screen: ${data.seasonalGate.pass?'pass':'fail'}; blocks: ${data.seasonalGate.blocks.map((b:Obj)=>`${b.from}–${b.to} majority=${b.fedBand} deltas=${JSON.stringify(b.deltasByBand)} ${b.pass?'pass':'fail'}`).join('; ')}.`,
    `Historical alternating descriptive deltas: ${data.baselineSeasonalReference.blocks.map((b:Obj)=>`${b.from}–${b.to} ${JSON.stringify(b.deltasByBand)} ${b.pass?'also meets screen':'does not meet screen'}`).join('; ')}. Historical baseline comparisons do not change the foothold status.`,
    `Historical alternating baseline regression: ${data.provenance.baselineRegression.status}; compared all ${data.provenance.baselineRegression.comparedSamples} samples, ${data.provenance.baselineRegression.comparedFrames} frames, ${data.provenance.baselineRegression.comparedTickRows} tick rows and ${data.provenance.baselineRegression.comparedSnapshots} snapshots.`,
    'Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. Missing endpoints and partial windows fail; no post-extinction states are fabricated.',
    'This screen does not establish adaptation, improved fitness, durable coexistence, or independent colonies.','');return lines.join('\n');
}
export function parseArgs(argv:string[]):{mode:'--write'|'--check';seed:1202;attemptDir?:string}{
  const actions=['--write','--check'];const mode=argv.find((x)=>actions.includes(x));invariant(mode!==undefined,'Usage: --write|--check --seed 1202 [--attempt-dir <reserved-dir>]');
  invariant(argv.filter((x)=>actions.includes(x)).length===1,'Choose exactly one action');const i=argv.indexOf('--seed');invariant(i>=0&&/^\d+$/.test(argv[i+1]??''),'An explicit --seed is required');
  const ai=argv.indexOf('--attempt-dir');const attemptDir=ai>=0?argv[ai+1]:undefined;
  invariant(argv.every((x,j)=>j===i||j===i+1||j===ai||j===ai+1||actions.includes(x)),'Unknown argument');const seed=Number(argv[i+1]);
  invariant(seed===1202,'This food-band foothold screen is frozen to seed 1202');
  invariant(mode==='--write'?ai>=0&&typeof attemptDir==='string'&&attemptDir.length>0:ai<0,'--write requires a durable --attempt-dir; --check does not accept one');
  return{mode:mode as any,seed,attemptDir};
}
function assertCommittedInputs():void{
  for(const path of ['docs/creative-prototypes/food-band-foothold-plan.md','apps/lab/src/food-band-foothold/model.ts','tools/food-band-foothold/explore.ts','tools/food-band-foothold/launch.sh','package.json','pnpm-lock.yaml']){
    try{const status=execFileSync('git',['status','--porcelain','--',path],{encoding:'utf8'});invariant(status.trim()==='',`Refusing outcome with uncommitted input: ${path}`);const committed=execFileSync('git',['show',`HEAD:${path}`],{encoding:'buffer'});invariant(hashBytes(readFileSync(new URL(`../../${path}`,import.meta.url)))===hashBytes(committed),`Working input differs from committed input: ${path}`);}catch(error){if(error instanceof Error&&error.message.startsWith('Refusing outcome'))throw error;throw new Error(`Unable to verify committed input ${path}: ${String(error)}`);}
  }
}
function legacyCheck():void{
  try{
    execFileSync(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('../alternating-food-replication/explore.ts',import.meta.url)),'--check','--seed','1202'],{stdio:'pipe'});
  }catch(error){
    const failure=error as {status?:number|null;stdout?:Buffer|string|null;stderr?:Buffer|string|null;message?:string};
    const output=(value:Buffer|string|null|undefined)=>value===undefined||value===null?'':Buffer.isBuffer(value)?value.toString('utf8'):value;
    throw new Error(`historical alternating-food runner --check failed (exit ${failure.status??'unknown'}):\n${output(failure.stdout)}${output(failure.stderr)}${failure.stdout||failure.stderr?'':failure.message??''}`);
  }
}
export function checkHistoricalReferences():Obj{
  legacyCheck();return baselineData();
}
export function formatCompletedOutcome(data:Obj):string{
  return JSON.stringify({seed:data.run.seed,mode:data.run.mode,finalTick:data.run.finalTick,extinctionTick:data.run.extinctionTick,
    census:data.final.census,environment:data.final.environment,numericalGate:data.numericalGate,spatialGate:data.spatialGate,seasonalGate:data.seasonalGate,baselineSeasonalReference:data.baselineSeasonalReference,windows:data.windows,dataSha256:data.dataSha256});
}
async function writeEvidence(seed:1202,attemptPath:string):Promise<void>{
  invariant(seed===1202,'This food-band foothold screen is frozen to seed 1202');
  const recorder=verifyAttemptReservation(attemptPath);let stage='preflight';
  try{
    assertCommittedInputs();assertPinnedInputs();assertSourceIdentity();
    process.stdout.write(`Attempt intent verified in ${recorder.directory}; seed ${seed}, foothold-band, 3,000 or actual extinction.\n`);
    stage='historical-alternating-check';legacyCheck();const prior=baselineData();
    for(const url of [JSON_URL,MD_URL]){try{await readFile(url);throw new Error(`Refusing to overwrite ${url.pathname}`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
    stage='historical-alternating-baseline-regression';const baselineRegression=runBaselineRegression(prior,recorder);assertSourceIdentity();
    process.stdout.write(`Completed predetermined historical alternating baseline regression: ${JSON.stringify(baselineRegression)}\n`);
    stage='foothold-outcome';const data=runArm(baselineRegression,recorder);assertSourceIdentity();
    process.stdout.write(`Completed foothold-band outcome: ${formatCompletedOutcome(data)}\n`);
    stage='evidence-write';const jsonText=`${JSON.stringify(data)}\n`;invariant(Buffer.byteLength(jsonText)<=MAX_ARTIFACT_BYTES,'alternating-band replication artifact exceeds 24 MiB cap; inconclusive attempt');
    await writeFile(JSON_URL,jsonText,{flag:'wx'});try{await writeFile(MD_URL,buildMarkdown(data),{flag:'wx'});}catch(e){throw new Error(`JSON written but Markdown failed for ${JSON_URL.pathname}; preserve it and investigate: ${String(e)}`);}
    recorder.append('attempt-status.json',{classification:'completed',artifactPath:OUTPUT_PATHS.json,artifactSha256:hashBytes(readFileSync(JSON_URL)),completedUtc:new Date().toISOString()});
    process.stdout.write(`Wrote food-band foothold seed ${seed} alternating-band evidence.\n`);
  }catch(error){recorder.failure(stage,error);throw error;}
}
async function checkEvidence(seed:1202):Promise<void>{
  assertPinnedInputs();assertSourceIdentity();checkHistoricalReferences();
  const data=JSON.parse(await readFile(JSON_URL,'utf8')) as Obj;validateEvidenceStructure(data,LOADED_SOURCE_SHA256);
  invariant(data.run.seed===seed&&data.run.mode==='foothold-band'&&data.kind==='hungry-shapes-food-band-foothold-arm','artifact identity differs');
  invariant(await readFile(MD_URL,'utf8')===buildMarkdown(data),'Markdown differs from alternating-food JSON');
  assertSourceIdentity();process.stdout.write(`Food-band foothold seed ${seed} arm structure, provenance, accounting, spatial and seasonal gates, and Markdown passed.\n`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const {mode,seed,attemptDir}=parseArgs(process.argv.slice(2));if(mode==='--write')await writeEvidence(seed,attemptDir!);else await checkEvidence(seed);}
