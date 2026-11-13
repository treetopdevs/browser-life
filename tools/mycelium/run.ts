// Headless Mycelium world run (CPU reference, rung R0). Prints a census line every --every steps and
// checks the matter and energy ledgers after every step; exits non-zero on any residual.
//
//   deno run -A --no-lock tools/mycelium/run.ts --steps 2000 --every 200 [--size 128] [--max 8192] [--founders 1024]
//     [--seed 1] [--heredity inherit|frozen|blocked] [--light uniform|gradient] [--json]
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { FRESH_MIN } from "./r2-protocol.ts";
import { createWorld, defaultConfig, energyTotal, type Heredity, type LightPattern, liveGenotypes, matterTotal, stateDigest, step } from "./world.ts";

const a = parseArgs(Deno.args, { string: ["steps", "every", "size", "max", "founders", "seed", "heredity", "light"], boolean: ["json"] });
// Seeds of 9001 and above are the R2 confirmation's fresh seeds (docs/mycelium-r2-2026-11-13/PROTOCOL.md section 5):
// they run only through r2.ts --phase confirm, so an unlogged look at one cannot happen from here.
if (a.seed !== undefined && !(Number(a.seed) < FRESH_MIN)) {
  console.error(`seed ${a.seed} is refused: seeds of ${FRESH_MIN} and above are reserved for the R2 confirmation (tools/mycelium/r2.ts)`);
  Deno.exit(2);
}
const steps = Number(a.steps ?? 2000), every = Number(a.every ?? 200), size = Number(a.size ?? 128);
const over = {
  width: size, height: size,
  ...(a.max ? { maxParticles: Number(a.max) } : {}),
  ...(a.founders ? { founders: Number(a.founders) } : {}),
  ...(a.seed ? { seed: Number(a.seed) } : {}),
  ...(a.heredity ? { heredity: a.heredity as Heredity } : {}),
  ...(a.light ? { lightPattern: a.light as LightPattern } : {}),
};
const s = createWorld(defaultConfig(over));
let births = 0, deaths = 0, refused = 0, contended = 0, mutations = 0;
const t0 = performance.now();
const rows: unknown[] = [];
for (let t = 1; t <= steps; t++) {
  const st = step(s);
  births += st.births; deaths += st.deaths; refused += st.refused; contended += st.contended; mutations += st.mutations;
  const dm = matterTotal(s) - s.matter0;
  const de = energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat);
  if (dm !== 0 || de !== 0) {
    console.error(`ledger residual at step ${s.step}: matter ${dm}, energy ${de}`);
    Deno.exit(1);
  }
  if (t % every === 0 || t === steps) {
    const row = { step: s.step, particles: s.n, genotypes: liveGenotypes(s), births, deaths, refused, contended, mutations, msPerStep: +((performance.now() - t0) / t).toFixed(2) };
    rows.push(row);
    if (!a.json) console.log(Object.entries(row).map(([k, v]) => `${k}=${v}`).join(" "));
    births = deaths = refused = contended = mutations = 0;
  }
}
const summary = { config: s.config, digest: stateDigest(s), matterResidual: 0, energyResidual: 0, rows };
if (a.json) console.log(JSON.stringify(summary));
else console.log(`digest=${summary.digest} ledger residuals 0 on all ${steps} steps`);
