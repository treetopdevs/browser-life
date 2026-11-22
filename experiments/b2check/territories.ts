/**
 * Exploratory, not in PLAN.md: reads the saved wall snapshots and asks whether the regions held by one wall
 * type (territories) stay where they are while the counted objects do not.
 *
 * A tile is walled if its total wall (all types) is at least 0.05; its type is the type with most wall there.
 * Kept: of the tiles walled at the first snapshot, the share that are walled with the same leading type later.
 * A territory is a 4-connected patch of walled tiles of one type with at least 3 tiles.
 *
 *   deno run -A --no-lock experiments/b2check/territories.ts --runs runs/b2check
 */

import { argOf, exists } from '../confirm/io.ts';
import { labelObjects, LOW_THRESH, MOTIFS } from './observe.ts';

const runs = argOf('runs');
const SIZE = 128;
const N = SIZE * SIZE;
const SETS: readonly (readonly [number, number, number])[] = [[70_000, 71_000, 72_000], [230_000, 231_000, 232_000]];

interface Snap {
  dom: Int8Array; // dominant type per tile, -1 if not walled
  labels: Int32Array;
  objects: number;
  territories: number;
  walled: number;
}

async function load(path: string): Promise<Snap> {
  const bytes = await Deno.readFile(path);
  const W = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const dom = new Int8Array(N).fill(-1);
  let walled = 0;
  for (let i = 0; i < N; i++) {
    let tot = 0;
    let best = -1;
    let bestW = 0;
    for (let m = 0; m < MOTIFS; m++) {
      const w = W[i * MOTIFS + m];
      tot += w;
      if (w > bestW) { bestW = w; best = m; }
    }
    if (tot >= LOW_THRESH) { dom[i] = best; walled++; }
  }
  // Territories: connected patches of one dominant type.
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
  let territories = 0;
  for (let start = 0; start < N; start++) {
    if (seen[start] || dom[start] < 0) continue;
    const m = dom[start];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % SIZE;
      const y = (i / SIZE) | 0;
      const nb = [y * SIZE + ((x + 1) % SIZE), y * SIZE + ((x + SIZE - 1) % SIZE), ((y + 1) % SIZE) * SIZE + x, ((y + SIZE - 1) % SIZE) * SIZE + x];
      for (const j of nb) if (!seen[j] && dom[j] === m) { seen[j] = 1; queue[tail++] = j; }
    }
    if (tail >= 3) territories++;
  }
  const { labels, objects } = labelObjects(W, SIZE, SIZE);
  return { dom, labels, objects: objects.length, territories, walled };
}

function compare(a: Snap, b: Snap): { sameType: number; chance: number; objectTiles: number } {
  let same = 0;
  const pa = new Float64Array(MOTIFS);
  const pb = new Float64Array(MOTIFS);
  for (let i = 0; i < N; i++) {
    if (a.dom[i] >= 0) pa[a.dom[i]]++;
    if (b.dom[i] >= 0) pb[b.dom[i]]++;
    if (a.dom[i] >= 0 && a.dom[i] === b.dom[i]) same++;
  }
  // Chance: a tile walled at the first time, of type m with the first map's shares, lands on a tile that is
  // walled and of type m in the second map with the second map's share of all tiles.
  let chance = 0;
  for (let m = 0; m < MOTIFS; m++) chance += (pa[m] / a.walled) * (pb[m] / N);
  let inObj = 0;
  let kept = 0;
  for (let m = 0; m < MOTIFS; m++) {
    for (let i = 0; i < N; i++) {
      if (a.labels[m * N + i] === 0) continue;
      inObj++;
      if (b.labels[m * N + i] !== 0) kept++;
    }
  }
  return { sameType: a.walled > 0 ? same / a.walled : 0, chance, objectTiles: inObj > 0 ? kept / inObj : 0 };
}

const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
console.log('| World | Seed | Snapshots | Objects (confirmation rule) | Territories | Walled tiles at the first snapshot | Of those, still walled with the same leading type after 1,000 / 2,000 steps (chance after 2,000) | Object tiles still in an object of that type after 1,000 / 2,000 steps |');
console.log('|---|---|---|---|---|---|---|---|');
for (const world of ['PHAGE', 'NO_PHAGE']) {
  for (const seed of [13, 14, 15, 16]) {
    for (const set of SETS) {
      const paths = set.map((t) => `${runs}/${world}/seed-${seed}/snap-${t}.bin`);
      if (!(await exists(paths[0])) || !(await exists(paths[2]))) continue;
      const [a, b, c] = await Promise.all(paths.map(load));
      const ab = compare(a, b);
      const ac = compare(a, c);
      console.log(
        `| ${world} | ${seed} | ${set.join(', ')} | ${a.objects}, ${b.objects}, ${c.objects} | ${a.territories}, ${b.territories}, ${c.territories} | ${pct(a.walled / N)} | ${pct(ab.sameType)} / ${pct(ac.sameType)} (${pct(ac.chance)}) | ${pct(ab.objectTiles)} / ${pct(ac.objectTiles)} |`,
      );
    }
  }
}
