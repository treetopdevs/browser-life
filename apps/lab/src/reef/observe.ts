/**
 * Pure observers for The Reef.
 * Never mutate world state; running with observers on or off produces bit-identical trajectories.
 */

import { type ReefCell, type ReefWorld } from './model.ts';

export interface MatterReport {
  nut: number;
  det: number;
  cellMass: number;
  cellNut: number;
  total: number;
  initial: number;
  residual: number;
}

export function observeMatter(world: ReefWorld): MatterReport {
  let nut = 0;
  let det = 0;
  for (let i = 0; i < world.nut.length; i++) {
    nut += world.nut[i];
    det += world.det[i];
  }
  let cellMass = 0;
  let cellNut = 0;
  for (let i = 0; i < world.cells.length; i++) {
    const c = world.cells[i];
    cellMass += c.mass;
    cellNut += c.nut;
  }
  const total = nut + det + cellMass + cellNut;
  return {
    nut,
    det,
    cellMass,
    cellNut,
    total,
    initial: world.initialMatter,
    residual: total - world.initialMatter,
  };
}

export interface BodySummary {
  bodyCount: number;
  multicellBodies: number;
  multicellCellShare: number;
  meanBodySize: number;
  maxBodySize: number;
  meanVerticalSpan: number;
  maxVerticalSpan: number;
  /** 90th-percentile height above the seabed (world units). */
  canopyHeight90: number;
  /** Within-body vertical tissue differentiation (top half minus bottom half for pigment; bottom minus top for anchor/digest). */
  diffPigment: number;
  diffAnchor: number;
  diffDigest: number;
  diffBodyCount: number;
}

export function observeBodies(world: ReefWorld): BodySummary {
  const cells = world.cells;
  const n = cells.length;
  if (n === 0) {
    return {
      bodyCount: 0,
      multicellBodies: 0,
      multicellCellShare: 0,
      meanBodySize: 0,
      maxBodySize: 0,
      meanVerticalSpan: 0,
      maxVerticalSpan: 0,
      canopyHeight90: 0,
      diffPigment: 0,
      diffAnchor: 0,
      diffDigest: 0,
      diffBodyCount: 0,
    };
  }

  // Build adjacency list by cell id -> index
  const idToIdx = new Map<number, number>();
  for (let i = 0; i < n; i++) idToIdx.set(cells[i].id, i);

  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < world.bonds.length; i++) {
    const b = world.bonds[i];
    const ia = idToIdx.get(b.a.id);
    const ib = idToIdx.get(b.b.id);
    if (ia !== undefined && ib !== undefined) {
      adj[ia].push(ib);
      adj[ib].push(ia);
    }
  }

  const visited = new Uint8Array(n);
  const queue: number[] = [];
  let bodyCount = 0;
  let multicellBodies = 0;
  let multicellCells = 0;
  let maxBodySize = 0;
  let spanSum = 0;
  let maxSpan = 0;

  let diffPigSum = 0;
  let diffAncSum = 0;
  let diffDigSum = 0;
  let diffBodies = 0;
  const minDiffSpan = world.config.cellRadius * 1.5;

  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;
    visited[start] = 1;
    queue.length = 0;
    queue.push(start);
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const nbrs = adj[u];
      for (let k = 0; k < nbrs.length; k++) {
        const v = nbrs[k];
        if (!visited[v]) {
          visited[v] = 1;
          queue.push(v);
        }
      }
    }

    const sz = queue.length;
    bodyCount++;
    if (sz > maxBodySize) maxBodySize = sz;

    if (sz >= 2) {
      multicellBodies++;
      multicellCells += sz;

      let minY = Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < sz; k++) {
        const y = cells[queue[k]].y;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const span = maxY - minY;
      spanSum += span;
      if (span > maxSpan) maxSpan = span;

      if (span >= minDiffSpan) {
        const midY = (minY + maxY) * 0.5;
        let topPig = 0, topAnc = 0, topDig = 0, topN = 0;
        let botPig = 0, botAnc = 0, botDig = 0, botN = 0;
        for (let k = 0; k < sz; k++) {
          const c = cells[queue[k]];
          if (c.y <= midY) {
            topPig += c.pigment;
            topAnc += c.anchor;
            topDig += c.digest;
            topN++;
          } else {
            botPig += c.pigment;
            botAnc += c.anchor;
            botDig += c.digest;
            botN++;
          }
        }
        if (topN > 0 && botN > 0) {
          diffPigSum += topPig / topN - botPig / botN;
          diffAncSum += botAnc / botN - topAnc / topN;
          diffDigSum += botDig / botN - topDig / topN;
          diffBodies++;
        }
      }
    }
  }

  // 90th-percentile height above seabed
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) heights[i] = world.height - cells[i].y;
  heights.sort();
  const canopyHeight90 = heights[Math.min(n - 1, Math.floor(n * 0.9))];

  return {
    bodyCount,
    multicellBodies,
    multicellCellShare: multicellCells / n,
    meanBodySize: n / bodyCount,
    maxBodySize,
    meanVerticalSpan: multicellBodies > 0 ? spanSum / multicellBodies : 0,
    maxVerticalSpan: maxSpan,
    canopyHeight90,
    diffPigment: diffBodies > 0 ? diffPigSum / diffBodies : 0,
    diffAnchor: diffBodies > 0 ? diffAncSum / diffBodies : 0,
    diffDigest: diffBodies > 0 ? diffDigSum / diffBodies : 0,
    diffBodyCount: diffBodies,
  };
}

export interface NicheReport {
  cells: number;
  bonds: number;
  meanPigment: number;
  meanArmor: number;
  meanDigest: number;
  meanAnchor: number;
  meanContract: number;
  meanBondKeep: number;
  stdPigment: number;
  stdArmor: number;
  stdDigest: number;
  /** Cross-cell Pearson correlations (negative = distinct functional guilds, not one generalist). */
  corrPigDig: number;
  corrArmCon: number;
  meanSpeed: number;
  /** Inferred strictly from actual earned energy (photoEarned vs detEarned vs grazeEarned). */
  phototrophShare: number;
  detritivoreShare: number;
  grazerShare: number;
  mixotrophShare: number;
  /** Fraction of cells touching seabed vs upper half of water column. */
  benthicShare: number;
  canopyShare: number;
  /** Founder clade Hill diversity D1 = exp(H). */
  founderD1: number;
  totalMassGrazed: number;
}

export function observeNiches(world: ReefWorld): NicheReport {
  const cells = world.cells;
  const n = cells.length;
  if (n === 0) {
    return {
      cells: 0,
      bonds: 0,
      meanPigment: 0,
      meanArmor: 0,
      meanDigest: 0,
      meanAnchor: 0,
      meanContract: 0,
      meanBondKeep: 0,
      stdPigment: 0,
      stdArmor: 0,
      stdDigest: 0,
      corrPigDig: 0,
      corrArmCon: 0,
      meanSpeed: 0,
      phototrophShare: 0,
      detritivoreShare: 0,
      grazerShare: 0,
      mixotrophShare: 0,
      benthicShare: 0,
      canopyShare: 0,
      founderD1: 0,
      totalMassGrazed: world.totalMassGrazed,
    };
  }

  let sPig = 0, sArm = 0, sDig = 0, sAnc = 0, sCon = 0, sBond = 0, sSpd = 0;
  let photoN = 0, detN = 0, grazeN = 0, mixoN = 0;
  let benthicN = 0, canopyN = 0;
  const floorThresh = world.height - world.config.cellRadius - 4.0;
  const canopyThresh = world.height * 0.55;
  const founderCounts = new Map<number, number>();

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    sPig += c.pigment;
    sArm += c.armor;
    sDig += c.digest;
    sAnc += c.anchor;
    sCon += c.contract;
    sBond += c.bondKeep;
    sSpd += Math.hypot(c.vx, c.vy);

    const totalE = c.photoEarned + c.detEarned + c.grazeEarned;
    if (totalE > 1e-6) {
      const pFrac = c.photoEarned / totalE;
      const dFrac = c.detEarned / totalE;
      const gFrac = c.grazeEarned / totalE;
      if (gFrac >= 0.4) grazeN++;
      else if (pFrac >= 0.75) photoN++;
      else if (dFrac >= 0.75) detN++;
      else mixoN++;
    }

    if (c.y >= floorThresh) benthicN++;
    if (c.y <= canopyThresh) canopyN++;
    founderCounts.set(c.founderId, (founderCounts.get(c.founderId) ?? 0) + 1);
  }

  const mPig = sPig / n;
  const mArm = sArm / n;
  const mDig = sDig / n;
  const mCon = sCon / n;
  let vPig = 0, vArm = 0, vDig = 0, vCon = 0;
  let covPigDig = 0, covArmCon = 0;
  for (let i = 0; i < n; i++) {
    const dp = cells[i].pigment - mPig;
    const da = cells[i].armor - mArm;
    const dd = cells[i].digest - mDig;
    const dc = cells[i].contract - mCon;
    vPig += dp * dp;
    vArm += da * da;
    vDig += dd * dd;
    vCon += dc * dc;
    covPigDig += dp * dd;
    covArmCon += da * dc;
  }
  const corrPigDig = vPig > 1e-9 && vDig > 1e-9 ? covPigDig / Math.sqrt(vPig * vDig) : 0;
  const corrArmCon = vArm > 1e-9 && vCon > 1e-9 ? covArmCon / Math.sqrt(vArm * vCon) : 0;

  let H = 0;
  for (const cnt of founderCounts.values()) {
    const p = cnt / n;
    H -= p * Math.log(p);
  }

  return {
    cells: n,
    bonds: world.bonds.length,
    meanPigment: mPig,
    meanArmor: mArm,
    meanDigest: mDig,
    meanAnchor: sAnc / n,
    meanContract: sCon / n,
    meanBondKeep: sBond / n,
    stdPigment: Math.sqrt(vPig / n),
    stdArmor: Math.sqrt(vArm / n),
    stdDigest: Math.sqrt(vDig / n),
    corrPigDig,
    corrArmCon,
    meanSpeed: sSpd / n,
    phototrophShare: photoN / n,
    detritivoreShare: detN / n,
    grazerShare: grazeN / n,
    mixotrophShare: mixoN / n,
    benthicShare: benthicN / n,
    canopyShare: canopyN / n,
    founderD1: Math.exp(H),
    totalMassGrazed: world.totalMassGrazed,
  };
}

/** Bit-deterministic FNV-1a 32-bit digest of world state. */
export function observeDigest(world: ReefWorld): string {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
  };

  mix(world.stepCount);
  mix(world.cells.length);
  mix(world.bonds.length);
  for (let i = 0; i < world.nut.length; i++) {
    mix(world.nut[i]);
    mix(world.det[i]);
  }
  for (let i = 0; i < world.cells.length; i++) {
    const c: ReefCell = world.cells[i];
    mix(c.id);
    mix(c.mass);
    mix(c.nut);
    mix(Math.round(c.x * 1024));
    mix(Math.round(c.y * 1024));
    mix(Math.round(c.energy * 1024));
    mix(c.bondCount);
    for (let w = 0; w < c.genome.length; w += 8) mix(c.genome[w]);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
