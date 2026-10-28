const FROZEN_RULES={"version":1,"width":96,"height":96,"tileCount":9216,"directions":4,"initialFood":20,"maxFood":40,"foodSupplyEvery":5,"foodSupplyPerTile":1,"absorbPerCell":2,"storeCap":160,"upkeepDivisor":8,"structurePerCell":4,"growthCost":4,"growthEvery":6,"reproductionEvery":80,"reproductionCellFraction":0.75,"reproductionThreshold":24,"reproductionCost":16,"newbornStore":12,"birthPlacementAttempts":16,"birthPlacementRadius":8,"maxOrganisms":48,"maxCellsPerOrganism":32,"maxOccupied":1536,"maxAge":600,"historyEvery":20,"maxHistory":451,"maxLineage":10000,"maxStepCount":100000,"founderCount":12,"mutationRate":0.25,"mutationSeedXor":2654435769};
const PLAN_SHA256="c5ab72408c514280360e67e2ef0fab75475663da52be799e8aa2836eab67661d";
const HIST_NAME="food-floor-longevity-replication-seed-1202.json",HIST_RAW="14565a78528152556140b68bedbd6d074e5f5dca556ecf0439094e945d5cef60",HIST_DATA="89479f5352fe09628fd2314d785e67ca540873c0f766c0a7d0206f5127975315";
const INDEX_NAME="food-schedule-769-index-1202.json",WORLD=96,CELLS=9216,BASE=new URL("./",import.meta.url),BANDS=[[0,23],[48,71]];
const bodyOnly = new URL(location.href).searchParams.get("bodies") === "1";
const byId = (id) => document.getElementById(id);
const statusNode = byId("source-status"), replayNode = byId("replay");
const canvas = { alternating: byId("alternating-world"), baseline: byId("baseline-world") };
const ctx = Object.fromEntries(Object.entries(canvas).map(([k,c])=>[k,c.getContext("2d")]));
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
  const keys = ["version", "mode", "pulseBudget", "targetCount", "pulses", "offered", "accepted", "overflow", "initialFoodPerTile", "bandColumns", "bandWidth", "activeBand", "bandOffered", "bandAccepted", "bandOverflow"];
  if (mode === "schedule-769") keys.push("floorPerBand", "alternatingBudget", "pulseAdvance");
  if (!exact(env, keys)) fail(`${mode} environment at ${tick} has unexpected fields.`);
  if (env.version !== 1 || env.mode !== mode || env.pulseBudget !== 768 || env.targetCount !== (mode === "schedule-769" ? 4608 : 2304) ||
      env.pulses !== Math.floor(tick / 5) || env.offered !== env.pulses * 768 || env.offered !== env.accepted + env.overflow || env.initialFoodPerTile !== 20 ||
      JSON.stringify(env.bandColumns) !== JSON.stringify(BANDS) || env.bandWidth !== 24 ||
      mode === "schedule-769" && (env.floorPerBand !== 96 || env.alternatingBudget !== 576 || env.pulseAdvance !== 769)) fail(`${mode} food ledger or geometry at ${tick} is inconsistent.`);
  const active = env.pulses === 0 ? 0 : Math.floor((env.pulses - 1) / 100) % 2;
  for (const key of ["bandOffered", "bandAccepted", "bandOverflow"]) {
    if (!Array.isArray(env[key]) || env[key].length !== 2 || env[key].some((n) => !Number.isSafeInteger(n) || n < 0)) fail(`${mode} ${key} at ${tick} is malformed.`);
  }
  const scheduled = [0, 0];
  for (let p = 0; p < env.pulses; p++) { if (mode === "schedule-769") { scheduled[0] += 96; scheduled[1] += 96; scheduled[Math.floor(p / 100) % 2] += 576; } else scheduled[Math.floor(p / 100) % 2] += 768; }
  if (env.activeBand !== active || env.bandOffered.some((n, i) => n !== scheduled[i] || n !== env.bandAccepted[i] + env.bandOverflow[i]) ||
      env.bandOffered[0] + env.bandOffered[1] !== env.offered || env.bandAccepted[0] + env.bandAccepted[1] !== env.accepted || env.bandOverflow[0] + env.bandOverflow[1] !== env.overflow) fail(`${mode} per-band food accounting at ${tick} is inconsistent.`);
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
function validateFinalLineage(final, tick) {
  const nodes = final?.lineage, fields = ["turnEvery", "turn", "branchEvery", "maxCells"];
  if (!Array.isArray(nodes) || nodes.length > 10000) fail("Final lineage is missing or exceeds capacity.");
  const byID = new Map(nodes.map((n) => [n.id, n]));
  if (byID.size !== nodes.length) fail("Duplicate final lineage node.");
  for (const n of nodes) {
    if (!exact(n, ["id", "parentID", "family", "generation", "birthTick", "genome", "mutation", "deathTick", "deathCause", "parentRecordDropped"]) ||
        !Number.isSafeInteger(n.id) || n.id < 1 || !Number.isSafeInteger(n.family) || n.family < 0 || n.family > 2 ||
        !Number.isSafeInteger(n.generation) || n.generation < 0 || !Number.isSafeInteger(n.birthTick) || n.birthTick < 0 || n.birthTick > tick ||
        !exact(n.genome, fields) || !Number.isInteger(n.genome.turnEvery) || n.genome.turnEvery < 2 || n.genome.turnEvery > 8 ||
        ![-1, 0, 1].includes(n.genome.turn) || !Number.isInteger(n.genome.branchEvery) || n.genome.branchEvery < 2 || n.genome.branchEvery > 6 ||
        !Number.isInteger(n.genome.maxCells) || n.genome.maxCells < 16 || n.genome.maxCells > 32 ||
        !(n.parentID === null || Number.isSafeInteger(n.parentID) && n.parentID > 0) || n.parentRecordDropped !== false ||
        !(n.deathTick === null || Number.isSafeInteger(n.deathTick) && n.deathTick >= n.birthTick && n.deathTick <= tick) ||
        (n.deathTick === null ? n.deathCause !== null : !["age", "starvation"].includes(n.deathCause))) fail("Final lineage structure, genome, or death semantics are invalid.");
    if (n.mutation !== null && (!exact(n.mutation, ["field", "from", "to"]) || !fields.includes(n.mutation.field) || !Number.isSafeInteger(n.mutation.from) || !Number.isSafeInteger(n.mutation.to))) fail("Final lineage mutation record is invalid.");
    if (n.parentID === null) {
      if (n.generation !== 0 || n.mutation !== null || n.birthTick !== 0) fail("Final lineage founder is invalid.");
    } else {
      const parent = byID.get(n.parentID);
      if (!parent || n.generation !== parent.generation + 1 || n.family !== parent.family || parent.birthTick > n.birthTick || parent.deathTick !== null && parent.deathTick < n.birthTick) fail("Final lineage parent or generation is inconsistent.");
      const changed = fields.filter((field) => n.genome[field] !== parent.genome[field]);
      if (n.mutation === null ? changed.length !== 0 : changed.length !== 1 || changed[0] !== n.mutation.field || n.mutation.from !== parent.genome[n.mutation.field] || n.mutation.to !== n.genome[n.mutation.field] || n.mutation.from === n.mutation.to) fail("Final lineage mutation does not match inheritance.");
    }
  }
  if (!exact(final.deathsByCause, ["age", "starvation"]) || final.deathsByCause.age !== nodes.filter((n) => n.deathCause === "age").length ||
      final.deathsByCause.starvation !== nodes.filter((n) => n.deathCause === "starvation").length ||
      final.maxEverGeneration !== nodes.reduce((max, n) => Math.max(max, n.generation), 0)) fail("Final lineage summary disagrees with its complete records.");
}
async function loadArm(entry, role, index) {
  const mode = "schedule-769";
  const kind = "hungry-shapes-food-schedule-769-arm";
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
  top.push("seasonalGate", "recoverySummary", "stage", "gate3000");
  if (!exact(data, top) || data.schemaVersion !== 1 || data.kind !== kind || !exact(data.run, ["seed", "mode", "mutation", "maxTick", "finalTick", "extinctionTick", "gateHorizon"]) ||
      data.run.seed !== 1202 || data.run.mode !== mode || data.run.mutation !== true || data.run.maxTick !== 6000 ||
      !Number.isSafeInteger(data.run.finalTick) || data.run.finalTick < 0 || data.run.finalTick > 6000 ||
      !(data.run.extinctionTick === null || data.run.extinctionTick === data.run.finalTick && data.run.extinctionTick > 0) ||
      ![3000,6000].includes(data.run.gateHorizon) || data.run.finalTick > data.run.gateHorizon || data.run.extinctionTick === null && data.run.finalTick !== data.run.gateHorizon) fail(`${role} artifact identity or run bounds are invalid.`);
  if (data.runtime?.node !== "24.2.0" || data.runtime?.platform !== "darwin" || data.runtime?.arch !== "arm64" ||
      JSON.stringify(data.rules)!==JSON.stringify(FROZEN_RULES)) fail(`${role} runtime or world rules are not the frozen values.`);
  const p = data.provenance;
  await validateProvenance(p);
  const expectedTicks = [0]; for (let t = 20; t <= data.run.finalTick; t += 20) expectedTicks.push(t);
  if (expectedTicks.at(-1) !== data.run.finalTick) expectedTicks.push(data.run.finalTick);
  if (!Array.isArray(data.samples) || !Array.isArray(data.frames) || data.samples.length !== expectedTicks.length || data.frames.length !== expectedTicks.length ||
      JSON.stringify(data.samples.map((x) => x.tick)) !== JSON.stringify(expectedTicks) || JSON.stringify(data.frames.map((x) => x.tick)) !== JSON.stringify(expectedTicks) ||
      !Array.isArray(data.tickRows) || data.tickRows.length !== data.run.finalTick) fail(`${role} recorded samples or tick history are incomplete.`);
  validateFinalLineage(data.final, data.run.finalTick);
  const entries = [];
  for (let i = 0; i < data.frames.length; i++) {
    const frame = data.frames[i], sample = data.samples[i];
    if (!exact(frame, ["tick", "censusSha256", "stateSha256", "foodBase64", "cells", "organisms", "ledger", "frameSha256"]) ||
        !exact(sample, ["tick", "census", "environment", "censusSha256", "stateSha256", "frameSha256"]) || frame.tick !== sample.tick ||
        !digest(frame.frameSha256) || !digest(frame.censusSha256) || !digest(frame.stateSha256) || frame.frameSha256 !== sample.frameSha256 ||
        frame.censusSha256 !== sample.censusSha256 || frame.stateSha256 !== sample.stateSha256) fail(`${role} frame/sample binding is invalid at ${frame.tick}.`);
    validateEnvironment(sample.environment, mode, frame.tick);
    if (i > 0) {
      const before = data.samples[i - 1].environment, after = sample.environment;
      for (let band = 0; band < 2; band++) {
        if (after.bandAccepted[band] < before.bandAccepted[band] || after.bandOverflow[band] < before.bandOverflow[band] ||
            after.bandAccepted[band] - before.bandAccepted[band] > after.bandOffered[band] - before.bandOffered[band]) fail(`${role} per-band cumulative ledger regresses or accepts more than newly offered food.`);
      }
    }
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
    if ([...tilesByOrganism.entries()].some(([id, tiles]) => !tiles.length || tiles.length > 32 || tiles.length > organisms.get(id).genome.maxCells || !bodyIsConnected(tiles))) fail(`${role} frame ${frame.tick} contains an empty, disconnected, or over-cap body.`);
    validateCensus(sample.census, frame, organisms);
    validateFrameLineage(frame, data.final.lineage, sample.census);
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
  const snapshots = Array.from({ length: 13 }, (_, i) => i * 500).filter((t) => t <= data.run.finalTick);
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
  validateGates(data, entries); validateRecovery(data, entries); await validateGateBinding(data,index);
  return { data, entries, url: entry.url };
}
function validateFrameLineage(frame, nodes, census) {
  if (!Array.isArray(nodes)) fail("Final lineage is missing.");
  const living = nodes.filter((n) => n.birthTick <= frame.tick && (n.deathTick === null || n.deathTick > frame.tick)).sort((a, b) => a.id - b.id);
  const expected = living.map((n) => ({ id: n.id, family: n.family, genome: n.genome }));
  if (JSON.stringify(frame.organisms) !== JSON.stringify(expected)) fail(`Frame ${frame.tick} body IDs, family, or genome differ from living lineage.`);
  const families = [0, 0, 0]; for (const node of living) families[node.family]++;
  if (JSON.stringify(families) !== JSON.stringify(census.familyCounts) || living.length !== census.population ||
      new Set(living.map((n) => JSON.stringify(n.genome))).size !== census.genomeVariantCount ||
      living.reduce((m, n) => Math.max(m, n.generation), 0) !== census.maxGeneration ||
      nodes.filter((n) => n.parentID !== null && n.birthTick <= frame.tick).length !== census.births ||
      nodes.filter((n) => n.deathTick !== null && n.deathTick <= frame.tick).length !== census.deaths ||
      nodes.filter((n) => n.mutation !== null && n.birthTick <= frame.tick).length !== census.effectiveMutations) fail(`Frame ${frame.tick} census disagrees with living or cumulative lineage.`);
}
function validateTickBindings(data) {
  const born = new Map(), died = new Map();
  for (const node of data.final.lineage) {
    if (node.parentID !== null) born.set(node.birthTick, (born.get(node.birthTick) ?? 0) + 1);
    if (node.deathTick !== null) died.set(node.deathTick, (died.get(node.deathTick) ?? 0) + 1);
  }
  let population = 12;
  const totals = { births: 0, deaths: 0, blockedCap: 0, blockedSpace: 0 };
  for (const row of data.tickRows) {
    if (row.population !== population + row.births - row.deaths) fail(`Population transition disagrees at tick ${row.tick}.`);
    if (row.population === 0 && row.tick !== data.run.finalTick) fail(`Population reached extinction before terminal tick ${row.tick}.`);
    if (row.births !== (born.get(row.tick) ?? 0) || row.deaths !== (died.get(row.tick) ?? 0)) fail(`Lineage event delta disagrees at tick ${row.tick}.`);
    population = row.population;
    for (const key of Object.keys(totals)) totals[key] += row[key];
    if (row.tick % 20 === 0 || row.tick === data.run.finalTick) {
      const census = data.samples.find((x) => x.tick === row.tick)?.census;
      if (!census || census.population !== row.population || census.cells !== row.cells || census.births !== totals.births ||
          census.deaths !== totals.deaths || census.blockedCapBirths !== totals.blockedCap || census.blockedSpaceBirths !== totals.blockedSpace) fail(`Sample counters disagree with tick rows at ${row.tick}.`);
    }
  }
  if (data.run.extinctionTick !== null && data.tickRows.length !== data.run.extinctionTick) fail("Extinction row coverage is incomplete.");
}
function validateGates(data, entries) {
  const H=data.run.gateHorizon, n = data.numericalGate, s = data.spatialGate;
  if (!exact(n, ["horizon", "aliveAtHorizon", "atLeastTwoFamiliesAtHorizon", "allWindowsReached", "eachNewWindowHasBirthsAndDeaths", "eachNewWindowCap48AtMost99", "numericalPass", "note"]) ||
      !Array.isArray(data.windows) || data.windows.length !== 3 || data.windows.some((w, i) => w.from !== H-1499 + i * 500 || w.to !== H-1000 + i * 500 || w.denominatorTicks !== 500)) fail("Alternating activity gate is malformed.");
  const windowsPass = data.windows.every((w) => w.status === "complete" && w.executedTicks === 500 && w.births > 0 && w.deaths > 0 && w.cap48Ticks <= 99);
  if (data.tickRows.some((row, i) => !exact(row, ["tick", "population", "cells", "births", "deaths", "blockedCap", "blockedSpace", "cap48", "nearCap47"]) ||
      row.tick !== i + 1 || !Number.isSafeInteger(row.population) || row.population < 0 || row.population > 48 || !Number.isSafeInteger(row.cells) || row.cells < 0 || row.cells > 1536 ||
      ![row.births, row.deaths, row.blockedCap, row.blockedSpace].every((x) => Number.isSafeInteger(x) && x >= 0) ||
      row.cap48 !== (row.population === 48) || row.nearCap47 !== (row.population >= 47))) fail("Alternating per-tick activity rows are malformed or contradict population cap flags.");
  validateTickBindings(data);
  for (const w of data.windows) {
    const rows = data.tickRows.filter((r) => r.tick >= w.from && r.tick <= w.to), count = rows.length;
    const expectedStatus = count === 500 ? "complete" : count ? "partial" : "not-reached";
    if (w.executedTicks !== count || w.status !== expectedStatus || w.births !== (count ? rows.reduce((a, r) => a + r.births, 0) : null) ||
        w.deaths !== (count ? rows.reduce((a, r) => a + r.deaths, 0) : null) || w.cap48Ticks !== (count ? rows.filter((r) => r.population === 48).length : null)) fail(`Activity window ${w.from}–${w.to} disagrees with per-tick rows.`);
  }
  const alive = data.run.finalTick === H && data.run.extinctionTick === null && data.final.census.population > 0;
  const families = alive && data.final.census.familyCounts.filter((x) => x > 0).length >= 2;
  const numPass = alive && families && windowsPass;
  if (n.horizon!==H || n.aliveAtHorizon !== alive || n.atLeastTwoFamiliesAtHorizon !== families || n.allWindowsReached !== data.windows.every((w) => w.status === "complete") ||
      n.eachNewWindowHasBirthsAndDeaths !== data.windows.every((w) => w.status === "complete" && w.births > 0 && w.deaths > 0) ||
      n.eachNewWindowCap48AtMost99 !== data.windows.every((w) => w.status === "complete" && w.cap48Ticks <= 99) || n.numericalPass !== numPass) fail("Alternating numerical activity gate disagrees with saved evidence.");
  if (!exact(s, ["requiredTilesPerBand", "checkpoints", "pass"]) || s.requiredTilesPerBand !== 10 || !Array.isArray(s.checkpoints) || s.checkpoints.length !== 2) fail("Alternating spatial gate is malformed.");
  const expectedSpatial = [H-500, H].map((tick) => { const e = entries.find((x) => x.frame.tick === tick); const counts = e?.bands ?? null; return { tick, occupiedTilesByBand: counts, pass: !!counts && counts.every((x) => x >= 10) }; });
  if (JSON.stringify(s.checkpoints) !== JSON.stringify(expectedSpatial) || s.pass !== expectedSpatial.every((x) => x.pass)) fail("Alternating spatial gate disagrees with saved body tiles.");
  const specs = [{ from: H-1500, to: H-1000, fedBand: 1 }, { from: H-1000, to: H-500, fedBand: 0 }, { from: H-500, to: H, fedBand: 1 }];
  const expected = specs.map((spec) => {
    const a = entries.find((e) => e.frame.tick === spec.from)?.bands, b = entries.find((e) => e.frame.tick === spec.to)?.bands;
    const delta = a && b ? [b[0] - a[0], b[1] - a[1]] : [null, null];
    return { ...spec, fromOccupiedTilesByBand: a ?? null, toOccupiedTilesByBand: b ?? null, deltasByBand: delta, pass: delta[spec.fedBand] !== null && delta[spec.fedBand] >= 20 && delta[1 - spec.fedBand] !== null && delta[1 - spec.fedBand] <= -20 };
  });
  const seasonal = data.seasonalGate;
  if (!exact(seasonal, ["blocks", "pass"]) || !Array.isArray(seasonal.blocks) || JSON.stringify(seasonal.blocks) !== JSON.stringify(expected) || seasonal.pass !== expected.some((x) => x.pass)) fail("Alternating seasonal gate disagrees with saved body frames.");
}
function expectedWindow(data, entries, from, to) {
  const rows = data.tickRows.filter(r => r.tick >= from && r.tick <= to), n=rows.length;
  const tick = Math.min(to, data.run.finalTick), end = entries.find(e => e.frame.tick === tick);
  const before = entries.find(e => e.frame.tick === from-1), env = end?.sample.environment;
  const food = n && env && before ? { offered:env.offered-before.sample.environment.offered, accepted:env.accepted-before.sample.environment.accepted, overflow:env.overflow-before.sample.environment.overflow } : {offered:null,accepted:null,overflow:null};
  return { rows,n,tick,end,before,food,mean:n?rows.reduce((a,r)=>a+r.population,0)/n:null };
}
function validateRecovery(data, entries) {
  const r=data.recoverySummary;
  if (!exact(r,["windows","populationPath","minimum","tailMinimum","endpoint","last500Executed"]) || !Array.isArray(r.windows) || r.windows.length!==12) fail("Recovery summary is malformed.");
  for (let i=0;i<12;i++) {
    const w=r.windows[i], from=1+i*500,to=500+i*500;
    const e=expectedWindow(data,entries,from,to), rows=e.rows,n=e.n;
    if (w.from!==from || w.to!==to || w.denominatorTicks!==500 || w.executedTicks!==n || w.status!==(n===500?"complete":n?"partial":"not-reached") || w.meanPopulation!==e.mean ||
        w.minPopulation!==(n?Math.min(...rows.map(x=>x.population)):null) || w.maxPopulation!==(n?Math.max(...rows.map(x=>x.population)):null) ||
        w.births!==(n?rows.reduce((a,x)=>a+x.births,0):null) || w.deaths!==(n?rows.reduce((a,x)=>a+x.deaths,0):null) ||
        w.cap48Ticks!==(n?rows.filter(x=>x.cap48).length:null) || w.nearCap47Ticks!==(n?rows.filter(x=>x.nearCap47).length:null) ||
        w.blockedCapAttempts!==(n?rows.reduce((a,x)=>a+x.blockedCap,0):null) || w.blockedSpaceAttempts!==(n?rows.reduce((a,x)=>a+x.blockedSpace,0):null) ||
        JSON.stringify(w.food)!==JSON.stringify(e.food)) fail(`New window ${from}–${to} disagrees with recorded rows or resources.`);
    if (n) {
      const ep=w.endpoint,s=e.end?.sample,f=e.end?.frame;
      if (!ep || !s || !f || ep.requestedTick!==to || ep.actualTick!==e.tick || ep.population!==s.census.population || ep.cells!==s.census.cells ||
          JSON.stringify(ep.familyCounts)!==JSON.stringify(s.census.familyCounts) || ep.foodRemaining!==e.end.food.total || JSON.stringify(ep.occupiedTilesByBand)!==JSON.stringify(e.end.bands) || ep.maxGeneration!==s.census.maxGeneration ||
          ep.maxEverGeneration!==data.final.lineage.filter(x=>x.birthTick<=e.tick).reduce((m,x)=>Math.max(m,x.generation),0)) fail(`Recovery endpoint ${to} disagrees with saved evidence.`);
      const counts=new Map();for(const o of f.organisms){const k=JSON.stringify(o.genome);counts.set(k,(counts.get(k)??0)+1);}
      const actual=(ep.genomeCounts??[]).map(x=>[JSON.stringify(x.genome),x.count]).sort((a,b)=>a[0].localeCompare(b[0]));
      if(JSON.stringify(actual)!==JSON.stringify([...counts.entries()].sort((a,b)=>a[0].localeCompare(b[0]))))fail(`Recovery programs at ${to} differ from the saved frame.`);
    } else if(JSON.stringify(w.endpoint)!==JSON.stringify({requestedTick:to,actualTick:null,population:null,cells:null,familyCounts:null,genomeCounts:[],maxGeneration:null,maxEverGeneration:null,foodRemaining:null,occupiedTilesByBand:null})) fail("Unreached recovery window has a fabricated endpoint.");
  }
  const offset=data.run.gateHorizon/500-3;
  if(JSON.stringify(data.windows)!==JSON.stringify(r.windows.slice(offset,offset+3)))fail("Gate windows differ from recorded windows.");
  const rows=data.tickRows,last=rows.slice(-500),tail=rows.filter(x=>x.tick>3000);
  const minimum=xs=>xs.reduce((m,x)=>m.population===null||x.population<m.population?{population:x.population,tick:x.tick}:m,{population:null,tick:null});
  if(JSON.stringify(r.populationPath)!==JSON.stringify(rows.map(({tick,population})=>({tick,population})))||JSON.stringify(r.minimum)!==JSON.stringify(minimum(rows))||JSON.stringify(r.tailMinimum)!==JSON.stringify(minimum(tail))||JSON.stringify(r.endpoint)!==JSON.stringify(rows.length?{tick:rows.at(-1).tick,population:rows.at(-1).population}:{tick:null,population:null}))fail("Population summary differs from saved rows.");
  const expected={from:last[0]?.tick??null,to:last.at(-1)?.tick??null,executedTicks:last.length,meanPopulation:last.length?last.reduce((a,x)=>a+x.population,0)/last.length:null};
  if(JSON.stringify(r.last500Executed)!==JSON.stringify(expected))fail("Final population mean differs from saved rows.");
}
async function readJSON(name,maxBytes=1024*1024){if(typeof name!=="string"||name.includes("..")||name.includes("/")||new URL(name,BASE).origin!==location.origin)fail("Evidence must be a local listed filename.");const response=await fetch(new URL(name,BASE));if(!response.ok)fail(`${name} returned ${response.status}.`);const bytes=await response.arrayBuffer();if(bytes.byteLength>maxBytes)fail("Evidence exceeds size limit.");let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{fail("Evidence JSON is invalid.");}return{value,bytes};}
async function validateProvenance(p){
 if(!exact(p,["sourceSha256","planSha256","historicalArtifactSha256","historicalDataSha256","historicalIndexSha256","regression","runId","intentSha256"])||p.planSha256!==PLAN_SHA256||p.historicalArtifactSha256!==HIST_RAW||p.historicalDataSha256!==HIST_DATA||p.historicalIndexSha256!=="666fe0dce4b094eef3f5498c0204f2321db2df1469c8f59df8e25520db41fe19"||typeof p.runId!=="string"||!p.runId||!digest(p.intentSha256))fail("New-rule provenance differs from frozen inputs.");
 const proof={status:"verified",seed:1202,mode:"foothold-band",throughTick:6000,normalization:"none",comparedSamples:301,comparedFrames:301,comparedTickRows:6000,comparedSnapshots:13,artifactSha256:HIST_RAW};
 if(JSON.stringify(p.regression)!==JSON.stringify(proof))fail("Full historical regression proof is missing.");
 if(!p.sourceSha256||typeof p.sourceSha256!=="object")fail("Source bindings missing.");
 for(const required of["tools/food-schedule-769/explore.ts","tools/food-schedule-769/launch.sh","apps/lab/src/food-schedule-769/model.ts","docs/creative-prototypes/food-schedule-769-plan.md"])if(!digest(p.sourceSha256[required]))fail("Required source binding missing.");
 for(const[path,expected]of Object.entries(p.sourceSha256)){if(!digest(expected)||path.startsWith('/')||path.includes('..')||(!path.match(/^(tools|apps|docs)\//)&&!['package.json','pnpm-lock.yaml'].includes(path)))fail("Unsafe source path or digest.");const url=new URL('../../'+path,BASE),res=await fetch(url);if(!res.ok||await sha(await res.arrayBuffer())!==expected)fail(`Source mismatch: ${path}`);}
 if(p.sourceSha256['docs/creative-prototypes/food-schedule-769-plan.md']!==PLAN_SHA256)fail("Plan binding differs.");
}
async function loadHistorical(){const{value:d,bytes}=await readJSON(HIST_NAME,24*1024*1024);if(await sha(bytes)!==HIST_RAW||d.dataSha256!==HIST_DATA)fail("Known historical record changed.");return{data:d,entries:d.frames.map((frame,i)=>({frame,sample:d.samples[i],organisms:new Map(frame.organisms.map(o=>[o.id,o])),food:b64Food(frame.foodBase64,frame.tick),bands:bandCounts(frame)}))};}
function manualPass(receipt,arm){if(!receipt)return false;const H=arm.data.run.gateHorizon;if(receipt.ownChange.pass&&![H-500,H].every(t=>arm.entries.some(e=>e.frame.tick===t)))fail("Own-change receipt requires exact saved endpoints.");return receipt.ownChange.pass&&receipt.seasonalChanges.some((x,i)=>x.pass&&arm.data.seasonalGate.blocks[i].pass);}
async function loadReceipt(decision,arm){if(decision.visualReceiptUrl===null&&decision.visualReceiptSha256===null)return null;const{value:r,bytes}=await readJSON(decision.visualReceiptUrl);const H=arm.data.run.gateHorizon;if(!digest(decision.visualReceiptSha256)||await sha(bytes)!==decision.visualReceiptSha256||r.seed!==1202||r.planSha256!==PLAN_SHA256||r.artifactSha256!==decision.artifactSha256||r.visualReviewedBeforeOverlapDiagnostics!==true||typeof r.reviewedAtUTC!=="string")fail("Final visual receipt binding is invalid.");const observation=x=>typeof x==="string"&&x.trim()&&/not blind/i.test(x);if(!exact(r.ownChange,["from","to","pass","observation"])||r.ownChange.from!==H-500||r.ownChange.to!==H||typeof r.ownChange.pass!=="boolean"||!observation(r.ownChange.observation)||!Array.isArray(r.seasonalChanges)||r.seasonalChanges.length!==3||r.seasonalChanges.some((x,i)=>!exact(x,["from","to","pass","observation"])||x.from!==H-1500+i*500||x.to!==H-1000+i*500||typeof x.pass!=="boolean"||!observation(x.observation)))fail("Visual receipt lacks all exact not-blind interval observations.");return r;}
function stop(){playing=false;clearInterval(timer);timer=0;byId('play').textContent='Play';byId('play').setAttribute('aria-label','Play saved replay');byId('run-state').textContent='Paused · saved replay';}
function draw(role,arm,target){const e=[...arm.entries].reverse().find(x=>x.frame.tick<=target)??arm.entries[0],c=canvas[role],g=ctx[role],u=c.width/WORLD;g.fillStyle='#09151a';g.fillRect(0,0,c.width,c.height);if(!bodyOnly)for(let t=0;t<CELLS;t++){const n=e.food.values[t];if(n){g.fillStyle=`rgba(175,229,187,${.035+n/40*.28})`;g.fillRect(t%WORLD*u,Math.floor(t/WORLD)*u,u,u);}}
 for(const[t,id]of e.frame.cells){g.fillStyle=bodyOnly?'#e4ece8':`hsl(${[154,37,249][e.organisms.get(id).family]} 67% 75%)`;g.fillRect(t%WORLD*u+.15,Math.floor(t/WORLD)*u+.15,u-.3,u-.3);}
 if(!bodyOnly)for(let b=0;b<2;b++){g.strokeStyle=b===e.sample.environment.activeBand?'#f2c978':'#657c82';g.lineWidth=b===e.sample.environment.activeBand?3:1.5;g.strokeRect(BANDS[b][0]*u+2,2,24*u-4,c.height-4);}
 byId(`${role}-frame-label`).textContent=`Tick ${fmt(e.frame.tick)}${e.frame.tick<target?' · actual terminal held':''}`;const n=e.sample.census,env=e.sample.environment;
 for(const[key,value]of Object.entries({population:fmt(n.population),families:n.familyCounts.map(fmt).join(' / '),cells:fmt(n.cells),programs:fmt(n.genomeVariantCount),bands:e.bands.map(fmt).join(' / '),food:fmt(e.food.total),ledger:[env.offered,env.accepted,env.overflow].map(fmt).join(' / '),'active-band':`Band ${env.activeBand} · majority 672 / minority 96`}))byId(`${role}-${key}`).textContent=value;
 c.setAttribute('aria-label',`${role==='baseline'?'Known 768':'New 769'} saved world at tick ${e.frame.tick}, ${n.population} bodies`);
}
function chart(age){const svg=byId('population-chart'),ns='http://www.w3.org/2000/svg';svg.replaceChildren();const add=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,String(v));if(text)el.textContent=text;svg.append(el);};const H=pair.arm.data.run.gateHorizon,x=t=>40+t/H*540,y=n=>210-n/48*180;for(const n of[0,24,48]){add('line',{x1:40,x2:580,y1:y(n),y2:y(n),stroke:'#39515b'});add('text',{x:8,y:y(n)+4,class:'chart-label'},String(n));}for(const t of[0,H/2,H])add('text',{x:x(t),y:238,'text-anchor':'middle',class:'chart-label'},fmt(t));add('line',{x1:x(3000),x2:x(3000),y1:25,y2:215,class:'chart-boundary'});for(const[arm,color]of[[pair.baseline,'#b9a3ed'],[pair.arm,'#9fe4c4']]){const rows=[{tick:0,population:12},...arm.data.tickRows.filter(r=>r.tick<=H)];add('path',{d:rows.map((r,i)=>`${i?'L':'M'}${x(r.tick).toFixed(2)},${y(r.population).toFixed(2)}`).join(' '),fill:'none',stroke:color,'stroke-width':1.5});}add('line',{x1:x(age),x2:x(age),y1:25,y2:215,stroke:'#f3d59b'});}
function render(){if(!pair)return;const age=ages[indexAt];draw('alternating',pair.arm,age);draw('baseline',pair.baseline,age);chart(age);byId('phase-label').textContent=age<=3000?'New-rule observations · before continuation gate':'New-rule observations · continuation earned at 3,000';if(age>pair.arm.data.run.finalTick)byId('phase-label').textContent+=` · actual terminal held at ${fmt(pair.arm.data.run.finalTick)}`;byId('scrub').value=String(indexAt);byId('scrub-value').textContent=`${fmt(age)} · ${indexAt+1}/${ages.length}`;byId('previous').disabled=indexAt===0;byId('next').disabled=indexAt===ages.length-1;for(const b of document.querySelectorAll('[data-jump-tick]'))b.disabled=!ages.includes(Number(b.dataset.jumpTick));if(indexAt===ages.length-1)stop();}
function tableRow(values){const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}return tr;}
function renderSummary(receipt){const d=pair.arm.data,c=d.final.census,decision=pair.index.decision;byId('outcome-title').textContent=`Seed 1202 · ${decision.status==='pending'?'awaiting parent review':decision.status}`;byId('outcome-summary').textContent=`At actual tick ${fmt(d.run.finalTick)}, the new 769 schedule has ${c.population} bodies, families ${c.familyCounts.join(' / ')}, and ${c.genomeVariantCount} programs. All new-rule ticks are novel observations. ${d.run.gateHorizon===3000?'The 6,000-tick continuation has not been earned.':'The 3,000-tick gate was accepted before continuation.'}`;byId('decision-status').textContent=decision.status;byId('decision-summary').textContent=decision.summary;byId('gate-title').textContent=`Frozen gates at ${fmt(d.run.gateHorizon)}`;for(const[id,pass]of[['activity-gate',d.numericalGate.numericalPass],['spatial-gate',d.spatialGate.pass],['seasonal-gate',d.seasonalGate.pass]])byId(id).textContent=pass?'Pass':'Did not pass';byId('visual-gate').textContent=receipt?(manualPass(receipt,pair.arm)?'Pass':'Did not pass'):'Pending parent review';byId('recovery-rows').replaceChildren(...d.recoverySummary.windows.map(w=>tableRow([`${fmt(w.from)}–${fmt(w.to)}`,`${w.status} · ${w.executedTicks}/500`,`${fmt(w.minPopulation)} / ${w.meanPopulation===null?'—':w.meanPopulation.toFixed(2)} / ${fmt(w.maxPopulation)} / ${fmt(w.endpoint?.population)}`,w.endpoint?.familyCounts?.join(' / ')??'Not observed',[w.births,w.deaths,w.cap48Ticks].map(fmt).join(' / '),w.endpoint?.occupiedTilesByBand?.join(' / ')??'Not observed',w.food?[w.food.offered,w.food.accepted,w.food.overflow].map(fmt).join(' / '):'Not observed'])));byId('seasonal-rows').replaceChildren(...d.seasonalGate.blocks.map(b=>tableRow([`${fmt(b.from)}–${fmt(b.to)}`,`Band ${b.fedBand}`,b.deltasByBand.map(x=>x===null?'Not observed':`${x>0?'+':''}${fmt(x)}`).join(' / '),b.pass?'Pass':'Did not pass'])));byId('visual-observations').replaceChildren(...(receipt?[...receipt.seasonalChanges.map(x=>`${fmt(x.from)}–${fmt(x.to)}: ${x.observation}`),`${fmt(receipt.ownChange.from)}–${fmt(receipt.ownChange.to)} own change: ${receipt.ownChange.observation}`]:['Pending body-only review; no manual pass assumed.']).map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));}
async function load(){try{const baseline=await loadHistorical(),response=await fetch(new URL(INDEX_NAME,BASE));if(response.status===404){byId('empty-state').hidden=false;setStatus('Known reference verified; no new outcome listed.','ready');return;}if(!response.ok)fail('Manifest could not be loaded.');const bytes=await response.arrayBuffer();if(bytes.byteLength>1024*1024)fail('Manifest too large');const index=JSON.parse(new TextDecoder().decode(bytes));Object.defineProperty(index,'url',{value:new URL(INDEX_NAME,BASE),enumerable:false});if(index.kind!=='hungry-shapes-food-schedule-769-manifest'||index.schemaVersion!==1||index.seed!==1202||index.planSha256!==PLAN_SHA256||index.historical?.url!==HIST_NAME||index.historical.rawSha256!==HIST_RAW||index.historical.dataSha256!==HIST_DATA)fail('Manifest identity/reference differs.');const arm=await loadArm(index.arm,'new769',index),decision=index.decision;if(!exact(decision,['status','summary','artifactSha256','visualReceiptUrl','visualReceiptSha256'])||!['pending','promising','stop'].includes(decision.status)||typeof decision.summary!=='string'||!decision.summary.trim()||decision.artifactSha256!==index.arm.rawSha256)fail('Decision binding malformed.');if(arm.data.stage==='gate3000'&&decision.status!=='pending'||decision.status==='promising'&&(arm.data.stage!=='final'||arm.data.run.gateHorizon!==6000||arm.data.run.finalTick!==6000))fail('Promising requires a completed earned 6,000-tick outcome; intermediate gate is pending only');const receipt=await loadReceipt(decision,arm);if(!receipt&&decision.status!=='pending')fail('Final decision lacks receipt');const pass=arm.data.numericalGate.numericalPass&&arm.data.spatialGate.pass&&arm.data.seasonalGate.pass&&manualPass(receipt,arm);if(receipt&&decision.status!==((pass&&arm.data.run.gateHorizon===6000)?'promising':'stop'))fail('Decision disagrees with frozen gates');pair={index,arm,baseline,receipt};ages=[...new Set([...Array.from({length:arm.data.run.gateHorizon/20+1},(_,i)=>i*20),...arm.entries.map(e=>e.frame.tick)])].sort((a,b)=>a-b);byId('replay').hidden=false;for(const id of['previous','play','next','scrub'])byId(id).disabled=false;byId('scrub').max=String(ages.length-1);renderSummary(receipt);render();setStatus('Known reference, new saved states, ledgers, lineage, gates and source bindings verified.','ready');}catch(error){stop();pair=null;byId('replay').hidden=true;byId('empty-state').hidden=true;byId('error-state').hidden=false;byId('error-detail').textContent=error instanceof Error?error.message:String(error);setStatus('Evidence verification failed. No replay shown.','error');}}
function move(i){indexAt=Math.max(0,Math.min(ages.length-1,i));render();}
byId('previous').addEventListener('click',()=>{stop();move(indexAt-1);});byId('next').addEventListener('click',()=>{stop();move(indexAt+1);});byId('scrub').addEventListener('input',e=>{stop();move(Number(e.target.value));});for(const b of document.querySelectorAll('[data-jump-tick]'))b.addEventListener('click',()=>{stop();move(ages.indexOf(Number(b.dataset.jumpTick)));});byId('play').addEventListener('click',()=>{if(!pair)return;if(playing){stop();return;}if(indexAt===ages.length-1)move(0);playing=true;byId('play').textContent='Pause';byId('play').setAttribute('aria-label','Pause saved replay');byId('run-state').textContent='Playing · saved frames';timer=setInterval(()=>move(indexAt+1),100);});document.addEventListener('keydown',e=>{if(!pair||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();stop();move(indexAt+(e.key==='ArrowLeft'?-1:1));}});load();
async function validateGateBinding(data,index){
 if(!['gate3000','final'].includes(data.stage))fail('Unknown observation stage');
 if(data.stage==='gate3000'){if(data.gate3000!==null||data.run.gateHorizon!==3000||data.run.finalTick!==3000)fail('Intermediate gate identity mismatch');return;}
 if(data.run.extinctionTick!==null&&data.run.finalTick<=3000){if(data.gate3000!==null||data.run.gateHorizon!==3000)fail('Early terminal fabricated a gate');return;}
 const b=data.gate3000;if(!exact(b,['status','artifactSha256','receiptSha256','receiptCommit'])||!digest(b.artifactSha256))fail('Gate evidence binding missing');
 const name='food-schedule-769-gate-3000-seed-1202.json',loaded=await readJSON(name,24*1024*1024);if(await sha(loaded.bytes)!==b.artifactSha256)fail('Gate artifact changed');
 const gate=(await loadArm({kind:'hungry-shapes-food-schedule-769-arm',mode:'schedule-769',url:name,rawSha256:b.artifactSha256,dataSha256:loaded.value.dataSha256},'gate3000',index)).data;
 if(gate.stage!=='gate3000'||JSON.stringify(gate.provenance)!==JSON.stringify(data.provenance))fail('Gate provenance differs from final');for(const k of['samples','frames','snapshots','tickRows'])if(JSON.stringify(data[k].filter(x=>x.tick<=3000))!==JSON.stringify(gate[k]))fail('Observed gate history changed across pause');
 const numeric=gate.numericalGate.numericalPass&&gate.spatialGate.pass&&gate.seasonalGate.pass;
 if(b.status==='numerical-stop'){if(numeric||b.receiptSha256!==null||b.receiptCommit!==null||data.run.gateHorizon!==3000||data.run.finalTick!==3000)fail('Numerical Stop binding contradicts gate');return;}
 if(!['passed','manual-stop'].includes(b.status)||!digest(b.receiptSha256)||!String(b.receiptCommit).match(/^[a-f0-9]{40}$/))fail('Continuation authorization missing');
 const{value:r,bytes}=await readJSON('food-schedule-769-gate-3000-visual-receipt-1202.json');
 if(await sha(bytes)!==b.receiptSha256||!exact(r,['schemaVersion','kind','seed','runId','intentSha256','gateArtifactSha256','planSha256','sourceSha256','ages','numericalGate','spatialGate','seasonalGate','manual','decision'])||r.schemaVersion!==1||r.kind!=='hungry-shapes-food-schedule-769-gate-receipt'||r.seed!==1202||r.runId!==gate.provenance.runId||r.intentSha256!==gate.provenance.intentSha256||r.gateArtifactSha256!==b.artifactSha256||r.planSha256!==PLAN_SHA256||JSON.stringify(r.sourceSha256)!==JSON.stringify(gate.provenance.sourceSha256)||JSON.stringify(r.ages)!=='[1500,2000,2500,3000]')fail('Gate receipt is not bound to these observations');
 for(const k of['numericalGate','spatialGate','seasonalGate'])if(JSON.stringify(r[k])!==JSON.stringify(gate[k]))fail('Gate receipt alters numeric findings');
 const m=r.manual;if(!exact(m,['notBlind','blocks','ownChange','pass'])||m.notBlind!==true||!Array.isArray(m.blocks)||m.blocks.length!==3)fail('Gate manual observations missing');
 for(let i=0;i<3;i++){const x=m.blocks[i],e=gate.seasonalGate.blocks[i];if(!exact(x,['from','to','fedBand','numericalPass','visualPass','observation'])||x.from!==e.from||x.to!==e.to||x.fedBand!==e.fedBand||x.numericalPass!==e.pass||typeof x.visualPass!=='boolean'||typeof x.observation!=='string'||x.observation.trim().length<20)fail('Gate manual interval invalid');}
 const o=m.ownChange;if(!exact(o,['from','to','pass','observation'])||o.from!==2500||o.to!==3000||typeof o.pass!=='boolean'||typeof o.observation!=='string'||o.observation.trim().length<20)fail('Gate own-change observation invalid');
 const pass=o.pass&&m.blocks.some(x=>x.numericalPass&&x.visualPass);if(m.pass!==pass||r.decision!==(numeric&&pass?'continue':'stop')||(b.status==='passed'?(r.decision!=='continue'||data.run.gateHorizon!==6000):(r.decision!=='stop'||data.run.gateHorizon!==3000||data.run.finalTick!==3000)))fail('Continuation did not earn the later horizon');
}
