const PLAN_SHA256 = "0858e5292d1a9949d1dfd53479519a518fbbe5b849363e577a7e630a0ece384d";
const PAIR_INDEX_NAME = "split-food-replication-index-1203.json";
const BASELINE_NAME = "stationary-food-replication-stationary-band-seed-1203.json";
const SPLIT_NAME = "split-food-replication-seed-1203.json";
const RECEIPT_NAME = "split-food-replication-visual-receipt-1203.json";
const BASELINE_RAW_SHA256 = "234c3c0eb54b5d6875f400e155b95f9afaa20638b511c0a4285305c9aac2ba7c";
const BASELINE_DATA_SHA256 = "236e98377fd6795236f2b6ecf3907bb637324866791e12c478e63ac7e9664ba7";
const BASELINE_INDEX_SHA256 = "73cf2ebfa0ab266d716d48f1c6b966872ad7cc2a68d7d95fe51729cfab6a16b3";
const SOURCE_PINS = {
  "apps/lab/src/development/model.ts": "49416b11ae8d0491cb9b2ae1f102f36779cd9fe0c72917a7ddf86fbbc63db072",
  "apps/lab/src/hungry-shapes/model.ts": "a33a3312caa6c91a46e2508f5b9267e3394089ff7320145a15157770068123bc",
  "apps/lab/src/moving-food/model.ts": "b7aa0a3f1a0183d574e152e16b7f12c24fc0c9a201e7ddfae6d576915f10d8b0",
  "tools/moving-food/explore.ts": "b77c58eca007727beeca81b1a797978a8ddfbacaa4d3192a094164bf868df63a",
  "tools/moving-food-replication/explore.ts": "a8403864210d575baaa0acfae4a1a8ab684909bf0e8df541a1103394d2e11969",
  "apps/lab/src/stationary-food/model.ts": "7bd5af02243cb0629547a20d889a05cd904246a16227f58df4e420edc84a859f",
  "tools/stationary-food/explore.ts": "ab692de5ede5ece9cfdc1af8d0e44c651a0bc30ff8aa6493b35e6a02672250f6",
  "docs/creative-prototypes/stationary-food-plan.md": "ba835f94fddbd48a823fb6264d3e4f9d8a815014c5bc5e4997fec56e6f7aaa51",
  "tools/stationary-food-replication/explore.ts": "18d9c74da2cd2d803923a544c2b717b06976909738699756e16abaa832b316f4",
  "docs/creative-prototypes/stationary-food-replication-plan.md": "74dc68201c7fb51ed9a87ba75d13e0ad79b171ff0d73d7929af4ba4f03fa114a",
  "docs/creative-prototypes/split-food-plan.md": "134944138fc636b1c9677e9a40b5c2583d7184d608ce1e8d8c914e2ce8d93515",
  "docs/creative-prototypes/split-food-replication-plan.md": "0858e5292d1a9949d1dfd53479519a518fbbe5b849363e577a7e630a0ece384d",
  "apps/lab/src/split-food/model.ts": "c6b5c37f20f8daa73858fd9e437d0b25d029c712c065ab11ef495c281b58b506",
  "tools/split-food/explore.ts": "aa2d3aeca0cd7a1a58e405c681cc6e61b5b15da2b0b85262a12c4f6fa95009bd",
  "docs/creative-prototypes/stationary-food-replication-stationary-band-seed-1203.json": "234c3c0eb54b5d6875f400e155b95f9afaa20638b511c0a4285305c9aac2ba7c",
  "docs/creative-prototypes/stationary-food-replication-index-1203.json": "73cf2ebfa0ab266d716d48f1c6b966872ad7cc2a68d7d95fe51729cfab6a16b3",
  "docs/creative-prototypes/stationary-food-replication-moving-band-seed-1203.json": "000e1ce6a3a60ab216707136ba97edf97bdcde826a63af2d3c27bf54e7810e3d",
  "docs/creative-prototypes/moving-food-replication-moving-band-seed-1203.json": "8ce7be228812002e2d03a2f68a15b9d1107e6fff022006ae9059003bb66e0c9b",
  "docs/creative-prototypes/moving-food-replication-index-1203.json": "44e02b3416e40cdde5318c1fecea2dd54bda8f9543df97c006aabc29dc24ce16",
  "docs/creative-prototypes/moving-food-moving-band-seed-1201.json": "46017d1db1eaf1ff85b8cc51d92533d928aeac18b3e7cf261a82bb9d0d0816bf",
  "docs/creative-prototypes/moving-food-index.json": "5f2ca66cb2d0bd39c0c017c4372381032746a0ba14076ecef71d8df079cccc57",
  "docs/creative-prototypes/hungry-shapes-seed-1201.json": "2cb6366595e43e2f5f215448bd13a67925e21f2ea11e4747790f6f61470b6520",
  "docs/creative-prototypes/hungry-shapes-seed-1201.md": "0f64a51d0ab22fe346160ed0ef94877a78998700372ce8ff1ffde3ef0f88a0f1",
  "docs/creative-prototypes/hungry-shapes-decision.json": "f935884132cd1f34edb5fec1af57eeaa033d87505448ea07acd05ed772c5d5b0",
  "apps/lab/src/uniform-endurance/model.ts": "b83de32cf42f58c13977dbbd3c74bf9d3068f90b40ec09600b9125ddb0a72009",
  "tools/hungry-shapes/explore.ts": "f49d2a63fc7b464bcd2115c683f3e40ec8381eb28aa8b318889552ea9bc23581",
  "tools/uniform-food/explore.ts": "312c2cffd7102e8c58fc1eabb72173d53692c8527f950b74ba33be4917b4a80c",
  "tools/uniform-endurance/explore.ts": "99099663fd619a644c29ff639bca1e6c884bc9d07161f3ba40fe3ec2f0fd7f77",
  "docs/creative-prototypes/uniform-endurance-seed-1201.json": "6b480bced89b1c7bf9ab759c84fb28c9bfdcd1f9c2a6ecc7e922ddba1a590221",
  "docs/creative-prototypes/uniform-endurance-seed-1201.md": "b7a831f8c6565479f9644d4ad06be86fbe230a41908773158af77116b7b699f2",
  "docs/creative-prototypes/uniform-endurance-seed-1202.json": "a67a99bde41317f59c3b0fdf6521cc561c9a2b4db38d12783ea2f9be0d5f5602",
  "docs/creative-prototypes/uniform-endurance-seed-1202.md": "3de277dc0d3a11acd20501a1c6a55133dd46ed80b0609c643f8111f7806aacda",
  "docs/creative-prototypes/uniform-endurance-seed-1203.json": "94fa6328fb74038793f859d629ef9535e5f610dd22eceeaa74d4677218b2b15d",
  "docs/creative-prototypes/uniform-endurance-seed-1203.md": "0ee0dc77840fa97babf8b1569ce66245b2e978692138cd2dc46cfeed587c1bbd",
  "docs/creative-prototypes/moving-food-replication-plan.md": "72f651acc7f221991b0ce89f7264eed9dd47df54e955d3d164406b4d0a17cc47",
  "docs/creative-prototypes/moving-food-uniform-seed-1201.json": "1ae6bdc3c9f5bedd2b6f6cfb70aa9dc94e8acb8177f4c2ecda9c2859bf1e4458",
  "docs/creative-prototypes/moving-food-uniform-seed-1201.md": "af43523fa6108f6a136d5eb734db3908c6258c862c29bc69edb71f53123d6efe",
  "docs/creative-prototypes/moving-food-moving-band-seed-1201.md": "b2de64b26073439a52ca2ed7fa121d078e559d32205c8737e3252cf1aa7f6471",
  "tools/split-food-replication/explore.ts": "5f60e71043ee4335ff178ed5521897723adf782bc2e3fb17e15a2bb0884c5baf",
};
const WORLD_WIDTH = 96;
const WORLD_CELLS = WORLD_WIDTH * WORLD_WIDTH;
const MAX_ARM_BYTES = 24 * 1024 * 1024;
const FAMILY_HUES = [154, 37, 249];
const fmt = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "—";
const byId = (id) => document.getElementById(id);
const sourceStatus = byId("source-status");
const emptyState = byId("empty-state");
const errorState = byId("error-state");
const replay = byId("replay");
const canvases = { baseline: byId("baseline-world"), split: byId("split-world") };
const contexts = { baseline: canvases.baseline.getContext("2d"), split: canvases.split.getContext("2d") };
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
  status("The listed split-food evidence could not be loaded.", "error");
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify SHA-256 here, so the paired evidence was not displayed.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const sha256Text = (text) => sha256Hex(new TextEncoder().encode(text));

function exactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
function digest(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function requireDigest(value, label) { if (!digest(value)) throw new Error(`${label} is missing a SHA-256 digest.`); }

function decodeFood(base64, tick) {
  if (typeof base64 !== "string") throw new Error(`Frame ${tick} is missing recorded food bytes.`);
  let binary;
  try { binary = atob(base64); } catch { throw new Error(`Frame ${tick} food is not valid base64.`); }
  if (binary.length !== WORLD_CELLS) throw new Error(`Frame ${tick} food does not cover the 96 × 96 world.`);
  const food = new Uint8Array(WORLD_CELLS);
  for (let i = 0; i < binary.length; i++) {
    const amount = binary.charCodeAt(i);
    if (amount > 40) throw new Error(`Frame ${tick} food exceeds the saved 0–40 tile cap.`);
    food[i] = amount;
  }
  return food;
}

function validateEnvironment(environment, mode, tick) {
  const expectedKeys = mode === "stationary-band"
    ? ["version", "mode", "pulseBudget", "targetCount", "pulses", "offered", "accepted", "overflow", "initialFoodPerTile", "bandLeft", "bandWidth"]
    : ["version", "mode", "pulseBudget", "targetCount", "pulses", "offered", "accepted", "overflow", "initialFoodPerTile", "bandColumns", "bandWidth"];
  if (!exactKeys(environment, expectedKeys)) throw new Error(`${mode} food environment at tick ${tick} has missing or unexpected fields.`);
  const commonOkay = environment && environment.version === 1 && environment.mode === mode && environment.pulseBudget === 768 &&
    environment.targetCount === 4608 && Number.isSafeInteger(environment.pulses) && environment.pulses === Math.floor(tick / 5) &&
    Number.isSafeInteger(environment.offered) && Number.isSafeInteger(environment.accepted) && Number.isSafeInteger(environment.overflow) &&
    environment.offered === environment.accepted + environment.overflow && environment.offered === environment.pulses * 768 &&
    environment.initialFoodPerTile === 20;
  if (!commonOkay) throw new Error(`The ${mode} food ledger at tick ${tick} is missing or inconsistent.`);
  if (mode === "stationary-band") {
    if (environment.bandLeft !== 0 || environment.bandWidth !== 48) throw new Error(`Historical stationary-band geometry at tick ${tick} is not columns 0–47.`);
  } else if (mode === "split-band") {
    if (environment.bandWidth !== 24 || JSON.stringify(environment.bandColumns) !== "[[0,23],[48,71]]") {
      throw new Error(`Split-band geometry at tick ${tick} is not the frozen columns 0–23 and 48–71.`);
    }
  } else throw new Error(`Unexpected food mode ${mode}.`);
}

function validateCensus(census, tick, organisms, occupied) {
  const keys = ["tick", "population", "cells", "familyCounts", "births", "growths", "deaths", "effectiveMutations", "attemptedMutations", "maxGeneration", "totalCells", "totalEnergy", "meanBodyCells", "meanEnergy", "blockedBirths", "blockedSpaceBirths", "blockedCapBirths", "ledgerResidual", "genomeVariantCount"];
  if (!exactKeys(census, keys) || census.tick !== tick || !Number.isSafeInteger(census.population) || census.population !== organisms.size || census.population > 48 ||
      !Number.isSafeInteger(census.cells) || census.cells !== occupied.size || !Array.isArray(census.familyCounts) || census.familyCounts.length !== 3 ||
      census.familyCounts.some((count, family) => !Number.isSafeInteger(count) || count !== [...organisms.values()].filter((item) => item.family === family).length) ||
      census.familyCounts.reduce((sum, count) => sum + count, 0) !== census.population ||
      census.totalCells !== census.cells || census.blockedBirths !== census.blockedSpaceBirths + census.blockedCapBirths ||
      census.effectiveMutations > census.attemptedMutations || census.effectiveMutations > census.births ||
      census.genomeVariantCount > census.population || census.ledgerResidual !== 0 || !Number.isFinite(census.meanBodyCells) ||
      census.meanBodyCells !== (census.population ? census.cells / census.population : 0) || !Number.isFinite(census.meanEnergy) ||
      census.meanEnergy !== (census.population ? census.totalEnergy / census.population : 0)) {
    throw new Error(`Frame ${tick} disagrees with its recorded body, cell, or family counts.`);
  }
}

function expectedSourcePins(data) {
  const sources = data.provenance?.sourceSha256;
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) throw new Error("Split-band provenance is missing source identities.");
  if (!Object.keys(SOURCE_PINS).length || JSON.stringify(Object.keys(sources).sort()) !== JSON.stringify(Object.keys(SOURCE_PINS).sort()) ||
      Object.entries(SOURCE_PINS).some(([path, sha]) => sources[path] !== sha)) {
    throw new Error("Split-band source identities do not match the frozen runner dependency set.");
  }
  for (const [path, sha] of Object.entries(sources)) requireDigest(sha, `Source ${path}`);
}

async function validateArm(data, mode) {
  const isSplit = mode === "split-band";
  const expectedTop = ["schemaVersion", "kind", "run", "runtime", "rules", "provenance", "samples", "tickRows", "frames", "snapshots", "windows", "final", "repeat", "numericalGate", "dataSha256", ...(isSplit ? ["spatialGate"] : [])];
  if (!exactKeys(data, expectedTop) || data.schemaVersion !== 1 || data.kind !== (isSplit ? "hungry-shapes-split-food-replication-arm" : "hungry-shapes-stationary-food-replication-arm")) {
    throw new Error(`The ${mode} file is not a supported saved arm record.`);
  }
  requireDigest(data.dataSha256, `${mode} internal evidence`);
  const canonical = { ...data };
  delete canonical.dataSha256;
  if (await sha256Text(JSON.stringify(canonical)) !== data.dataSha256) throw new Error(`The ${mode} internal data SHA-256 does not match its contents.`);

  const expectedRunKeys = ["seed", "mode", "mutation", "maxTick", "finalTick", "extinctionTick"];
  const run = data.run;
  if (!exactKeys(run, expectedRunKeys) || run.seed !== 1203 || run.mode !== mode || run.mutation !== true || run.maxTick !== 3000 ||
      !Number.isSafeInteger(run.finalTick) || run.finalTick < 0 || run.finalTick > 3000 ||
      !(run.extinctionTick === null || Number.isSafeInteger(run.extinctionTick) && run.extinctionTick >= 1 && run.extinctionTick === run.finalTick) ||
      (run.extinctionTick === null && run.finalTick !== 3000)) {
    throw new Error(`The ${mode} arm does not match seed 1203 and its 3,000-tick or actual-extinction cap.`);
  }
  if (data.rules?.width !== WORLD_WIDTH || data.rules?.height !== WORLD_WIDTH || data.rules?.tileCount !== WORLD_CELLS || data.rules?.maxHistory !== 451) {
    throw new Error(`The ${mode} arm does not use the frozen 96 × 96 world and 451-sample history.`);
  }
  if (data.runtime?.node !== "24.2.0" || data.runtime?.platform !== "darwin" || data.runtime?.arch !== "arm64") {
    throw new Error(`The ${mode} arm was not recorded with the frozen Node 24.2.0 darwin/arm64 runtime.`);
  }

  if (isSplit) {
    if (!exactKeys(data.provenance, ["sourceSha256", "planSha256", "baselineArtifactSha256", "baselineDataSha256", "baselineIndexSha256", "baselineRegression"]) ||
        data.provenance.planSha256 !== PLAN_SHA256 || data.provenance.baselineArtifactSha256 !== BASELINE_RAW_SHA256 ||
        data.provenance.baselineDataSha256 !== BASELINE_DATA_SHA256 || data.provenance.baselineIndexSha256 !== BASELINE_INDEX_SHA256) {
      throw new Error("Split-band provenance does not bind the frozen plan and accepted historical baseline.");
    }
    expectedSourcePins(data);
    const proof = data.provenance.baselineRegression;
    if (!proof || proof.status !== "verified" || proof.seed !== 1203 || proof.comparedSamples !== 151 || proof.comparedFrames !== 151 ||
        proof.comparedTickRows !== 3000 || proof.comparedSnapshots !== 5 || !Array.isArray(proof.checkpoints) ||
        JSON.stringify(proof.checkpoints.map((entry) => entry.tick)) !== "[0,500,1500,2500,3000]" ||
        proof.checkpoints.some((entry) => !exactKeys(entry, ["tick", "stateSha256", "compared"]) || entry.compared !== true || !digest(entry.stateSha256))) {
      throw new Error("Split-band provenance lacks the complete 3,000-tick historical baseline regression proof.");
    }
  } else {
    if (!exactKeys(data.provenance, ["sourceSha256", "planSha256", "baselineArtifactSha256", "baselineDataSha256", "prefix"]) ||
        data.provenance.planSha256 !== "74dc68201c7fb51ed9a87ba75d13e0ad79b171ff0d73d7929af4ba4f03fa114a" ||
        data.provenance.baselineArtifactSha256 !== "8ce7be228812002e2d03a2f68a15b9d1107e6fff022006ae9059003bb66e0c9b" ||
        data.provenance.baselineDataSha256 !== "eb8a0985950d5de4450b1a911bd602761644a3adb96a9bd8265c5fd1e5af572e" ||
        !exactKeys(data.provenance.prefix, ["status", "seed", "normalization", "comparedSamples", "comparedFrames", "comparedTickRows", "comparedSnapshots", "checkpoints"]) ||
        data.provenance.prefix.status !== "not-applicable" || data.provenance.prefix.seed !== null ||
        data.provenance.prefix.normalization !== "none; stationary-band has no moving-reference prefix" ||
        data.provenance.prefix.comparedSamples !== 0 || data.provenance.prefix.comparedFrames !== 0 ||
        data.provenance.prefix.comparedTickRows !== 0 || data.provenance.prefix.comparedSnapshots !== 0 ||
        JSON.stringify(data.provenance.prefix.checkpoints) !== "[]") {
      throw new Error("The historical baseline provenance is not the accepted PR106 seed 1203 stationary replication record.");
    }
  }

  const frames = data.frames;
  const samples = data.samples;
  if (!Array.isArray(frames) || !Array.isArray(samples) || frames.length === 0 || frames.length !== samples.length) {
    throw new Error(`The ${mode} arm is missing aligned frames and samples.`);
  }
  const expectedTicks = [0];
  for (let tick = 20; tick <= run.finalTick; tick += 20) expectedTicks.push(tick);
  if (expectedTicks.at(-1) !== run.finalTick) expectedTicks.push(run.finalTick);
  if (frames.map((frame) => frame.tick).join(",") !== expectedTicks.join(",") || samples.some((sample, index) => sample.tick !== frames[index]?.tick)) {
    throw new Error(`The ${mode} arm is missing a recorded 20-tick sample or exact terminal frame.`);
  }
  if (!Array.isArray(data.tickRows) || data.tickRows.length !== run.finalTick) throw new Error(`${mode} tick history does not cover the actual run.`);
  for (let index = 0; index < data.tickRows.length; index++) {
    const row = data.tickRows[index], tick = index + 1;
    if (!row || row.tick !== tick || !Number.isSafeInteger(row.population) || row.population < 0 || row.population > 48 ||
        !Number.isSafeInteger(row.births) || row.births < 0 || !Number.isSafeInteger(row.deaths) || row.deaths < 0 ||
        row.cap48 !== (row.population === 48) || row.nearCap47 !== (row.population >= 47) || ((row.population === 0) !== (tick === run.extinctionTick))) {
      throw new Error(`${mode} tick row ${tick} is missing or contradicts the declared terminal state.`);
    }
  }

  const entries = [];
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index], sample = samples[index];
    if (!exactKeys(frame, ["tick", "censusSha256", "stateSha256", "foodBase64", "cells", "organisms", "ledger", "frameSha256"]) ||
        !exactKeys(sample, ["tick", "census", "environment", "censusSha256", "stateSha256", "frameSha256"])) {
      throw new Error(`${mode} frame/sample ${frame.tick} has unexpected or missing fields.`);
    }
    if (sample.tick !== frame.tick || !digest(frame.frameSha256) || !digest(frame.censusSha256) || !digest(frame.stateSha256) ||
        sample.frameSha256 !== frame.frameSha256 || sample.censusSha256 !== frame.censusSha256 || sample.stateSha256 !== frame.stateSha256) {
      throw new Error(`${mode} frame ${frame.tick} is not bound to its sample digests.`);
    }
    const food = decodeFood(frame.foodBase64, frame.tick);
    if (!Array.isArray(frame.cells) || !Array.isArray(frame.organisms)) throw new Error(`${mode} frame ${frame.tick} is missing body records.`);
    const organisms = new Map();
    for (const organism of frame.organisms) {
      if (!exactKeys(organism, ["id", "family", "genome"]) || !Number.isSafeInteger(organism.id) || organism.id < 1 || !Number.isInteger(organism.family) || organism.family < 0 || organism.family > 2 || !exactKeys(organism.genome, ["turnEvery", "turn", "branchEvery", "maxCells"]) || organisms.has(organism.id)) {
        throw new Error(`${mode} frame ${frame.tick} contains an invalid or repeated organism.`);
      }
      organisms.set(organism.id, organism);
    }
    const occupied = new Set();
    let previousTile = -1;
    for (const cell of frame.cells) {
      if (!Array.isArray(cell) || cell.length !== 2 || !Number.isSafeInteger(cell[0]) || cell[0] <= previousTile || cell[0] >= WORLD_CELLS || !organisms.has(cell[1]) || occupied.has(cell[0])) {
        throw new Error(`${mode} frame ${frame.tick} has a duplicate or invalid occupied tile.`);
      }
      occupied.add(cell[0]);
      previousTile = cell[0];
    }
    validateCensus(sample.census, frame.tick, organisms, occupied);
    validateEnvironment(sample.environment, mode, frame.tick);
    if (!exactKeys(frame.ledger, ["initialEnergy", "supplied", "dissipated", "deathLoss", "expected", "actual", "residual"]) ||
        ![frame.ledger.initialEnergy, frame.ledger.supplied, frame.ledger.dissipated, frame.ledger.deathLoss, frame.ledger.expected, frame.ledger.actual, frame.ledger.residual].every(Number.isSafeInteger) ||
        frame.ledger.supplied !== sample.environment.accepted || frame.ledger.actual !== food.reduce((sum, amount) => sum + amount, 0) + sample.census.totalEnergy ||
        frame.ledger.residual !== 0 || frame.ledger.expected !== frame.ledger.actual || frame.ledger.expected !== frame.ledger.initialEnergy + frame.ledger.supplied - frame.ledger.dissipated - frame.ledger.deathLoss) {
      throw new Error(`${mode} frame ${frame.tick} has inconsistent energy accounting.`);
    }
    if (await sha256Text(JSON.stringify(sample.census)) !== frame.censusSha256) throw new Error(`${mode} census digest at ${frame.tick} does not match its contents.`);
    const frameEnvelope = { ...frame };
    delete frameEnvelope.frameSha256;
    if (await sha256Text(JSON.stringify(frameEnvelope)) !== frame.frameSha256) throw new Error(`${mode} frame digest at ${frame.tick} does not match its contents.`);
    entries.push({ frame, sample, food, organisms, occupied });
  }
  if (run.extinctionTick === null && entries.at(-1).sample.census.population === 0 || run.extinctionTick !== null && entries.at(-1).sample.census.population !== 0) {
    throw new Error(`${mode} terminal population does not agree with its declared live or extinct state.`);
  }
  const requiredSnapshots = [0, 500, 1500, 2500, 3000, run.finalTick].filter((tick, index, all) => tick <= run.finalTick && all.indexOf(tick) === index);
  if (!Array.isArray(data.snapshots) || requiredSnapshots.some((tick) => !data.snapshots.some((snapshot) => snapshot.tick === tick))) {
    throw new Error(`${mode} arm is missing a required snapshot or actual terminal checkpoint.`);
  }
  for (const snapshot of data.snapshots) {
    const sample = samples.find((item) => item.tick === snapshot.tick);
    if (!sample || snapshot.terminal !== (run.extinctionTick !== null && snapshot.tick === run.finalTick) ||
        snapshot.stateSha256 !== sample.stateSha256 || JSON.stringify(snapshot.environment) !== JSON.stringify(sample.environment) ||
        await sha256Text(JSON.stringify({ state: snapshot.state, environment: snapshot.environment })) !== snapshot.stateSha256) {
      throw new Error(`${mode} snapshot ${snapshot.tick} does not match the saved state and environment.`);
    }
  }
  if (!data.repeat || data.repeat.verified !== true || data.repeat.comparedThroughTick !== run.finalTick || data.repeat.stateChecks !== frames.length || data.repeat.frameChecks !== frames.length) {
    throw new Error(`${mode} independent repeat does not cover the complete saved run.`);
  }
  if (!data.final || JSON.stringify(data.final.census) !== JSON.stringify(samples.at(-1).census) ||
      JSON.stringify(data.final.environment) !== JSON.stringify(samples.at(-1).environment) || !Array.isArray(data.final.lineage)) {
    throw new Error(`${mode} final summary does not match its terminal sample.`);
  }

  if (isSplit) {
    validateSplitGates(data, entries);
  } else {
    if (run.finalTick !== 3000 || run.extinctionTick !== null) throw new Error("The pinned historical stationary baseline must be alive at tick 3,000.");
  }
  return { data, entries };
}

function validateSplitGates(data, entries) {
  const windows = data.windows;
  if (!Array.isArray(windows) || windows.length !== 3 || windows.some((window, i) => window.from !== 1501 + i * 500 || window.to !== 2000 + i * 500 || window.denominatorTicks !== 500)) {
    throw new Error("Split-band evidence is missing its three frozen 500-tick windows.");
  }
  for (const window of windows) {
    const active = data.tickRows.filter((row) => row.tick >= window.from && row.tick <= window.to);
    const status = active.length === 500 ? "complete" : active.length ? "partial" : "not-reached";
    const totals = {
      births: active.length ? active.reduce((sum, row) => sum + row.births, 0) : null,
      deaths: active.length ? active.reduce((sum, row) => sum + row.deaths, 0) : null,
      cap48Ticks: active.length ? active.filter((row) => row.cap48).length : null,
      nearCap47Ticks: active.length ? active.filter((row) => row.nearCap47).length : null,
      blockedCapAttempts: active.length ? active.reduce((sum, row) => sum + row.blockedCap, 0) : null,
      blockedSpaceAttempts: active.length ? active.reduce((sum, row) => sum + row.blockedSpace, 0) : null,
      minPopulation: active.length ? Math.min(...active.map((row) => row.population)) : null,
      maxPopulation: active.length ? Math.max(...active.map((row) => row.population)) : null,
    };
    if (window.status !== status || window.executedTicks !== active.length || Object.entries(totals).some(([key, value]) => window[key] !== value)) {
      throw new Error(`Split-band window ${window.from}–${window.to} disagrees with its per-tick rows.`);
    }
    const executed = active.length > 0;
    const endpointTick = executed ? active.at(-1).tick : null;
    const endpointEntry = executed ? entries.find((entry) => entry.frame.tick === endpointTick) : null;
    const startSample = executed ? data.samples.find((sample) => sample.tick === window.from - 1) : null;
    if (executed && (!endpointEntry || !startSample)) throw new Error(`Split-band window ${window.from}–${window.to} is missing saved endpoints.`);
    const food = executed ? {
      offered: endpointEntry.sample.environment.offered - startSample.environment.offered,
      accepted: endpointEntry.sample.environment.accepted - startSample.environment.accepted,
      overflow: endpointEntry.sample.environment.overflow - startSample.environment.overflow,
    } : { offered: null, accepted: null, overflow: null };
    const occupiedByBand = endpointEntry ? [0, 0] : null;
    if (endpointEntry) for (const tile of endpointEntry.occupied) {
      const column = tile % WORLD_WIDTH;
      if (column <= 23) occupiedByBand[0]++;
      else if (column >= 48 && column <= 71) occupiedByBand[1]++;
    }
    const endpoint = window.endpoint;
    if (!endpoint || endpoint.requestedTick !== window.to || endpoint.actualTick !== endpointTick ||
        JSON.stringify(window.food) !== JSON.stringify(food) ||
        (endpointEntry && (endpoint.population !== endpointEntry.sample.census.population || endpoint.cells !== endpointEntry.sample.census.cells ||
          JSON.stringify(endpoint.familyCounts) !== JSON.stringify(endpointEntry.sample.census.familyCounts) || endpoint.maxGeneration !== endpointEntry.sample.census.maxGeneration ||
          endpoint.foodRemaining !== endpointEntry.food.reduce((sum, amount) => sum + amount, 0) ||
          JSON.stringify(endpoint.occupiedTilesByBand) !== JSON.stringify(occupiedByBand))) ||
        (!endpointEntry && (endpoint.population !== null || endpoint.cells !== null || endpoint.familyCounts !== null || endpoint.occupiedTilesByBand !== null))) {
      throw new Error(`Split-band window ${window.from}–${window.to} endpoint or food totals disagree with saved evidence.`);
    }
  }
  const windowsReached = windows.every((window) => window.status === "complete" && window.executedTicks === 500);
  const computedNumerical = {
    aliveAt3000: data.run.finalTick === 3000 && data.final.census.population > 0,
    atLeastTwoFamiliesAt3000: data.run.finalTick === 3000 && data.final.census.population > 0 && data.final.census.familyCounts.filter((count) => count > 0).length >= 2,
    allWindowsReached: windowsReached,
    eachNewWindowHasBirthsAndDeaths: windowsReached && windows.every((window) => window.births > 0 && window.deaths > 0),
    eachNewWindowCap48AtMost99: windowsReached && windows.every((window) => window.cap48Ticks <= 99),
  };
  const numericalPass = Object.values(computedNumerical).every(Boolean);
  if (!exactKeys(data.numericalGate, ["aliveAt3000", "atLeastTwoFamiliesAt3000", "allWindowsReached", "eachNewWindowHasBirthsAndDeaths", "eachNewWindowCap48AtMost99", "numericalPass", "note"]) ||
      Object.entries(computedNumerical).some(([key, value]) => data.numericalGate[key] !== value) || data.numericalGate.numericalPass !== numericalPass || typeof data.numericalGate.note !== "string") {
    throw new Error("The split-band numerical gate does not match the saved endpoints and window records.");
  }
  const gate = data.spatialGate;
  if (!exactKeys(gate, ["requiredTilesPerBand", "checkpoints", "pass"]) || gate.requiredTilesPerBand !== 10 || !Array.isArray(gate.checkpoints) ||
      gate.pass !== (gate.checkpoints.length === 2 && gate.checkpoints.every((entry) => entry.pass))) {
    throw new Error("The split-band occupancy gate is missing or contradictory.");
  }
  for (const tick of [2500, 3000]) {
    const checkpoint = gate.checkpoints.find((entry) => entry.tick === tick);
    const frameEntry = entries.find((entry) => entry.frame.tick === tick);
    if (!checkpoint || !exactKeys(checkpoint, ["tick", "occupiedTilesByBand", "pass"])) {
      throw new Error(`Split-band occupancy evidence is missing exact frame ${tick}.`);
    }
    if (!frameEntry) {
      if (data.run.extinctionTick === null || data.run.extinctionTick >= tick || checkpoint.occupiedTilesByBand !== null || checkpoint.pass !== false) {
        throw new Error(`Split-band occupancy evidence is missing reached endpoint ${tick}.`);
      }
      continue;
    }
    if (!Array.isArray(checkpoint.occupiedTilesByBand) || checkpoint.occupiedTilesByBand.length !== 2) throw new Error(`Split-band occupancy evidence at ${tick} is malformed.`);
    const counts = [0, 0];
    for (const tile of frameEntry.occupied) {
      const column = tile % WORLD_WIDTH;
      if (column <= 23) counts[0]++;
      else if (column >= 48 && column <= 71) counts[1]++;
    }
    if (JSON.stringify(checkpoint.occupiedTilesByBand) !== JSON.stringify(counts) ||
        checkpoint.pass !== counts.every((count) => count >= gate.requiredTilesPerBand)) {
      throw new Error(`Split-band occupancy gate at ${tick} does not match the actual saved body tiles.`);
    }
  }
}

function validateIndex(index, indexUrl) {
  if (!exactKeys(index, ["schemaVersion", "kind", "seed", "planSha256", "arms", "decision"]) || index.schemaVersion !== 1 ||
      index.kind !== "hungry-shapes-split-food-replication-pair" || index.seed !== 1203 || index.planSha256 !== PLAN_SHA256 ||
      !exactKeys(index.arms, ["baseline", "split"])) throw new Error("The pair index is not the frozen seed 1203 split-food record.");
  for (const [key, expectedMode, expectedFile, expectedRaw] of [
    ["baseline", "stationary-band", BASELINE_NAME, BASELINE_RAW_SHA256],
    ["split", "split-band", SPLIT_NAME, null],
  ]) {
    const item = index.arms[key];
    if (!exactKeys(item, ["mode", "url", "rawSha256"]) || item.mode !== expectedMode || item.url !== expectedFile || !digest(item.rawSha256) || (expectedRaw && item.rawSha256 !== expectedRaw)) {
      throw new Error(`The pair index has an invalid ${key} arm entry.`);
    }
    const resolved = new URL(item.url, indexUrl);
    if (resolved.origin !== indexUrl.origin || resolved.pathname !== new URL(expectedFile, indexUrl).pathname) {
      throw new Error(`The ${key} arm URL must use its canonical file in the evidence directory.`);
    }
  }
  const decision = index.decision;
  if (!decision || !exactKeys(decision, ["status", "summary", "baselineArtifactSha256", "splitArtifactSha256", ...(decision.status === "pending" ? [] : ["visualReceiptUrl", "visualReceiptSha256"])]) ||
      !["pending", "promising", "stop"].includes(decision.status) || typeof decision.summary !== "string" || !decision.summary.trim() ||
      decision.baselineArtifactSha256 !== index.arms.baseline.rawSha256 || decision.splitArtifactSha256 !== index.arms.split.rawSha256) {
    throw new Error("The decision is not bound to the raw SHA-256 values of both listed arms.");
  }
  if (decision.status === "pending") {
    if ("visualReceiptUrl" in decision || "visualReceiptSha256" in decision) throw new Error("A pending pair cannot carry an accepted visual receipt.");
  } else if (decision.visualReceiptUrl !== RECEIPT_NAME || !digest(decision.visualReceiptSha256)) {
    throw new Error("A reviewed decision must use its canonical SHA-bound receipt.");
  }
}

async function fetchArm(item, mode, indexUrl, generation) {
  const response = await fetch(new URL(item.url, indexUrl), { headers: { Accept: "application/json" }, cache: "no-store" });
  if (generation !== loadGeneration) return null;
  if (!response.ok) throw new Error(`The listed ${mode} record answered ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (generation !== loadGeneration) return null;
  if (bytes.byteLength > MAX_ARM_BYTES) throw new Error(`The listed ${mode} record exceeds the 24 MiB limit.`);
  if (await sha256Hex(bytes) !== item.rawSha256) throw new Error(`The ${mode} raw-file SHA-256 does not match the pair index.`);
  if (mode === "stationary-band" && item.rawSha256 !== BASELINE_RAW_SHA256) throw new Error("The baseline is not the accepted PR106 stationary replication seed 1203 record.");
  if (generation !== loadGeneration) return null;
  const data = JSON.parse(new TextDecoder().decode(bytes));
  return validateArm(data, mode);
}

async function fetchReceipt(decision, indexUrl, generation) {
  if (decision.status === "pending") return null;
  const response = await fetch(new URL(decision.visualReceiptUrl, indexUrl), { headers: { Accept: "application/json" }, cache: "no-store" });
  if (generation !== loadGeneration) return null;
  if (!response.ok) throw new Error(`The listed visual receipt answered ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (generation !== loadGeneration) return null;
  if (bytes.byteLength > 1024 * 1024) throw new Error("The visual receipt exceeds the 1 MiB limit.");
  if (await sha256Hex(bytes) !== decision.visualReceiptSha256) throw new Error("The visual receipt raw-file SHA-256 does not match the decision.");
  const receipt = JSON.parse(new TextDecoder().decode(bytes));
  if (!exactKeys(receipt, ["seed", "planSha256", "baselineArtifactSha256", "splitArtifactSha256", "splitChange", "sameAgeComparisons", "visualReviewedBeforeOverlapDiagnostics", "reviewedAtUTC"]) ||
      receipt.seed !== 1203 || receipt.planSha256 !== PLAN_SHA256 || receipt.baselineArtifactSha256 !== decision.baselineArtifactSha256 ||
      receipt.splitArtifactSha256 !== decision.splitArtifactSha256 || receipt.visualReviewedBeforeOverlapDiagnostics !== true ||
      typeof receipt.reviewedAtUTC !== "string" || !receipt.reviewedAtUTC.trim() ||
      !exactKeys(receipt.splitChange, ["from", "to", "pass", "observation"]) || receipt.splitChange.from !== 2500 || receipt.splitChange.to !== 3000 ||
      typeof receipt.splitChange.pass !== "boolean" || typeof receipt.splitChange.observation !== "string" || !receipt.splitChange.observation.trim() ||
      !Array.isArray(receipt.sameAgeComparisons) || JSON.stringify(receipt.sameAgeComparisons.map((item) => item.tick)) !== "[1500,2500,3000]" ||
      receipt.sameAgeComparisons.some((item) => !exactKeys(item, ["tick", "observation"]) || typeof item.observation !== "string" || !item.observation.trim())) {
    throw new Error("The SHA-matched visual receipt does not bind complete seed, plan, arm, and frame observations.");
  }
  const disclosed = [receipt.splitChange.observation, ...receipt.sameAgeComparisons.map((item) => item.observation)].every((text) =>
    /not blind/i.test(text) && /historical baseline/i.test(text) && /numerical outcome/i.test(text));
  if (!disclosed) throw new Error("Visual notes must disclose that review was not blind to the historical baseline and numerical outcome.");
  return receipt;
}

function verifyDecision(decision, baseline, split, receipt) {
  const computedStatus = split.data.numericalGate.numericalPass && split.data.spatialGate.pass && receipt?.splitChange.pass ? "promising" : "stop";
  if (decision.status === "pending") return;
  if (decision.status !== computedStatus) throw new Error(`The decision conflicts with saved gates and review (expected ${computedStatus}).`);
}

function familyColor(organism) {
  if (!organism) return "#e5eee9";
  const hue = FAMILY_HUES[organism.family] ?? 154;
  return `hsl(${hue} 74% 63%)`;
}
function drawBandOutline(ctx, size, columns) {
  const tile = size / WORLD_WIDTH;
  ctx.save();
  ctx.strokeStyle = "#edce91";
  ctx.lineWidth = Math.max(1.5, tile * .45);
  for (const [left, right] of columns) ctx.strokeRect(left * tile + ctx.lineWidth / 2, ctx.lineWidth / 2, (right - left + 1) * tile - ctx.lineWidth, size - ctx.lineWidth);
  ctx.restore();
}
function formatFrameLabel(arm, targetTick, frameTick) {
  if (targetTick > arm.data.run.finalTick && arm.data.run.extinctionTick !== null) return `Extinct · actual tick ${fmt(arm.data.run.finalTick)} · holding terminal frame`;
  if (frameTick !== targetTick) return `Tick ${fmt(frameTick)} · saved sample · timeline ${fmt(targetTick)}`;
  if (arm.data.run.extinctionTick === frameTick) return `Extinct · actual tick ${fmt(frameTick)}`;
  return `Tick ${fmt(frameTick)} · saved sample`;
}
function setMetrics(key, entry, mode) {
  const prefix = key;
  const sample = entry.sample;
  byId(`${prefix}-tick`).textContent = fmt(entry.frame.tick);
  byId(`${prefix}-population`).textContent = fmt(sample.census.population);
  byId(`${prefix}-cells`).textContent = fmt(sample.census.cells);
  byId(`${prefix}-families`).textContent = sample.census.familyCounts.map(fmt).join(" · ");
  byId(`${prefix}-offered`).textContent = fmt(sample.environment.offered);
  byId(`${prefix}-accepted`).textContent = fmt(sample.environment.accepted);
  byId(`${prefix}-overflow`).textContent = fmt(sample.environment.overflow);
  byId(`${prefix}-food`).textContent = fmt(entry.food.reduce((sum, amount) => sum + amount, 0));
  if (mode === "split-band") {
    const counts = [0, 0];
    for (const tile of entry.occupied) {
      const column = tile % WORLD_WIDTH;
      if (column <= 23) counts[0]++;
      else if (column >= 48 && column <= 71) counts[1]++;
    }
    byId("split-band-one").textContent = fmt(counts[0]);
    byId("split-band-two").textContent = fmt(counts[1]);
  }
}
function renderArm(key, arm, targetTick) {
  const entry = [...arm.entries].reverse().find((candidate) => candidate.frame.tick <= targetTick) ?? arm.entries[0];
  const ctx = contexts[key], canvas = canvases[key], size = canvas.width, tileSize = size / WORLD_WIDTH;
  ctx.fillStyle = "#09151a";
  ctx.fillRect(0, 0, size, size);
  for (let index = 0; index < entry.food.length; index++) {
    const amount = entry.food[index];
    if (!amount) continue;
    ctx.fillStyle = `rgba(175, 229, 187, ${Math.min(.34, .04 + amount / 40 * .30)})`;
    const x = index % WORLD_WIDTH, y = Math.floor(index / WORLD_WIDTH);
    ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
  }
  for (const [tileIndex, id] of entry.frame.cells) {
    const organism = entry.organisms.get(id);
    ctx.fillStyle = familyColor(organism);
    const x = tileIndex % WORLD_WIDTH, y = Math.floor(tileIndex / WORLD_WIDTH);
    ctx.fillRect(x * tileSize + .15, y * tileSize + .15, Math.max(1, tileSize - .3), Math.max(1, tileSize - .3));
  }
  drawBandOutline(ctx, size, key === "baseline" ? [[0, 47]] : [[0, 23], [48, 71]]);
  byId(`${key}-frame-label`).textContent = formatFrameLabel(arm, targetTick, entry.frame.tick);
  canvas.setAttribute("aria-label", `Recorded ${arm.data.run.mode} world at actual tick ${fmt(entry.frame.tick)}; ${fmt(entry.sample.census.population)} living bodies, ${fmt(entry.sample.census.cells)} occupied cells.`);
  setMetrics(key, entry, arm.data.run.mode);
}
function renderCurrent() {
  if (!pair) return;
  const tick = timelineTicks[currentIndex];
  renderArm("baseline", pair.baseline, tick);
  renderArm("split", pair.split, tick);
  scrub.value = String(currentIndex);
  scrubValue.value = `${fmt(tick)} · ${currentIndex + 1} / ${timelineTicks.length}`;
  scrubValue.textContent = scrubValue.value;
  previousButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === timelineTicks.length - 1;
  for (const button of document.querySelectorAll("[data-jump-tick]")) button.disabled = Number(button.dataset.jumpTick) > timelineTicks.at(-1);
  const extinct = [pair.baseline, pair.split].filter((arm) => arm.data.run.extinctionTick !== null);
  const note = byId("extinction-note");
  note.hidden = extinct.length === 0;
  if (extinct.length) note.textContent = extinct.map((arm) => `${arm.data.run.mode} world became extinct at actual tick ${fmt(arm.data.run.extinctionTick)}; the terminal frame is held while the paired timeline continues.`).join(" ");
  if (currentIndex === timelineTicks.length - 1) stopPlayback();
}
function resizeCanvases() {
  if (!pair) return;
  for (const canvas of Object.values(canvases)) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) continue;
    const ratio = window.devicePixelRatio || 1;
    const size = Math.max(1, Math.round(rect.width * ratio));
    if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size; }
  }
  renderCurrent();
}
function moveTo(index) {
  currentIndex = Math.max(0, Math.min(timelineTicks.length - 1, index));
  renderCurrent();
}
function renderWindows() {
  const rows = [];
  for (const [key, arm] of [["Historical baseline", pair.baseline], ["Split bands", pair.split]]) {
    for (const window of arm.data.windows) {
      const label = `${fmt(window.from)}–${fmt(window.to)}`;
      if (window.status === "not-reached") { rows.push(`<tr><th scope="row">${key}<br>${label}</th><td colspan="6">Not reached · no executed ticks</td></tr>`); continue; }
      const end = window.endpoint;
      rows.push(`<tr><th scope="row">${key}<br>${label}${window.status === "partial" ? `<br><span class="muted">${fmt(window.executedTicks)} executed · tick ${fmt(end.actualTick)}</span>` : ""}</th><td>${fmt(window.births)} · ${fmt(window.deaths)}</td><td>${fmt(window.minPopulation)}–${fmt(window.maxPopulation)} · ${fmt(end.population)}</td><td>${fmt(window.cap48Ticks)} / 500</td><td>${fmt(window.food.offered)} · ${fmt(window.food.accepted)} · ${fmt(window.food.overflow)}</td><td>${end.familyCounts.map(fmt).join(" / ")}</td><td>${fmt(end.genomeCounts.length)}</td></tr>`);
    }
  }
  byId("window-rows").innerHTML = rows.join("");
}
function renderGates(receipt) {
  const spatial = pair.split.data.spatialGate;
  byId("numerical-gate").textContent = pair.split.data.numericalGate.numericalPass ? "Pass" : "Did not pass";
  for (const tick of [2500, 3000]) {
    const item = spatial.checkpoints.find((entry) => entry.tick === tick);
    byId(`spatial-${tick}`).textContent = item.occupiedTilesByBand
      ? `${item.occupiedTilesByBand.map(fmt).join(" · ")} occupied tiles · ${item.pass ? "pass" : "did not pass"}`
      : `Unavailable · terminal before tick ${fmt(tick)} · did not pass`;
  }
  byId("visual-gate").textContent = receipt ? `${receipt.splitChange.pass ? "Pass" : "Did not pass"} · ${receipt.splitChange.observation}` : "Pending visual review";
  const comparisons = byId("same-age-comparisons");
  comparisons.replaceChildren();
  if (!receipt) comparisons.append(Object.assign(document.createElement("li"), { textContent: "Pending the saved visual receipt." }));
  else for (const entry of receipt.sameAgeComparisons) {
    const item = document.createElement("li");
    item.textContent = `Tick ${fmt(entry.tick)} · ${entry.observation}`;
    comparisons.append(item);
  }
  const summary = pair.index.decision;
  byId("decision-status").textContent = summary.status === "promising" ? "Promising" : summary.status === "stop" ? "Stop" : "Pending";
  byId("decision-status").dataset.status = summary.status;
  byId("decision-summary").textContent = summary.summary;
  byId("pair-decision-status").textContent = `Recorded decision · ${summary.status}`;
  byId("pair-decision-summary").textContent = summary.summary;
  byId("pair-decision").hidden = summary.status === "pending";
}
async function loadPair() {
  const generation = ++loadGeneration;
  pair = null;
  timelineTicks = [];
  stopPlayback();
  replay.hidden = true;
  errorState.hidden = true;
  emptyState.hidden = false;
  byId("decision-status").textContent = "Pending";
  byId("decision-status").dataset.status = "pending";
  byId("decision-summary").textContent = "A decision appears only after the saved records, source identities, raw-file hashes, gate evidence, and SHA-bound visual receipt verify. Pending is not a pass.";
  byId("pair-decision").hidden = true;
  const indexUrl = new URL(`./${PAIR_INDEX_NAME}`, import.meta.url);
  try {
    status("Checking only the seed 1203 split-food replication pair index…");
    const response = await fetch(indexUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (generation !== loadGeneration) return;
    if (response.status === 404) { status("No seed 1203 split-food replication pair index is published yet."); return; }
    if (!response.ok) throw new Error(`The split-food pair index answered ${response.status}.`);
    const index = await response.json();
    if (generation !== loadGeneration) return;
    validateIndex(index, indexUrl);
    status("Checking the explicitly listed historical baseline, split-band record, and receipt…");
    const [baseline, split, receipt] = await Promise.all([
      fetchArm(index.arms.baseline, "stationary-band", indexUrl, generation),
      fetchArm(index.arms.split, "split-band", indexUrl, generation),
      fetchReceipt(index.decision, indexUrl, generation),
    ]);
    if (generation !== loadGeneration || !baseline || !split || index.decision.status !== "pending" && !receipt) return;
    if (split.data.provenance.baselineRegression.checkpoints.some((checkpoint) => {
      const baselineSample = baseline.data.samples.find((sample) => sample.tick === checkpoint.tick);
      return !baselineSample || checkpoint.stateSha256 !== baselineSample.stateSha256;
    })) throw new Error("The split-run baseline regression checkpoints do not match the accepted historical baseline.");
    verifyDecision(index.decision, baseline, split, receipt);
    pair = { index, baseline, split, receipt };
    timelineTicks = [...new Set([...baseline.entries.map((entry) => entry.frame.tick), ...split.entries.map((entry) => entry.frame.tick)])].sort((a, b) => a - b);
    if (!timelineTicks.length || timelineTicks[0] !== 0) throw new Error("The paired recordings do not contain a shared tick-zero frame.");
    emptyState.hidden = true;
    replay.hidden = false;
    byId("replay-title").textContent = "Seed 1203 · baseline and split-band states";
    playButton.disabled = false;
    previousButton.disabled = true;
    nextButton.disabled = timelineTicks.length < 2;
    scrub.disabled = false;
    scrub.min = "0";
    scrub.max = String(timelineTicks.length - 1);
    scrub.value = "0";
    for (const button of document.querySelectorAll("[data-jump-tick]")) button.disabled = Number(button.dataset.jumpTick) > timelineTicks.at(-1);
    renderWindows();
    renderGates(receipt);
    currentIndex = 0;
    resizeCanvases();
    moveTo(0);
    status("Historical baseline and split-band record verified · paused at tick 0.", "ready");
  } catch (error) {
    if (generation !== loadGeneration) return;
    showError(error instanceof Error ? error.message : String(error));
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
    if (document.hidden) { stopPlayback(); runState.textContent = "Paused while away"; return; }
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
document.addEventListener("visibilitychange", () => { if (document.hidden && playing) { stopPlayback(); runState.textContent = "Paused while away"; } });
document.addEventListener("keydown", (event) => {
  if ((event.code === "ArrowRight" || event.code === "ArrowLeft") && !event.defaultPrevented && !event.repeat &&
      !(event.target instanceof HTMLElement && /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(event.target.tagName)) && timelineTicks.length) {
    event.preventDefault();
    moveTo(Math.max(0, Math.min(timelineTicks.length - 1, currentIndex + (event.code === "ArrowRight" ? 1 : -1))));
    return;
  }
  if (event.code !== "Space" || event.defaultPrevented || event.repeat || event.target instanceof HTMLElement && /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
  event.preventDefault();
  playButton.click();
});
window.addEventListener("resize", resizeCanvases, { passive: true });
void loadPair();
