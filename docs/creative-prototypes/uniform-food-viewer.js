const MANIFEST_URL = new URL("./uniform-food-index.json", import.meta.url);
const WORLD_WIDTH = 96;
const WORLD_CELLS = WORLD_WIDTH * WORLD_WIDTH;
const FAMILY_HUES = [154, 37, 249];
const fmt = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "—";
const byId = (id) => document.getElementById(id);

const sourceStatus = byId("source-status");
const emptyState = byId("empty-state");
const errorState = byId("error-state");
const replay = byId("replay");
const canvas = byId("world");
const ctx = canvas.getContext("2d");
const previousButton = byId("previous");
const playButton = byId("play");
const nextButton = byId("next");
const scrub = byId("scrub");
const scrubValue = byId("scrub-value");
const runState = byId("run-state");

let records = [];
let manifestRecord = null;
let selectedRun = null;
let currentIndex = 0;
let playing = false;
let playbackTimer = 0;
let loadGeneration = 0;

function status(message, kind = "") {
  sourceStatus.textContent = message;
  sourceStatus.dataset.kind = kind;
}

function showError(message) {
  stopPlayback();
  replay.hidden = true;
  emptyState.hidden = true;
  errorState.hidden = false;
  byId("error-detail").textContent = message;
  status("The listed evidence could not be loaded.", "error");
}

function stopPlayback() {
  playing = false;
  if (playbackTimer) window.clearInterval(playbackTimer);
  playbackTimer = 0;
  if (playButton) {
    playButton.textContent = "Play";
    playButton.setAttribute("aria-label", "Play sampled replay");
  }
  if (runState) runState.textContent = "Paused · recorded replay";
}

function setSeedDecision(decision, seed) {
  const panel = byId("seed-decision");
  if (!decision) { panel.hidden = true; return; }
  const label = decision.status === "pass" ? "Promising" : decision.status === "stop" ? "Stopped" : "Pending";
  byId("seed-decision-status").textContent = `Seed ${fmt(seed)} decision · ${label}`;
  byId("seed-decision-summary").textContent = typeof decision.summary === "string" ? decision.summary : "No explanatory note was recorded.";
  panel.hidden = false;
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify SHA-256 here, so accepted evidence was not displayed.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const sha256Text = (text) => sha256Hex(new TextEncoder().encode(text));

function decodeFood(base64) {
  if (typeof base64 !== "string") throw new Error("Frame food is missing its recorded byte string.");
  let binary;
  try { binary = atob(base64); } catch { throw new Error("Frame food is not valid base64 data."); }
  if (binary.length !== WORLD_CELLS) throw new Error("Frame food does not contain all 96 × 96 world tiles.");
  const food = new Uint8Array(WORLD_CELLS);
  for (let i = 0; i < binary.length; i++) {
    const amount = binary.charCodeAt(i);
    if (amount > 40) throw new Error("Frame food contains a value outside the recorded 0–40 range.");
    food[i] = amount;
  }
  return food;
}

async function validateRun(data, expectedSeed) {
  if (!data || data.schemaVersion !== 1 || data.kind !== "hungry-shapes-uniform-long-run") throw new Error("The listed file is not a supported uniform-food evidence record.");
  if (typeof data.dataSha256 !== "string" || !/^[a-f0-9]{64}$/.test(data.dataSha256)) throw new Error("The evidence is missing its internal SHA-256 digest.");
  const canonical = { ...data };
  delete canonical.dataSha256;
  if (await sha256Text(JSON.stringify(canonical)) !== data.dataSha256) throw new Error("The evidence internal SHA-256 digest does not match its contents.");
  const run = data.run;
  if (!run || run.seed !== expectedSeed || run.mode !== "uniform" || run.mutation !== true || run.maxTick !== 6000) {
    throw new Error("The listed evidence does not match its seed, uniform mode, mutation setting, or 6,000-tick cap.");
  }
  if (!Number.isSafeInteger(run.finalTick) || run.finalTick < 0 || run.finalTick > 6000 ||
      !(run.extinctionTick === null || run.extinctionTick === run.finalTick)) {
    throw new Error("The run has an invalid actual terminal tick.");
  }
  if (run.extinctionTick === null && run.finalTick !== 6000) {
    throw new Error("A living recording must include the full 6,000-tick horizon.");
  }
  if (!Array.isArray(data.samples) || !Array.isArray(data.frames) || data.samples.length === 0 || data.samples.length !== data.frames.length) {
    throw new Error("The evidence is missing its aligned census samples or replay frames.");
  }
  const frameByTick = new Map();
  let previousTick = -1;
  for (const frame of data.frames) {
    if (!Number.isSafeInteger(frame.tick) || frame.tick <= previousTick || frame.tick > run.finalTick ||
        (frame.tick % 20 !== 0 && frame.tick !== run.finalTick)) {
      throw new Error("Replay frames are out of order or outside the recorded 20-tick cadence.");
    }
    previousTick = frame.tick;
    const food = decodeFood(frame.foodBase64);
    if (!Array.isArray(frame.cells) || !Array.isArray(frame.organisms)) throw new Error(`Frame ${frame.tick} is missing body or organism records.`);
    const organisms = new Map();
    for (const organism of frame.organisms) {
      if (!Number.isSafeInteger(organism.id) || organism.id < 1 || !Number.isInteger(organism.family) || organism.family < 0 || organism.family > 2 || !organism.genome) {
        throw new Error(`Frame ${frame.tick} has an invalid founder-family or genome record.`);
      }
      if (organisms.has(organism.id)) throw new Error(`Frame ${frame.tick} repeats a body identifier.`);
      organisms.set(organism.id, organism);
    }
    const occupied = new Set();
    for (const entry of frame.cells) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) || entry[0] < 0 || entry[0] >= WORLD_CELLS ||
          !organisms.has(entry[1]) || occupied.has(entry[0])) {
        throw new Error(`Frame ${frame.tick} has an invalid or duplicate occupied tile.`);
      }
      occupied.add(entry[0]);
    }
    const sample = data.samples[frameByTick.size];
    if (!sample || sample.tick !== frame.tick || !sample.census || !sample.environment ||
        sample.census.population !== organisms.size || sample.census.cells !== occupied.size ||
        sample.census.familyCounts?.length !== 3 || sample.census.familyCounts.reduce((a, b) => a + b, 0) !== organisms.size ||
        sample.census.familyCounts.some((count, family) => count !== [...organisms.values()].filter((organism) => organism.family === family).length) ||
        sample.environment.offered !== sample.environment.accepted + sample.environment.overflow ||
        !Number.isSafeInteger(sample.environment.offered) || !Number.isSafeInteger(sample.environment.accepted) || !Number.isSafeInteger(sample.environment.overflow)) {
      throw new Error(`Frame ${frame.tick} does not agree with its recorded census and food ledger.`);
    }
    if (!/^[a-f0-9]{64}$/.test(frame.frameSha256 ?? "") || !/^[a-f0-9]{64}$/.test(frame.censusSha256 ?? "") ||
        !/^[a-f0-9]{64}$/.test(frame.stateSha256 ?? "") || sample.frameSha256 !== frame.frameSha256 ||
        sample.censusSha256 !== frame.censusSha256 || sample.stateSha256 !== frame.stateSha256 ||
        await sha256Text(JSON.stringify(sample.census)) !== sample.censusSha256) {
      throw new Error(`Frame ${frame.tick} has a missing or mismatched sample digest.`);
    }
    const frameBase = { tick: frame.tick, censusSha256: frame.censusSha256, stateSha256: frame.stateSha256,
      foodBase64: frame.foodBase64, cells: frame.cells, organisms: frame.organisms, ledger: frame.ledger };
    if (await sha256Text(JSON.stringify(frameBase)) !== frame.frameSha256) throw new Error(`Frame ${frame.tick} SHA-256 does not match its contents.`);
    if (sample.census.population === 0 && frame.tick !== run.finalTick) {
      throw new Error(`Population first reached zero before the recorded terminal tick ${run.finalTick}.`);
    }
    frameByTick.set(frame.tick, { frame, sample, food, organisms });
  }
  const expectedTicks = [0];
  for (let tick = 20; tick <= run.finalTick; tick += 20) expectedTicks.push(tick);
  if (expectedTicks.at(-1) !== run.finalTick) expectedTicks.push(run.finalTick);
  if (data.frames.map((frame) => frame.tick).join(",") !== expectedTicks.join(",") ||
      data.samples.some((sample, i) => sample.tick !== data.frames[i]?.tick)) {
    throw new Error("The replay is missing a 20-tick sample, an exact terminal frame, or aligned samples.");
  }
  const terminalPopulation = data.samples.at(-1)?.census?.population;
  if (run.extinctionTick === null && (!Number.isSafeInteger(terminalPopulation) || terminalPopulation < 1)) {
    throw new Error("The live 6,000-tick recording must end with a living population.");
  }
  if (run.extinctionTick !== null && terminalPopulation !== 0) {
    throw new Error("The extinction tick must end with zero living bodies.");
  }
  if (!Array.isArray(data.windows) || data.windows.length !== 4 ||
      data.windows.some((window, i) => window.from !== [2501, 3501, 4501, 5501][i] || window.to !== [3000, 4000, 5000, 6000][i] ||
        !window.endpoint || !Array.isArray(window.endpoint.familyCounts) || !Array.isArray(window.endpoint.genomeCounts))) {
    throw new Error("The evidence does not include all four frozen 500-tick windows.");
  }
  return { data, frames: [...frameByTick.values()] };
}

function organismColor(organism) {
  const genome = organism.genome;
  let hash = 2166136261;
  for (const value of [genome.turnEvery, genome.turn + 1, genome.branchEvery, genome.maxCells]) {
    if (!Number.isFinite(value)) throw new Error("A recorded organism has an invalid genome palette.");
    hash = Math.imul(hash ^ value, 16777619);
  }
  const light = 66 + (hash >>> 0) % 5 * 4;
  return `hsl(${FAMILY_HUES[organism.family]} 67% ${light}%)`;
}

function resizeCanvas() {
  if (!selectedRun) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.max(1, Math.round(canvas.getBoundingClientRect().width * dpr));
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  renderFrame();
}

function renderFrame() {
  if (!selectedRun || !ctx) return;
  const record = selectedRun.frames[currentIndex];
  if (!record) return;
  const { frame, sample, food, organisms } = record;
  const size = canvas.width;
  const tile = size / WORLD_WIDTH;
  ctx.fillStyle = "#09151a";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < food.length; i++) {
    const amount = food[i];
    if (amount === 0) continue;
    const alpha = Math.min(.34, .04 + amount / 40 * .30);
    ctx.fillStyle = `rgba(175, 229, 187, ${alpha})`;
    const x = i % WORLD_WIDTH;
    const y = Math.floor(i / WORLD_WIDTH);
    const left = Math.round(x * tile), right = Math.round((x + 1) * tile);
    const top = Math.round(y * tile), bottom = Math.round((y + 1) * tile);
    ctx.fillRect(left, top, right - left, bottom - top);
  }
  for (const [tileIndex, id] of frame.cells) {
    const organism = organisms.get(id);
    ctx.fillStyle = organismColor(organism);
    const x = tileIndex % WORLD_WIDTH;
    const y = Math.floor(tileIndex / WORLD_WIDTH);
    ctx.fillRect(x * tile + .15, y * tile + .15, Math.max(1, tile - .3), Math.max(1, tile - .3));
  }
  const { census, environment } = sample;
  const tickText = fmt(frame.tick);
  canvas.setAttribute("aria-label", `Recorded uniform-food world at tick ${tickText}; ${fmt(census.population)} living bodies across ${fmt(census.cells)} occupied cells.`);
  byId("sample-label").textContent = frame.tick === selectedRun.data.run.finalTick && selectedRun.data.run.extinctionTick !== null
    ? `Extinct · actual tick ${tickText}`
    : `Tick ${tickText} · saved sample`;
  byId("metric-tick").textContent = tickText;
  byId("metric-population").textContent = fmt(census.population);
  byId("metric-cells").textContent = fmt(census.cells);
  byId("metric-families").textContent = census.familyCounts.map(fmt).join(" · ");
  byId("metric-offered").textContent = fmt(environment.offered);
  byId("metric-accepted").textContent = fmt(environment.accepted);
  byId("metric-overflow").textContent = fmt(environment.overflow);
  const extinction = byId("extinction-note");
  extinction.hidden = selectedRun.data.run.extinctionTick === null;
  if (!extinction.hidden) extinction.textContent = `The world became extinct at actual tick ${fmt(selectedRun.data.run.extinctionTick)}. The recording ends there.`;
  scrub.value = String(currentIndex);
  scrubValue.value = `${currentIndex + 1} / ${selectedRun.frames.length}`;
  scrubValue.textContent = scrubValue.value;
  previousButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === selectedRun.frames.length - 1;
  if (currentIndex === selectedRun.frames.length - 1) stopPlayback();
}

function moveTo(index) {
  if (!selectedRun) return;
  currentIndex = Math.max(0, Math.min(selectedRun.frames.length - 1, index));
  renderFrame();
}

function togglePlayback() {
  if (!selectedRun || document.hidden) return;
  if (playing) {
    stopPlayback();
    return;
  }
  if (currentIndex === selectedRun.frames.length - 1) moveTo(0);
  playing = true;
  playButton.textContent = "Pause";
  playButton.setAttribute("aria-label", "Pause sampled replay");
  runState.textContent = "Playing · saved frames only";
  playbackTimer = window.setInterval(() => {
    if (document.hidden) {
      stopPlayback();
      runState.textContent = "Paused while away";
      return;
    }
    if (currentIndex + 1 >= selectedRun.frames.length) {
      stopPlayback();
      return;
    }
    moveTo(currentIndex + 1);
  }, 450);
}

function renderWindows(windows) {
  const rows = windows.map((window) => {
    const endpoint = window.endpoint;
    const minMax = window.minPopulation === null ? "No executed ticks" : `${fmt(window.minPopulation)}–${fmt(window.maxPopulation)} · ${fmt(endpoint.population)}`;
    const endpointTick = endpoint.actualTick !== window.to ? ` · tick ${fmt(endpoint.actualTick)}` : "";
    const familyCounts = endpoint.familyCounts.map(fmt).join(" / ");
    const genomes = `${fmt(endpoint.genomeCounts.length)} distinct`;
    return `<tr><td>${fmt(window.from)}–${fmt(window.to)}${window.executedTicks < window.denominatorTicks ? `<br><span class="muted">${fmt(window.executedTicks)} executed · ${fmt(window.zeroOccupancyTicks)} post-extinction slots</span>` : ""}</td><td>${fmt(window.births)}</td><td>${fmt(window.deaths)}</td><td>${minMax}${endpointTick}</td><td>${fmt(window.cap48Ticks)} / 500</td><td>${fmt(window.nearCap47Ticks)} / 500</td><td>${fmt(window.blockedCapAttempts)} cap · ${fmt(window.blockedSpaceAttempts)} space</td><td>${fmt(endpoint.cells)}</td><td>${familyCounts}</td><td>${genomes}</td></tr>`;
  }).join("");
  byId("window-rows").innerHTML = rows;
}

function decisionFor(manifest, entry) {
  const seedDecisions = (manifest.decisions ?? []).filter((decision) => decision.seed === entry.seed);
  if (seedDecisions.length > 1) throw new Error(`The manifest has multiple decisions for seed ${entry.seed}.`);
  const decision = seedDecisions[0];
  if (decision) {
    if (decision.artifactSha256 !== entry.sha256) throw new Error(`The seed ${entry.seed} decision is bound to a different evidence file.`);
    return decision;
  }
  return null;
}

async function loadRun(entry, manifest) {
  const generation = ++loadGeneration;
  stopPlayback();
  selectedRun = null;
  replay.hidden = true;
  errorState.hidden = true;
  status(`Loading the explicitly listed seed ${fmt(entry.seed)} record…`);
  try {
    const response = await fetch(new URL(entry.url, MANIFEST_URL), { headers: { Accept: "application/json" }, cache: "no-store" });
    if (generation !== loadGeneration) return;
    if (!response.ok) throw new Error(`The manifest lists seed ${fmt(entry.seed)}, but its file answered ${response.status}. No replay was shown.`);
    const rawBytes = new Uint8Array(await response.arrayBuffer());
    if (generation !== loadGeneration) return;
    const artifactSha256 = await sha256Hex(rawBytes);
    if (generation !== loadGeneration) return;
    if (artifactSha256 !== entry.sha256) throw new Error(`Seed ${fmt(entry.seed)} raw-file SHA-256 does not match the manifest; no replay or decision was shown.`);
    const data = JSON.parse(new TextDecoder().decode(rawBytes));
    const verifiedRun = await validateRun(data, entry.seed);
    if (generation !== loadGeneration) return;
    const decision = decisionFor(manifest, entry);
    if (generation !== loadGeneration) return;
    selectedRun = verifiedRun;
    currentIndex = 0;
    setSeedDecision(decision, entry.seed);
    byId("replay-title").textContent = `Uniform · seed ${fmt(entry.seed)}`;
    byId("record-link").href = new URL(entry.url, MANIFEST_URL).href;
    byId("record-link").hidden = false;
    byId("run-state").textContent = selectedRun.data.run.extinctionTick === null
      ? `Paused · recorded through tick ${fmt(selectedRun.data.run.finalTick)}`
      : `Paused · extinct at actual tick ${fmt(selectedRun.data.run.extinctionTick)}`;
    scrub.max = String(selectedRun.frames.length - 1);
    scrub.disabled = false;
    previousButton.disabled = true;
    nextButton.disabled = selectedRun.frames.length < 2;
    playButton.disabled = selectedRun.frames.length < 2 || document.hidden;
    renderWindows(selectedRun.data.windows);
    emptyState.hidden = true;
    errorState.hidden = true;
    replay.hidden = false;
    status(`Seed ${fmt(entry.seed)} verified · ${fmt(selectedRun.frames.length)} exact saved frames · paused.`, "ready");
    resizeCanvas();
  } catch (error) {
    if (generation === loadGeneration) showError(error instanceof Error ? error.message : "The evidence source could not be read.");
  }
}

function validateManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.runs)) throw new Error("The replay manifest is malformed: expected an explicit runs list.");
  if ("overallDecision" in manifest || "overall" in manifest || "decision" in manifest) {
    throw new Error("Manifest decisions must be bound to a seed artifact SHA; the overall decision is authored in this page.");
  }
  const seen = new Set();
  for (const entry of manifest.runs) {
    if (!entry || !Number.isSafeInteger(entry.seed) || entry.seed < 0 || typeof entry.url !== "string" || !entry.url.trim() ||
        typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error("The replay manifest contains a malformed source entry.");
    }
    if (seen.has(entry.seed)) throw new Error(`The replay manifest lists seed ${entry.seed} more than once.`);
    const resolved = new URL(entry.url, MANIFEST_URL);
    if (resolved.origin !== MANIFEST_URL.origin || !resolved.pathname.startsWith(MANIFEST_URL.pathname.replace(/[^/]*$/, ""))) {
      throw new Error("Replay sources must stay in the creative-prototypes evidence directory.");
    }
    seen.add(entry.seed);
  }
  if (manifest.decisions !== undefined && !Array.isArray(manifest.decisions)) throw new Error("The replay manifest decisions must be a list.");
  for (const decision of manifest.decisions ?? []) {
    if (!decision || !Number.isSafeInteger(decision.seed) || !/^[a-f0-9]{64}$/.test(decision.artifactSha256 ?? "") ||
        !["pending", "pass", "stop"].includes(decision.status)) {
      throw new Error("The replay manifest contains a malformed seed decision.");
    }
  }
}

async function init() {
  if (!ctx) {
    showError("This browser cannot draw the recorded world, so the evidence was not displayed.");
    return;
  }
  try {
    const response = await fetch(MANIFEST_URL, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (response.status === 404) {
      status("No replay manifest is published yet.");
      return;
    }
    if (!response.ok) throw new Error(`The replay manifest answered ${response.status}.`);
    const manifest = await response.json();
    validateManifest(manifest);
    manifestRecord = manifest;
    records = manifest.runs;
    const seed1201 = records.find((entry) => entry.seed === 1201);
    if (!seed1201) {
      status("The manifest has no accepted seed 1201 entry; no run was requested.");
      return;
    }
    const picker = byId("seed-picker");
    const pickerWrap = byId("seed-picker-wrap");
    picker.replaceChildren(...records.map((entry) => new Option(`Seed ${fmt(entry.seed)}`, String(entry.seed))));
    picker.value = "1201";
    pickerWrap.hidden = records.length < 2;
    await loadRun(seed1201, manifest);
  } catch (error) {
    showError(error instanceof Error ? error.message : "The evidence source could not be read.");
  }
}

previousButton.addEventListener("click", () => moveTo(currentIndex - 1));
nextButton.addEventListener("click", () => moveTo(currentIndex + 1));
playButton.addEventListener("click", togglePlayback);
scrub.addEventListener("input", () => moveTo(Number(scrub.value)));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPlayback();
    if (selectedRun) {
      runState.textContent = "Paused while away";
      playButton.disabled = true;
    }
  } else if (selectedRun) {
    runState.textContent = "Paused · recorded replay";
    playButton.disabled = selectedRun.frames.length < 2;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  const isControl = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(target.tagName));
  if (isControl) return;
  if (event.key === "ArrowLeft" && selectedRun) { event.preventDefault(); moveTo(currentIndex - 1); }
  if (event.key === "ArrowRight" && selectedRun) { event.preventDefault(); moveTo(currentIndex + 1); }
  if (event.code === "Space" && selectedRun) { event.preventDefault(); togglePlayback(); }
});
window.addEventListener("resize", resizeCanvas, { passive: true });
byId("seed-picker").addEventListener("change", async (event) => {
  const selectedSeed = (event.currentTarget instanceof HTMLSelectElement) ? event.currentTarget.value : "";
  const entry = records.find((candidate) => String(candidate.seed) === selectedSeed);
  if (!entry) return;
  if (manifestRecord) await loadRun(entry, manifestRecord);
});
init();
