/** Compare complete preserved v2 pilots with current outputs; no simulation or writes. Node 24. */
import { readFileSync } from 'node:fs';
import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';

const base = new URL('../../docs/creative-prototypes/', import.meta.url);
function load(path: string) {
  const bytes = readFileSync(new URL(path, base));
  return { data: JSON.parse(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex') };
}
const pairs = [
  ['history/particle-v2-pilot.json', 'pilot.json'],
  ['history/picker-v2-pilot.json', 'picker-pilot.json'],
];
for (const [historical, current] of pairs) {
  const old = load(historical), fresh = load(current);
  if (old.data.runtime !== process.version || fresh.data.runtime !== process.version) throw new Error(`Unverified: ${historical} and ${current} must both record the executing runtime ${process.version}`);
  const omitted = ['sourceSha256', 'sourceHashes', 'rulesVersion'];
  for (const data of [old.data, fresh.data]) {
    for (const key of omitted) delete data[key];
    if (data.rules) delete data.rules.version;
    if (data.runs) for (const run of data.runs) delete run.session.modelVersion;
  }
  deepStrictEqual(fresh.data, old.data, `Compatibility mismatch: ${historical} → ${current}`);
  console.log(JSON.stringify({ historical, current, runtime: process.version, exactMatch: true, historicalSha256: old.sha256, currentSha256: fresh.sha256, exclusions: [...omitted, 'rules.version', 'runs[*].session.modelVersion'], scope: 'Entire parsed artifacts; all other fields including complete histories, recipes, selections, ledger and numerical outcomes compare exactly.' }));
}
const baselineArtifact = load('history/particle-v2-pilot.json');
const oasesArtifact = load('oases-pilot.json');
const baseline = baselineArtifact.data;
const oases = oasesArtifact.data;
if (oases.runtime !== process.version) throw new Error('Oases still-prefix comparison requires the recorded runtime');
let comparedCensuses = 0;
for (const still of oases.results.filter((r: { label: string }) => r.label === 'still')) {
  const original = baseline.results.find((r: { preset: string; seed: number }) => r.preset === 'pursuit' && r.seed === still.seed);
  if (!original) throw new Error(`Missing v2 pursuit seed ${still.seed}`);
  for (const recorded of original.history) {
    const actual = still.history.find((r: { tick: number }) => r.tick === recorded.tick);
    if (!actual) throw new Error(`Missing still census ${still.seed}/${recorded.tick}`);
    const { occupiedBins: _occupiedBins, ...expectedCensus } = recorded;
    const { patches: _patches, fractionInsideAnyPatch: _fraction, ...actualCensus } = actual;
    deepStrictEqual(actualCensus, expectedCensus, `Still prefix mismatch seed ${still.seed} tick ${recorded.tick}`);
    comparedCensuses++;
  }
}
console.log(JSON.stringify({ scope: 'Oases still arm versus preserved v2 pursuit census prefix through tick3000', seeds: [1201, 1202, 1203], comparedCensuses, exactMatch: true, runtime: process.version, historicalSha256: baselineArtifact.sha256, currentSha256: oasesArtifact.sha256 }));
