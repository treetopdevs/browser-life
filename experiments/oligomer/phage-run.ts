/**
 * Phase B1.4 Experiment Runner: Conserved Obligate Phage (Kill-the-Winner) on Pointer-Free Zwicker Droplets.
 *
 * Compares PHAGE vs NO_PHAGE vs SINGLE_WALL vs NEUTRAL_PHAGE across multiple seeds with exact
 * integer matter conservation (sum(A + F + W + P) === initTotalMatter, res = 0).
 *
 * Usage:
 *   node experiments/oligomer/phage-run.ts --steps 16000 --seeds 4 --size 48
 *   node experiments/oligomer/phage-run.ts --steps 16000 --seeds 1 --size 48 --arm PHAGE --trace --census 500
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

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
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
  return vx > 1e-12 && vy > 1e-12 ? num / Math.sqrt(vx * vy) : null;
}

function fmtR(r: number | null): string {
  if (r === null) return '  n/a';
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}`;
}

const args = parseArgs(process.argv.slice(2));
const steps = Number(args.steps ?? 16000);
const seeds = Number(args.seeds ?? 4);
const size = Number(args.size ?? 48);
const censusEvery = Number(args.census ?? 500);
const initMode = (args.init ?? 'mixed') as 'single' | 'mixed';
const onlyArm = args.arm;
const trace = args.trace === 'true';
const kInfect = Number(args.kInfect ?? 0.35);
const phageYield = Number(args.phageYield ?? 0.5);
const diffP = Number(args.diffP ?? 0.30);
const kDecayP = Number(args.kDecayP ?? 0.015);
const mutPhage = Number(args.mutPhage ?? 0.00001);
const mutMotif = Number(args.mutMotif ?? 0.000015);

const arms = [
  { name: 'PHAGE', ov: { kInfect, phageYield, diffP, kDecayP, mutPhage, mutMotif, neutralPhage: false }, single: false },
  { name: 'NO_PHAGE', ov: { kInfect: 0.0, phageYield, diffP, kDecayP, mutPhage: 0.0, mutMotif, neutralPhage: false }, single: false },
  { name: 'SINGLE_WALL', ov: { kInfect, phageYield, diffP, kDecayP, mutPhage, mutMotif: 0.0, neutralPhage: false }, single: true },
  { name: 'NEUTRAL_PHAGE', ov: { kInfect, phageYield, diffP, kDecayP, mutPhage, mutMotif, neutralPhage: true }, single: false },
] as const;

console.log(
  `=== Phase B1.4 Conserved Phage (Kill-the-Winner) | init=${initMode} | size=${size}x${size} | steps=${steps} | seeds=${seeds} | kInfect=${kInfect} kDecayP=${kDecayP} mutPhage=${mutPhage} ===`,
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
    const phageHist: number[][] = [];

    for (let t = 1; t <= steps; t++) {
      w.step();
      if (t % censusEvery === 0 || t === steps) {
        const st = w.motifStats();
        const ds = w.findDroplets(0.20);
        const pt = w.phageTotals();
        const pSum = pt.reduce((a, b) => a + b, 0);
        const pShares = pt.map((v) => (pSum > 0 ? v / pSum : 0));

        if (trace) {
          const sh = st.shares.map((s, m) => `m${m}:${(s * 100).toFixed(0)}%`).join(' ');
          const ph = pt.map((v, m) => (v > 0 ? `P${m}:${v}` : '')).filter(Boolean).join(' ');
          console.log(
            `  t=${String(t).padStart(5)} drop=${String(ds.length).padStart(2)} D1=${st.hillD1.toFixed(2)} | ${sh} | ${ph}`,
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
          phageHist.push(pShares);
        }
      }
    }

    // Per-motif mean-centered lag-1 correlation between host share s_m(t) and expressed phage share P_{(m+shift)%6}(t+1)
    const lagCorrShift = (shift: number): number | null => {
      const xs: number[] = [];
      const ys: number[] = [];
      const T = motifHist.length;
      if (T < 3) return null;
      for (let m = 0; m < NUM_MOTIFS; m++) {
        const pm = (m + shift) % NUM_MOTIFS;
        let mx = 0;
        let my = 0;
        for (let k = 0; k + 1 < T; k++) {
          mx += motifHist[k][m];
          my += phageHist[k + 1][pm];
        }
        mx /= T - 1;
        my /= T - 1;
        for (let k = 0; k + 1 < T; k++) {
          xs.push(motifHist[k][m] - mx);
          ys.push(phageHist[k + 1][pm] - my);
        }
      }
      return pearson(xs, ys);
    };
    const lagCorr = lagCorrShift(0);
    // Temporal/motif-shuffled null: average off-diagonal lag-1 correlation across shifts 1..5
    let nullSum = 0;
    let nullCnt = 0;
    for (let sh = 1; sh < NUM_MOTIFS; sh++) {
      const r = lagCorrShift(sh);
      if (r !== null) { nullSum += r; nullCnt++; }
    }
    const lagNull = nullCnt > 0 ? nullSum / nullCnt : null;

    // Negative frequency-dependent growth correlation: corr(s_m(t), s_m(t+1) - s_m(t)) over present motifs
    const nfX: number[] = [];
    const nfY: number[] = [];
    for (let k = 0; k + 1 < motifHist.length; k++) {
      for (let m = 0; m < NUM_MOTIFS; m++) {
        if (motifHist[k][m] > 0.01) {
          nfX.push(motifHist[k][m]);
          nfY.push(motifHist[k + 1][m] - motifHist[k][m]);
        }
      }
    }
    const nfdsR = pearson(nfX, nfY);

    const st = w.motifStats();
    const ds = w.findDroplets(0.20);
    const res = w.totalMatter() - w.initTotalMatter;
    const shStr = st.shares.map((s, m) => `m${m}:${(s * 100).toFixed(0)}%`).join(' ');
    const ms = Math.round(performance.now() - t0);
    console.log(
      `${arm.name.padEnd(13)} s${seed} | drop=${String(ds.length).padStart(2)} (late ${(dropSum / lateCount).toFixed(1).padStart(4)}) ` +
        `| D1=${(d1Sum / lateCount).toFixed(2)} sw=${String(switchesLate).padStart(2)} sw30=${String(sweepsLate).padStart(2)} maxM=${(maxDomLate * 100).toFixed(0).padStart(3)}% ` +
        `| lagR=${fmtR(lagCorr)} (null ${fmtR(lagNull)}) nfds=${fmtR(nfdsR)} phMass=${String(w.phageMassCleaved).padStart(8)} res=${res} | ${ms}ms`,
    );
    console.log(`              motifs: ${shStr}`);
  }
}
