const INDEX_URLS = { 1202: new URL("./moving-food-replication-index-1202.json", import.meta.url), 1203: new URL("./moving-food-replication-index-1203.json", import.meta.url) };
const PLAN_SHA256 = "72f651acc7f221991b0ce89f7264eed9dd47df54e955d3d164406b4d0a17cc47";
const BASELINE_IDENTITIES = {
  1202: { artifact: "a67a99bde41317f59c3b0fdf6521cc561c9a2b4db38d12783ea2f9be0d5f5602", data: "1fb5f81e128f7e6ecf60449349257df09ec2ce0fd1155d5d0c2784e3f59a8e2f" },
  1203: { artifact: "94fa6328fb74038793f859d629ef9535e5f610dd22eceeaa74d4677218b2b15d", data: "8c3ac66e4d3699e423a58597411c05b187dc56fdf9dab7b2550296da2fc95b33" },
};
const SOURCE_PINS = {
  "apps/lab/src/development/model.ts": "49416b11ae8d0491cb9b2ae1f102f36779cd9fe0c72917a7ddf86fbbc63db072",
  "apps/lab/src/hungry-shapes/model.ts": "a33a3312caa6c91a46e2508f5b9267e3394089ff7320145a15157770068123bc",
  "apps/lab/src/uniform-endurance/model.ts": "b83de32cf42f58c13977dbbd3c74bf9d3068f90b40ec09600b9125ddb0a72009",
  "apps/lab/src/moving-food/model.ts": "b7aa0a3f1a0183d574e152e16b7f12c24fc0c9a201e7ddfae6d576915f10d8b0",
  "tools/hungry-shapes/explore.ts": "f49d2a63fc7b464bcd2115c683f3e40ec8381eb28aa8b318889552ea9bc23581",
  "tools/uniform-food/explore.ts": "312c2cffd7102e8c58fc1eabb72173d53692c8527f950b74ba33be4917b4a80c",
  "tools/uniform-endurance/explore.ts": "99099663fd619a644c29ff639bca1e6c884bc9d07161f3ba40fe3ec2f0fd7f77",
  "tools/moving-food/explore.ts": "b77c58eca007727beeca81b1a797978a8ddfbacaa4d3192a094164bf868df63a",
  "docs/creative-prototypes/hungry-shapes-seed-1201.json": "2cb6366595e43e2f5f215448bd13a67925e21f2ea11e4747790f6f61470b6520",
  "docs/creative-prototypes/hungry-shapes-seed-1201.md": "0f64a51d0ab22fe346160ed0ef94877a78998700372ce8ff1ffde3ef0f88a0f1",
  "docs/creative-prototypes/hungry-shapes-decision.json": "f935884132cd1f34edb5fec1af57eeaa033d87505448ea07acd05ed772c5d5b0",
  "docs/creative-prototypes/moving-food-replication-plan.md": PLAN_SHA256,
  "docs/creative-prototypes/moving-food-index.json": "5f2ca66cb2d0bd39c0c017c4372381032746a0ba14076ecef71d8df079cccc57",
  "docs/creative-prototypes/moving-food-uniform-seed-1201.json": "1ae6bdc3c9f5bedd2b6f6cfb70aa9dc94e8acb8177f4c2ecda9c2859bf1e4458",
  "docs/creative-prototypes/moving-food-uniform-seed-1201.md": "af43523fa6108f6a136d5eb734db3908c6258c862c29bc69edb71f53123d6efe",
  "docs/creative-prototypes/moving-food-moving-band-seed-1201.json": "46017d1db1eaf1ff85b8cc51d92533d928aeac18b3e7cf261a82bb9d0d0816bf",
  "docs/creative-prototypes/moving-food-moving-band-seed-1201.md": "b2de64b26073439a52ca2ed7fa121d078e559d32205c8737e3252cf1aa7f6471",
  "docs/creative-prototypes/uniform-endurance-seed-1202.json": "a67a99bde41317f59c3b0fdf6521cc561c9a2b4db38d12783ea2f9be0d5f5602",
  "docs/creative-prototypes/uniform-endurance-seed-1202.md": "3de277dc0d3a11acd20501a1c6a55133dd46ed80b0609c643f8111f7806aacda",
  "docs/creative-prototypes/uniform-endurance-seed-1203.json": "94fa6328fb74038793f859d629ef9535e5f610dd22eceeaa74d4677218b2b15d",
  "docs/creative-prototypes/uniform-endurance-seed-1203.md": "0ee0dc77840fa97babf8b1569ce66245b2e978692138cd2dc46cfeed587c1bbd",
  "tools/moving-food-replication/explore.ts": "a8403864210d575baaa0acfae4a1a8ab684909bf0e8df541a1103394d2e11969"
};
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
const seedPicker = byId("seed-picker");
let selectedSeed = 1202;

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

async function validateArm(data, expectedMode, expectedSeed) {
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
  if (!run || run.seed !== expectedSeed || run.mode !== expectedMode || run.mutation !== true || run.maxTick !== 3000 ||
      !Number.isSafeInteger(run.finalTick) || run.finalTick < 0 || run.finalTick > 3000 ||
      !(run.extinctionTick === null || Number.isSafeInteger(run.extinctionTick) && run.extinctionTick >= 1 && run.extinctionTick === run.finalTick)) {
    throw new Error(`The ${expectedMode} arm does not match seed ${expectedSeed}, its food mode, mutation setting, or 3,000-tick cap.`);
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
  if (JSON.stringify(Object.keys(sourceHashes).sort()) !== JSON.stringify(Object.keys(SOURCE_PINS).sort()) ||
      Object.entries(SOURCE_PINS).some(([path, digest]) => sourceHashes[path] !== digest)) {
    throw new Error(`${expectedMode} source identities do not match the frozen runner dependency set.`);
  }
  if (JSON.stringify(sourceHashes) !== JSON.stringify(data.provenance?.sourceSha256)) throw new Error(`${expectedMode} source identities are inconsistent.`);
  for (const [path, digest] of Object.entries(sourceHashes)) assertDigest(digest, `${expectedMode} source ${path}`);
  if (!sourceHashes["apps/lab/src/moving-food/model.ts"] || !sourceHashes["tools/moving-food-replication/explore.ts"] ||
      !sourceHashes["apps/lab/src/uniform-endurance/model.ts"] || !sourceHashes["tools/uniform-endurance/explore.ts"]) {
    throw new Error(`The ${expectedMode} arm is missing a moving-rule, runner, or pinned-baseline source hash.`);
  }
  if (data.provenance?.planSha256 !== PLAN_SHA256) throw new Error(`${expectedMode} arm is not bound to the frozen replication plan SHA-256.`);
  const baseline = BASELINE_IDENTITIES[expectedSeed];
  if (data.provenance?.baselineArtifactSha256 !== baseline.artifact || data.provenance?.baselineDataSha256 !== baseline.data ||
      !sourceHashes[`docs/creative-prototypes/uniform-endurance-seed-${expectedSeed}.json`]) {
    throw new Error(`The ${expectedMode} arm is missing its pinned uniform-baseline identity.`);
  }
  if (expectedMode === "uniform") {
    const proof = data.provenance?.prefix;
    if (!proof || proof.status !== "verified" || proof.seed !== expectedSeed || proof.comparedSamples !== 151 ||
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
  const finalCensus = data.final.census;
  const allWindowsReached = data.windows.length === 3 && data.windows.every((window) => window.status === "complete" && window.executedTicks === 500);
  const computedGate = {
    aliveAt3000: run.finalTick === 3000 && finalCensus.population > 0,
    atLeastTwoFamiliesAt3000: run.finalTick === 3000 && finalCensus.population > 0 && finalCensus.familyCounts.filter((count) => count > 0).length >= 2,
    allWindowsReached,
    eachNewWindowHasBirthsAndDeaths: allWindowsReached && data.windows.every((window) => window.births > 0 && window.deaths > 0),
    eachNewWindowCap48AtMost99: allWindowsReached && data.windows.every((window) => window.cap48Ticks <= 99),
  };
  const expectedNumericalPass = computedGate.aliveAt3000 && computedGate.atLeastTwoFamiliesAt3000 && computedGate.allWindowsReached &&
    computedGate.eachNewWindowHasBirthsAndDeaths && computedGate.eachNewWindowCap48AtMost99;
  if (!data.numericalGate || Object.entries(computedGate).some(([key, value]) => data.numericalGate[key] !== value) ||
      data.numericalGate.numericalPass !== expectedNumericalPass || typeof data.numericalGate.note !== "string") {
    throw new Error(`${expectedMode} numerical gate does not match its saved endpoint and window evidence.`);
  }
  return { data, frames: entries };
}

function validateIndex(index, expectedSeed, indexUrl) {
  if (!index || index.schemaVersion !== 1 || index.kind !== "hungry-shapes-moving-food-pair" || index.seed !== expectedSeed ||
      index.planSha256 !== PLAN_SHA256 || !index.arms) {
    throw new Error(`The paired manifest is malformed or is not the frozen seed ${expectedSeed} replication pair.`);
  }
  if ("overall" in index || "overallDecision" in index || Object.keys(index).some((key) => !["schemaVersion", "kind", "seed", "arms", "decision", "planSha256"].includes(key)) ||
      Object.keys(index.arms).some((key) => !["uniform", "movingBand"].includes(key))) {
    throw new Error("The paired manifest contains an unbound decision or unexpected source entry.");
  }
  const arms = [["uniform", index.arms.uniform, "uniform"], ["movingBand", index.arms.movingBand, "moving-band"]];
  for (const [, arm, expectedMode] of arms) {
    if (!arm || arm.mode !== expectedMode || typeof arm.url !== "string" || !arm.url.trim() || !/^[a-f0-9]{64}$/.test(arm.rawSha256 ?? "")) {
      throw new Error(`The paired manifest has a malformed ${expectedMode} source entry.`);
    }
    const resolved = new URL(arm.url, indexUrl);
    const docsDirectory = indexUrl.pathname.replace(/[^/]*$/, "");
    if (resolved.origin !== indexUrl.origin || !resolved.pathname.startsWith(docsDirectory)) {
      throw new Error(`The ${expectedMode} source must stay in the creative-prototypes evidence directory.`);
    }
  }
  const decision = index.decision;
  if (!decision || !["pending", "promising", "stop"].includes(decision.status) || typeof decision.summary !== "string" ||
      decision.uniformArtifactSha256 !== index.arms.uniform.rawSha256 || decision.movingBandArtifactSha256 !== index.arms.movingBand.rawSha256) {
    throw new Error("The pair decision is not bound to the listed raw SHA-256 values for both arms.");
  }
  const allowedDecisionKeys = ["status", "title", "summary", "uniformArtifactSha256", "movingBandArtifactSha256", "visualReceiptUrl", "visualReceiptSha256"];
  if (Object.keys(decision).some((key) => !allowedDecisionKeys.includes(key)) || (decision.title !== undefined && typeof decision.title !== "string")) throw new Error("The pair decision contains unbound extra fields.");
  if (decision.status === "pending") {
    if (decision.visualReceiptUrl !== undefined || decision.visualReceiptSha256 !== undefined) throw new Error("A pending pair cannot carry an accepted visual receipt.");
  } else if (typeof decision.visualReceiptUrl !== "string" || !decision.visualReceiptUrl.trim() || !/^[a-f0-9]{64}$/.test(decision.visualReceiptSha256 ?? "")) {
    throw new Error("An accepted pair must list a SHA-bound visual receipt.");
  }
}

async function fetchArm(arm, expectedMode, expectedSeed, indexUrl, generation) {
  const response = await fetch(new URL(arm.url, indexUrl), { headers: { Accept: "application/json" }, cache: "no-store" });
  if (generation !== loadGeneration) return null;
  if (!response.ok) throw new Error(`The listed ${expectedMode} arm answered ${response.status}; no paired replay was shown.`);
  const rawBytes = new Uint8Array(await response.arrayBuffer());
  if (generation !== loadGeneration) return null;
  if (rawBytes.byteLength > MAX_ARM_BYTES) throw new Error(`The listed ${expectedMode} arm exceeds the 24 MiB evidence limit.`);
  if (await sha256Hex(rawBytes) !== arm.rawSha256) throw new Error(`The ${expectedMode} raw-file SHA-256 does not match the pair manifest.`);
  if (generation !== loadGeneration) return null;
  const data = JSON.parse(new TextDecoder().decode(rawBytes));
  return validateArm(data, expectedMode, expectedSeed);
}

async function fetchReceipt(decision, seed, indexUrl, generation) {
  if (decision.status === "pending") return null;
  const url = new URL(decision.visualReceiptUrl, indexUrl);
  const docsDirectory = indexUrl.pathname.replace(/[^/]*$/, "");
  if (url.origin !== indexUrl.origin || !url.pathname.startsWith(docsDirectory)) throw new Error("The visual receipt must stay in the creative-prototypes evidence directory.");
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (generation !== loadGeneration) return null;
  if (!response.ok) throw new Error(`The listed visual receipt answered ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (generation !== loadGeneration) return null;
  if (bytes.byteLength > 1024 * 1024) throw new Error("The listed visual receipt exceeds the 1 MiB evidence limit.");
  if (await sha256Hex(bytes) !== decision.visualReceiptSha256) throw new Error("The visual receipt raw-file SHA-256 does not match the selected-seed decision.");
  const receipt = JSON.parse(new TextDecoder().decode(bytes));
  if (!receipt || Object.keys(receipt).some((key) => !["seed", "uniformArtifactSha256", "movingBandArtifactSha256", "visualComparisons", "lateWithinMoving", "visualReviewedBeforeOverlapDiagnostics", "reviewedAtUTC"].includes(key)) ||
      (receipt.reviewedAtUTC !== undefined && typeof receipt.reviewedAtUTC !== "string") || receipt.seed !== seed || receipt.uniformArtifactSha256 !== decision.uniformArtifactSha256 ||
      receipt.movingBandArtifactSha256 !== decision.movingBandArtifactSha256 || receipt.visualReviewedBeforeOverlapDiagnostics !== true ||
      !Array.isArray(receipt.visualComparisons) || JSON.stringify(receipt.visualComparisons.map((entry) => entry.tick)) !== "[1500,2500,3000]" ||
      receipt.visualComparisons.some((entry) => typeof entry.pass !== "boolean" || typeof entry.observation !== "string" || !entry.observation.trim()) ||
      !receipt.lateWithinMoving || receipt.lateWithinMoving.from !== 2500 || receipt.lateWithinMoving.to !== 3000 ||
      typeof receipt.lateWithinMoving.pass !== "boolean" || typeof receipt.lateWithinMoving.observation !== "string" || !receipt.lateWithinMoving.observation.trim()) {
    throw new Error("The SHA-matched visual receipt does not bind complete selected-seed observations to both arms.");
  }
  return receipt;
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

async function loadPair(seed = selectedSeed) {
  const generation = ++loadGeneration;
  selectedSeed = seed;
  pair = null;
  timelineTicks = [];
  stopPlayback();
  replay.hidden = true;
  errorState.hidden = true;
  emptyState.hidden = false;
  byId("decision-status").textContent = "Pending";
  byId("decision-status").dataset.status = "pending";
  byId("decision-summary").textContent = `Seed ${seed} decision will appear only after both recordings and any accepted visual receipt verify.`;
  byId("pair-decision").hidden = true;
  const indexUrl = INDEX_URLS[seed];
  try {
    status(`Checking only the seed ${seed} replication record…`);
    const response = await fetch(indexUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (generation !== loadGeneration) return;
    if (response.status === 404) {
      status(`No paired manifest is published for seed ${seed} yet.`);
      return;
    }
    if (!response.ok) throw new Error(`The paired manifest answered ${response.status}.`);
    const index = await response.json();
    validateIndex(index, seed, indexUrl);
    status(`Checking the listed seed ${seed} arms and visual receipt…`);
    const [uniform, movingBand, receipt] = await Promise.all([
      fetchArm(index.arms.uniform, "uniform", seed, indexUrl, generation),
      fetchArm(index.arms.movingBand, "moving-band", seed, indexUrl, generation),
      fetchReceipt(index.decision, seed, indexUrl, generation),
    ]);
    if (generation !== loadGeneration || !uniform || !movingBand || index.decision.status !== "pending" && !receipt) return;
    if (receipt) {
      for (const comparison of receipt.visualComparisons) {
        const bothArmsHaveFrame = uniform.frames.some((entry) => entry.frame.tick === comparison.tick) &&
          movingBand.frames.some((entry) => entry.frame.tick === comparison.tick);
        if (comparison.pass && !bothArmsHaveFrame) throw new Error(`The visual receipt marks tick ${fmt(comparison.tick)} as a pass without exact saved frames in both arms.`);
      }
      const movingHasLateFrames = movingBand.frames.some((entry) => entry.frame.tick === 2500) &&
        movingBand.frames.some((entry) => entry.frame.tick === 3000);
      if (receipt.lateWithinMoving.pass && !movingHasLateFrames) throw new Error("The visual receipt marks the late moving comparison as a pass without exact saved frames at ticks 2,500 and 3,000.");
    }
    if (index.decision.status === "promising" && (movingBand.data.numericalGate?.numericalPass !== true ||
        receipt.visualComparisons.filter((entry) => entry.pass).length < 2 || !receipt.lateWithinMoving.pass)) {
      throw new Error("The promising decision conflicts with its saved numerical gate or visual receipt.");
    }
    pair = { index, uniform, movingBand };
    timelineTicks = [...new Set([...uniform.frames.map((record) => record.frame.tick), ...movingBand.frames.map((record) => record.frame.tick)])].sort((a, b) => a - b);
    currentIndex = 0;
    const decision = index.decision;
    const label = decision.status === "promising" ? "Promising" : decision.status === "stop" ? "Stop" : "Pending";
    byId("decision-status").textContent = label;
    byId("decision-status").dataset.status = decision.status === "promising" ? "pass" : decision.status;
    byId("decision-title").textContent = decision.title || `Seed ${seed.toLocaleString("en-US")} replication screen`;
    byId("decision-summary").textContent = decision.summary;
    byId("pair-decision-status").textContent = `Seed ${seed.toLocaleString("en-US")} paired decision · ${label}`;
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
    status(`Both seed ${seed.toLocaleString("en-US")} arms verified${receipt ? " with SHA-matched visual receipt" : ""} · paused at tick 0.`, "ready");
    byId("replay-title").textContent = `Seed ${seed.toLocaleString("en-US")} · paired world states`;
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
seedPicker.addEventListener("change", () => { const seed = Number(seedPicker.value); if (seed === 1202 || seed === 1203) loadPair(seed); });
loadPair(1202);
