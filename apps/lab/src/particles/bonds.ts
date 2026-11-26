import { BOND_RULES, BondedWorld, type BondMode } from './bonded-model.ts';
import { mountEnvironmentPage, type EnvironmentSettings, type ViewWorld } from './environment-page.ts';
import { drawBondOverlay } from './bonds-render.ts';
import './bonds.css';

const modes: readonly BondMode[] = ['none', 'chains', 'mesh'];
const environments = [
  { label: 'No bonds', detail: 'individual movement rules only', value: { kind: 'still' as const } },
  { label: 'Chains', detail: `supplied links · degree cap ${BOND_RULES.chainsDegreeMax} · rings can form`, value: { kind: 'still' as const } },
  { label: 'Mesh', detail: `supplied links · degree cap ${BOND_RULES.meshDegreeMax}`, value: { kind: 'still' as const } },
];

function bonded(world: ViewWorld): BondedWorld { return world as BondedWorld; }

function graphText(view: ViewWorld): string {
  const graph = bonded(view).graphSummary();
  const meanDegree = graph.meanDegree === null ? '—' : graph.meanDegree.toFixed(2);
  const medianAge = graph.liveEdgeAgeMedian === null ? '—' : `${graph.liveEdgeAgeMedian} ticks`;
  return `Edges ${graph.edgeCount} · linked components ${graph.linkedComponents} · largest ${graph.largestComponent} · isolated ${graph.isolatedParticles} · mean degree ${meanDegree} · median edge age ${medianAge} · formed ${graph.formations} · stretch breaks ${graph.stretchBreaks} · removed after death ${graph.deathRemovals}`;
}

mountEnvironmentPage({
  environments,
  initialSettings: { seed: 1201, preset: 'pursuit', mutation: true },
  exportKind: 'particle-bonds-comparison-observation',
  filenamePrefix: 'particle-bonds',
  worldFactory: (settings: EnvironmentSettings, _environment, slot) => new BondedWorld(
    settings.seed, settings.preset, settings.mutation, modes[slot],
  ),
  overlay: (ctx, world, size) => drawBondOverlay(ctx, bonded(world), size),
  summary: graphText,
  worldMetadata: modes.map(mode => ({ mode })),
});
