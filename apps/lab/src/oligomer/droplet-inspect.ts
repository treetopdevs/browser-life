/** Inspector text for one droplet-world square (read-only; plain integers of matter, 1,024 = full density). */

import { DROPLET_CORE, type DropletSource, dominantMotif, dropletTileMatter } from './droplet-render.ts';
import { KERNEL_MOTIFS } from './droplets-kernel.ts';
import { WALL_COLOUR_NAMES, WALL_NAMES } from './render.ts';

export type DropletInspectRow = readonly [label: string, value: string];

export function dropletHeading(src: { width: number }, tile: number): string {
  return `square (${tile % src.width}, ${Math.floor(tile / src.width)})`;
}

const line = (arr: Uint32Array, tile: number): string =>
  Array.from({ length: KERNEL_MOTIFS }, (_, m) => `${WALL_NAMES[m]} (${WALL_COLOUR_NAMES[m]}): ${arr[tile * KERNEL_MOTIFS + m]}`).join('\n');

export function dropletInspectRows(src: DropletSource, tile: number): DropletInspectRow[] {
  const W = src.W, P = src.P;
  const m = dominantMotif(W, tile), wd = W[tile * KERNEL_MOTIFS + m];
  let wTot = 0;
  for (let k = 0; k < KERNEL_MOTIFS; k++) wTot += W[tile * KERNEL_MOTIFS + k];
  return [
    ['Square', `${dropletHeading(src, tile)} (a square of the grid, not a tracked patch)`],
    ['Loose pieces (A)', String(src.A[tile])],
    ['Food (F)', String(src.F[tile])],
    ['Wall matter', `total ${wTot}; main pattern ${WALL_NAMES[m]} (${WALL_COLOUR_NAMES[m]})\n${line(W, tile)}`],
    ['Phage', line(P, tile)],
    ['Thick wall?', `${wd >= DROPLET_CORE ? 'yes' : 'no'} (the main pattern holds ${wd}; the patch count looks for ${DROPLET_CORE} or more, full density is 1,024)`],
    ['All matter on this square', String(dropletTileMatter(src, tile))],
  ];
}

export function dropletTileSpeech(src: DropletSource, tile: number): string {
  const W = src.W, m = dominantMotif(W, tile), wd = W[tile * KERNEL_MOTIFS + m];
  const x = tile % src.width, y = Math.floor(tile / src.width);
  return wd >= DROPLET_CORE ? `Tile (${x}, ${y}): thick wall, main pattern ${WALL_NAMES[m]}` : `Tile (${x}, ${y}): thin wall or empty`;
}
