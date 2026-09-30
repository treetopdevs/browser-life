// CPU-only dense-state readback analysis benchmark; no evolution or GPU execution.
import { cellCount, CH, G, GENOME_CHANNELS } from '@bl/schema';
import { discoveryEvolutionWorld, sampleDiscoveryEvolution } from './lib/discovery-evolution.ts';
import { sha256 } from './lib/founder-policy.ts';

const [shortlistPath, output] = Deno.args;
if (!shortlistPath || !output) throw Error('usage: discovery_sampling_benchmark.ts SHORTLIST NEW_OUTPUT');
const bytes = await Deno.readFile(shortlistPath);
const shortlist = JSON.parse(new TextDecoder().decode(bytes));
const {state} = discoveryEvolutionWorld(6410001, 'normal', shortlist.selected[0].hex);
const n = cellCount(state.cfg), center = 128 * 256 + 128;
if (!state.genome[G.LIN_LO * n + center]) throw Error('Missing constructed founder');
for (let c = 0; c < GENOME_CHANNELS; c++) state.genome.fill(state.genome[c*n+center], c*n, (c+1)*n);
state.cells.fill(64, CH.B*n, (CH.B+1)*n);
const started = performance.now();
const sample = sampleDiscoveryEvolution(state, shortlist.selected[0].hex, [], [6420001, 6420002]);
const seconds = (performance.now()-started)/1000;
const report = {
  format: 'discovery-cpu-sampling-benchmark/v1',
  interpretation: 'Constructed all-cell founder-associated biomass. CPU analysis only; not a simulation outcome or a measured GPU/mutation-ledger throughput estimate. One-lineage case does not bound ancestry-graph costs.',
  shortlistSha256: sha256(bytes),
  sourceHashes: Object.fromEntries(await Promise.all(['tools/discovery_sampling_benchmark.ts','tools/lib/discovery-evolution.ts','tools/lib/founder-policy.ts'].map(async p=>[p,sha256(await Deno.readFile(p))]))),
  cells: n, seconds, rootMass: sample.rootMass, associatedGenomeCount: sample.byGenomeAbundance.length,
  sampleStateHash: sample.stateHash, paidUSD: 0,
};
await Deno.writeTextFile(output, JSON.stringify(report,null,2)+'\n', {createNew:true});
console.log(JSON.stringify({seconds,cells:n,rootMass:sample.rootMass}));
