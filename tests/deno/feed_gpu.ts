// Feeding on the real GPU path (GpuSim.feed) against the reference (applyFeed): the same result, the
// same state hash right after and after further steps, and no mutation event lost when a feed lands
// between ledger drains. Feeds and drains, one at the tile edge, with mutation on.
import { M3_FOUNDERS, applyFeed, buildWorld, cloneState, defaultConfig, founderGenome, stateHash, totalsOf } from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { RefSim } from "@bl/sim-ref";

const cfg = defaultConfig({ tileW: 48, tileH: 48, tilesX: 2, kernelRadius: 5, seed: 97, mutRate: 60_000_000, eA: 2, eC: 3 });
const start = buildWorld(cfg, {
  nutrient: 32,
  founders: [0, 1, 2, 5, 3, 4].map((f, k) => ({ x: 12 + 24 * (k % 4), y: 12 + 24 * (k >> 2), radius: 6, genome: founderGenome(M3_FOUNDERS[f]), biomass: 64, energy: 128 })),
});
const ref = new RefSim(cloneState(start));
const gpu = await GpuSim.create(await requestDevice(navigator.gpu, cfg), cloneState(start));
const checks: [string, unknown, unknown][] = [];
const refEvents: string[] = [];
const key = (e: { childHi: number; childLo: number; parentHi: number; parentLo: number }) => `${e.childHi}:${e.childLo}<${e.parentHi}:${e.parentLo}`;
let matter = totalsOf(cfg, start.cells).matter;
const feeds: [number, number, number, number][] = [[24, 24, 6, 16], [46, 3, 9, 40], [70, 20, 4, -12], [24, 24, 12, -4096], [5, 40, 0, 1]];
for (const [k, [x, y, r, amount]] of feeds.entries()) {
  // 37 steps: never a multiple of anything the runner drains on, so events are pending at each feed.
  for (const e of ref.run(37)) refEvents.push(key(e));
  gpu.run(37);
  const want = applyFeed(ref.state, x, y, r, amount);
  const got = await gpu.feed(x, y, r, amount);
  matter += BigInt(want.matter);
  checks.push([`feed ${k} (${amount} at ${x},${y} r${r}): result`, JSON.stringify({ ...got, energy: String(got.energy) }), JSON.stringify({ ...want, energy: String(want.energy) })]);
  checks.push([`feed ${k}: state hash right after`, stateHash(await gpu.readState()), stateHash(ref.state)]);
}
for (const e of ref.run(63)) refEvents.push(key(e));
gpu.run(63);
const final = await gpu.readState();
const ledger = await gpu.drainLedger();
checks.push(
  ["state hash 63 steps after the last feed", stateHash(final), stateHash(ref.state)],
  ["total matter equals the start plus what the feeds report", totalsOf(cfg, final.cells).matter, matter],
  ["mutation events across all feeds, none lost", ledger.events.map(key).sort().join(" "), refEvents.sort().join(" ")],
  ["mutation events happened", refEvents.length > 50, true],
  ["no event dropped", ledger.dropped, 0],
);
// A refused feed throws and leaves the GPU state exactly as it was. Fill the world to just under
// MATTER_MAX with accepted feeds, then ask for one more than fits.
let accepted = 0;
for (;;) {
  const room = BigInt(2 ** 26) - totalsOf(cfg, (await gpu.readState()).cells).matter;
  if (room < 4096n * 1257n) break; // a radius-20 disc holds 1,257 cells
  await gpu.feed(24, 24, 20, 4096);
  accepted++;
}
const before = stateHash(await gpu.readState());
const refusals: string[] = [];
for (const attempt of [() => gpu.feed(24, 24, 20, 4096), () => gpu.feed(24, 24, NaN, 4), () => gpu.feed(24, 24, 3, 0), () => gpu.feed(999, 24, 3, 4)]) {
  try { await attempt(); refusals.push("accepted"); } catch (e) { refusals.push(e instanceof Error ? e.message : String(e)); }
}
checks.push(
  ["feeds were accepted up to the bound", accepted > 0, true],
  ["a feed past MATTER_MAX is refused", /MATTER_MAX/.test(refusals[0]), true],
  ["a non-finite radius, a zero amount and a centre outside the world are refused", /finite/.test(refusals[1]) && /non-zero/.test(refusals[2]) && /outside/.test(refusals[3]), true],
  ["refused feeds change nothing", stateHash(await gpu.readState()), before],
);
// A feed awaited across the sim's destruction must not report success.
const doomed = await GpuSim.create(await requestDevice(navigator.gpu, cfg), cloneState(start));
const pending = doomed.feed(24, 24, 6, 16);
doomed.destroy();
let outcome = "resolved";
try { await pending; } catch (e) { outcome = e instanceof Error ? e.message : String(e); }
checks.push(["a feed across destroy() rejects", outcome, "GpuSim destroyed"]);
// The same once the first readback is through: destroy lands while the nutrient channel is being mapped.
const late = await GpuSim.create(await requestDevice(navigator.gpu, cfg), cloneState(start));
const readStats = late.readStats.bind(late);
late.readStats = async () => {
  const s = await readStats();
  setTimeout(() => late.destroy(), 0);
  return s;
};
let lateOutcome = "resolved";
try { await late.feed(24, 24, 6, 16); } catch (e) { lateOutcome = e instanceof Error ? e.message : String(e); }
checks.push(["a feed destroyed during its nutrient readback rejects", lateOutcome, "GpuSim destroyed"]);

let ok = true;
for (const [name, x, y] of checks) {
  const eq = x === y;
  ok &&= eq;
  console.log(`${eq ? "PASS" : "FAIL"} ${name}${eq ? "" : `: ${String(x).slice(0, 160)} vs ${String(y).slice(0, 160)}`}`);
}
console.log(`${refEvents.length} mutation events; net fed ${matter - totalsOf(cfg, start.cells).matter} quanta before the refusal test`);
Deno.exit(ok ? 0 : 1);
