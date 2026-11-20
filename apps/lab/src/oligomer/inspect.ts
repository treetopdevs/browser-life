/** Inspector text for one tile (read-only; follows the tile, not a tracked cell). */

import { NUM_SPECIES, NUM_WALL_SPECIES, SPECIES, formatCatalyst } from './chem.ts';
import type { OligomerWorld } from './model.ts';
import { WALL_COLOUR_NAMES, WALL_NAMES, dominantIndex, feedstockAmount, lysinTargetMask, tileSourceOf, trophicClass, wallTotal } from './render.ts';
import type { ViewerObserver } from './viewer-observer.ts';

export type InspectRow = readonly [label: string, value: string];

function top(arr: Int32Array, base: number, n: number): string {
  const items: [number, number][] = [];
  for (let s = 0; s < NUM_SPECIES; s++) if (arr[base + s] > 0) items.push([s, arr[base + s]]);
  items.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return items.length ? items.slice(0, n).map(([s, c]) => `${SPECIES[s].label} x ${c}`).join(', ') : 'nothing';
}

export function tileHeading(world: OligomerWorld, tile: number): string {
  const W = world.cfg.width;
  return `tile (${tile % W}, ${Math.floor(tile / W)})`;
}

export function inspectRows(world: OligomerWorld, tile: number, viewer: ViewerObserver, cache: Map<number, number>): InspectRow[] {
  const cfg = world.cfg;
  const src = tileSourceOf(world);
  const rows: InspectRow[] = [['Square', `${tileHeading(world, tile)} (the square, not a tracked cell)`]];
  const eb = tile * NUM_SPECIES;
  if (!world.alive[tile]) {
    rows.push(['Contents', 'Empty']);
    rows.push(['Food outside', String(feedstockAmount(src, tile))]);
    rows.push(['Most common outside', top(world.ext, eb, 3)]);
    return rows;
  }
  rows.push(['Contents', 'compartment']);
  rows.push(['Energy', `${world.energy[tile]} / ${cfg.eMax}`]);
  rows.push(['Founder tag', `founder line ${world.founder[tile]} (the start square this lineage descends from; not the current wall)`]);
  const wb = tile * NUM_WALL_SPECIES;
  const lines: string[] = [];
  for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) lines.push(`${WALL_NAMES[wi]} (${WALL_COLOUR_NAMES[wi]}): ${world.wall[wb + wi]}`);
  rows.push(['Wall, total ' + wallTotal(src, tile) + ' (main pattern ' + WALL_NAMES[dominantIndex(src, tile)] + ')', lines.join('\n')]);
  rows.push(['Inside, most common', top(world.int, eb, 5)]);
  rows.push(['Outside, most common', top(world.ext, eb, 3)]);
  const gl: string[] = [];
  for (let s = 0; s < cfg.genomeSlots; s++) gl.push(`slot ${s + 1}  ${formatCatalyst(world.genome[tile * cfg.genomeSlots + s])}`);
  rows.push(['Genome', gl.join('\n')]);
  const mask = lysinTargetMask(src, tile, cache);
  let aim: string;
  if (mask === 0) aim = 'no lysin';
  else if (!cfg.enableLyse) aim = 'lysin gene present but predators are off in this world';
  else if (cfg.neutralWallLyse) aim = 'lysin cuts any neighbour wall at one fixed rate';
  else {
    const t: string[] = [];
    for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) if (mask & (1 << wi)) t.push(`${WALL_NAMES[wi]} (${WALL_COLOUR_NAMES[wi]})`);
    aim = `lysin aims at ${t.join(', ')}`;
  }
  rows.push(['Predation', aim]);
  const f = viewer.feed[tile];
  const s = viewer.sec[tile];
  const cls = trophicClass(f, s);
  rows.push(['Recent cuts (about 130 steps)', `${f} of food, ${s} of leftovers: ${cls === 'secondary' ? 'mostly leftovers' : cls === 'primary' ? 'mostly food' : cls === 'mixed' ? 'both' : 'too quiet to say'}`]);
  return rows;
}
