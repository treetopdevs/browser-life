/**
 * SPOT6 diagnostic (described in CALIBRATION.md; decides nothing): where do bodies that appear "from nothing"
 * come from, and how much wall sits under the counting threshold?
 *
 *   deno run -A --no-lock experiments/spot6/regrowth.ts --runs runs/spot6 --settings MIX50,MIX75,SPOT --from 80000
 *
 * Part 1, from the tracker's samples (object positions at every 500-step census) of one tracked window: for
 * each lasting birth from nothing, the object of any type that most recently ended by fading earlier in the
 * window within `--near` tiles (default 2) of where the new one stands. Reported: how many new bodies stand on such a
 * site, whether the body that ended there was of the same type, and how long the site was without an object.
 * Objects that never reached a census have no position and are left out.
 *
 * Part 2, from the saved wall snapshots of that window: patches of one type's wall (4-connected, at least 3
 * tiles) at thresholds of 0.20 (the counting rule), 0.10 and 0.05 of a tile.
 */

import { argOf } from '../confirm/io.ts';
import { labelObjects, torusDist } from '../b2check/observe.ts';
import type { SegmentFile } from './rule.ts';
import { ALLOWED_SEEDS, SIZE } from './settings.ts';

const runs = argOf('runs');
const settings = argOf('settings').split(',');
const from = Number(argOf('from'));
const near = Number(argOf('near', '2'));
const arms = argOf('arms', 'PHAGE,NO_PHAGE').split(',');
const to = from + 20_000;

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2;
};

console.log(`## Bodies from nothing: what stood there before (window ${from} to ${to}, within ${near} tiles)\n`);
console.log('| Setting | Arm | Seed | Lasting births from nothing (with a position) | On the site of an object that faded earlier in the window | Of those: same type / another type | Median steps since that object ended | Of those, within 500 steps | On no such site |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const setting of settings) {
  for (const arm of arms) {
    for (const seed of ALLOWED_SEEDS) {
      let file: SegmentFile;
      try {
        file = JSON.parse(await Deno.readTextFile(`${runs}/${setting}/${arm}/seed-${seed}/seg-${from}-${to}.json`)) as SegmentFile;
      } catch {
        continue;
      }
      const tr = file.tracker!;
      const firstAt = new Map<number, { cx: number; cy: number }>();
      const lastAt = new Map<number, { cx: number; cy: number }>();
      for (const s of tr.samples) {
        if (!firstAt.has(s.uid)) firstAt.set(s.uid, { cx: s.cx, cy: s.cy });
        lastAt.set(s.uid, { cx: s.cx, cy: s.cy });
      }
      const faded = tr.records.filter((r) => r.end !== null && r.endKind === 'fade' && lastAt.has(r.uid));
      let births = 0;
      let onSite = 0;
      let same = 0;
      const gaps: number[] = [];
      for (const r of tr.records) {
        if (r.birth !== 'denovo' || r.born + 500 > tr.lastStep || (r.end !== null && r.end - r.born <= 500)) continue;
        const at = firstAt.get(r.uid);
        if (!at) continue;
        births++;
        // Of the objects that faded within `near` tiles before this birth, the one that ended last.
        let best: (typeof faded)[number] | null = null;
        for (const d of faded) {
          if ((d.end as number) > r.born) continue;
          const p = lastAt.get(d.uid)!;
          if (torusDist(at.cx, at.cy, p.cx, p.cy, SIZE, SIZE) > near) continue;
          if (best === null || (d.end as number) > (best.end as number)) best = d;
        }
        if (best) {
          onSite++;
          if (best.motif === r.motif) same++;
          gaps.push(r.born - (best.end as number));
        }
      }
      console.log(`| ${setting} | ${arm} | ${seed} | ${births} | ${onSite} | ${same} / ${onSite - same} | ${median(gaps) ?? 'n/a'} | ${gaps.filter((g) => g <= 500).length} | ${births - onSite} |`);
    }
  }
}

console.log(`\n## Wall under the counting threshold (snapshots at steps ${from + 10_000}, ${from + 11_000}, ${from + 12_000}; mean of the three)\n`);
console.log('| Setting | Arm | Seed | Patches at 0.20 (the counted objects) | Patches at 0.10 | Patches at 0.05 |');
console.log('|---|---|---|---|---|---|');
for (const setting of settings) {
  for (const arm of arms) {
    for (const seed of ALLOWED_SEEDS) {
      const counts = [0, 0, 0];
      let n = 0;
      for (const t of [from + 10_000, from + 11_000, from + 12_000]) {
        let bytes: Uint8Array;
        try {
          bytes = await Deno.readFile(`${runs}/${setting}/${arm}/seed-${seed}/snap-${t}.bin`);
        } catch {
          continue;
        }
        const W = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        [205, 102, 51].forEach((th, k) => (counts[k] += labelObjects(W, SIZE, SIZE, th).objects.length));
        n++;
      }
      if (n > 0) console.log(`| ${setting} | ${arm} | ${seed} | ${(counts[0] / n).toFixed(0)} | ${(counts[1] / n).toFixed(0)} | ${(counts[2] / n).toFixed(0)} |`);
    }
  }
}
