// Behaviour atlas (docs/behaviour-atlas-2026-11-01/PLAN.md): the atlas observer is read-only.
// evaluateBatch with no observer, with a state-hash observer, and with the atlas observer added
// gives identical evaluations; the two observed runs give identical phase state hashes; and the
// atlas observer yields physical descriptors for live replicates. Needs a WebGPU adapter.
//   deno run -A tests/deno/atlas_twin.ts
import { M3_FOUNDERS, founderGenome, stateHash } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { DEFAULT_EVAL, atlasObserver, evaluateBatch, type EvalObserver } from "@bl/search";

const device = await requestDevice(navigator.gpu);
try {
  const genomes = [0, 1].map((i) => founderGenome(M3_FOUNDERS[i]));
  const config = { ...DEFAULT_EVAL, side: 2, reps: 2, seed: 2_026_110_101, growSteps: 600, recoverSteps: 200, darkSteps: 100 };
  const hashes = (out: Record<string, string>): EvalObserver => async (e) => { if (e.kind === "state") out[e.phase] = stateHash(e.state); };
  const plainStates: Record<string, string> = {}, atlasStates: Record<string, string> = {};
  const bare = await evaluateBatch(device, genomes, config);
  const plain = await evaluateBatch(device, genomes, config, hashes(plainStates));
  if (JSON.stringify(bare) !== JSON.stringify(plain)) throw new Error("evaluations differ with a state-hash observer");
  const atlas = atlasObserver(config, genomes.length);
  const both: EvalObserver = async (e) => { await atlas.observer(e); await hashes(atlasStates)(e); };
  const watched = await evaluateBatch(device, genomes, config, both);
  if (JSON.stringify(plain) !== JSON.stringify(watched)) throw new Error("evaluations differ with the atlas observer");
  if (JSON.stringify(plainStates) !== JSON.stringify(atlasStates)) throw new Error("phase state hashes differ with the atlas observer");
  const d = atlas.results();
  console.log(JSON.stringify(d.map((g, k) => ({ genome: k, survived: watched[k].survived, ...g }))));
  if (d.some((g, k) => watched[k].survived > 0 && !g.descriptors)) throw new Error("a surviving genome has no descriptors");
  console.log(`PASS atlas observer twin: evaluations identical with no observer, a hash observer and the atlas observer; ${Object.keys(plainStates).length} phase hashes identical with and without the atlas`);
} finally {
  device.destroy();
}
