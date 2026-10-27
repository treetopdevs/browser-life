// Run with Node 24: node tools/ecosystem/explore.ts > docs/ecosystem-sandbox-exploration.json
import { Ecosystem, RULES } from "../../apps/lab/src/ecosystem/model.ts";
const results = [];
for (const seed of [1101, 1102, 1103]) for (const staged of [true, false]) {
  const s = new Ecosystem(seed, 96, staged); let previousBirths = 0;
  for (let i = 0; i < 3000; i++) { if (i === 2900) previousBirths = s.births; s.step(); }
  const final = s.sample();
  results.push({ seed, staged, final, turnover: (s.births + s.deaths) / (s.cells.length * s.tick),
    flags: { sparse: final.population < s.cells.length * 0.05, monopoly: Math.max(...final.counts) / Math.max(1, final.population) > 0.95, frozen: s.births === previousBirths },
    history: s.history.filter(p => p.tick % 100 === 0), notices: s.notices });
}
console.log(JSON.stringify({ model: RULES, purpose: "Creative diagnostic, not survival evidence", ticks: 3000, results }, null, 2));
