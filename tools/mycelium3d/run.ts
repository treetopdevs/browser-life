// Headless run of the 3D mycelium world (CPU reference, rung R0). Checks the matter and energy ledgers after
// every step (exit 1 on any residual) and prints a census by depth every --every steps: particles, body matter
// and A/C/P per layer, the light reaching each layer, and births and deaths since the last census.
//
//   deno run -A --no-lock tools/mycelium3d/run.ts [--width 32] [--height 32] [--depth 16] [--steps 20000] [--every 2000]
//     [--seed 1] [--sink 1..16] [--light 0..4096] [--light-k 1..65536] [--max 8192] [--founders 1024]
//     [--heredity inherit|frozen|blocked] [--light-pattern uniform|gradient] [--diff-a 0..256]
//     [--trail-discount 0..256 [--discount-mode public|toll]]
//     [--conduit 0..255 [--conduit-cap 1..255]]
//     [--owner id|gid [--owner-defend 1..255] [--owner-conduit 0..255 [--owner-conduit-cap 1..255]]]
//     [--json]
//
// Numeric flags must be plain non-negative integers; a malformed or out-of-range value, an unknown flag, a
// positional argument or a config validateConfig rejects exits 2 with the reason.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { censusByDepth, createWorld, defaultConfig, energyTotal, type Heredity, type LightPattern, liveGenotypes, matterTotal, type Mycelium3dConfig, stateDigest, step, type TrailDiscountMode, type TrailOwnerMode, validateConfig } from "./world.ts";

const NUM: Record<string, keyof Mycelium3dConfig | null> = {
  width: "width", height: "height", depth: "depth", seed: "seed", sink: "sinkShift", light: "light", "light-k": "lightK",
  max: "maxParticles", founders: "founders", "diff-a": "diffA", "trail-discount": "trailMoveDiscount", conduit: "trailConduit",
  "conduit-cap": "trailConduitCap", "owner-defend": "ownerDefend", "owner-conduit": "ownerConduit", "owner-conduit-cap": "ownerConduitCap",
  steps: null, every: null,
};
const STR = ["heredity", "light-pattern", "discount-mode", "owner"];
const fail = (msg: string): never => { console.error(msg); Deno.exit(2); };
const a = parseArgs(Deno.args, { string: [...Object.keys(NUM), ...STR], boolean: ["json"], unknown: (f) => fail(f.startsWith("-") ? `unknown flag ${f}` : `unexpected argument ${f}`) });
if (a._.length) fail(`unexpected argument ${a._[0]}`);
const num = (k: string, dflt: number): number => {
  const v = a[k as keyof typeof a];
  if (v === undefined) return dflt;
  if (typeof v !== "string" || !/^[0-9]+$/.test(v) || !Number.isSafeInteger(Number(v))) return fail(`--${k} must be a non-negative integer, got ${JSON.stringify(v)}`);
  return Number(v);
};
const steps = num("steps", 20000), every = num("every", 2000);
if (steps < 1) fail("--steps must be at least 1");
if (every < 1) fail("--every must be at least 1");
const over: Partial<Mycelium3dConfig> = {};
for (const [flag, key] of Object.entries(NUM)) if (key && a[flag as keyof typeof a] !== undefined) (over as Record<string, unknown>)[key] = num(flag, 0);
if (a.heredity !== undefined) over.heredity = a.heredity as Heredity;
if (a["light-pattern"] !== undefined) over.lightPattern = a["light-pattern"] as LightPattern;
if (a["discount-mode"] !== undefined) over.trailDiscountMode = a["discount-mode"] as TrailDiscountMode;
if (a.owner !== undefined) over.trailOwner = a.owner as TrailOwnerMode;
const config = defaultConfig(over);
const bad = validateConfig(config);
if (bad.length) fail(`invalid config: ${bad.join("; ")}`);

const s = createWorld(config);
let births = 0, deaths = 0;
const t0 = performance.now();
const rows: unknown[] = [];
for (let t = 1; t <= steps; t++) {
  const st = step(s);
  births += st.births; deaths += st.deaths;
  const dm = matterTotal(s) - s.matter0;
  const de = energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat);
  if (dm !== 0 || de !== 0) {
    console.error(`ledger residual at step ${s.step}: matter ${dm}, energy ${de}`);
    Deno.exit(1);
  }
  if (t % every === 0 || t === steps) {
    const layers = censusByDepth(s);
    const row = { step: s.step, particles: s.n, genotypes: liveGenotypes(s), births, deaths, msPerStep: +((performance.now() - t0) / t).toFixed(2), layers };
    rows.push(row);
    if (!a.json) {
      console.log(`step=${row.step} particles=${row.particles} genotypes=${row.genotypes} births=${births} deaths=${deaths} msPerStep=${row.msPerStep}`);
      console.log("   z  particles        M        A        C        P   light/256");
      for (const l of layers) console.log([l.z, l.particles, l.M, l.A, l.C, l.P, l.light].map((v, i) => String(v).padStart(i === 0 ? 4 : i === 6 ? 11 : 9)).join(""));
    }
    births = deaths = 0;
  }
}
const summary = { config: s.config, digest: stateDigest(s), matterResidual: 0, energyResidual: 0, rows };
if (a.json) console.log(JSON.stringify(summary));
else console.log(`digest=${summary.digest} ledger residuals 0 on all ${steps} steps`);
