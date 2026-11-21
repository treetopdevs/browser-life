/**
 * The four droplet worlds (the phage-gpu-run arms), their seeding, and their audience-terms notes, in one
 * place. Imported by the viewer page and by experiments/oligomer/phage-gpu-run.ts (which deno runs, so keep
 * this file to erasable TypeScript: no enums, namespaces or parameter properties).
 */

import { DropletKernelRef, KERNEL_MOTIFS, type DropletKernelConfig, defaultDropletKernelConfig } from './droplets-kernel.ts';

export type DropletArmId = 'PHAGE' | 'NO_PHAGE' | 'SINGLE_WALL' | 'NEUTRAL_PHAGE';
export const DROPLET_ARM_IDS: readonly DropletArmId[] = ['PHAGE', 'NO_PHAGE', 'SINGLE_WALL', 'NEUTRAL_PHAGE'];

export interface PhageParams {
  readonly kInfect: number;
  readonly kDecayP: number;
  readonly diffP: number;
  readonly mutPhage: number;
  readonly mutMotif: number;
}

/** The runner's own defaults (they differ from defaultDropletKernelConfig on mutPhage and mutMotif). */
export const PHAGE_RUN_DEFAULTS: PhageParams = { kInfect: 0.34, kDecayP: 0.02, diffP: 0.22, mutPhage: 0.00001, mutMotif: 0.00002 };

export interface PhageArm {
  readonly name: DropletArmId;
  readonly ov: Pick<DropletKernelConfig, 'kInfect' | 'kDecayP' | 'diffP' | 'mutPhage' | 'mutMotif' | 'neutralPhage'>;
  readonly single: boolean;
}

export function phageArms(p: PhageParams): readonly PhageArm[] {
  const { kInfect, kDecayP, diffP, mutPhage, mutMotif } = p;
  return [
    { name: 'PHAGE', ov: { kInfect, kDecayP, diffP, mutPhage, mutMotif, neutralPhage: false }, single: false },
    { name: 'NO_PHAGE', ov: { kInfect: 0.0, kDecayP, diffP, mutPhage: 0.0, mutMotif, neutralPhage: false }, single: false },
    { name: 'SINGLE_WALL', ov: { kInfect, kDecayP, diffP, mutPhage, mutMotif: 0.0, neutralPhage: false }, single: true },
    { name: 'NEUTRAL_PHAGE', ov: { kInfect, kDecayP, diffP, mutPhage, mutMotif, neutralPhage: true }, single: false },
  ];
}

/** Seed a grid of droplets scaled to the arena size (spacing about 20 tiles), exactly as the runner always did. */
export function seedPhageArena(ref: DropletKernelRef, size: number, single: boolean, initMode: 'single' | 'mixed'): void {
  const gridN = Math.max(3, Math.floor(size / 22));
  let idx = 0;
  for (let gy = 0; gy < gridN; gy++) {
    for (let gx = 0; gx < gridN; gx++) {
      const cx = Math.floor(((gx + 0.5) / gridN) * size);
      const cy = Math.floor(((gy + 0.5) / gridN) * size);
      const m = single || initMode === 'single' ? 0 : idx % KERNEL_MOTIFS;
      ref.seedDroplet(cx, cy, 3, m, 0.85);
      idx++;
    }
  }
}

export function armById(id: string, p: PhageParams = PHAGE_RUN_DEFAULTS): PhageArm {
  const a = phageArms(p).find((x) => x.name === id);
  if (!a) throw new Error(`Unknown droplet arm: ${id}`);
  return a;
}

export interface DropletBuild {
  readonly cfg: DropletKernelConfig;
  readonly ref: DropletKernelRef;
}

/** A seeded CPU reference for one arm (the GPU engine uploads it and drops it). */
export function buildDropletWorld(id: string, size: number, seed: number, p: PhageParams = PHAGE_RUN_DEFAULTS): DropletBuild {
  const arm = armById(id, p);
  const cfg = defaultDropletKernelConfig({ width: size, height: size, seed, ...arm.ov });
  const ref = new DropletKernelRef(cfg);
  seedPhageArena(ref, size, arm.single, 'mixed');
  return { cfg, ref };
}

/** Select option value for a droplet world. Namespaced because the Phase A condition id SINGLE_WALL already exists. */
export const dropletOptionValue = (id: string): string => `D_${id}`;
export const isDropletOptionValue = (v: string): boolean => v.startsWith('D_');
export const dropletIdOfValue = (v: string): DropletArmId => v.slice(2) as DropletArmId;

export const DROPLET_WORLD_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'D_PHAGE', label: 'Six wall patterns, each with its own phage: a pattern that spreads becomes the next target' },
  { value: 'D_NO_PHAGE', label: 'Same six patterns, phage switched off (the control)' },
  { value: 'D_SINGLE_WALL', label: 'One wall pattern only (shown as 0011), phage allowed' },
  { value: 'D_NEUTRAL_PHAGE', label: 'Phage that ignores the pattern: it eats any wall at the same rate' },
];

/** Where the quoted results come from. Every figure below is copied from the PHASE-B2-GPU.md table. */
export const RESULT_SETTING = '128 x 128 squares, 20,000 steps, 4 seeds, run on a graphics card';

/** Audience-terms description of one world, derived from its arm flags so it cannot drift from them. */
export function describeDropletArm(name: string, p: PhageParams = PHAGE_RUN_DEFAULTS): string {
  const a = armById(name, p);
  const parts: string[] = [];
  parts.push(a.single ? 'Only one wall pattern (shown as 0011) exists, so there is nothing to switch to.' : 'Droplets start in six wall patterns (the names and colours on this page are display labels only).');
  if (a.ov.kInfect === 0) {
    parts.push('Phage is switched off, so no pattern is ever a target (the control). In the doc runs (' + RESULT_SETTING + ') it held 59 to 65 droplets late and the leading pattern changed 0 to 2 times; that table predates a later fix to the kernel, and our re-run on the current code (same size, steps and seeds) held 60 to 68 droplets late with 0 to 1 leader changes.');
  } else if (a.ov.neutralPhage) {
    parts.push(
      'A phage here grows in any wall at the same rate, so no pattern is safer than another. All its phage is drawn as the 0011 colour, since it has no pattern of its own. In the doc runs (' +
        RESULT_SETTING + ') it held 10 to 19 droplets late and the leading pattern changed 1 to 9 times; that table predates a later fix to the kernel, and our re-run on the current code (same size, steps and seeds) held 4 to 15 droplets late with 1 to 11 leader changes.',
    );
  } else if (a.single) {
    parts.push('Phage is allowed, but only phage of that one pattern can grow, and only in its wall. In the doc runs (' + RESULT_SETTING + ') it held 17 to 25 droplets late; that table predates a later fix to the kernel, and our re-run on the current code (same size, steps and seeds) held 19 to 29 droplets late.');
  } else {
    parts.push(
      'A phage can only grow in wall of its own pattern, and it turns that wall back into loose pieces and more phage, so a pattern that spreads becomes the next target. In the doc runs (' +
        RESULT_SETTING + ') it held 65 to 70 droplets late and the leading pattern changed 6 to 9 times; that table predates a later fix to the kernel, and our re-run on the current code (same size, steps and seeds) held 68 to 71 droplets late with 7 to 10 leader changes.',
    );
  }
  parts.push('The leader-change counter on this page samples every 500 steps from step 2,000 over the whole run, so it is not the same measurement as these figures.');
  return parts.join(' ');
}
