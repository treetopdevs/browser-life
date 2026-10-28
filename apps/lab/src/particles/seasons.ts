import { renewalMultiplier, seasonalPhase } from './model.ts';
import type { ParticleEnvironment } from './model.ts';
import { mountEnvironmentPage } from './environment-page.ts';

const environments: { label: string; detail: string; value: ParticleEnvironment }[] = [
  { label: 'Still', detail: 'steady renewal · 1× on every row', value: { kind: 'still' } },
  { label: 'Short seasons', detail: '600 ticks per phase · 1,800 per full cycle', value: { kind: 'seasonal', period: 600 } },
  { label: 'Long seasons', detail: '1,800 ticks per phase · 5,400 per full cycle', value: { kind: 'seasonal', period: 1800 } },
];

mountEnvironmentPage({
  environments,
  initialSettings: { seed: 1201, preset: 'flocks', mutation: true },
  exportKind: 'particle-seasons-observation',
  filenamePrefix: 'particle-seasons',
  phaseAt: seasonalPhase,
  renewalAt: renewalMultiplier,
});
