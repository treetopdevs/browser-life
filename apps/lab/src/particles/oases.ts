import { mountEnvironmentPage } from './environment-page.ts';
import type { ParticleEnvironment, PresetId } from './model.ts';

const environments: { label: string; detail: string; value: ParticleEnvironment }[] = [
  { label: 'Still', detail: 'patches stay in place', value: { kind: 'still' } },
  { label: 'Slow oases', detail: 'travelling at 0.0001 world widths per tick', value: { kind: 'travelling', speed: 0.0001 } },
  { label: 'Faster oases', detail: 'travelling at 0.00025 world widths per tick', value: { kind: 'travelling', speed: 0.00025 } },
];

mountEnvironmentPage({
  environments,
  initialSettings: { seed: 1201, preset: 'pursuit' as PresetId, mutation: true },
  exportKind: 'particle-oases-observation',
  filenamePrefix: 'particle-oases',
});
