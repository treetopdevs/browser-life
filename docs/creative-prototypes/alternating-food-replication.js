const PLAN_SHA256 = "2070ef956ca73855e9b032a7cbaa5e53e594dddaa9ed82f84f72c49256f5c743";
const BASELINE_RAW_SHA256 = "3f99cf98531a9908a1a2ab9adb7ce2dd6566d2edd08afb4855d99267fbee033b";
const BASELINE_DATA_SHA256 = "1379b36370340873e531443ab8f9176a19a69d88b942d20e4d982ed81a81a349";
const BASELINE_INDEX_SHA256 = "e3e3aa26ace9722ca15175d208ba0d5e2aaa09608e03af072695066c14089afc";
const BASELINE_NAME = "split-food-seed-1202.json";
const BASELINE_SOURCE_PATH = `docs/creative-prototypes/${BASELINE_NAME}`;
const BASELINE_INDEX_NAME = "split-food-index-1202.json";
const INDEX_NAME = "alternating-food-replication-index-1202.json";
const WORLD = 96, CELLS = WORLD * WORLD, BASE = new URL("./", import.meta.url);
const BANDS = [[0, 23], [48, 71]], BAND_TICKS = [1500, 2000, 2500, 3000];
const PINNED_SOURCES = {
  "docs/creative-prototypes/alternating-food-replication-plan.md": PLAN_SHA256,
  "apps/lab/src/split-food/model.ts": "c6b5c37f20f8daa73858fd9e437d0b25d029c712c065ab11ef495c281b58b506",
  "apps/lab/src/alternating-food/model.ts": "5dc6ce46ee36d2d008f802e81e0f7aae80d7bfeaa58984512d13cad714729b31",
  "tools/split-food/explore.ts": "aa2d3aeca0cd7a1a58e405c681cc6e61b5b15da2b0b85262a12c4f6fa95009bd",
  [BASELINE_SOURCE_PATH]: BASELINE_RAW_SHA256,
  "docs/creative-prototypes/split-food-index-1202.json": BASELINE_INDEX_SHA256,
  "docs/creative-prototypes/split-food-validation.md": "56a5a32d86286a425f1f0f0f83cd8b0b76cf4aaae351d0be52afdf14665ce7c5",
  "tools/alternating-food-replication/launch.sh": "4aababa0eff4be913debbecd9179ee769af165cdf69050051c25220734227429",
};
const EXPECTED_SOURCE_KEYS = [...Object.keys(PINNED_SOURCES), "tools/alternating-food-replication/explore.ts"].sort();
const RUNNER_SHA256 = "f616b0b1fa6ab1194e224ad7040f972c7b55ad65b6a5a2425e16b81a2ce7c162";
const STATIC_DELTAS = [[35, -179], [-201, 95], [-10, 28]];
const bodyOnly = new URL(location.href).searchParams.get("bodies") === "1";
const byId = (id) => document.getElementById(id);
const statusNode = byId("source-status"), replayNode = byId("replay");
const canvas = { baseline: byId("baseline-world"), alternating: byId("alternating-world") };
const ctx = { baseline: canvas.baseline.getContext("2d"), alternating: canvas.alternating.getContext("2d") };
let pair = null, ages = [], indexAt = 0, timer = 0, playing = false;
const fmt = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—";
const sha = async (bytes) => {
  if (!crypto?.subtle) throw new Error("This browser cannot verify SHA-256, so the replay was not displayed.");
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
};
const shaText = (text) => sha(new TextEncoder().encode(text));
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const exact = (v, keys) => v !== null && typeof v === "object" && !Array.isArray(v) &&
  JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...keys].sort());
function fail(message) { throw new Error(message); }
function setStatus(message, kind = "") { statusNode.textContent = message; statusNode.dataset.kind = kind; }
function bandCounts(frame) {
  const out = [0, 0];
  for (const [tile] of frame.cells) { const col = tile % WORLD; if (col <= 23) out[0]++; else if (col >= 48 && col <= 71) out[1]++; }
  return out;
}
function b64Food(text, tick) {
  if (typeof text !== "string") fail(`Frame ${tick} is missing recorded food.`);
  let raw; try { raw = atob(text); } catch { fail(`Frame ${tick} food is malformed.`); }
  if (raw.length !== CELLS) fail(`Frame ${tick} food does not cover the 96 × 96 world.`);
  const out = new Uint8Array(CELLS); let total = 0;
  for (let i = 0; i < raw.length; i++) { const n = raw.charCodeAt(i); if (n > 40) fail(`Frame ${tick} food exceeds the tile cap.`); out[i] = n; total += n; }
  return { values: out, total };
}
function validateEnvironment(env, mode, tick) {
  const baseKeys = ["version", "mode", "pulseBudget", "targetCount", "pulses", "offered", "accepted", "overflow", "initialFoodPerTile"];
  const keys = mode === "alternating-band"
    ? [...baseKeys, "bandColumns", "bandWidth", "activeBand", "bandOffered", "bandAccepted", "bandOverflow"]
    : [...baseKeys, "bandColumns", "bandWidth"];
  if (!exact(env, keys)) fail(`${mode} environment at ${tick} has unexpected fields.`);
  if (env.version !== 1 || env.mode !== mode || env.pulseBudget !== 768 || env.targetCount !== 4608 && mode === "split-band" ||
      env.targetCount !== 2304 && mode === "alternating-band" || env.pulses !== Math.floor(tick / 5) ||
      env.offered !== env.pulses * 768 || env.offered !== env.accepted + env.overflow || env.initialFoodPerTile !== 20 ||
      JSON.stringify(env.bandColumns) !== JSON.stringify(BANDS) || env.bandWidth !== 24) fail(`${mode} food ledger or geometry at ${tick} is inconsistent.`);
  if (mode === "alternating-band") {
    const active = env.pulses === 0 ? 0 : Math.floor((env.pulses - 1) / 100) % 2;
    for (const key of ["bandOffered", "bandAccepted", "bandOverflow"]) {
      if (!Array.isArray(env[key]) || env[key].length !== 2 || env[key].some((n) => !Number.isSafeInteger(n) || n < 0)) fail(`Alternating ${key} at ${tick} is malformed.`);
    }
    const scheduled = [0, 0];
    for (let p = 0; p < env.pulses; p++) scheduled[Math.floor(p / 100) % 2]++;
    if (env.activeBand !== active || env.bandOffered[0] !== scheduled[0] * 768 || env.bandOffered[1] !== scheduled[1] * 768 ||
        env.bandOffered[active] !== env.bandAccepted[active] + env.bandOverflow[active] ||
        env.bandOffered[1 - active] !== env.bandAccepted[1 - active] + env.bandOverflow[1 - active] ||
        env.bandOffered[0] + env.bandOffered[1] !== env.offered || env.bandAccepted[0] + env.bandAccepted[1] !== env.accepted ||
        env.bandOverflow[0] + env.bandOverflow[1] !== env.overflow || env.bandOffered[active] - env.bandOffered[1 - active] !== (active === 0 ? 768 : 0) && tick === 5) {
      fail(`Alternating per-band food accounting at ${tick} is inconsistent.`);
    }
  }
}
function validateCensus(census, frame, organisms) {
  const fields = ["tick", "population", "cells", "familyCounts", "births", "growths", "deaths", "effectiveMutations", "attemptedMutations", "maxGeneration", "totalCells", "totalEnergy", "meanBodyCells", "meanEnergy", "blockedBirths", "blockedSpaceBirths", "blockedCapBirths", "ledgerResidual", "genomeVariantCount"];
  if (!exact(census, fields) || census.tick !== frame.tick || !Number.isSafeInteger(census.population) || census.population < 0 || census.population > 48 ||
      !Number.isSafeInteger(census.cells) || census.cells < 0 || census.cells > 1536 || census.population !== organisms.size ||
      !Array.isArray(census.familyCounts) || census.familyCounts.length !== 3 || census.familyCounts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
      census.familyCounts.reduce((a, b) => a + b, 0) !== census.population || census.cells !== frame.cells.length || census.totalCells !== census.cells ||
      census.blockedBirths !== census.blockedSpaceBirths + census.blockedCapBirths || census.effectiveMutations > census.attemptedMutations ||
      census.effectiveMutations > census.births || census.genomeVariantCount > census.population || census.ledgerResidual !== 0) fail(`Frame ${frame.tick} disagrees with census counts.`);
  const families = [0, 0, 0]; for (const org of organisms.values()) families[org.family]++;
  if (JSON.stringify(families) !== JSON.stringify(census.familyCounts)) fail(`Frame ${frame.tick} family counts are inconsistent.`);
}
function censusFromSnapshot(state) {
  const families = [0, 0, 0], variants = new Set(); let cells = 0, totalEnergy = 0, maxGeneration = 0;
  for (const org of state.organisms) { families[org.family]++; cells += org.cells.length; totalEnergy += org.store + state.rules.structurePerCell * org.cells.length; maxGeneration = Math.max(maxGeneration, org.generation); variants.add(JSON.stringify([org.genome.turnEvery, org.genome.turn, org.genome.branchEvery, org.genome.maxCells])); }
  const counters = state.counters;
  return { tick: state.tick, population: state.organisms.length, cells, familyCounts: families, births: counters.births, growths: counters.growths,
    deaths: counters.deaths, effectiveMutations: counters.effectiveMutations, attemptedMutations: counters.attemptedMutations, maxGeneration,
    totalCells: cells, totalEnergy, meanBodyCells: state.organisms.length ? cells / state.organisms.length : 0,
    meanEnergy: state.organisms.length ? totalEnergy / state.organisms.length : 0,
    blockedBirths: counters.blockedSpaceBirths + counters.blockedCapBirths, blockedSpaceBirths: counters.blockedSpaceBirths,
    blockedCapBirths: counters.blockedCapBirths, ledgerResidual: state.ledger.residual, genomeVariantCount: variants.size };
}
function validateSnapshotFrame(state, entry, sample, finalLineage, label) {
  const stateKeys = ["schemaVersion", "description", "runtime", "rules", "seed", "mutation", "tick", "extinctionTick", "food", "occupancy", "organisms", "ledger", "counters", "history", "droppedHistory", "lineage", "droppedLineage"];
  if (!exact(state, stateKeys) || state.schemaVersion !== 1 || state.description !== "observation only; not a resume checkpoint" ||
      state.runtime !== "Node 24.2.0" || state.seed !== 1202 || state.mutation !== true || state.tick !== entry.frame.tick ||
      JSON.stringify(state.rules) !== JSON.stringify(entry.arm.data.rules) || !Array.isArray(state.food) || state.food.length !== CELLS ||
      state.food.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 40) || !Array.isArray(state.occupancy) || state.occupancy.length !== CELLS ||
      !Array.isArray(state.organisms) || state.organisms.length > 48 || !Array.isArray(state.history) || state.history.length > 451 ||
      !Array.isArray(state.lineage) || state.lineage.length > 10000 || !exact(state.counters, ["births", "growths", "deaths", "effectiveMutations", "attemptedMutations", "blockedSpaceBirths", "blockedCapBirths"]) ||
      Object.values(state.counters).some((n) => !Number.isSafeInteger(n) || n < 0) || !exact(state.ledger, ["initialEnergy", "supplied", "dissipated", "deathLoss", "expected", "actual", "residual"]) ||
      Object.values(state.ledger).some((n) => !Number.isSafeInteger(n)) || !state.history.length || state.history.at(-1).tick !== state.tick ||
      state.droppedHistory !== 0 || state.droppedLineage !== 0 || state.extinctionTick !== (entry.arm.data.run.extinctionTick !== null && state.tick === entry.arm.data.run.finalTick ? state.tick : null)) fail(`${label} snapshot structure or bounds are invalid.`);
  const projectedLineage = finalLineage.filter((node) => node.birthTick <= state.tick).map((node) => {
    const dead = node.deathTick !== null && node.deathTick <= state.tick;
    return { ...node, deathTick: dead ? node.deathTick : null, deathCause: dead ? node.deathCause : null, parentRecordDropped: false };
  }).sort((a, b) => a.id - b.id);
  if (JSON.stringify(state.lineage) !== JSON.stringify(projectedLineage)) fail(`${label} snapshot lineage is not the complete projection of its final lineage.`);
  const lineageById = new Map(state.lineage.map((node) => [node.id, node]));
  const occupied = new Array(CELLS).fill(0), cells = [], organisms = [];
  for (const org of state.organisms) {
    if (!exact(org, ["id", "parentID", "family", "generation", "age", "store", "genome", "births", "cells", "growthQueue", "growthCursor"]) ||
        !Number.isSafeInteger(org.id) || !Number.isInteger(org.family) || org.family < 0 || org.family > 2 || !Number.isSafeInteger(org.generation) || org.generation < 0 ||
        !Number.isSafeInteger(org.age) || org.age < 0 || org.age >= 600 || !Number.isSafeInteger(org.store) || org.store < 0 || org.store > state.rules.storeCap ||
        !exact(org.genome, ["turnEvery", "turn", "branchEvery", "maxCells"]) || !Array.isArray(org.cells) || !Array.isArray(org.growthQueue) ||
        !Number.isSafeInteger(org.growthCursor) || org.growthCursor < 0 || org.growthCursor > org.growthQueue.length) fail(`${label} snapshot organism structure is invalid.`);
    const node = lineageById.get(org.id);
    if (!node || node.deathTick !== null || node.family !== org.family || node.generation !== org.generation || node.parentID !== org.parentID ||
        JSON.stringify(node.genome) !== JSON.stringify(org.genome)) fail(`${label} snapshot organism is not bound to its living lineage node.`);
    organisms.push({ id: org.id, family: org.family, genome: org.genome });
    for (const cell of org.cells) { if (!exact(cell, ["tile", "heading", "depth"]) || !Number.isSafeInteger(cell.tile) || cell.tile < 0 || cell.tile >= CELLS ||
      !Number.isInteger(cell.heading) || cell.heading < 0 || cell.heading > 3 || !Number.isSafeInteger(cell.depth) || cell.depth < 0 || occupied[cell.tile] !== 0) fail(`${label} snapshot body tiles overlap or exceed bounds.`); occupied[cell.tile] = org.id; cells.push([cell.tile, org.id]); }
  }
  cells.sort((a, b) => a[0] - b[0]);
  if (JSON.stringify(occupied) !== JSON.stringify(state.occupancy) || JSON.stringify(cells) !== JSON.stringify(entry.frame.cells) ||
      JSON.stringify(organisms) !== JSON.stringify(entry.frame.organisms) || JSON.stringify(state.food) !== JSON.stringify(Array.from(entry.food.values)) ||
      JSON.stringify(state.ledger) !== JSON.stringify(entry.frame.ledger) || JSON.stringify(censusFromSnapshot(state)) !== JSON.stringify(sample.census)) fail(`${label} snapshot bodies, food, ledger, or census disagree with its recorded frame.`);
  for (const row of state.history) {
    const retained = entry.arm.data.samples.find((x) => x.tick === row.tick);
    if (!retained || JSON.stringify(row) !== JSON.stringify(retained.census)) fail(`${label} snapshot history differs from its saved samples.`);
  }
}
function bodyIsConnected(tiles) {
  if (tiles.length <= 1) return true;
  const set = new Set(tiles); if (set.size !== tiles.length) return false;
  const reached = new Set([tiles[0]]), queue = [tiles[0]];
  while (queue.length) {
    const tile = queue.pop(), x = tile % WORLD, y = Math.floor(tile / WORLD);
    const neighbors = [(x + 1) % WORLD + y * WORLD, (x + WORLD - 1) % WORLD + y * WORLD,
      x + ((y + 1) % WORLD) * WORLD, x + ((y + WORLD - 1) % WORLD) * WORLD];
    for (const next of neighbors) if (set.has(next) && !reached.has(next)) { reached.add(next); queue.push(next); }
  }
  return reached.size === set.size;
}
async function loadArm(entry, role, index) {
  const mode = role === "baseline" ? "split-band" : "alternating-band";
  const kind = role === "baseline" ? "hungry-shapes-split-food-arm" : "hungry-shapes-alternating-food-replication-arm";
  if (!exact(entry, ["kind", "mode", "url", "rawSha256", "dataSha256"]) || entry.kind !== kind || entry.mode !== mode ||
      typeof entry.url !== "string" || entry.url.includes("..") || !digest(entry.rawSha256) || !digest(entry.dataSha256)) fail(`${role} pair entry is malformed.`);
  const url = new URL(entry.url, index.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(BASE.pathname)) fail(`${role} evidence must be a local listed file.`);
  const response = await fetch(url); if (!response.ok) fail(`${role} record returned ${response.status}.`);
  const raw = await response.arrayBuffer();
  if (raw.byteLength > 24 * 1024 * 1024 || await sha(raw) !== entry.rawSha256) fail(`${role} raw-file digest does not match the pair index.`);
  let data; try { data = JSON.parse(new TextDecoder().decode(raw)); } catch { fail(`${role} record is not valid JSON.`); }
  if (data.dataSha256 !== entry.dataSha256 || await shaText(JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => k !== "dataSha256")))) !== data.dataSha256) fail(`${role} internal data digest does not match its contents.`);
  const top = ["schemaVersion", "kind", "run", "runtime", "rules", "provenance", "samples", "tickRows", "frames", "snapshots", "windows", "final", "repeat", "numericalGate", "spatialGate", "dataSha256"];
  if (role === "alternating") top.push("seasonalGate", "staticBaselineSeasonalReference");
  if (!exact(data, top) || data.schemaVersion !== 1 || data.kind !== kind || !exact(data.run, ["seed", "mode", "mutation", "maxTick", "finalTick", "extinctionTick"]) ||
      data.run.seed !== 1202 || data.run.mode !== mode || data.run.mutation !== true || data.run.maxTick !== 3000 ||
      !Number.isSafeInteger(data.run.finalTick) || data.run.finalTick < 0 || data.run.finalTick > 3000 ||
      !(data.run.extinctionTick === null || data.run.extinctionTick === data.run.finalTick && data.run.extinctionTick > 0) ||
      data.run.extinctionTick === null && data.run.finalTick !== 3000) fail(`${role} artifact identity or run bounds are invalid.`);
  if (data.runtime?.node !== "24.2.0" || data.runtime?.platform !== "darwin" || data.runtime?.arch !== "arm64" ||
      data.rules?.width !== WORLD || data.rules?.height !== WORLD || data.rules?.tileCount !== CELLS || data.rules?.maxHistory !== 451) fail(`${role} runtime or world rules are not the frozen values.`);
  const p = data.provenance;
  const provenanceOkay = role === "baseline"
    ? exact(p, ["sourceSha256", "planSha256", "baselineArtifactSha256", "baselineDataSha256", "baselineIndexSha256", "baselineRegression"]) &&
      p.planSha256 === "134944138fc636b1c9677e9a40b5c2583d7184d608ce1e8d8c914e2ce8d93515" &&
      p.baselineArtifactSha256 === "1c85fd8477644da9fb2bd54df0f5c1a463103db6ac49022e2caa2b0611badd39" &&
      p.baselineDataSha256 === "3c3ee5857d3f1f3f4eb2cad6eed6a1863db324e6bc5ed19635532a69b3f25bcf" && p.baselineIndexSha256 === "3462a1e0ecd74c98a465395dceebbe4d1c28e19f272a451a8abb3edd18b3ac0c"
    : exact(p, ["sourceSha256", "planSha256", "baselineArtifactSha256", "baselineDataSha256", "baselineIndexSha256", "baselineRegression"]) &&
      p.planSha256 === PLAN_SHA256 && p.baselineArtifactSha256 === BASELINE_RAW_SHA256 && p.baselineDataSha256 === BASELINE_DATA_SHA256 && p.baselineIndexSha256 === BASELINE_INDEX_SHA256;
  if (!provenanceOkay ||
      !exact(p.baselineRegression, ["status", "seed", "comparedSamples", "comparedFrames", "comparedTickRows", "comparedSnapshots", "checkpoints"]) ||
      p.baselineRegression.status !== "verified" || p.baselineRegression.seed !== 1202 || p.baselineRegression.comparedSamples !== 151 ||
      p.baselineRegression.comparedFrames !== 151 || p.baselineRegression.comparedTickRows !== 3000 || p.baselineRegression.comparedSnapshots !== 5 ||
      JSON.stringify(p.baselineRegression.checkpoints?.map((x) => x.tick)) !== "[0,500,1500,2500,3000]") fail(`${role} provenance lacks the complete static split baseline regression.`);
  if (role === "alternating" && (!p.sourceSha256 || typeof p.sourceSha256 !== "object" || Array.isArray(p.sourceSha256) ||
      JSON.stringify(Object.keys(p.sourceSha256).sort()) !== JSON.stringify(EXPECTED_SOURCE_KEYS) ||
      Object.entries(PINNED_SOURCES).some(([path, expected]) => p.sourceSha256[path] !== expected) ||
      p.sourceSha256["tools/alternating-food-replication/explore.ts"] !== RUNNER_SHA256)) fail("Alternating source paths or pinned source identities do not match the frozen runner dependency set.");
  if (role === "baseline" && (entry.url !== BASELINE_NAME || entry.rawSha256 !== BASELINE_RAW_SHA256 || entry.dataSha256 !== BASELINE_DATA_SHA256 || data.run.finalTick !== 3000 || data.run.extinctionTick !== null)) fail("Historical static split reference does not match its accepted identity.");
  const expectedTicks = [0]; for (let t = 20; t <= data.run.finalTick; t += 20) expectedTicks.push(t);
  if (expectedTicks.at(-1) !== data.run.finalTick) expectedTicks.push(data.run.finalTick);
  if (!Array.isArray(data.samples) || !Array.isArray(data.frames) || data.samples.length !== expectedTicks.length || data.frames.length !== expectedTicks.length ||
      JSON.stringify(data.samples.map((x) => x.tick)) !== JSON.stringify(expectedTicks) || JSON.stringify(data.frames.map((x) => x.tick)) !== JSON.stringify(expectedTicks) ||
      !Array.isArray(data.tickRows) || data.tickRows.length !== data.run.finalTick) fail(`${role} recorded samples or tick history are incomplete.`);
  const entries = [];
  for (let i = 0; i < data.frames.length; i++) {
    const frame = data.frames[i], sample = data.samples[i];
    if (!exact(frame, ["tick", "censusSha256", "stateSha256", "foodBase64", "cells", "organisms", "ledger", "frameSha256"]) ||
        !exact(sample, ["tick", "census", "environment", "censusSha256", "stateSha256", "frameSha256"]) || frame.tick !== sample.tick ||
        !digest(frame.frameSha256) || !digest(frame.censusSha256) || !digest(frame.stateSha256) || frame.frameSha256 !== sample.frameSha256 ||
        frame.censusSha256 !== sample.censusSha256 || frame.stateSha256 !== sample.stateSha256) fail(`${role} frame/sample binding is invalid at ${frame.tick}.`);
    validateEnvironment(sample.environment, mode, frame.tick);
    const organisms = new Map();
    for (const org of frame.organisms) {
      if (!exact(org, ["id", "family", "genome"]) || !Number.isSafeInteger(org.id) || org.id < 1 || !Number.isInteger(org.family) || org.family < 0 || org.family > 2 ||
          !exact(org.genome, ["turnEvery", "turn", "branchEvery", "maxCells"]) || !Number.isInteger(org.genome.turnEvery) || org.genome.turnEvery < 2 || org.genome.turnEvery > 8 ||
          ![-1, 0, 1].includes(org.genome.turn) || !Number.isInteger(org.genome.branchEvery) || org.genome.branchEvery < 2 || org.genome.branchEvery > 6 ||
          !Number.isInteger(org.genome.maxCells) || org.genome.maxCells < 16 || org.genome.maxCells > 32 || organisms.has(org.id)) fail(`${role} frame ${frame.tick} has an invalid organism.`);
      organisms.set(org.id, org);
    }
    if (!Array.isArray(frame.cells) || frame.cells.length > 1536) fail(`${role} frame ${frame.tick} exceeds body-cell capacity.`);
    let last = -1; const tilesByOrganism = new Map([...organisms.keys()].map((id) => [id, []]));
    for (const cell of frame.cells) { if (!Array.isArray(cell) || cell.length !== 2 || !Number.isSafeInteger(cell[0]) || cell[0] <= last || cell[0] >= CELLS || !organisms.has(cell[1])) fail(`${role} frame ${frame.tick} has invalid body tiles.`); last = cell[0]; tilesByOrganism.get(cell[1]).push(cell[0]); }
    if ([...tilesByOrganism.values()].some((tiles) => !tiles.length || tiles.length > 32 || !bodyIsConnected(tiles))) fail(`${role} frame ${frame.tick} contains an empty or disconnected body.`);
    validateCensus(sample.census, frame, organisms);
    const food = b64Food(frame.foodBase64, frame.tick);
    if (!exact(frame.ledger, ["initialEnergy", "supplied", "dissipated", "deathLoss", "expected", "actual", "residual"]) ||
        frame.ledger.supplied !== sample.environment.accepted || frame.ledger.actual !== food.total + sample.census.totalEnergy ||
        frame.ledger.residual !== 0 || frame.ledger.actual !== frame.ledger.expected ||
        frame.ledger.expected !== frame.ledger.initialEnergy + frame.ledger.supplied - frame.ledger.dissipated - frame.ledger.deathLoss ||
        await shaText(JSON.stringify(sample.census)) !== frame.censusSha256) fail(`${role} frame ${frame.tick} accounting or census digest is invalid.`);
    const frameEnvelope = Object.fromEntries(Object.entries(frame).filter(([k]) => k !== "frameSha256"));
    if (await shaText(JSON.stringify(frameEnvelope)) !== frame.frameSha256) fail(`${role} frame digest is invalid.`);
    entries.push({ frame, sample, organisms, food, bands: bandCounts(frame), arm: { data } });
  }
  if (data.run.extinctionTick === null && entries.at(-1).sample.census.population === 0 || data.run.extinctionTick !== null && entries.at(-1).sample.census.population !== 0) fail(`${role} terminal population and extinction metadata disagree.`);
  const snapshots = role === "baseline" ? [0, 500, 1500, 2500, 3000] : [0, 500, 1000, 1500, 2000, 2500, 3000].filter((t) => t <= data.run.finalTick);
  if (data.run.extinctionTick !== null && !snapshots.includes(data.run.finalTick)) snapshots.push(data.run.finalTick);
  if (!Array.isArray(data.snapshots) || JSON.stringify(data.snapshots.map((x) => x.tick)) !== JSON.stringify([...new Set(snapshots)].sort((a, b) => a - b))) fail(`${role} required full snapshots are missing or out of order.`);
  for (const snap of data.snapshots) {
    const sample = data.samples.find((x) => x.tick === snap.tick);
    const entry = entries.find((x) => x.frame.tick === snap.tick);
    if (!sample || snap.terminal !== (data.run.extinctionTick !== null && snap.tick === data.run.finalTick) || snap.stateSha256 !== sample.stateSha256 ||
        snap.state?.tick !== snap.tick || snap.state?.seed !== 1202 || snap.state?.mutation !== true || snap.state?.droppedHistory !== 0 || snap.state?.droppedLineage !== 0 ||
        !Array.isArray(snap.state?.history) || snap.state.history.length > 451 || !Array.isArray(snap.state?.lineage) || snap.state.lineage.length > 10000 ||
        !entry || JSON.stringify(snap.environment) !== JSON.stringify(sample.environment) || await shaText(JSON.stringify({ state: snap.state, environment: snap.environment })) !== snap.stateSha256) fail(`${role} full snapshot ${snap.tick} is not bound to saved data or dropped observations.`);
    validateSnapshotFrame(snap.state, entry, sample, data.final.lineage, `${role}@${snap.tick}`);
  }
  if (!exact(data.repeat, ["verified", "comparedThroughTick", "stateChecks", "frameChecks"]) || data.repeat.verified !== true || data.repeat.comparedThroughTick !== data.run.finalTick || data.repeat.stateChecks !== data.samples.length || data.repeat.frameChecks !== data.frames.length) fail(`${role} independent repeat evidence is incomplete.`);
  if (!exact(data.final, ["census", "environment", "ledger", "lineage", "deathsByCause", "maxEverGeneration", "stateSha256"]) ||
      JSON.stringify(data.final.census) !== JSON.stringify(data.samples.at(-1).census) || JSON.stringify(data.final.environment) !== JSON.stringify(data.samples.at(-1).environment) || !Array.isArray(data.final.lineage) ||
      JSON.stringify(data.final.lineage) !== JSON.stringify(data.snapshots.at(-1).state.lineage) || data.final.stateSha256 !== data.snapshots.at(-1).stateSha256 ||
      JSON.stringify(data.final.ledger) !== JSON.stringify(data.snapshots.at(-1).state.ledger)) fail(`${role} final summary does not match its terminal snapshot.`);
  if (role === "alternating") validateGates(data, entries);
  return { data, entries, url: entry.url };
}
function validateGates(data, entries) {
  const n = data.numericalGate, s = data.spatialGate;
  if (!exact(n, ["aliveAt3000", "atLeastTwoFamiliesAt3000", "allWindowsReached", "eachNewWindowHasBirthsAndDeaths", "eachNewWindowCap48AtMost99", "numericalPass", "note"]) ||
      !Array.isArray(data.windows) || data.windows.length !== 3 || data.windows.some((w, i) => w.from !== 1501 + i * 500 || w.to !== 2000 + i * 500 || w.denominatorTicks !== 500)) fail("Alternating activity gate is malformed.");
  const windowsPass = data.windows.every((w) => w.status === "complete" && w.executedTicks === 500 && w.births > 0 && w.deaths > 0 && w.cap48Ticks <= 99);
  if (data.tickRows.some((row, i) => !exact(row, ["tick", "population", "cells", "births", "deaths", "blockedCap", "blockedSpace", "cap48", "nearCap47"]) ||
      row.tick !== i + 1 || !Number.isSafeInteger(row.population) || row.population < 0 || row.population > 48 || !Number.isSafeInteger(row.cells) || row.cells < 0 || row.cells > 1536 ||
      ![row.births, row.deaths, row.blockedCap, row.blockedSpace].every((x) => Number.isSafeInteger(x) && x >= 0) ||
      row.cap48 !== (row.population === 48) || row.nearCap47 !== (row.population >= 47))) fail("Alternating per-tick activity rows are malformed or contradict population cap flags.");
  for (const w of data.windows) {
    const rows = data.tickRows.filter((r) => r.tick >= w.from && r.tick <= w.to), count = rows.length;
    const expectedStatus = count === 500 ? "complete" : count ? "partial" : "not-reached";
    if (w.executedTicks !== count || w.status !== expectedStatus || w.births !== (count ? rows.reduce((a, r) => a + r.births, 0) : null) ||
        w.deaths !== (count ? rows.reduce((a, r) => a + r.deaths, 0) : null) || w.cap48Ticks !== (count ? rows.filter((r) => r.population === 48).length : null)) fail(`Activity window ${w.from}–${w.to} disagrees with per-tick rows.`);
  }
  const alive = data.run.finalTick === 3000 && data.run.extinctionTick === null && data.final.census.population > 0;
  const families = data.final.census.familyCounts.filter((x) => x > 0).length >= 2;
  const numPass = alive && families && windowsPass;
  if (n.aliveAt3000 !== alive || n.atLeastTwoFamiliesAt3000 !== families || n.allWindowsReached !== data.windows.every((w) => w.status === "complete") ||
      n.eachNewWindowHasBirthsAndDeaths !== data.windows.every((w) => w.status === "complete" && w.births > 0 && w.deaths > 0) ||
      n.eachNewWindowCap48AtMost99 !== data.windows.every((w) => w.status === "complete" && w.cap48Ticks <= 99) || n.numericalPass !== numPass) fail("Alternating numerical activity gate disagrees with saved evidence.");
  if (!exact(s, ["requiredTilesPerBand", "checkpoints", "pass"]) || s.requiredTilesPerBand !== 10 || !Array.isArray(s.checkpoints) || s.checkpoints.length !== 2) fail("Alternating spatial gate is malformed.");
  const expectedSpatial = [2500, 3000].map((tick) => { const e = entries.find((x) => x.frame.tick === tick); const counts = e?.bands ?? null; return { tick, occupiedTilesByBand: counts, pass: !!counts && counts.every((x) => x >= 10) }; });
  if (JSON.stringify(s.checkpoints) !== JSON.stringify(expectedSpatial) || s.pass !== expectedSpatial.every((x) => x.pass)) fail("Alternating spatial gate disagrees with saved body tiles.");
  const specs = [{ from: 1500, to: 2000, fedBand: 1 }, { from: 2000, to: 2500, fedBand: 0 }, { from: 2500, to: 3000, fedBand: 1 }];
  const expected = specs.map((spec) => {
    const a = entries.find((e) => e.frame.tick === spec.from)?.bands, b = entries.find((e) => e.frame.tick === spec.to)?.bands;
    const delta = a && b ? [b[0] - a[0], b[1] - a[1]] : [null, null];
    return { ...spec, fromOccupiedTilesByBand: a ?? null, toOccupiedTilesByBand: b ?? null, deltasByBand: delta, pass: delta[spec.fedBand] !== null && delta[spec.fedBand] >= 20 && delta[1 - spec.fedBand] !== null && delta[1 - spec.fedBand] <= -20 };
  });
  const seasonal = data.seasonalGate;
  if (!exact(seasonal, ["blocks", "pass"]) || !Array.isArray(seasonal.blocks) || JSON.stringify(seasonal.blocks) !== JSON.stringify(expected) || seasonal.pass !== expected.some((x) => x.pass)) fail("Alternating seasonal gate disagrees with saved body frames.");
  const staticRef = data.staticBaselineSeasonalReference;
  if (!exact(staticRef, ["blocks", "pass"]) || !Array.isArray(staticRef.blocks) || staticRef.blocks.length !== 3) fail("Static split seasonal reference is malformed.");
}
function validateBaselineParity(baseline, alternating) {
  const prior = baseline.data, proof = alternating.data.provenance.baselineRegression;
  const blocks = [{ from: 1500, to: 2000, fedBand: 1 }, { from: 2000, to: 2500, fedBand: 0 }, { from: 2500, to: 3000, fedBand: 1 }].map((spec) => {
    const a = baseline.entries.find((e) => e.frame.tick === spec.from)?.bands, b = baseline.entries.find((e) => e.frame.tick === spec.to)?.bands;
    const deltasByBand = a && b ? [b[0] - a[0], b[1] - a[1]] : [null, null];
    return { ...spec, fromOccupiedTilesByBand: a ?? null, toOccupiedTilesByBand: b ?? null, deltasByBand, pass: deltasByBand[spec.fedBand] !== null && deltasByBand[spec.fedBand] >= 20 && deltasByBand[1 - spec.fedBand] !== null && deltasByBand[1 - spec.fedBand] <= -20 };
  });
  if (prior.samples.length !== 151 || prior.frames.length !== 151 || prior.tickRows.length !== 3000 || prior.snapshots.length !== 5 ||
      JSON.stringify(prior.snapshots.map((x) => x.tick)) !== "[0,500,1500,2500,3000]" ||
      JSON.stringify(proof.checkpoints.map((x) => x.tick)) !== JSON.stringify(prior.snapshots.map((x) => x.tick)) ||
      proof.checkpoints.some((x, i) => x.compared !== true || x.stateSha256 !== prior.snapshots[i].stateSha256) ||
      JSON.stringify(blocks.map((x) => x.deltasByBand)) !== JSON.stringify(STATIC_DELTAS) || blocks.some((x) => x.pass) ||
      JSON.stringify(alternating.data.staticBaselineSeasonalReference) !== JSON.stringify({ blocks, pass: false })) fail("New model lacks the complete static split regression proof or seasonal reference against the historical samples, frames, tick rows, and five snapshots.");
}
async function readJSON(name, maxBytes = 1024 * 1024) {
  const response = await fetch(new URL(name, BASE)); if (!response.ok) fail(`${name} returned ${response.status}.`);
  const bytes = await response.arrayBuffer(); if (bytes.byteLength > maxBytes) fail(`${name} exceeds its size limit.`);
  let value; try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(`${name} is not valid JSON.`); }
  return { value, bytes };
}
async function validateReceipt(raw, decision, baselineSha, alternatingSha) {
  if (decision.visualReceiptUrl === null && decision.visualReceiptSha256 === null) return null;
  if (typeof decision.visualReceiptUrl !== "string" || !digest(decision.visualReceiptSha256)) fail("Visual receipt link or digest is malformed.");
  const { value, bytes } = await readJSON(decision.visualReceiptUrl);
  if (await sha(bytes) !== decision.visualReceiptSha256 || !exact(value, ["seed", "planSha256", "baselineArtifactSha256", "alternatingArtifactSha256", "alternatingChange", "seasonalChanges", "sameAgeComparisons", "visualReviewedBeforeOverlapDiagnostics", "reviewedAtUTC"]) ||
      value.seed !== 1202 || value.planSha256 !== PLAN_SHA256 || value.baselineArtifactSha256 !== baselineSha || value.alternatingArtifactSha256 !== alternatingSha ||
      value.visualReviewedBeforeOverlapDiagnostics !== true || typeof value.reviewedAtUTC !== "string" || !value.reviewedAtUTC.trim() ||
      !exact(value.alternatingChange, ["from", "to", "pass", "observation"]) || value.alternatingChange.from !== 2500 || value.alternatingChange.to !== 3000 ||
      typeof value.alternatingChange.pass !== "boolean" || !value.alternatingChange.observation.trim() || !Array.isArray(value.seasonalChanges) || value.seasonalChanges.length !== 3 ||
      JSON.stringify(value.seasonalChanges.map((x) => [x.from, x.to])) !== "[[1500,2000],[2000,2500],[2500,3000]]" ||
      value.seasonalChanges.some((x) => !exact(x, ["from", "to", "pass", "observation"]) || typeof x.pass !== "boolean" || !x.observation.trim()) ||
      !Array.isArray(value.sameAgeComparisons) || JSON.stringify(value.sameAgeComparisons.map((x) => x.tick)) !== JSON.stringify(BAND_TICKS) ||
      value.sameAgeComparisons.some((x) => !exact(x, ["tick", "observation"]) || !x.observation.trim())) fail("Visual receipt does not bind all four same-age observations and three seasonal blocks.");
  const disclosed = [value.alternatingChange.observation, ...value.seasonalChanges.map((x) => x.observation), ...value.sameAgeComparisons.map((x) => x.observation)].every((x) => /not blind/i.test(x));
  if (!disclosed) fail("Visual receipt must disclose that the historical reference and numerical outcome were known.");
  return value;
}
function verifyIndex(index, baseline, alternating, receipt) {
  const d = index.decision;
  if (!exact(index, ["schemaVersion", "kind", "seed", "planSha256", "arms", "decision"]) || index.schemaVersion !== 1 || index.kind !== "hungry-shapes-alternating-food-replication-pair" ||
      index.seed !== 1202 || index.planSha256 !== PLAN_SHA256 || !exact(index.arms, ["baseline", "alternating"]) ||
      !exact(d, ["status", "summary", "baselineArtifactSha256", "alternatingArtifactSha256", "visualReceiptUrl", "visualReceiptSha256"]) ||
      !["pending", "promising", "stop"].includes(d.status) || typeof d.summary !== "string" || !d.summary.trim() ||
      d.baselineArtifactSha256 !== BASELINE_RAW_SHA256 || d.alternatingArtifactSha256 !== alternating.rawSha256) fail("Alternating pair index is malformed or refers to different evidence.");
  if (d.status === "pending" && (receipt || d.visualReceiptUrl !== null || d.visualReceiptSha256 !== null)) fail("Pending status cannot include an accepted visual receipt.");
  if (d.status !== "pending" && !receipt) fail("A reviewed decision requires its SHA-bound visual receipt.");
  const manualSeasonal = receipt?.seasonalChanges.some((x) => x.pass && alternating.data.seasonalGate.blocks.find((b) => b.from === x.from && b.to === x.to)?.pass) ?? false;
  if (receipt?.seasonalChanges.some((x) => x.pass && !alternating.data.seasonalGate.blocks.find((b) => b.from === x.from && b.to === x.to)?.pass)) fail("Manual seasonal receipt claims a pass for a block that failed the numerical screen.");
  const manualPass = !!receipt && receipt.alternatingChange.pass && manualSeasonal;
  const expectedStatus = alternating.data.numericalGate.numericalPass && alternating.data.spatialGate.pass && alternating.data.seasonalGate.pass && manualPass ? "promising" : "stop";
  if (receipt && d.status !== expectedStatus) fail("Recorded decision does not derive from all four frozen screens.");
  return { decision: d, manualPass };
}
function stop() { playing = false; clearInterval(timer); timer = 0; byId("play").textContent = "Play"; byId("play").setAttribute("aria-label", "Play saved replay"); if (pair) byId("run-state").textContent = "Paused · recorded replay"; }
function draw(role, arm, target) {
  const e = [...arm.entries].reverse().find((x) => x.frame.tick <= target) ?? arm.entries[0];
  const c = canvas[role], g = ctx[role], unit = c.width / WORLD; g.fillStyle = "#09151a"; g.fillRect(0, 0, c.width, c.height);
  if (!bodyOnly) for (let i = 0; i < e.food.values.length; i++) { const amount = e.food.values[i]; if (!amount) continue; g.fillStyle = `rgba(175,229,187,${Math.min(.32,.035+amount/40*.28)})`; g.fillRect((i % WORLD) * unit, Math.floor(i / WORLD) * unit, unit, unit); }
  for (const [tile, id] of e.frame.cells) { const org = e.organisms.get(id), hue = [154, 37, 249][org.family]; g.fillStyle = `hsl(${hue} 67% 75%)`; g.fillRect((tile % WORLD) * unit + .15, Math.floor(tile / WORLD) * unit + .15, Math.max(1, unit - .3), Math.max(1, unit - .3)); }
  const activeBand = role === "alternating" ? e.sample.environment.activeBand : null;
  g.save(); for (let i = 0; i < BANDS.length; i++) { const [lo, hi] = BANDS[i]; g.strokeStyle = activeBand === i ? "#f2c978" : "#657c82"; g.lineWidth = Math.max(activeBand === i ? 3 : 1.5, unit * (activeBand === i ? .8 : .4)); g.strokeRect(lo * unit + g.lineWidth / 2, g.lineWidth / 2, (hi - lo + 1) * unit - g.lineWidth, c.height - g.lineWidth); } g.restore();
  const label = byId(`${role}-frame-label`);
  if (arm.data.run.extinctionTick !== null && target > arm.data.run.finalTick && e.frame.tick === arm.data.run.finalTick) label.textContent = `Extinct · actual tick ${fmt(e.frame.tick)} · holding terminal frame`;
  else if (arm.data.run.extinctionTick !== null && e.frame.tick === arm.data.run.finalTick) label.textContent = `Extinct · actual tick ${fmt(e.frame.tick)}`;
  else if (e.frame.tick !== target) label.textContent = `Tick ${fmt(e.frame.tick)} · saved sample · timeline ${fmt(target)}`;
  else label.textContent = `Tick ${fmt(target)} · saved sample`;
  byId(`${role}-population`).textContent = fmt(e.sample.census.population); byId(`${role}-families`).textContent = e.sample.census.familyCounts.map(fmt).join(" / ");
  byId(`${role}-cells`).textContent = fmt(e.frame.cells.length); byId(`${role}-programs`).textContent = fmt(new Set([...e.organisms.values()].map((o) => JSON.stringify(o.genome))).size);
  byId(`${role}-bands`).textContent = e.bands.map(fmt).join(" / "); byId(`${role}-food`).textContent = fmt(e.food.total);
  c.setAttribute("aria-label", `${role === "baseline" ? "Historical static split" : "Alternating supply"} saved frame tick ${e.frame.tick}; ${e.sample.census.population} living bodies and ${e.frame.cells.length} occupied tiles.`);
  if (role === "alternating") {
    const env = e.sample.environment, band = env.activeBand;
    byId("alternating-ledger").textContent = `${fmt(env.offered)} / ${fmt(env.accepted)} / ${fmt(env.overflow)}`;
    byId("alternating-active-band").textContent = `Band ${band} · columns ${BANDS[band][0]}–${BANDS[band][1]}${env.pulses ? ` · last supplied at tick ${fmt(Math.floor(e.frame.tick / 5) * 5)}` : " · before first pulse"}`;
  }
}
function render() {
  if (!pair) return; const age = ages[indexAt]; draw("baseline", pair.baseline, age); draw("alternating", pair.alternating, age);
  const scrub = byId("scrub"); scrub.value = String(indexAt); byId("scrub-value").value = `${fmt(age)} · ${indexAt + 1} / ${ages.length}`; byId("scrub-value").textContent = byId("scrub-value").value;
  byId("previous").disabled = indexAt === 0; byId("next").disabled = indexAt === ages.length - 1;
  for (const button of document.querySelectorAll("[data-jump-tick]")) button.disabled = !ages.includes(Number(button.dataset.jumpTick));
  if (indexAt === ages.length - 1) stop();
}
function renderSeasonal() {
  const rows = [{ from: 1500, to: 2000, band: 1 }, { from: 2000, to: 2500, band: 0 }, { from: 2500, to: 3000, band: 1 }];
  const baseRows = pair.alternating.data.staticBaselineSeasonalReference.blocks;
  const altRows = pair.alternating.data.seasonalGate.blocks;
  const staticText = baseRows.map((b) => `${fmt(b.from)}–${fmt(b.to)}: ${b.deltasByBand.map((x) => `${x > 0 ? "+" : ""}${fmt(x)}`).join(" / ")}`).join("; ");
  byId("static-caveat").textContent = `Known static split deltas: ${staticText}. ${pair.alternating.data.staticBaselineSeasonalReference.pass ? "At least one static block also meets the same growth/retreat screen without alternating supply; a matching result cannot establish causation or superiority." : "No static block meets this screen."}`;
  byId("seasonal-rows").replaceChildren(...rows.map((spec, i) => {
    const tr = document.createElement("tr"), base = baseRows[i], alt = altRows[i];
    const vals = [`${fmt(spec.from)}–${fmt(spec.to)}`, `Band ${spec.band}`, `${base.deltasByBand ? base.deltasByBand.map((x) => `${x > 0 ? "+" : ""}${fmt(x)}`).join(" / ") : "Unavailable"} · ${base.pass ? "meets" : "does not meet"}`, `${alt.deltasByBand ? alt.deltasByBand.map((x) => `${x > 0 ? "+" : ""}${fmt(x)}`).join(" / ") : "Unavailable"} · ${alt.pass ? "meets" : "does not meet"}`, alt.pass ? "Numerical pass" : "No pass"];
    for (const v of vals) { const td = document.createElement("td"); td.textContent = v; tr.append(td); }
    return tr;
  }));
}
function renderGates(receipt, verification) {
  const d = pair.index.decision, alt = pair.alternating.data;
  byId("decision-status").textContent = d.status === "pending" ? "Pending parent review" : d.status === "promising" ? "Promising" : "Stop";
  byId("decision-summary").textContent = d.summary;
  const final = alt.final.census, trough = alt.tickRows.reduce((best, row) => row.population < best.population ? row : best, alt.tickRows[0]);
  const seasonalPasses = alt.seasonalGate.blocks.filter((block) => block.pass).length;
  const allFamiliesPersist = alt.samples.every((sample) => sample.census.familyCounts.every((count) => count > 0));
  byId("outcome-title").textContent = `Seed 1202 · ${d.status === "pending" ? "awaiting parent review" : d.status}`;
  byId("outcome-summary").textContent = `At tick ${fmt(alt.run.finalTick)}, the population was ${fmt(final.population)} with family counts ${final.familyCounts.map(fmt).join(" / ")}. The minimum per-tick population was ${fmt(trough.population)} at tick ${fmt(trough.tick)}; ${allFamiliesPersist ? "all three families appeared in every saved sample" : "one or more founder families were absent from a saved sample"}. ${seasonalPasses} of 3 late seasonal blocks met the numerical growth/retreat screen.`;
  byId("scope-caveat").textContent = `The historical static reference has no qualifying late block under this screen. This selected single replication cannot establish food causation, superiority, adaptation, or durable coexistence.`;
  byId("activity-gate").textContent = alt.numericalGate.numericalPass ? "Pass" : "Did not pass";
  byId("spatial-gate").textContent = alt.spatialGate.pass ? "Pass" : "Did not pass";
  byId("seasonal-gate").textContent = alt.seasonalGate.pass ? "Pass" : "Did not pass";
  byId("visual-gate").textContent = receipt ? `${receipt.alternatingChange.pass && verification.manualPass ? "Pass" : "Did not pass"} · ${receipt.alternatingChange.observation}` : "Pending parent review; outcome gates are still validated.";
  const ul = byId("same-age-comparisons"); ul.replaceChildren();
  if (receipt) for (const c of receipt.sameAgeComparisons) { const li = document.createElement("li"); li.textContent = `Tick ${fmt(c.tick)} · ${c.observation}`; ul.append(li); }
  else { const li = document.createElement("li"); li.textContent = "Pending parent visual receipt for ticks 1,500, 2,000, 2,500, and 3,000."; ul.append(li); }
}
async function load() {
  try {
    const baselineIndexFile = await readJSON(BASELINE_INDEX_NAME);
    if (await sha(baselineIndexFile.bytes) !== BASELINE_INDEX_SHA256) fail("Historical static split index identity changed.");
    const historical = baselineIndexFile.value;
    if (!exact(historical, ["schemaVersion", "kind", "seed", "planSha256", "arms", "decision"]) || historical.schemaVersion !== 1 ||
        historical.kind !== "hungry-shapes-split-food-pair" || historical.seed !== 1202 ||
        historical.planSha256 !== "134944138fc636b1c9677e9a40b5c2583d7184d608ce1e8d8c914e2ce8d93515" ||
        !exact(historical.arms, ["baseline", "split"]) ||
        !exact(historical.arms.split, ["mode", "url", "rawSha256"]) || historical.arms.split.mode !== "split-band" ||
        historical.arms.split.url !== BASELINE_NAME || historical.arms.split.rawSha256 !== BASELINE_RAW_SHA256 ||
        !exact(historical.decision, ["status", "summary", "baselineArtifactSha256", "splitArtifactSha256", "visualReceiptUrl", "visualReceiptSha256"]) ||
        historical.decision.status !== "promising" || historical.decision.splitArtifactSha256 !== BASELINE_RAW_SHA256) fail("Historical split index does not bind the accepted seed-1202 split arm.");
    let response = await fetch(new URL(INDEX_NAME, BASE));
    if (response.status === 404) { byId("empty-state").hidden = false; setStatus("The historical reference is pinned; no alternating pair is listed yet.", "ready"); return; }
    if (!response.ok) fail(`${INDEX_NAME} returned ${response.status}.`);
    const indexBytes = await response.arrayBuffer(); if (indexBytes.byteLength > 1024 * 1024) fail("The alternating pair index exceeds its size limit.");
    let indexData; try { indexData = JSON.parse(new TextDecoder().decode(indexBytes)); } catch { fail("The alternating pair index is not valid JSON."); }
    const indexFile = { value: indexData, bytes: indexBytes };
    const index = indexFile.value; Object.defineProperty(index, "url", { value: new URL(INDEX_NAME, BASE), enumerable: false });
    const baseline = await loadArm(index.arms?.baseline, "baseline", index), alternating = await loadArm(index.arms?.alternating, "alternating", index);
    if (baseline.data.dataSha256 !== BASELINE_DATA_SHA256) fail("Historical split reference does not match its frozen data identity.");
    validateBaselineParity(baseline, alternating);
    const d = index.decision;
    let receipt = null;
    if (d?.visualReceiptUrl !== null || d?.visualReceiptSha256 !== null) receipt = await validateReceipt(index, d, d.baselineArtifactSha256, d.alternatingArtifactSha256);
    const verified = verifyIndex(index, baseline, { ...alternating, rawSha256: index.arms.alternating.rawSha256 }, receipt);
    pair = { index, baseline, alternating, receipt };
    ages = [...new Set([...baseline.entries.map((e) => e.frame.tick), ...alternating.entries.map((e) => e.frame.tick)])].sort((a, b) => a - b);
    if (!ages.length || ages[0] !== 0) fail("The saved pair has no shared tick-zero frame.");
    replayNode.hidden = false; byId("empty-state").hidden = true; byId("error-state").hidden = true;
    for (const id of ["previous", "play", "next", "scrub"]) byId(id).disabled = ages.length < 2;
    byId("scrub").max = String(ages.length - 1); byId("play").setAttribute("aria-label", "Play saved replay");
    renderSeasonal(); renderGates(receipt, verified); render(); resize(); setStatus("Both records, saved frames, food ledgers, gates, and pair bindings verified.", "ready");
  } catch (error) {
    stop(); pair = null; replayNode.hidden = true; byId("empty-state").hidden = true; byId("error-state").hidden = false;
    byId("error-detail").textContent = error instanceof Error ? error.message : String(error); setStatus("The listed alternating-food evidence could not be verified.", "error");
  }
}
function resize() { if (!pair) return; for (const c of Object.values(canvas)) { const width = c.getBoundingClientRect().width; if (width) { const size = Math.round(width * (devicePixelRatio || 1)); if (c.width !== size || c.height !== size) c.width = c.height = size; } } render(); }
function move(index) { indexAt = Math.max(0, Math.min(ages.length - 1, index)); render(); }
byId("previous").addEventListener("click", () => move(indexAt - 1));
byId("next").addEventListener("click", () => move(indexAt + 1));
byId("scrub").addEventListener("input", (event) => move(Number(event.currentTarget.value)));
byId("play").addEventListener("click", () => {
  if (playing) { stop(); return; }
  if (indexAt === ages.length - 1) move(0);
  playing = true; byId("run-state").textContent = "Playing · recorded frames"; byId("play").textContent = "Pause"; byId("play").setAttribute("aria-label", "Pause saved replay");
  timer = window.setInterval(() => { if (indexAt + 1 >= ages.length) stop(); else move(indexAt + 1); }, 100);
});
for (const button of document.querySelectorAll("[data-jump-tick]")) button.addEventListener("click", () => { const index = ages.indexOf(Number(button.dataset.jumpTick)); if (index >= 0) move(index); });
window.addEventListener("keydown", (event) => { if ((event.code === "ArrowLeft" || event.code === "ArrowRight") && !/^(INPUT|BUTTON|TEXTAREA)$/.test(event.target.tagName)) { event.preventDefault(); move(indexAt + (event.code === "ArrowRight" ? 1 : -1)); } });
window.addEventListener("resize", resize);
load();
