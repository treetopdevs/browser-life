const INDEX_URL = new URL("./moving-food-index.json", import.meta.url);
const WORLD_WIDTH = 96;
const WORLD_CELLS = WORLD_WIDTH * WORLD_WIDTH;
const BAND_WIDTH = 48;
const FAMILY_HUES = [154, 37, 249];
const MAX_ARM_BYTES = 24 * 1024 * 1024;
const fmt = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "—";
const byId = (id) => document.getElementById(id);

const sourceStatus = byId("source-status");
const emptyState = byId("empty-state");
const errorState = byId("error-state");
const replay = byId("replay");
const canvases = {
  uniform: byId("uniform-world"),
  movingBand: byId("moving-world"),
};
const contexts = {
  uniform: canvases.uniform.getContext("2d"),
  movingBand: canvases.movingBand.getContext("2d"),
};
const previousButton = byId("previous");
const playButton = byId("play");
const nextButton = byId("next");
const scrub = byId("scrub");
const scrubValue = byId("scrub-value");
const runState = byId("run-state");

let pair = null;
let timelineTicks = [];
let currentIndex = 0;
let playbackTimer = 0;
let playing = false;
let loadGeneration = 0;

function status(message, kind = "") {
  sourceStatus.textContent = message;
  sourceStatus.dataset.kind = kind;
}

function stopPlayback() {
  playing = false;
  if (playbackTimer) window.clearInterval(playbackTimer);
  playbackTimer = 0;
  playButton.textContent = "Play both";
  playButton.setAttribute("aria-label", "Play paired sampled replay");
  if (pair) runState.textContent = "Paused · recorded replay";
}

function showError(message) {
  stopPlayback();
  pair = null;
  replay.hidden = true;
  emptyState.hidden = true;
  errorState.hidden = false;
  byId("error-detail").textContent = message;
  status("The listed pair could not be loaded.", "error");
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify SHA-256 here, so the paired evidence was not displayed.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const sha256Text = (text) => sha256Hex(new TextEncoder().encode(text));

function decodeFood(base64, tick) {
  if (typeof base64 !== "string") throw new Error(`Frame ${tick} is missing its recorded food bytes.`);
  let binary;
  try { binary = atob(base64); } catch { throw new Error(`Frame ${tick} food is not valid base64 data.`); }
  if (binary.length !== WORLD_CELLS) throw new Error(`Frame ${tick} food does not contain all 96 × 96 world tiles.`);
  const food = new Uint8Array(WORLD_CELLS);
  for (let i = 0; i < binary.length; i++) {
    const amount = binary.charCodeAt(i);
    if (amount > 40) throw new Error(`Frame ${tick} food has a value outside the recorded 0–40 range.`);
    food[i] = amount;
  }
  return food;
}

function validateEnvironment(environment, mode, tick) {
  if (!environment || environment.mode !== mode || environment.pulseBudget !== 768 ||
      !Number.isSafeInteger(environment.targetCount) || environment.targetCount !== (mode === "moving-band" ? 4608 : 9216) ||
      !Number.isSafeInteger(environment.pulses) || environment.pulses !== Math.floor(tick / 5) ||
      !Number.isSafeInteger(environment.offered) || !Number.isSafeInteger(environment.accepted) ||
      !Number.isSafeInteger(environment.overflow) || environment.offered !== environment.accepted + environment.overflow ||
      environment.offered !== environment.pulses * 768 || environment.initialFoodPerTile !== 20) {
    throw new Error(`The ${mode} food ledger at tick ${tick} is missing or inconsistent.`);
  }
  if (mode === "moving-band") {
    if (environment.bandLeft !== Math.floor(tick / 50) % WORLD_WIDTH || environment.bandWidth !== BAND_WIDTH) {
      throw new Error(`The replenishment band geometry at tick ${tick} does not match the frozen rule.`);
    }
  } else if ("bandLeft" in environment || "bandWidth" in environment) {
    throw new Error(`The uniform baseline environment at tick ${tick} contains moving-band fields.`);
  }
}

function validateCensus(census, tick, organismById, occupied) {
  if (!census || census.tick !== tick || !Number.isSafeInteger(census.population) || census.population < 0 || census.population > 48 ||
      !Number.isSafeInteger(census.cells) || census.cells !== occupied.size || census.population !== organismById.size ||
      !Array.isArray(census.familyCounts) || census.familyCounts.length !== 3 ||
      census.familyCounts.reduce((total, count) => total + count, 0) !== census.population ||
      census.familyCounts.some((count, family) => !Number.isSafeInteger(count) || count !== [...organismById.values()].filter((organism) => organism.family === family).length)) {
    throw new Error(`Frame ${tick} does not agree with its recorded population, cells, and family counts.`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is missing a SHA-256 digest.`);
}

async function validateArm(data, expectedMode) {
  if (!data || data.schemaVersion !== 1 || data.kind !== "hungry-shapes-moving-food-arm") {
    throw new Error(`The ${expectedMode} source is not a supported moving-food arm record.`);
  }
  assertDigest(data.dataSha256, `${expectedMode} internal evidence`);
  const canonical = { ...data };
  delete canonical.dataSha256;
  if (await sha256Text(JSON.stringify(canonical)) !== data.dataSha256) {
    throw new Error(`The ${expectedMode} internal evidence SHA-256 does not match its contents.`);
  }
  const run = data.run;
  if (!run || run.seed !== 1201 || run.mode !== expectedMode || run.mutation !== true || run.maxTick !== 3000 ||
      !Number.isSafeInteger(run.finalTick) || run.finalTick < 0 || run.finalTick > 3000 ||
      !(run.extinctionTick === null || Number.isSafeInteger(run.extinctionTick) && run.extinctionTick >= 1 && run.extinctionTick === run.finalTick)) {
    throw new Error(`The ${expectedMode} arm does not match seed 1201, its food mode, mutation setting, or 3,000-tick cap.`);
  }
  if (run.extinctionTick === null && run.finalTick !== 3000) {
    throw new Error(`A living ${expectedMode} recording must include the full 3,000-tick horizon.`);
  }
  if (run.extinctionTick !== null && run.finalTick !== run.extinctionTick) {
    throw new Error(`The ${expectedMode} arm terminal tick does not match its actual extinction tick.`);
  }
  if (data.rules?.width !== WORLD_WIDTH || data.rules?.height !== WORLD_WIDTH || data.rules?.tileCount !== WORLD_CELLS || data.rules?.maxHistory !== 451) {
    throw new Error(`The ${expectedMode} arm does not use the frozen 96 × 96 world and 451-sample history.`);
  }
  if (data.runtime?.node !== "24.2.0" || data.runtime?.platform !== "darwin" || data.runtime?.arch !== "arm64") {
    throw new Error(`The ${expectedMode} arm was not recorded with the frozen Node 24.2.0 darwin/arm64 runtime.`);
  }
  const sourceHashes = data.provenance?.sourceSha256;
  if (!sourceHashes || typeof sourceHashes !== "object") throw new Error(`The ${expectedMode} arm is missing source identities.`);
  for (const [path, digest] of Object.entries(sourceHashes)) assertDigest(digest, `${expectedMode} source ${path}`);
  if (!sourceHashes["apps/lab/src/moving-food/model.ts"] || !sourceHashes["tools/moving-food/explore.ts"] ||
      !sourceHashes["apps/lab/src/uniform-endurance/model.ts"] || !sourceHashes["tools/uniform-endurance/explore.ts"]) {
    throw new Error(`The ${expectedMode} arm is missing a moving-rule, runner, or pinned-baseline source hash.`);
  }
  if (!/^[a-f0-9]{64}$/.test(data.provenance?.baselineArtifactSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(data.provenance?.baselineDataSha256 ?? "")) {
    throw new Error(`The ${expectedMode} arm is missing its pinned uniform-baseline identity.`);
  }
  if (expectedMode === "uniform") {
    const proof = data.provenance?.prefix;
    if (!proof || proof.status !== "verified" || proof.seed !== 1201 || proof.comparedSamples !== 151 ||
        proof.normalization !== "none; maxHistory 451 is unchanged" || proof.comparedFrames !== 151 ||
        proof.comparedTickRows !== 3000 || proof.comparedSnapshots !== 1 || !Array.isArray(proof.checkpoints) ||
        proof.checkpoints.length !== 1 || proof.checkpoints[0].tick !== 0 || proof.checkpoints[0].compared !== true ||
        !/^[a-f0-9]{64}$/.test(proof.checkpoints[0].stateSha256 ?? "")) {
      throw new Error("The uniform arm does not carry the complete pinned 0–3,000 baseline comparison proof.");
    }
  } else {
    const proof = data.provenance?.prefix;
    if (!proof || proof.status !== "not-applicable" || proof.seed !== null ||
        proof.normalization !== "none; moving-band is not the uniform control" || proof.comparedSamples !== 0 ||
        proof.comparedFrames !== 0 || proof.comparedTickRows !== 0 || proof.comparedSnapshots !== 0 ||
        !Array.isArray(proof.checkpoints) || proof.checkpoints.length !== 0) {
      throw new Error("The moving-band arm must explicitly mark the uniform prefix comparison as not applicable.");
    }
  }
  const frames = data.frames;
  const samples = data.samples;
  if (!Array.isArray(frames) || !Array.isArray(samples) || frames.length === 0 || frames.length !== samples.length) {
    throw new Error(`The ${expectedMode} arm is missing aligned saved frames and samples.`);
  }
  const expectedTicks = [0];
  for (let tick = 20; tick <= run.finalTick; tick += 20) expectedTicks.push(tick);
  if (expectedTicks.at(-1) !== run.finalTick) expectedTicks.push(run.finalTick);
  if (frames.map((frame) => frame.tick).join(",") !== expectedTicks.join(",") ||
      samples.some((sample, index) => sample.tick !== frames[index]?.tick)) {
    throw new Error(`The ${expectedMode} arm is missing a 20-tick sample, exact terminal frame, or aligned census row.`);
  }
  const rows = data.tickRows;
  if (!Array.isArray(rows) || rows.length !== run.finalTick) {
    throw new Error(`The ${expectedMode} per-tick history does not cover its full actual tick range.`);
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const tick = i + 1;
    if (!row || row.tick !== tick || !Number.isSafeInteger(row.population) || row.population < 0 || row.population > 48 ||
        !Number.isSafeInteger(row.births) || row.births < 0 || !Number.isSafeInteger(row.deaths) || row.deaths < 0 ||
        row.cap48 !== (row.population === 48) || row.nearCap47 !== (row.population >= 47) ||
        ((row.population === 0) !== (tick === run.extinctionTick))) {
      throw new Error(`${expectedMode} per-tick row ${tick} is missing, contradictory, or disagrees with actual extinction.`);
    }
  }
  const entries = [];
  let previousTick = -1;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const sample = samples[i];
    if (!Number.isSafeInteger(frame.tick) || frame.tick <= previousTick || frame.tick > run.finalTick ||
        (frame.tick % 20 !== 0 && frame.tick !== run.finalTick)) {
      throw new Error(`${expectedMode} replay frames are out of order or outside the recorded 20-tick cadence.`);
    }
    previousTick = frame.tick;
    const food = decodeFood(frame.foodBase64, frame.tick);
    if (!Array.isArray(frame.cells) || !Array.isArray(frame.organisms)) throw new Error(`${expectedMode} frame ${frame.tick} is missing body records.`);
    const organismById = new Map();
    for (const organism of frame.organisms) {
      if (!Number.isSafeInteger(organism.id) || organism.id < 1 || !Number.isInteger(organism.family) || organism.family < 0 || organism.family > 2 || !organism.genome) {
        throw new Error(`${expectedMode} frame ${frame.tick} has an invalid organism or founder family.`);
      }
      if (organismById.has(organism.id)) throw new Error(`${expectedMode} frame ${frame.tick} repeats a body identifier.`);
      organismById.set(organism.id, organism);
    }
    const occupied = new Set();
    for (const cell of frame.cells) {
      if (!Array.isArray(cell) || cell.length !== 2 || !Number.isSafeInteger(cell[0]) || cell[0] < 0 || cell[0] >= WORLD_CELLS ||
          !organismById.has(cell[1]) || occupied.has(cell[0])) {
        throw new Error(`${expectedMode} frame ${frame.tick} has an invalid or duplicate occupied tile.`);
      }
      occupied.add(cell[0]);
    }
    validateCensus(sample.census, frame.tick, organismById, occupied);
    validateEnvironment(sample.environment, expectedMode, frame.tick);
    assertDigest(frame.frameSha256, `${expectedMode} frame ${frame.tick}`);
    assertDigest(frame.censusSha256, `${expectedMode} census ${frame.tick}`);
    assertDigest(frame.stateSha256, `${expectedMode} state ${frame.tick}`);
    if (sample.frameSha256 !== frame.frameSha256 || sample.censusSha256 !== frame.censusSha256 || sample.stateSha256 !== frame.stateSha256 ||
        await sha256Text(JSON.stringify(sample.census)) !== sample.censusSha256) {
      throw new Error(`${expectedMode} frame ${frame.tick} does not match its saved sample digests.`);
    }
    const frameBase = { ...frame };
    delete frameBase.frameSha256;
    if (await sha256Text(JSON.stringify(frameBase)) !== frame.frameSha256) {
      throw new Error(`${expectedMode} frame ${frame.tick} SHA-256 does not match its saved contents.`);
    }
    if (sample.census.population === 0 && frame.tick !== run.finalTick) {
      throw new Error(`${expectedMode} population reached zero before its declared actual terminal tick.`);
    }
    entries.push({ frame, sample, food, organismById });
  }
  const terminalPopulation = samples.at(-1)?.census?.population;
  if ((run.extinctionTick === null && (!Number.isSafeInteger(terminalPopulation) || terminalPopulation < 1)) ||
      (run.extinctionTick !== null && terminalPopulation !== 0)) {
    throw new Error(`${expectedMode} final population does not agree with its live or extinct terminal state.`);
  }
  const expectedWindowStarts = [1501, 2001, 2501];
  if (!Array.isArray(data.windows) || data.windows.length !== 3 || data.windows.some((window, i) =>
      window.from !== expectedWindowStarts[i] || window.to !== expectedWindowStarts[i] + 499 || window.denominatorTicks !== 500 ||
      !["complete", "partial", "not-reached"].includes(window.status))) {
    throw new Error(`${expectedMode} arm is missing its three frozen late windows.`);
  }
  for (const window of data.windows) {
    if (!Number.isSafeInteger(window.executedTicks) || window.executedTicks < 0 || window.executedTicks > 500 ||
        (window.status === "complete" && window.executedTicks !== 500) ||
        (window.status === "not-reached" && window.executedTicks !== 0) ||
        (window.status === "partial" && (window.executedTicks < 1 || window.executedTicks >= 500)) ||
        window.executedTicks !== Math.max(0, Math.min(window.to, run.finalTick) - window.from + 1)) {
      throw new Error(`${expectedMode} window ${window.from}–${window.to} has an invalid executed-tick count.`);
    }
    if (window.status === "not-reached") {
      if (!window.endpoint || !window.food || window.food.offered !== null || window.food.accepted !== null || window.food.overflow !== null ||
          window.endpoint.actualTick !== null || window.endpoint.population !== null || window.endpoint.cells !== null ||
          window.endpoint.familyCounts !== null || window.endpoint.maxGeneration !== null || window.endpoint.maxEverGeneration !== null || window.endpoint.foodRemaining !== null ||
          window.endpoint.bandLeft !== null || window.endpoint.occupiedBandCells !== null || window.endpoint.occupiedBandShare !== null ||
          window.minPopulation !== null || window.maxPopulation !== null || window.births !== null || window.deaths !== null) {
        throw new Error(`${expectedMode} window ${window.from}–${window.to} invents metrics for an unobserved interval.`);
      }
      continue;
    }
    if (!window.endpoint || !Array.isArray(window.endpoint.familyCounts) || !Array.isArray(window.endpoint.genomeCounts) ||
        !Number.isSafeInteger(window.endpoint.actualTick) || window.endpoint.actualTick < window.from - 1 || window.endpoint.actualTick > window.to ||
        !Number.isSafeInteger(window.endpoint.maxGeneration) || !Number.isSafeInteger(window.endpoint.maxEverGeneration) ||
        !Number.isSafeInteger(window.births) || window.births < 0 || !Number.isSafeInteger(window.deaths) || window.deaths < 0 ||
        !Number.isSafeInteger(window.cap48Ticks) || window.cap48Ticks < 0 || !Number.isSafeInteger(window.nearCap47Ticks) || window.nearCap47Ticks < 0 ||
        !Number.isSafeInteger(window.blockedCapAttempts) || !Number.isSafeInteger(window.blockedSpaceAttempts) ||
        !window.food || ![window.food.offered, window.food.accepted, window.food.overflow].every((value) => Number.isSafeInteger(value) && value >= 0) ||
        window.food.offered < 0 || window.food.accepted < 0 || window.food.overflow < 0 ||
        window.food.offered !== window.food.accepted + window.food.overflow ||
        !Number.isSafeInteger(window.endpoint.occupiedBandCells) || window.endpoint.occupiedBandCells < 0 ||
        !(window.endpoint.occupiedBandShare === null && window.endpoint.cells === 0 ||
          typeof window.endpoint.occupiedBandShare === "number" && window.endpoint.occupiedBandShare >= 0 && window.endpoint.occupiedBandShare <= 1)) {
      throw new Error(`${expectedMode} window ${window.from}–${window.to} is missing valid endpoint or food accounting.`);
    }
    const endEntry = entries.find((entry) => entry.frame.tick === window.endpoint.actualTick);
    const startEntry = entries.find((entry) => entry.frame.tick === window.from - 1);
    if (!endEntry || !startEntry || window.endpoint.actualTick !== Math.min(window.to, run.finalTick) ||
        window.endpoint.requestedTick !== window.to ||
        window.endpoint.population !== endEntry.sample.census.population || window.endpoint.cells !== endEntry.sample.census.cells ||
        JSON.stringify(window.endpoint.familyCounts) !== JSON.stringify(endEntry.sample.census.familyCounts) ||
        window.endpoint.maxGeneration !== endEntry.sample.census.maxGeneration ||
        window.endpoint.foodRemaining !== endEntry.food.reduce((sum, amount) => sum + amount, 0) ||
        window.food.offered !== endEntry.sample.environment.offered - startEntry.sample.environment.offered ||
        window.food.accepted !== endEntry.sample.environment.accepted - startEntry.sample.environment.accepted ||
        window.food.overflow !== endEntry.sample.environment.overflow - startEntry.sample.environment.overflow) {
      throw new Error(`${expectedMode} window ${window.from}–${window.to} endpoint or food totals do not match saved observations.`);
    }
    const maxEverGeneration = Math.max(0, ...data.final.lineage.filter((node) => node.birthTick <= window.endpoint.actualTick).map((node) => node.generation));
    if (window.endpoint.maxEverGeneration !== maxEverGeneration) {
      throw new Error(`${expectedMode} window ${window.from}–${window.to} max-ever generation does not match saved lineage.`);
    }
    const observedRows = rows.filter((row) => row.tick >= window.from && row.tick <= window.to);
    const sum = (field) => observedRows.reduce((total, row) => total + row[field], 0);
    if (window.births !== sum("births") || window.deaths !== sum("deaths") ||
        window.cap48Ticks !== observedRows.filter((row) => row.cap48).length ||
        window.nearCap47Ticks !== observedRows.filter((row) => row.nearCap47).length ||
        window.blockedCapAttempts !== sum("blockedCap") || window.blockedSpaceAttempts !== sum("blockedSpace") ||
        window.minPopulation !== Math.min(...observedRows.map((row) => row.population)) ||
        window.maxPopulation !== Math.max(...observedRows.map((row) => row.population))) {
      throw new Error(`${expectedMode} window ${window.from}–${window.to} turnover or population range disagrees with per-tick evidence.`);
    }
    const expectedBandLeft = Math.floor(window.endpoint.actualTick / 50) % WORLD_WIDTH;
    const occupiedBandCells = endEntry.frame.cells.filter(([tile]) => {
      const x = tile % WORLD_WIDTH;
      return (x - expectedBandLeft + WORLD_WIDTH) % WORLD_WIDTH < BAND_WIDTH;
    }).length;
    const occupiedBandShare = endEntry.sample.census.cells ? occupiedBandCells / endEntry.sample.census.cells : null;
    const genomeCounts = new Map();
    for (const organism of endEntry.frame.organisms) {
      const key = JSON.stringify(organism.genome);
      genomeCounts.set(key, (genomeCounts.get(key) ?? 0) + 1);
    }
    const recordedGenomeCounts = new Map(window.endpoint.genomeCounts.map((entry) => [JSON.stringify(entry.genome), entry.count]));
    if (window.endpoint.bandLeft !== expectedBandLeft || window.endpoint.occupiedBandCells !== occupiedBandCells ||
        window.endpoint.occupiedBandShare !== occupiedBandShare || recordedGenomeCounts.size !== genomeCounts.size ||
        [...genomeCounts].some(([genome, count]) => recordedGenomeCounts.get(genome) !== count)) {
      throw new Error(`${expectedMode} window ${window.from}–${window.to} band occupancy does not match its saved endpoint.`);
    }
  }
  const expectedSnapshots = [0, 500, 1500, 2500, 3000, run.finalTick].filter((tick, index, ticks) => tick <= run.finalTick && ticks.indexOf(tick) === index);
  if (!Array.isArray(data.snapshots) || expectedSnapshots.some((tick) => !data.snapshots.some((snapshot) => snapshot.tick === tick)) ||
      data.snapshots.some((snapshot) => !Number.isSafeInteger(snapshot.tick) || typeof snapshot.terminal !== "boolean" ||
        !snapshot.environment || !snapshot.state || !/^[a-f0-9]{64}$/.test(snapshot.stateSha256 ?? ""))) {
    throw new Error(`${expectedMode} arm is missing a required actual-tick checkpoint snapshot.`);
  }
  if (data.snapshots.some((snapshot) => snapshot.terminal !== (run.extinctionTick !== null && snapshot.tick === run.extinctionTick))) {
    throw new Error(`${expectedMode} snapshots do not label the actual terminal state correctly.`);
  }
  for (const snapshot of data.snapshots) {
    const sample = samples.find((entry) => entry.tick === snapshot.tick);
    if (!sample || sample.stateSha256 !== snapshot.stateSha256 ||
        JSON.stringify(sample.environment) !== JSON.stringify(snapshot.environment) ||
        await sha256Text(JSON.stringify({ state: snapshot.state, environment: snapshot.environment })) !== snapshot.stateSha256) {
      throw new Error(`${expectedMode} checkpoint snapshot at tick ${snapshot.tick} does not match its state and saved sample.`);
    }
  }
  if (expectedMode === "uniform") {
    const checkpoint = data.provenance.prefix.checkpoints[0];
    if (checkpoint.stateSha256 !== data.samples[0].stateSha256 || data.snapshots.find((snapshot) => snapshot.tick === 0)?.stateSha256 !== checkpoint.stateSha256) {
      throw new Error("The uniform tick-0 checkpoint does not match its compared sample and snapshot hashes.");
    }
  }
  const repeat = data.repeat;
  if (!repeat || repeat.verified !== true || repeat.comparedThroughTick !== run.finalTick ||
      repeat.stateChecks !== frames.length || repeat.frameChecks !== frames.length) {
    throw new Error(`${expectedMode} independent repeat proof is incomplete or does not cover every saved frame.`);
  }
  if (!data.final || JSON.stringify(data.final.census) !== JSON.stringify(samples.at(-1)?.census) ||
      JSON.stringify(data.final.environment) !== JSON.stringify(samples.at(-1)?.environment) ||
      data.final.stateSha256 !== samples.at(-1)?.stateSha256 || !Array.isArray(data.final.lineage)) {
    throw new Error(`${expectedMode} final summary does not match its actual terminal sample.`);
  }
  if (data.final.lineage.some((node) => !Number.isSafeInteger(node.birthTick) || node.birthTick < 0 || node.birthTick > run.finalTick ||
      !Number.isSafeInteger(node.generation) || node.generation < 0)) {
    throw new Error(`${expectedMode} final lineage has an invalid birth tick or generation.`);
  }
  return { data, frames: entries };
}

function validateIndex(index) {
  if (!index || index.schemaVersion !== 1 || index.kind !== "hungry-shapes-moving-food-pair" || index.seed !== 1201 || !index.arms) {
    throw new Error("The paired manifest is malformed or is not the frozen seed 1201 pair.");
  }
  if ("overall" in index || "overallDecision" in index || Object.keys(index).some((key) => !["schemaVersion", "kind", "seed", "arms", "decision"].includes(key)) ||
      Object.keys(index.arms).some((key) => !["uniform", "movingBand"].includes(key))) {
    throw new Error("The paired manifest contains an unbound decision or unexpected source entry.");
  }
  const arms = [
    ["uniform", index.arms.uniform, "uniform"],
    ["movingBand", index.arms.movingBand, "moving-band"],
  ];
  for (const [label, arm, expectedMode] of arms) {
    if (!arm || arm.mode !== expectedMode || typeof arm.url !== "string" || !arm.url.trim() ||
        !/^[a-f0-9]{64}$/.test(arm.rawSha256 ?? "")) {
      throw new Error(`The paired manifest has a malformed ${expectedMode} source entry.`);
    }
    const resolved = new URL(arm.url, INDEX_URL);
    const docsDirectory = INDEX_URL.pathname.replace(/[^/]*$/, "");
    if (resolved.origin !== INDEX_URL.origin || !resolved.pathname.startsWith(docsDirectory)) {
      throw new Error(`The ${expectedMode} source must stay in the creative-prototypes evidence directory.`);
    }
  }
  if (!index.decision || !["pending", "promising", "stop"].includes(index.decision.status) ||
      typeof index.decision.summary !== "string" ||
      index.decision.uniformArtifactSha256 !== index.arms.uniform.rawSha256 ||
      index.decision.movingBandArtifactSha256 !== index.arms.movingBand.rawSha256) {
    throw new Error("The pair decision is not bound to the listed raw SHA-256 values for both arms.");
  }
}

async function fetchArm(arm, expectedMode, generation) {
  const response = await fetch(new URL(arm.url, INDEX_URL), { headers: { Accept: "application/json" }, cache: "no-store" });
  if (generation !== loadGeneration) return null;
  if (!response.ok) throw new Error(`The listed ${expectedMode} arm answered ${response.status}; no paired replay was shown.`);
  const rawBytes = new Uint8Array(await response.arrayBuffer());
  if (generation !== loadGeneration) return null;
  if (rawBytes.byteLength > MAX_ARM_BYTES) throw new Error(`The listed ${expectedMode} arm exceeds the 24 MiB evidence limit.`);
  if (await sha256Hex(rawBytes) !== arm.rawSha256) throw new Error(`The ${expectedMode} raw-file SHA-256 does not match the pair manifest.`);
  if (generation !== loadGeneration) return null;
  const data = JSON.parse(new TextDecoder().decode(rawBytes));
  return validateArm(data, expectedMode);
}

function familyColor(organism) {
  const genome = organism.genome;
  let hash = 2166136261;
  for (const value of [genome.turnEvery, genome.turn + 1, genome.branchEvery, genome.maxCells]) {
    if (!Number.isFinite(value)) throw new Error("A recorded organism has an invalid genome color.");
    hash = Math.imul(hash ^ value, 16777619);
  }
  return `hsl(${FAMILY_HUES[organism.family]} 67% ${66 + (hash >>> 0) % 5 * 4}%)`;
}

function drawBandOutline(ctx, size, left) {
  const tile = size / WORLD_WIDTH;
  const firstWidth = Math.min(BAND_WIDTH, WORLD_WIDTH - left);
  const segments = [[left, firstWidth]];
  if (firstWidth < BAND_WIDTH) segments.push([0, BAND_WIDTH - firstWidth]);
  ctx.save();
  ctx.strokeStyle = "#ffd27b";
  ctx.lineWidth = Math.max(1.5, size / 300);
  ctx.setLineDash([Math.max(4, size / 32), Math.max(3, size / 48)]);
  for (const [start, width] of segments) {
    const x = start * tile;
    const w = width * tile;
    ctx.strokeRect(x + ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, size - ctx.lineWidth);
  }
  ctx.restore();
}

function formatFrameLabel(arm, targetTick, frameTick) {
  const finalTick = arm.data.run.finalTick;
  if (targetTick > finalTick && arm.data.run.extinctionTick !== null) {
    return `Extinct · actual tick ${fmt(finalTick)} · holding terminal frame`;
  }
  if (frameTick !== targetTick) return `Tick ${fmt(frameTick)} · saved sample · timeline ${fmt(targetTick)}`;
  if (arm.data.run.extinctionTick === frameTick) return `Extinct · actual tick ${fmt(frameTick)}`;
  return `Tick ${fmt(frameTick)} · saved sample`;
}

function setArmMetrics(key, { frame, sample, food }) {
  const census = sample.census;
  const environment = sample.environment;
  byId(`${key}-tick`).textContent = fmt(frame.tick);
  byId(`${key}-population`).textContent = fmt(census.population);
  byId(`${key}-cells`).textContent = fmt(census.cells);
  byId(`${key}-families`).textContent = census.familyCounts.map(fmt).join(" · ");
  byId(`${key}-offered`).textContent = fmt(environment.offered);
  byId(`${key}-accepted`).textContent = fmt(environment.accepted);
  byId(`${key}-overflow`).textContent = fmt(environment.overflow);
  byId(`${key}-food`).textContent = fmt(food.reduce((sum, amount) => sum + amount, 0));
  const bandLeft = byId("moving-band-left");
  if (key === "moving") bandLeft.textContent = fmt(environment.bandLeft);
}

function renderArm(key, arm, targetTick) {
  const record = [...arm.frames].reverse().find((candidate) => candidate.frame.tick <= targetTick) ?? arm.frames[0];
  const { frame, sample, food, organismById } = record;
  const canvas = canvases[key === "uniform" ? "uniform" : "movingBand"];
  const ctx = contexts[key === "uniform" ? "uniform" : "movingBand"];
  if (!ctx) throw new Error("This browser cannot draw the recorded worlds.");
  const size = canvas.width;
  const tile = size / WORLD_WIDTH;
  ctx.fillStyle = "#09151a";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < food.length; i++) {
    const amount = food[i];
    if (!amount) continue;
    ctx.fillStyle = `rgba(175, 229, 187, ${Math.min(.34, .04 + amount / 40 * .30)})`;
    const x = i % WORLD_WIDTH;
    const y = Math.floor(i / WORLD_WIDTH);
    const left = Math.round(x * tile), right = Math.round((x + 1) * tile);
    const top = Math.round(y * tile), bottom = Math.round((y + 1) * tile);
    ctx.fillRect(left, top, right - left, bottom - top);
  }
  for (const [tileIndex, id] of frame.cells) {
    const organism = organismById.get(id);
    ctx.fillStyle = familyColor(organism);
    const x = tileIndex % WORLD_WIDTH;
    const y = Math.floor(tileIndex / WORLD_WIDTH);
    ctx.fillRect(x * tile + .15, y * tile + .15, Math.max(1, tile - .3), Math.max(1, tile - .3));
  }
  if (key === "moving") drawBandOutline(ctx, size, sample.environment.bandLeft);
  const frameLabel = byId(`${key}-frame-label`);
  frameLabel.textContent = formatFrameLabel(arm, targetTick, frame.tick);
  canvas.setAttribute("aria-label", `Recorded ${arm.data.run.mode} world at actual tick ${fmt(frame.tick)}, shown for shared timeline tick ${fmt(targetTick)}; ${fmt(sample.census.population)} living bodies across ${fmt(sample.census.cells)} occupied cells${key === "moving" ? `; replenishment stripe starts at column ${fmt(sample.environment.bandLeft)}` : ""}.`);
  setArmMetrics(key, record);
}

function renderCurrent() {
  if (!pair) return;
  const tick = timelineTicks[currentIndex];
  renderArm("uniform", pair.uniform, tick);
  renderArm("moving", pair.movingBand, tick);
  scrub.value = String(currentIndex);
  scrubValue.value = `${fmt(tick)} · ${currentIndex + 1} / ${timelineTicks.length}`;
  scrubValue.textContent = scrubValue.value;
  previousButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === timelineTicks.length - 1;
  for (const button of document.querySelectorAll("[data-jump-tick]")) {
    const target = Number(button.dataset.jumpTick);
    button.disabled = target > Math.max(pair.uniform.data.run.finalTick, pair.movingBand.data.run.finalTick);
  }
  const extinct = [pair.uniform, pair.movingBand].filter((arm) => arm.data.run.extinctionTick !== null);
  const note = byId("extinction-note");
  note.hidden = extinct.length === 0;
  if (extinct.length) {
    note.textContent = extinct.map((arm) => `${arm.data.run.mode === "moving-band" ? "Moving-band" : "Uniform"} world became extinct at actual tick ${fmt(arm.data.run.extinctionTick)}; its terminal frame is held while the paired timeline continues.`).join(" ");
  }
  if (currentIndex === timelineTicks.length - 1) stopPlayback();
}

function resizeCanvases() {
  if (!pair) return;
  for (const canvas of Object.values(canvases)) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.max(1, Math.round(canvas.getBoundingClientRect().width * dpr));
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
  }
  renderCurrent();
}

function moveTo(index) {
  if (!pair) return;
  currentIndex = Math.max(0, Math.min(timelineTicks.length - 1, index));
  renderCurrent();
}

function renderWindows() {
  const rows = [];
  for (const [key, arm] of [["Uniform", pair.uniform], ["Moving band", pair.movingBand]]) {
    for (const window of arm.data.windows) {
      const label = `${fmt(window.from)}–${fmt(window.to)}`;
      if (window.status === "not-reached") {
        rows.push(`<tr><th scope="row">${key}<br>${label}</th><td colspan="11">Not reached · no executed ticks</td></tr>`);
        continue;
      }
      const endpoint = window.endpoint;
      const minMax = window.minPopulation === null ? "Unavailable" : `${fmt(window.minPopulation)}–${fmt(window.maxPopulation)} · ${fmt(endpoint.population)}`;
      const partial = window.status === "partial" ? `<br><span class="muted">${fmt(window.executedTicks)} executed · endpoint tick ${fmt(endpoint.actualTick)}</span>` : "";
      const food = window.food;
      const band = endpoint.occupiedBandCells === null || endpoint.occupiedBandShare === null
        ? "Unavailable" : `${fmt(endpoint.occupiedBandCells)} · ${(endpoint.occupiedBandShare * 100).toFixed(1)}%`;
      rows.push(`<tr><th scope="row">${key}<br>${label}${partial}</th><td>${fmt(window.births)} · ${fmt(window.deaths)}</td><td>${minMax}</td><td>${fmt(window.cap48Ticks)} / 500</td><td>${fmt(window.nearCap47Ticks)} / 500</td><td>${fmt(window.blockedCapAttempts)} cap · ${fmt(window.blockedSpaceAttempts)} space</td><td>${fmt(food.offered)} · ${fmt(food.accepted)} · ${fmt(food.overflow)}</td><td>${endpoint.familyCounts.map(fmt).join(" / ")}</td><td>${fmt(endpoint.genomeCounts.length)}</td><td>${fmt(endpoint.maxGeneration)}</td><td>${fmt(endpoint.maxEverGeneration)}</td><td>${band}</td></tr>`);
    }
  }
  byId("window-rows").innerHTML = rows.join("");
}

async function loadPair() {
  const generation = ++loadGeneration;
  try {
    const response = await fetch(INDEX_URL, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (generation !== loadGeneration) return;
    if (response.status === 404) {
      status("No paired manifest is published yet.");
      return;
    }
    if (!response.ok) throw new Error(`The paired manifest answered ${response.status}.`);
    const index = await response.json();
    validateIndex(index);
    status("Checking the listed uniform and moving-band evidence…");
    const [uniform, movingBand] = await Promise.all([
      fetchArm(index.arms.uniform, "uniform", generation),
      fetchArm(index.arms.movingBand, "moving-band", generation),
    ]);
    if (generation !== loadGeneration || !uniform || !movingBand) return;
    pair = { index, uniform, movingBand };
    timelineTicks = [...new Set([...uniform.frames.map((record) => record.frame.tick), ...movingBand.frames.map((record) => record.frame.tick)])].sort((a, b) => a - b);
    currentIndex = 0;
    const decision = index.decision;
    const label = decision.status === "promising" ? "Promising" : decision.status === "stop" ? "Stop" : "Pending";
    byId("decision-status").textContent = label;
    byId("decision-status").dataset.status = decision.status === "promising" ? "pass" : decision.status;
    byId("decision-summary").textContent = decision.summary;
    byId("pair-decision-status").textContent = `Seed 1,201 paired decision · ${label}`;
    byId("pair-decision-summary").textContent = decision.summary;
    byId("pair-decision").hidden = false;
    scrub.max = String(timelineTicks.length - 1);
    scrub.disabled = false;
    playButton.disabled = timelineTicks.length < 2 || document.hidden;
    nextButton.disabled = timelineTicks.length < 2;
    for (const button of document.querySelectorAll("[data-jump-tick]")) button.disabled = false;
    renderWindows();
    emptyState.hidden = true;
    errorState.hidden = true;
    replay.hidden = false;
    byId("run-state").textContent = "Paused · paired recorded states";
    status("Both seed 1,201 arms verified · paused at tick 0.", "ready");
    resizeCanvases();
  } catch (error) {
    if (generation === loadGeneration) showError(error instanceof Error ? error.message : "The paired evidence could not be read.");
  }
}

previousButton.addEventListener("click", () => moveTo(currentIndex - 1));
nextButton.addEventListener("click", () => moveTo(currentIndex + 1));
scrub.addEventListener("input", () => moveTo(Number(scrub.value)));
playButton.addEventListener("click", () => {
  if (!pair || document.hidden) return;
  if (playing) { stopPlayback(); return; }
  if (currentIndex === timelineTicks.length - 1) moveTo(0);
  playing = true;
  playButton.textContent = "Pause both";
  playButton.setAttribute("aria-label", "Pause paired sampled replay");
  runState.textContent = "Playing · saved states only";
  playbackTimer = window.setInterval(() => {
    if (document.hidden) {
      stopPlayback();
      runState.textContent = "Paused while away";
      return;
    }
    if (currentIndex + 1 >= timelineTicks.length) { stopPlayback(); return; }
    moveTo(currentIndex + 1);
  }, 450);
});
for (const button of document.querySelectorAll("[data-jump-tick]")) {
  button.addEventListener("click", () => {
    const target = Number(button.dataset.jumpTick);
    const index = timelineTicks.findIndex((tick) => tick >= target);
    if (index >= 0) moveTo(index);
  });
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPlayback();
    if (pair) {
      runState.textContent = "Paused while away";
      playButton.disabled = true;
    }
  } else if (pair) {
    runState.textContent = "Paused · paired recorded states";
    playButton.disabled = timelineTicks.length < 2;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(target.tagName))) return;
  if (event.key === "ArrowLeft" && pair) { event.preventDefault(); moveTo(currentIndex - 1); }
  if (event.key === "ArrowRight" && pair) { event.preventDefault(); moveTo(currentIndex + 1); }
  if (event.code === "Space" && pair) { event.preventDefault(); playButton.click(); }
});
window.addEventListener("resize", resizeCanvases, { passive: true });
loadPair();
