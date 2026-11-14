import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadModel, makeWorld, resolveModelKey, NEWEST_MODEL, type ModelModule } from '../src/food-bands/models.ts';
import { SCREENS, screenSeeds, type FoodModeId } from '../src/food-bands/screens.ts';
import { encodeBase64 } from '../src/food-bands/render.ts';
import { checkReplay, describeResult, fetchRecording, recordedAvailable, replayUrl, validateRecording, type ReplayExpectation } from '../src/food-bands/replay-check.ts';

type Obj = Record<string, any>;
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A small recording shaped like the tools' output, produced by the live model itself. */
async function synthetic(mode: FoodModeId, seed: number, ticks: number, options: { runtime?: string } = {}): Promise<{ rec: Obj; expected: ReplayExpectation }> {
  const mod = await loadModel(NEWEST_MODEL);
  const world = makeWorld(mod, seed, mode);
  const rec: Obj = { run: { seed, mode, mutation: true, maxTick: ticks, finalTick: ticks, extinctionTick: null }, rules: mod.RULES, samples: [], tickRows: [], frames: [], snapshots: [] };
  let previous = world.census();
  const capture = (tick: number) => {
    const census = world.census();
    rec.samples.push({ tick, census, environment: world.environment });
    const cells: [number, number][] = [];
    for (const o of world.organisms) for (const c of o.cells) cells.push([c.tile, o.id]);
    cells.sort((a, b) => a[0] - b[0]);
    rec.frames.push({ tick, foodBase64: encodeBase64(world.food), cells, organisms: world.organisms.map(o => ({ id: o.id, family: o.family, genome: o.genome })), ledger: world.ledger });
    if (tick === 0 || tick === ticks) {
      const state = { ...world.snapshot(), runtime: options.runtime ?? 'Node 24.2.0' };
      rec.snapshots.push({ tick, terminal: false, environment: world.environment, state, stateSha256: sha({ state, environment: world.environment }) });
    }
  };
  capture(0);
  for (let tick = 1; tick <= ticks; tick++) {
    world.step(1);
    const census = world.census();
    rec.tickRows.push({ tick, population: census.population, cells: census.cells, births: census.births - previous.births, deaths: census.deaths - previous.deaths,
      blockedCap: census.blockedCapBirths - previous.blockedCapBirths, blockedSpace: census.blockedSpaceBirths - previous.blockedSpaceBirths,
      cap48: census.population === 48, nearCap47: census.population >= 47 });
    previous = census;
    if (tick % 20 === 0) capture(tick);
  }
  return { rec: JSON.parse(JSON.stringify(rec)), expected: { seed, mode, horizon: ticks, mod } };
}

describe('replay check, synthetic recordings (always run)', () => {
  it('identical for a faithful recording, counting what it compared', async () => {
    const { rec, expected } = await synthetic('alternating-band', 1202, 100);
    const result = await checkReplay(rec, expected, { sliceTicks: 30 });
    expect(result).toMatchObject({ status: 'identical', finalTick: 100, compared: { ticks: 100, samples: 6, frames: 6, snapshots: 2 }, intact: true });
    expect(describeResult('x', result)).toMatch(/identical at all 100 recorded ticks/);
  });

  it('a runtime-label-only difference still counts as equal', async () => {
    const { rec, expected } = await synthetic('split-band', 1202, 40, { runtime: 'Node 99.9.9' });
    expect(await checkReplay(rec, expected)).toMatchObject({ status: 'identical', intact: true });
  });

  it.each<[string, (rec: Obj) => void]>([
    ['empty samples', rec => { rec.samples = []; }],
    ['no per-tick rows', rec => { delete rec.tickRows; }],
    ['truncated per-tick rows', rec => { rec.tickRows = rec.tickRows.slice(0, 50); }],
    ['duplicate tick in samples', rec => { rec.samples[2].tick = 20; }],
    ['samples off the 20-tick cadence', rec => { rec.samples[3].tick = 61; }],
    ['wrong seed', rec => { rec.run.seed = 1203; }],
    ['wrong arm', rec => { rec.run.mode = 'uniform'; }],
    ['wrong rules', rec => { rec.rules = { ...rec.rules, maxOrganisms: 47 }; }],
    ['no snapshots', rec => { rec.snapshots = []; }],
    ['duplicate snapshot', rec => { rec.snapshots.push(rec.snapshots[0]); }],
    ['no snapshot at the final tick', rec => { rec.snapshots = rec.snapshots.slice(0, 1); }],
    ['a snapshot that could never be compared (off the sample ticks)', rec => { rec.snapshots.push({ ...rec.snapshots[0], tick: 1 }); }],
    ['recording longer than the screen', rec => { rec.run.maxTick = 500; }],
    ['final tick beyond the recorded horizon', rec => { rec.run.maxTick = 20; }],
  ])('invalid, never identical: %s', async (_name, mutate) => {
    const { rec, expected } = await synthetic('split-band', 1202, 100);
    mutate(rec);
    const result = await checkReplay(rec, expected);
    expect(result.status).toBe('invalid');
    expect(validateRecording(rec, expected)).not.toBeNull();
  });

  it('a non-object file is invalid', async () => {
    const { expected } = await synthetic('uniform', 1202, 20);
    expect((await checkReplay([], expected)).status).toBe('invalid');
    expect((await checkReplay(null, expected)).status).toBe('invalid');
  });

  it('a shorter recording is partial, with the compared ticks stated', async () => {
    const { rec, expected } = await synthetic('uniform', 1202, 60);
    const result = await checkReplay(rec, { ...expected, horizon: 120 });
    expect(result).toMatchObject({ status: 'partial', recordedTicks: 60, horizon: 120, compared: { ticks: 60 } });
    expect(describeResult('x', result)).toMatch(/partial.*60 of 120/);
  });

  it('a final tick beyond the expected horizon is invalid', async () => {
    const { rec, expected } = await synthetic('split-band', 1202, 100);
    expect((await checkReplay(rec, { ...expected, horizon: 60 })).status).toBe('invalid');
  });

  it('a corrupt or missing stateSha256 is reported, in identical and in partial results', async () => {
    const full = await synthetic('uniform', 1202, 60);
    full.rec.snapshots[1].stateSha256 = '0'.repeat(64);
    const r1 = await checkReplay(full.rec, full.expected);
    expect(r1).toMatchObject({ status: 'identical', integrity: 'failed', intact: false });
    expect(describeResult('x', r1)).toMatch(/does not hash/);
    const missing = await synthetic('uniform', 1202, 60);
    delete missing.rec.snapshots[0].stateSha256;
    expect(await checkReplay(missing.rec, missing.expected)).toMatchObject({ integrity: 'failed', intact: false });
    const short = await synthetic('uniform', 1202, 60);
    short.rec.snapshots[1].stateSha256 = 'bad';
    const r2 = await checkReplay(short.rec, { ...short.expected, horizon: 120 });
    expect(r2).toMatchObject({ status: 'partial', integrity: 'failed' });
    expect(describeResult('x', r2)).toMatch(/does not hash/);
  });

  it('without crypto.subtle the digest is unchecked, never reported as intact', async () => {
    const { rec, expected } = await synthetic('uniform', 1202, 40);
    vi.stubGlobal('crypto', {});
    try {
      const result = await checkReplay(rec, expected);
      expect(result).toMatchObject({ status: 'identical', integrity: 'unchecked', intact: false });
      expect(describeResult('x', result)).toMatch(/could not be checked/);
    } finally { vi.unstubAllGlobals(); }
  });

  it('a perturbed environment at a sample tick with no snapshot is found there', async () => {
    const { rec, expected } = await synthetic('moving-band', 1202, 100);
    rec.samples[2].environment.offered += 1;
    expect(await checkReplay(rec, expected)).toMatchObject({ status: 'differs', firstTick: 40, field: 'environment.offered' });
  });

  it('a recorded extinction tick that the live world does not share is a difference', async () => {
    const { rec, expected } = await synthetic('moving-band', 1202, 100);
    rec.run.extinctionTick = 100;
    expect(await checkReplay(rec, expected)).toMatchObject({ status: 'differs', firstTick: 100, field: 'extinctionTick' });
  });

  it('a perturbed census reports the right first tick and field', async () => {
    const { rec, expected } = await synthetic('moving-band', 1202, 100);
    rec.samples[2].census.totalEnergy += 1;
    expect(await checkReplay(rec, expected)).toMatchObject({ status: 'differs', firstTick: 40, field: 'census.totalEnergy' });
  });

  it('a perturbed per-tick row reports its own tick', async () => {
    const { rec, expected } = await synthetic('moving-band', 1202, 100);
    rec.tickRows[32].population += 1;
    expect(await checkReplay(rec, expected)).toMatchObject({ status: 'differs', firstTick: 33, field: 'tickRows.population' });
  });

  it('a perturbed food byte in a recorded frame is found at that frame', async () => {
    const { rec, expected } = await synthetic('foothold-band', 1202, 100);
    const bytes = atob(rec.frames[3].foodBase64).split('');
    bytes[100] = String.fromCharCode((bytes[100]!.charCodeAt(0) + 1) % 256);
    rec.frames[3].foodBase64 = btoa(bytes.join(''));
    expect(await checkReplay(rec, expected)).toMatchObject({ status: 'differs', firstTick: 60, field: 'frame.food' });
  });

  it('a perturbed saved snapshot (other than its runtime label) is found', async () => {
    const { rec, expected } = await synthetic('split-band', 1202, 40);
    rec.snapshots[1].state.food[5] += 1;
    expect(await checkReplay(rec, expected)).toMatchObject({ status: 'differs', firstTick: 40 });
  });

  it('absent or non-JSON files are unavailable, not invalid', async () => {
    expect(await recordedAvailable('/x.json', (async () => new Response('nope', { status: 404 })) as typeof fetch)).toBe(false);
    expect(await recordedAvailable('/x.json', (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch)).toBe(false);
    expect(await recordedAvailable('/x.json', (async () => { throw new Error('offline'); }) as typeof fetch)).toBe(false);
    expect(await fetchRecording('/x.json', (async () => new Response('nope', { status: 404 })) as typeof fetch)).toMatchObject({ ok: false });
  });
});

const prototypes = (name: string) => new URL(`../../../docs/creative-prototypes/${name}`, import.meta.url);

/** The recorded run of every arm of every screen on every seed it has, replayed through the page's own model path. */
describe('replay check, real recordings (skip when restored files are absent)', () => {
  for (const screen of SCREENS) {
    for (const arm of screen.arms) {
      for (const seed of screenSeeds(screen)) for (const file of arm.replays[seed] ?? []) {
        it.skipIf(!existsSync(prototypes(file)))(`${screen.id} / ${arm.id} / seed ${seed}: live equals recorded (${file})`, async () => {
          const mod = await loadModel(resolveModelKey(screen.id));
          const data = JSON.parse(readFileSync(prototypes(file), 'utf8'));
          const result = await checkReplay(data, { seed, mode: arm.mode, horizon: screen.horizon, mod }, { sliceTicks: 500 });
          if (result.status !== 'identical') console.log(file, JSON.stringify(result));
          // the earlier 3,000-tick foothold recording sits beside a 6,000-tick screen: it can only ever be partial
          expect(result.status, file).toBe(screen.id === 'food-schedule-769' && arm.id === 'foothold' ? 'partial' : 'identical');
          if (result.status === 'identical') expect(result.intact).toBe(true);
        }, 600_000);
      }
    }
  }
});

describe('replay check over real HTTP from the dev server', () => {
  let server: ViteDevServer | null = null;
  afterAll(async () => { await server?.close(); });
  const file = 'split-food-seed-1202.json';
  it.skipIf(!existsSync(prototypes(file)))('serves a restored recording, allowlisted only, and the check passes on the fetched bytes', async () => {
    server = await createServer({ root: new URL('../', import.meta.url).pathname, configFile: new URL('../vite.config.ts', import.meta.url).pathname, logLevel: 'silent', server: { port: 0, strictPort: false, host: '127.0.0.1' } });
    await server.listen();
    const address = server.httpServer!.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const url = base + replayUrl(file);
    expect(await recordedAvailable(url)).toBe(true);
    // not in the screens table: refused even though the file exists
    expect((await fetch(`${base}/docs/creative-prototypes/current-pilot.json`)).status).toBe(404);
    expect((await fetch(`${base}/docs/creative-prototypes/..%2fARTIFACTS.md`)).status).not.toBe(200);
    expect((await fetch(url, { method: 'POST' })).status).toBe(404);
    expect(await recordedAvailable(`${base}/docs/creative-prototypes/no-such-file.json`)).toBe(false);
    const fetched = await fetchRecording(url);
    expect(fetched.ok).toBe(true);
    const mod: ModelModule = await loadModel(resolveModelKey('split-food'));
    const result = await checkReplay((fetched as { data: unknown }).data, { seed: 1202, mode: 'split-band', horizon: 3000, mod }, { sliceTicks: 500 });
    expect(result.status).toBe('identical');
  }, 300_000);
});

it('every screen lists at least one recorded file name', () => {
  for (const screen of SCREENS) {
    const files = screen.arms.flatMap(a => screenSeeds(screen).flatMap(s => a.replays[s] ?? []));
    expect(files.length, screen.id).toBeGreaterThan(0);
  }
});
