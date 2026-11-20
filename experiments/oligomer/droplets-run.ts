/**
 * Phase B1.3 Experiment Runner: Secreted Lysin (Bacteriocin) Red Queen Test on Pointer-Free Zwicker Droplets.
 *
 * Compares LYSE vs NO_LYSE vs SINGLE_WALL vs NEUTRAL_LYSE (foreign-motif-gated) across multiple
 * seeds with exact integer matter conservation (res = 0).
 *
 * Usage:
 *   node experiments/oligomer/droplets-run.ts --steps 20000 --seeds 4 --size 48 --init single
 *   node experiments/oligomer/droplets-run.ts --steps 20000 --seeds 1 --size 48 --init single --arm LYSE --trace
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

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n;
  my /= n;
  let num = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx > 0 && vy > 0 ? num / Math.sqrt(vx * vy) : 0;
}

const args = parseArgs(process.argv.slice(2));
const steps = Number(args.steps ?? 20000);
const seeds = Number(args.seeds ?? 4);
const size = Number(args.size ?? 48);
const censusEvery = Number(args.census ?? 500);
const initMode = (args.init ?? 'single') as 'single' | 'mixed';
const onlyArm = args.arm;
const trace = args.trace === 'true';
const kLyse = Number(args.kLyse ?? 0.35);
const mutLyse = Number(args.mutLyse ?? 0.0008);
const mutMotif = Number(args.mutMotif ?? 0.000005);
const lyseUpkeep = Number(args.upkeep ?? 0.012);
const decayL = Number(args.decayL ?? 0.025);
const secreteL = Number(args.secreteL ?? decayL);

const arms = [
  { name: 'LYSE', ov: { kLyse, mutLyse, mutMotif, lyseUpkeep, neutralLyse: false, decayL, secreteL }, single: false },
  { name: 'NO_LYSE', ov: { kLyse: 0.0, mutLyse, mutMotif, lyseUpkeep, neutralLyse: false, decayL, secreteL }, single: false },
  { name: 'SINGLE_WALL', ov: { kLyse, mutLyse, mutMotif: 0.0, lyseUpkeep, neutralLyse: false, decayL, secreteL }, single: true },
  { name: 'NEUTRAL_LYSE', ov: { kLyse, mutLyse, mutMotif, lyseUpkeep, neutralLyse: true, decayL, secreteL }, single: false },
] as const;

console.log(
  `=== Phase B1.3 Secreted-Lysin Droplets | init=${initMode} | size=${size}x${size} | steps=${steps} | seeds=${seeds} | kLyse=${kLyse} upkeep=${lyseUpkeep} decayL=${decayL} mutMotif=${mutMotif} ===`,
);

for (const arm of arms) {
  if (onlyArm && arm.name !== onlyArm) continue;
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
      const m = arm.single || initMode === 'single' ? 0 : idx % NUM_MOTIFS;
      w.seedDroplet(x, y, 3, m, 0.85);
    });

    const lateFrom = Math.floor(steps * 0.4);
    let switchesLate = 0;
    let sweepsLate = 0;
    let prevDom = -1;
    let prevMajorDom = -1;
    let d1Sum = 0;
    let dropSum = 0;
    let maxDomLate = 0;
    let lateCount = 0;

    const motifHist: number[][] = [];
    const lyserHist: number[][] = [];

    for (let t = 1; t <= steps; t++) {
      w.step();
      if (t % censusEvery === 0 || t === steps) {
        const st = w.motifStats();
        const ds = w.findDroplets(0.20);
        // Measure expressed lysin field pressure per motif (comparable across LYSE and NEUTRAL_LYSE)
        const fieldTotals = new Array<number>(NUM_MOTIFS).fill(0);
        let fieldSum = 0;
        for (let i = 0; i < w.nTiles; i++) {
          const base = i * NUM_MOTIFS;
          for (let m = 0; m < NUM_MOTIFS; m++) {
            const v = w.L[base + m];
            fieldTotals[m] += v;
            fieldSum += v;
          }
        }
        const lyShares = fieldTotals.map((v) => (fieldSum > 0 ? v / fieldSum : 0));

        if (trace) {
          const sh = st.shares.map((s, m) => `m${m}:${(s * 100).toFixed(0)}%`).join(' ');
          const ly = st.lyserCounts.map((c, m) => (c > 0 ? `L${m}:${c}` : '')).filter(Boolean).join(' ');
          console.log(
            `  t=${String(t).padStart(5)} drop=${String(ds.length).padStart(2)} D1=${st.hillD1.toFixed(2)} | ${sh} | ${ly}`,
          );
        }

        if (t >= lateFrom) {
          if (prevDom >= 0 && st.dominant >= 0 && st.dominant !== prevDom) switchesLate++;
          prevDom = st.dominant;
          if (st.dominant >= 0 && st.dominantShare >= 0.30) {
            if (prevMajorDom >= 0 && st.dominant !== prevMajorDom) sweepsLate++;
            prevMajorDom = st.dominant;
          }
          d1Sum += st.hillD1;
          dropSum += ds.length;
          if (st.dominantShare > maxDomLate) maxDomLate = st.dominantShare;
          lateCount++;
          motifHist.push(st.shares);
          lyserHist.push(lyShares);
        }
      }
    }

    // Per-motif mean-centered lag-1 correlation between motif share s_m(t) and expressed lysin share L_m(t+1)
    const xs: number[] = [];
    const ys: number[] = [];
    const T = motifHist.length;
    if (T >= 3) {
      for (let m = 0; m < NUM_MOTIFS; m++) {
        let mx = 0;
        let my = 0;
        for (let k = 0; k + 1 < T; k++) {
          mx += motifHist[k][m];
          my += lyserHist[k + 1][m];
        }
        mx /= T - 1;
        my /= T - 1;
        for (let k = 0; k + 1 < T; k++) {
          xs.push(motifHist[k][m] - mx);
          ys.push(lyserHist[k + 1][m] - my);
        }
      }
    }
    const lagCorr = pearson(xs, ys);

    const st = w.motifStats();
    const ds = w.findDroplets(0.20);
    const res = w.totalMatter() - w.initTotalMatter;
    const shStr = st.shares.map((s, m) => `m${m}:${(s * 100).toFixed(0)}%`).join(' ');
    const ms = Math.round(performance.now() - t0);
    console.log(
      `${arm.name.padEnd(13)} s${seed} | drop=${String(ds.length).padStart(2)} (late ${(dropSum / lateCount).toFixed(1).padStart(4)}) ` +
        `| D1=${(d1Sum / lateCount).toFixed(2)} sw=${String(switchesLate).padStart(2)} sw30=${String(sweepsLate).padStart(2)} maxM=${(maxDomLate * 100).toFixed(0).padStart(3)}% ` +
        `| lagR=${lagCorr >= 0 ? '+' : ''}${lagCorr.toFixed(2)} lyMass=${String(w.lyseMassCleaved).padStart(7)} res=${res} | ${ms}ms`,
    );
    console.log(`              motifs: ${shStr}`);
  }
}
