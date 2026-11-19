import { blank, put, at } from './lib.ts';
// 1. GATE_SHARE chain through a cell that matches both ends (non-transitive): 0 -- 16 -- 32 at tol 16
{
  const w = blank({ GATE_SHARE: 1, FLOW: 1, FORAGE: 0 });
  const a = put(w, 10, 10, { kin: 0, store: 24 }), c = put(w, 11, 10, { kin: 16, store: 0 }), b = put(w, 12, 10, { kin: 32, store: 0 });
  for (let s = 0; s < 30; s++) w.step(1);
  console.log('chain: A(0) C(16) B(32) stores after 30 steps', w.store[a], w.store[c], w.store[b], '(A and B do not match; store crossed the A..B gap?)');
}
// 2. GATE_SHARE diagonal: no 4-edge, expect nothing moves
{
  const w = blank({ GATE_SHARE: 1, FLOW: 1, FORAGE: 0 });
  const a = put(w, 10, 10, { kin: 0, store: 24 }), b = put(w, 11, 11, { kin: 100, store: 0 });
  for (let s = 0; s < 30; s++) w.step(1);
  console.log('diag, different marks', w.store[a], w.store[b]);
}
// 3. GATE_GROW: two clades, one empty tile between them (A at x=10, tile x=11 empty, B at x=12). Food everywhere
{
  const w = blank({ GATE_GROW: 1, FORAGE: 0, FLOW: 0 });
  put(w, 10, 10, { kin: 0, store: 24, d: 0 }); put(w, 12, 10, { kin: 128, store: 24, d: 0 });
  w.food.fill(10); w.initialMatter = w.matterTotal();
  w.step(5);
  console.log('between tile (11,10) live?', w.cell[at(11, 10)], 'blockedGrow', w.blockedGrow);
}
// 4. GATE_GROW diagonal touch: A at (10,10), B at (12,12). Empty (11,11) touches both diagonally.
{
  const w = blank({ GATE_GROW: 1, FORAGE: 0, FLOW: 0 });
  put(w, 10, 10, { kin: 0, store: 24, d: 0 }); put(w, 12, 12, { kin: 128, store: 24, d: 0 });
  w.food.fill(10); w.initialMatter = w.matterTotal();
  const before = w.cell[at(11, 11)];
  w.step(1);
  console.log('diag tile (11,11) live?', before, w.cell[at(11, 11)]);
}
// 5. GATE_GROW same step, two fronts: A grows west->east into (11) while B grows (13): A at 10, B at 14, tiles 11..13 empty
{
  let contact = 0, trials = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const w = blank({ GATE_GROW: 1, FORAGE: 0, FLOW: 0, SUPPLY: 0 }, { seed });
    put(w, 10, 10, { kin: 0, store: 24, d: 0, g1: 255 }); put(w, 15, 10, { kin: 128, store: 24, d: 0, g1: 255 });
    w.food.fill(10); w.initialMatter = w.matterTotal();
    w.step(40);
    // look for adjacent (8-nbr) live cells that mismatch
    let c = 0;
    for (let i = 0; i < 9216; i++) if (w.cell[i]) { const x = i % 96, y = (i - x) / 96; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { if (!dx && !dy) continue; const p = ((y + dy + 96) % 96) * 96 + ((x + dx + 96) % 96); if (w.cell[p] && !w.pairMatches(i, p)) c++; } }
    trials++; if (c) contact++;
  }
  console.log('two fronts, 60 seeds: runs with a mismatched 8-neighbour contact', contact, '/', trials);
}
// 6. GATE_SIGNAL alone: growth can still pick a foreign parent
{
  const w = blank({ GATE_SIGNAL: 1, FORAGE: 0, FLOW: 0 });
  const a = put(w, 10, 10, { kin: 0, store: 24, d: 0 }); const b = put(w, 12, 10, { kin: 128, store: 24, d: 0 });
  w.food.fill(10); w.initialMatter = w.matterTotal();
  w.step(3);
  const t = at(11, 10); console.log('GATE_SIGNAL only: tile between filled?', w.cell[t], 'its kin', w.kin[t]);
}
// 7. GATE_SIGNAL: foreign cell with only foreign neighbours gets d=255 ; cell matched
{
  const w = blank({ GATE_SIGNAL: 1, FORAGE: 0, FLOW: 0 });
  put(w, 10, 10, { kin: 0, d: 0 }); const b = put(w, 11, 10, { kin: 128, d: 2 });
  w.step(1); console.log('foreign neighbour d after relax', w.d[b]);
}
