/**
 * Phase B1.2 Experiment Runner: Heritable Motif-Specific Lysis on Pointer-Free Zwicker Droplets.
 *
 * Compares LYSE vs NO_LYSE vs SINGLE_WALL vs NEUTRAL_LYSE across multiple seeds with exact
 * integer matter conservation (res = 0).
 *
 * Usage:
 *   node experiments/oligomer/droplets-run.ts --steps 12000 --seeds 4 --size 48
 */

import { DropletWorld, NUM_MOTIFS, defaultDropletConfig } from '../../apps/lab/src/oligomer/droplets.ts';

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const steps = Number(args.steps ?? 12000);
const seeds = Number(args.seeds ?? 4);
const size = Number(args.size ?? 48);
const censusEvery = Number(args.census ?? 500);

const arms = [
  { name: 'LYSE', ov: { kLyse: 0.35, mutLyse: 0.0008, mutMotif: 0.00005, neutralLyse: false }, single: false },
  { name: 'NO_LYSE', ov: { kLyse: 0.0, mutLyse: 0.0008, mutMotif: 0.00005, neutralLyse: false }, single: false },
  { name: 'SINGLE_WALL', ov: { kLyse: 0.35, mutLyse: 0.0008, mutMotif: 0.0, neutralLyse: false }, single: true },
  { name: 'NEUTRAL_LYSE', ov: { kLyse: 0.15, mutLyse: 0.0008, mutMotif: 0.00005, neutralLyse: true }, single: false },
] as const;

console.log(`=== Phase B1.2 Active Droplets | size=${size}x${size} | steps=${steps} | seeds=${seeds} ===`);

for (const arm of arms) {
  for (let seed = 1; seed <= seeds; seed++) {
    const t0 = performance.now();
    const w = new DropletWorld(defaultDropletConfig({ width: size, height: size, seed, ...arm.ov }));
    const coords = [
      [Math.floor(size * 0.2), Math.floor(size * 0.25)],
      [Math.floor(size * 0.5), Math.floor(size * 0.25)],
      [Math.floor(size * 0.8), Math.floor(size * 0.25)],
      [Math.floor(size * 0.2), Math.floor(size * 0.75)],
      [Math.floor(size * 0.5), Math.floor(size * 0.75)],
      [Math.floor(size * 0.8), Math.floor(size * 0.75)],
    ];
    coords.forEach(([x, y], idx) => {
      w.seedDroplet(x, y, 3, arm.single ? 0 : idx % NUM_MOTIFS, 0.85);
    });

    const lateFrom = Math.floor(steps * 0.5);
    let switchesLate = 0;
    let prevDom = -1;
    let d1Sum = 0;
    let dropSum = 0;
    let maxDomLate = 0;
    let lateCount = 0;

    for (let t = 1; t <= steps; t++) {
      w.step();
      if (t % censusEvery === 0 || t === steps) {
        const st = w.motifStats();
        const ds = w.findDroplets(0.20);
        if (t >= lateFrom) {
          if (prevDom >= 0 && st.dominant >= 0 && st.dominant !== prevDom) switchesLate++;
          prevDom = st.dominant;
          d1Sum += st.hillD1;
          dropSum += ds.length;
          if (st.dominantShare > maxDomLate) maxDomLate = st.dominantShare;
          lateCount++;
        }
      }
    }

    const st = w.motifStats();
    const ds = w.findDroplets(0.20);
    const res = w.totalMatter() - w.initTotalMatter;
    const shStr = st.shares.map((s, m) => `m${m}:${(s * 100).toFixed(0)}%`).join(' ');
    const ms = Math.round(performance.now() - t0);
    console.log(
      `${arm.name.padEnd(13)} s${seed} | drop=${String(ds.length).padStart(2)} (late ${(dropSum / lateCount).toFixed(1).padStart(4)}) ` +
        `| D1=${(d1Sum / lateCount).toFixed(2)} sw=${String(switchesLate).padStart(2)} maxM=${(maxDomLate * 100).toFixed(0).padStart(3)}% ` +
        `| lyMass=${String(w.lyseMassCleaved).padStart(7)} res=${res} | ${ms}ms`,
    );
    console.log(`              motifs: ${shStr}`);
  }
}
