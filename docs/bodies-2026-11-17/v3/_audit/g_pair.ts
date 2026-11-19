import { BodiesWorld } from '../../../../apps/lab/src/bodies/model.ts';
// pair scenario geometry (x=41 and 55 on row 48), GATE_GROW on, budless, upkeep on. West founder vs east founder.
for (const [label, pos, tags] of [['west=64,east=192', [[41, 48], [55, 48]], [64, 192]], ['west=192,east=64', [[41, 48], [55, 48]], [192, 64]],
  ['north=64,south=192', [[48, 41], [48, 55]], [64, 192]], ['north=192,south=64', [[48, 41], [48, 55]], [192, 64]]] as const) {
  let first = 0, second = 0, firstWins = 0; const N = 30;
  for (let seed = 1; seed <= N; seed++) {
    const w = new BodiesWorld({ seed, founders: 2, positions: pos as any, founderTags: tags as any, genome: [16, 60, 0, 0], upkeep: true, rules: { GATE_GROW: 1 } });
    w.step(1500);
    let a = 0, b = 0; for (let i = 0; i < 9216; i++) if (w.cell[i]) { if (w.kin[i] === tags[0]) a++; else b++; }
    first += a; second += b; if (a > b) firstWins++;
  }
  console.log(`${label}: first-listed(west/north) cells ${first}, second ${second}; first-listed larger in ${firstWins}/${N} seeds`);
}
