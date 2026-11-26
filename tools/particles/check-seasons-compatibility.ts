/** Compare complete preserved v3 pilots with regenerated outputs; no simulation, writes receipt after checks pass. Node 24. */
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { RULES } from '../../apps/lab/src/particles/model.ts';

const base = new URL('../../docs/creative-prototypes/', import.meta.url);
const output = new URL('../../docs/creative-prototypes/seasons-compatibility.jsonl', import.meta.url);
function load(path: string) {
  const bytes = readFileSync(new URL(path, base));
  return { data: JSON.parse(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex') };
}
function numericalProjection(input: any) {
  const data = structuredClone(input);
  // Only source and toy-model version provenance is excluded. Runtime remains a required equality check.
  delete data.sourceSha256;
  delete data.sourceHashes;
  delete data.rulesVersion;
  if (data.rules) delete data.rules.version;
  if (Array.isArray(data.runs)) for (const run of data.runs) if (run.session) delete run.session.modelVersion;
  return data;
}
const pairs = [
  ['history/particle-v3-pilot.json', 'pilot.json'],
  ['history/picker-v3-pilot.json', 'picker-pilot.json'],
  ['history/oases-v3-pilot.json', 'oases-pilot.json'],
  ['history/oases-flocks-v3-pilot.json', 'oases-flocks.json'],
] as const;
const receipts = [];
for (const [historical, current] of pairs) {
  const old = load(historical), fresh = load(current);
  if (old.data.runtime !== process.version || fresh.data.runtime !== process.version) throw new Error(`Unverified runtime for ${historical} → ${current}; both must record ${process.version}`);
  deepStrictEqual(numericalProjection(fresh.data), numericalProjection(old.data), `Compatibility mismatch: ${historical} → ${current}`);
  receipts.push({ historical, current, runtime: process.version, exactMatch: true, historicalSha256: old.sha256, currentSha256: fresh.sha256,
    exclusions: ['sourceSha256', 'sourceHashes', 'rulesVersion', 'rules.version', 'runs[*].session.modelVersion'], scope: 'Entire parsed artifacts; all other settings, histories, ledgers, recipes, selections and numerical outcomes compare exactly.' });
}

const historical = load('history/oases-flocks-v3-pilot.json');
const seasonal = load('seasons-pilot.json');
if (historical.data.runtime !== process.version || seasonal.data.runtime !== process.version) throw new Error(`Still-prefix comparison requires runtime ${process.version}`);
if (historical.data.rulesVersion !== RULES.version - 1 || seasonal.data.rulesVersion !== RULES.version) throw new Error('Still-prefix comparison expected preserved v3 model and current v4 model');
const expectedSeeds = [1201, 1202, 1203];
const oldStill = historical.data.results.filter((r: any) => r.environment.kind === 'still');
const currentStill = seasonal.data.results.filter((r: any) => r.environment.kind === 'still');
deepStrictEqual(oldStill.map((r: any) => r.seed).sort((a: number,b: number)=>a-b), expectedSeeds, 'Preserved flock evidence must contain three still seeds');
deepStrictEqual(currentStill.map((r: any) => r.seed).sort((a: number,b: number)=>a-b), expectedSeeds, 'Season evidence must contain three still seeds');
if (seasonal.data.results.length !== 9) throw new Error(`Season evidence must contain exactly nine runs, found ${seasonal.data.results.length}`);
const expectedMatrix = ['still','seasonal-600','seasonal-1800'].flatMap(label => expectedSeeds.map(seed => `${label}/${seed}`)).sort();
const currentMatrix = seasonal.data.results.map((r: any) => `${r.label}/${r.seed}`).sort();
deepStrictEqual(currentMatrix, expectedMatrix, 'Season evidence must contain each seed/environment pair exactly once');
const censusFields = ['tick','population','counts','births','deaths','mutations','blockedBirths','maxGeneration','meanSpeed','traitSpread','particleEnergy','foodEnergy'];
let comparedCensuses = 0;
for (const seed of expectedSeeds) {
  const before = oldStill.find((r: any) => r.seed === seed);
  const after = currentStill.find((r: any) => r.seed === seed);
  if (!before || !after) throw new Error(`Missing still seed ${seed}`);
  const expected = before.history.filter((c: any) => c.tick <= 6000);
  const actual = after.history.filter((c: any) => c.tick <= 6000);
  if (expected.length !== 61 || actual.length !== 61) throw new Error(`Expected 61 still census samples through tick 6000 for seed ${seed}; found ${expected.length}/${actual.length}`);
  for (let i = 0; i < expected.length; i++) {
    const expectedCensus = Object.fromEntries(censusFields.map(key => [key, expected[i][key]]));
    const actualCensus = Object.fromEntries(censusFields.map(key => [key, actual[i][key]]));
    deepStrictEqual(actualCensus, expectedCensus, `Still flock prefix mismatch at seed ${seed}, tick ${expected[i].tick}`);
    comparedCensuses++;
  }
}
receipts.push({ historical: 'history/oases-flocks-v3-pilot.json', current: 'seasons-pilot.json', scope: 'Still flock census prefix through tick 6000; 61 censuses × 3 seeds, exact census fields only.', seeds: expectedSeeds, comparedCensuses, runtime: process.version, exactMatch: true, historicalSha256: historical.sha256, currentSha256: createHash('sha256').update(readFileSync(new URL('seasons-pilot.json', base))).digest('hex') });
writeFileSync(output, receipts.map(r => JSON.stringify(r)).join('\n') + '\n');
for (const receipt of receipts) console.log(JSON.stringify(receipt));
