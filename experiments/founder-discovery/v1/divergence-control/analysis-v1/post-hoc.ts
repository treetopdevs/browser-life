// Post hoc description (not confirmatory, written after seeing analysis-v1/report.json).
// The type-matched null keeps each parameter change on its own slot with a random sign.
// This splits each founder's random mutants by whether they carry the founder's swept
// change in the same direction as evolution, and reports their mean scores.
// Reads the frozen roster and the analysis report only; runs no competition.
// Usage: deno run --no-lock -A experiments/founder-discovery/v1/divergence-control/analysis-v1/post-hoc.ts NEW_OUT.json
import { sha256 } from "../../../../../tools/lib/founder-policy.ts";
import { writeNew } from "../../../../../tools/lib/discovery-improvement-runtime.ts";
import {
  GAIN,
  MU,
  RECONSTRUCTIONS,
  SIGMA,
  slotsOf,
} from "../../../../../tools/lib/discovery-divergence-control.ts";

const DIR = "experiments/founder-discovery/v1/divergence-control";
const [outPath] = Deno.args;
if (!outPath) throw Error("usage: post-hoc.ts NEW_OUT.json");
const rosterBytes = await Deno.readFile(`${DIR}/roster.json`);
const reportBytes = await Deno.readFile(`${DIR}/analysis-v1/report.json`);
const roster = JSON.parse(new TextDecoder().decode(rosterBytes));
const report = JSON.parse(new TextDecoder().decode(reportBytes));

type Draw = {
  drawId: string;
  founderId: string;
  seed: number;
  evolved: { point: number };
  mutants: { point: number }[];
};
const genome = new Map<string, { founderHex: string }>(
  roster.genomes.map((g: { id: string; founderHex: string }) => [g.id, g]),
);
const evolvedHex = new Map<string, string>(
  roster.evolved.map((e: { drawId: string; descendantHex: string }) => [e.drawId, e.descendantHex]),
);
const mutantsOf = new Map<string, { genomeId: string; hex: string }[]>();
for (const m of roster.mutants) {
  mutantsOf.set(m.evolvedDrawId, [...(mutantsOf.get(m.evolvedDrawId) ?? []), m]);
}
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const sign = (x: number) => Math.sign(x) as -1 | 0 | 1;
const SWEPT = new Map<string, number>(RECONSTRUCTIONS.map((r) => [r.founderId, r.slot]));

const founders = [...new Set((report.draws as Draw[]).map((d) => d.founderId))];
const out = founders.map((founderId) => {
  const draws = (report.draws as Draw[]).filter((d) => d.founderId === founderId);
  const parameterChanges = { mu: 0, sigma: 0, motGain: 0 };
  const rows = draws.flatMap((d) => {
    const ms = mutantsOf.get(d.drawId)!;
    const f = slotsOf(genome.get(ms[0].genomeId)!.founderHex);
    const e = slotsOf(evolvedHex.get(d.drawId)!);
    for (const [k, s] of [["mu", MU], ["sigma", SIGMA], ["motGain", GAIN]] as const) {
      if (e[s] !== f[s]) parameterChanges[k]++;
    }
    return ms.map((m, j) => {
      const x = slotsOf(m.hex);
      const slot = SWEPT.get(founderId);
      return {
        drawId: d.drawId,
        seed: d.seed,
        mutant: m.genomeId,
        score: d.mutants[j].point,
        evolvedSweptDelta: slot === undefined ? null : e[slot] - f[slot],
        mutantSweptDelta: slot === undefined ? null : x[slot] - f[slot],
      };
    });
  });
  const slot = SWEPT.get(founderId);
  const split = slot === undefined ? null : (() => {
    const same = rows.filter((r) =>
      r.evolvedSweptDelta !== 0 && sign(r.mutantSweptDelta!) === sign(r.evolvedSweptDelta!)
    );
    const other = rows.filter((r) => !same.includes(r));
    return {
      slot,
      evolvedDrawsChangingSweptSlot: draws.filter((d) => {
        const ms = mutantsOf.get(d.drawId)!;
        return slotsOf(evolvedHex.get(d.drawId)!)[slot] !==
          slotsOf(genome.get(ms[0].genomeId)!.founderHex)[slot];
      }).length,
      mutantsSameDirection: { n: same.length, meanScore: mean(same.map((r) => r.score)) },
      mutantsOtherwise: { n: other.length, meanScore: mean(other.map((r) => r.score)) },
    };
  })();
  return {
    founderId,
    draws: draws.length,
    evolvedDrawsWithParameterChange: parameterChanges,
    meanMutantScore: mean(rows.map((r) => r.score)),
    sweptSlotSplit: split,
    mutants: rows,
  };
});

await writeNew(
  outPath,
  JSON.stringify(
    {
      format: "founder-discovery-divergence-control-post-hoc-v1",
      status: "post hoc description; not confirmatory; written after the analysis",
      inputs: { rosterSha256: sha256(rosterBytes), reportSha256: sha256(reportBytes) },
      founders: out,
    },
    null,
    2,
  ) + "\n",
);
for (const f of out) {
  console.log(
    JSON.stringify({
      founderId: f.founderId,
      evolvedDrawsWithParameterChange: f.evolvedDrawsWithParameterChange,
      meanMutantScore: f.meanMutantScore,
      sweptSlotSplit: f.sweptSlotSplit,
    }),
  );
}
