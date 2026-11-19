import { BodiesWorld, hash32, validateWorld, hashState, census, basinLabels } from '../../../../apps/lab/src/bodies/model.ts';
import { PatchTracker, observe } from '../../../../apps/lab/src/bodies/observe.ts';
let rej = 0, bad = 0, runs = 0, maxStore = 0, nRaid = 0, nSeam = 0, nBlk = 0, nBlkBud = 0, nTagMut = 0, nDeath = 0, nBoth = 0;
const rnd = (s: number, k: number, n: number) => hash32(s, k, 99, 5) % n;
for (let c = 0; c < 80; c++) {
  const R = (k: number, n: number) => rnd(c, k, n);
  const CAP = [24, 24, 1, 2, 5, 255][R(1, 6)];
  const rules: any = {
    CAP, SHARE: Math.min(4, Math.max(1, CAP - 1)), BUDSHARE: Math.min(8, CAP), FOUNDER_STORE: Math.min(16, CAP), RCOST: Math.min(6, CAP),
    UPK: [1, 2, 3, 8][R(2, 4)], GATE_SHARE: R(3, 2), GATE_GROW: R(4, 2), GATE_SIGNAL: R(5, 2), TAG_TOL_GENE: R(6, 2), TAG_MUT_BUD: R(7, 2),
    TAG_TOL: [0, 4, 16, 64, 127, 128, 255][R(8, 7)], TAG_STEP: [0, 1, 8, 64, 128][R(9, 5)],
    SEAM_COST: R(10, 3) === 0 ? 0 : R(11, Math.max(1, CAP)), RAID: R(12, 3) === 0 ? 0 : 1 + R(13, CAP), SUPPLY: [0, 24, 100, 256][R(14, 4)],
  };
  rules.SEAM_COST = Math.min(rules.SEAM_COST, CAP - 1); rules.RAID = Math.min(rules.RAID, CAP);
  if (rules.CAP < 6) { rules.BUDMIN = 14; }
  let w: BodiesWorld;
  try { w = new BodiesWorld({ seed: c + 1, founders: 0, positions: [], upkeep: R(15, 5) !== 0, mutRate: R(16, 2) ? 30 : 0, tagMutRate: [0, 3000, 65536][R(17, 3)], tagBlind: R(18, 6) === 0, blind: R(19, 5) === 0, rules }); }
  catch (e) { rej++; continue; }
  // random 40x40 patch of cells with random stores incl. 0 and CAP, random marks, random tolerances, random d
  for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) {
    const h = hash32(c, x, y, 31); if (h % 3 === 0) continue;
    const i = y * 96 + x; w.cell[i] = 1; w.store[i] = [0, CAP, h % (CAP + 1)][(h >>> 8) % 3]; w.d[i] = (h >>> 12) % 5 === 0 ? 0 : 20 + (h >>> 16) % 30;
    w.kin[i] = [0, 255, 128, h >>> 24][(h >>> 4) % 4]; w.kinTol[i] = [0, 3, 16, 255][(h >>> 6) % 4];
    w.g0[i] = 6 + (h >>> 20) % 55; w.g1[i] = 8 + (h >>> 3) % 248; w.g2[i] = (h >>> 9) % 40; w.g3[i] = (h >>> 11) % 100;
  }
  for (let i = 0; i < 9216; i++) w.food[i] = hash32(c, i, 3, 3) % (rules.FMAX ?? 65);
  w.initialMatter = w.matterTotal();
  try { w.step(300); } catch (e) { bad++; console.log('THROW', JSON.stringify(rules), (e as Error).message); continue; }
  runs++; if (w.raided > 0) nRaid++; if (w.seamBurned > 0) nSeam++; if (w.blockedGrow > 0) nBlk++; if (w.blockedBud > 0) nBlkBud++; if (w.tagMutations > 0) nTagMut++; if (w.raided > 0 && w.seamBurned > 0 && w.blockedGrow > 0) nBoth++;
  let ms = 0; for (let i = 0; i < 9216; i++) if (w.store[i] > ms) ms = w.store[i]; maxStore = Math.max(maxStore, ms);
  const errs = validateWorld(w);
  // genes can leave range because I wrote random genes 6..60 etc; ignore gene errors from my own init
  const real = errs.filter((e) => !e.startsWith('gene'));
  if (real.length || w.residual() !== 0) { bad++; console.log('BAD', JSON.stringify(rules), real, w.residual()); }
  // observer non-interference: observers every 25 steps must not alter physics
  const w2 = new BodiesWorld({ seed: c + 1, founders: 0, positions: [], upkeep: w.upkeep, mutRate: w.mutRate, tagMutRate: w.tagMutRate, tagBlind: w.tagBlind, blind: w.blind, rules });
  w2.cell.set(new Uint8Array(9216)); // recreate initial state identically
  for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) { const h = hash32(c, x, y, 31); if (h % 3 === 0) continue; const i = y * 96 + x; w2.cell[i] = 1; w2.store[i] = [0, CAP, h % (CAP + 1)][(h >>> 8) % 3]; w2.d[i] = (h >>> 12) % 5 === 0 ? 0 : 20 + (h >>> 16) % 30; w2.kin[i] = [0, 255, 128, h >>> 24][(h >>> 4) % 4]; w2.kinTol[i] = [0, 3, 16, 255][(h >>> 6) % 4]; w2.g0[i] = 6 + (h >>> 20) % 55; w2.g1[i] = 8 + (h >>> 3) % 248; w2.g2[i] = (h >>> 9) % 40; w2.g3[i] = (h >>> 11) % 100; }
  for (let i = 0; i < 9216; i++) w2.food[i] = hash32(c, i, 3, 3) % (rules.FMAX ?? 65);
  w2.initialMatter = w2.matterTotal();
  const tr = new PatchTracker(5);
  for (let k = 0; k < 12; k++) { w2.step(25); observe(w2, tr, 170); }
  if (hashState(w2) !== hashState(w) || w2.tagMutations !== w.tagMutations || w2.raided !== w.raided) { bad++; console.log('OBSERVER CHANGED PHYSICS', JSON.stringify(rules)); }
}
console.log('ctor rejected (CAP=1 cases, SHARE<CAP)', rej, '| runs', runs, 'bad', bad, 'max store seen', maxStore, '| runs with raided>0:', nRaid, 'seamBurned>0:', nSeam, 'blockedGrow>0:', nBlk, 'blockedBud>0:', nBlkBud, 'tagMutations>0:', nTagMut, 'all three:', nBoth);
