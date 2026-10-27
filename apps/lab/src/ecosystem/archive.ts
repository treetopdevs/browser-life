import raw1101 from "../../../../docs/creative-prototypes/ecosystem-archive/source/seed-1101.json";
import raw1102 from "../../../../docs/creative-prototypes/ecosystem-archive/source/seed-1102.json";
import raw1103 from "../../../../docs/creative-prototypes/ecosystem-archive/source/seed-1103.json";
import summaries from "../../../../docs/creative-prototypes/ecosystem-archive/source/ecosystem-20k-summary.json";
// The movies are kept out of git (docs/creative-prototypes/ARTIFACTS.md); a checkout without them shows the census only.
const movies = import.meta.glob<string>("./archive-assets/ecosystem-archive-*.mp4", { eager: true, query: "?url", import: "default" });

const familyNames = ["Jade", "Amber", "Violet", "Protected", "Hunter"] as const;
const colors = ["#65d6a0", "#efb75c", "#ab98ed", "#6dd9ed", "#f18599"] as const;
const runs = [raw1101, raw1102, raw1103] as unknown as ArchiveRun[];
const media = new Map<number, string>(Object.entries(movies).flatMap(([path, url]) => {
  const seed = path.match(/ecosystem-archive-(\d+)\.mp4$/)?.[1];
  return seed ? [[Number(seed), url] as const] : [];
}));
const summaryBySeed = new Map((summaries as unknown as ArchiveSummary[]).map(summary => [summary.seed, summary]));

interface Census {
  tick: number;
  counts: number[];
  population: number;
  attack: number;
  defense: number;
  classes: number;
  diversity: number;
  births: number;
  deaths: number;
  mutations: number;
  bins: number[];
}

interface ArchiveRun {
  seed: number;
  ticks: number;
  captureEvery: number;
  fps: number;
  samples: Census[];
}

interface FamilySummary {
  name: string;
  minimum: number;
  maximum: number;
  mean: number;
}

interface ArchiveSummary {
  seed: number;
  final: Census;
  windows: { "15000-20000": { families: FamilySummary[] } };
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (callbackId: number) => void;
};

interface CanvasSpace {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
}

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing archive interface element: ${id}`);
  return node as T;
};

const playbackStatus = byId<HTMLParagraphElement>("playback-status");
const playbackFailures = new Set<HTMLVideoElement>();
const retryGenerations = new Map<HTMLVideoElement, number>();
let playbackRate = Number(byId<HTMLSelectElement>("playback-speed").value);
let globalPauseGeneration = 0;
let playAllGeneration = 0;
let statusNotice = "";

const renderPlaybackStatus = (): void => {
  playbackStatus.textContent = playbackFailures.size
    ? `Playback could not start for ${playbackFailures.size} recording${playbackFailures.size === 1 ? "" : "s"}. Use each recording’s retry button or its player controls.`
    : statusNotice;
};

const loadFailureMessage = "This movie file could not be loaded. Check your connection, then choose ‘Retry and play this recording’.";

function text(tag: string, value: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function prepareCanvas(canvas: HTMLCanvasElement): CanvasSpace | null {
  const aspect = canvas.height / canvas.width;
  const bounds = canvas.getBoundingClientRect();
  const width = bounds.width || canvas.clientWidth || canvas.width;
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const height = bounds.height || width * aspect;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { context, width, height };
}

function drawPopulation(run: ArchiveRun): void {
  const canvas = byId<HTMLCanvasElement>(`population-${run.seed}`);
  const space = prepareCanvas(canvas);
  if (!space) return;
  const { context, width, height } = space;
  const pad = { left: 48, right: 14, top: 14, bottom: 30 };
  const plotWidth = width - pad.left - pad.right, plotHeight = height - pad.top - pad.bottom;
  const maxCount = Math.max(1000, Math.ceil(Math.max(...run.samples.flatMap(sample => sample.counts)) / 1000) * 1000);
  context.clearRect(0, 0, width, height);
  context.font = `${Math.max(10, Math.min(12, width / 58))}px ui-sans-serif, system-ui, sans-serif`;
  context.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const value = maxCount * i / 4, y = pad.top + plotHeight - plotHeight * i / 4;
    context.strokeStyle = "#30443a";
    context.lineWidth = 1;
    context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke();
    context.fillStyle = "#9bb0a0";
    context.textAlign = "right";
    context.fillText(value.toLocaleString(), pad.left - 7, y);
  }
  for (const tick of [0, 5000, 10000, 15000, 20000]) {
    const x = pad.left + plotWidth * tick / 20000;
    context.strokeStyle = "#24372d";
    context.beginPath(); context.moveTo(x, pad.top); context.lineTo(x, height - pad.bottom); context.stroke();
    context.fillStyle = "#9bb0a0";
    context.textAlign = tick === 0 ? "left" : tick === 20000 ? "right" : "center";
    context.textBaseline = "alphabetic";
    context.fillText(tick === 0 ? "0" : `${tick / 1000}k`, x, height - 8);
  }
  for (let family = 0; family < familyNames.length; family++) {
    context.strokeStyle = colors[family];
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.beginPath();
    run.samples.forEach((sample, index) => {
      const x = pad.left + plotWidth * sample.tick / 20000;
      const y = pad.top + plotHeight * (1 - sample.counts[family] / maxCount);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
  }
  const legend = byId<HTMLDivElement>(`legend-${run.seed}`);
  legend.replaceChildren();
  for (let family = 0; family < familyNames.length; family++) {
    const item = document.createElement("span"), swatch = document.createElement("i");
    swatch.style.backgroundColor = colors[family];
    item.append(swatch, document.createTextNode(familyNames[family]));
    legend.append(item);
  }
}

function traitMeans(run: ArchiveRun, family: number, trait: "attack" | "defense"): Array<number | null> {
  return run.samples.map(sample => {
    if (sample.bins.length !== 125) return null;
    const familyBins = sample.bins.slice(family * 25, family * 25 + 25);
    const population = familyBins.reduce((sum, count) => sum + count, 0);
    if (population === 0) return null;
    const weightedTotal = familyBins.reduce((sum, count, index) => {
      const traitValue = trait === "attack" ? Math.floor(index / 5) : index % 5;
      return sum + count * traitValue;
    }, 0);
    return weightedTotal / population;
  });
}

function drawTraitMeans(run: ArchiveRun, trait: "attack" | "defense"): void {
  const canvas = byId<HTMLCanvasElement>(`${trait}-${run.seed}`);
  const space = prepareCanvas(canvas);
  if (!space) return;
  const { context, width, height } = space;
  const pad = { left: 48, right: 14, top: 12, bottom: 26 };
  const plotWidth = width - pad.left - pad.right, plotHeight = height - pad.top - pad.bottom;
  context.clearRect(0, 0, width, height);
  context.font = `${Math.max(10, Math.min(12, width / 58))}px ui-sans-serif, system-ui, sans-serif`;
  for (let value = 0; value <= 4; value++) {
    const y = pad.top + plotHeight * (1 - value / 4);
    context.strokeStyle = "#30443a";
    context.lineWidth = 1;
    context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke();
    context.fillStyle = "#9bb0a0";
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(String(value), pad.left - 8, y);
  }
  for (const tick of [0, 5000, 10000, 15000, 20000]) {
    const x = pad.left + plotWidth * tick / 20000;
    context.strokeStyle = "#24372d";
    context.beginPath(); context.moveTo(x, pad.top); context.lineTo(x, height - pad.bottom); context.stroke();
    context.fillStyle = "#9bb0a0";
    context.textAlign = tick === 0 ? "left" : tick === 20000 ? "right" : "center";
    context.textBaseline = "alphabetic";
    context.fillText(tick === 0 ? "0" : `${tick / 1000}k`, x, height - 6);
  }
  let gapCount = 0;
  for (let family = 0; family < familyNames.length; family++) {
    const values = traitMeans(run, family, trait);
    gapCount += values.filter(value => value === null).length;
    context.strokeStyle = colors[family];
    context.lineWidth = 2;
    context.lineJoin = "round";
    let segmentOpen = false;
    values.forEach((value, index) => {
      if (value === null) { segmentOpen = false; return; }
      const sample = run.samples[index];
      const x = pad.left + plotWidth * sample.tick / 20000;
      const y = pad.top + plotHeight * (1 - value / 4);
      if (!segmentOpen) { context.beginPath(); context.moveTo(x, y); segmentOpen = true; }
      else context.lineTo(x, y);
      if (index === values.length - 1 || values[index + 1] === null) context.stroke();
    });
  }
  canvas.dataset.gapCount = String(gapCount);
}

function renderFacts(run: ArchiveRun, summary: ArchiveSummary): void {
  const final = summary.final;
  const familyWindow = summary.windows["15000-20000"].families;
  const familyTable = document.createElement("table");
  const familyCaption = document.createElement("caption");
  familyCaption.textContent = "Final population and last 5,000-tick range";
  familyTable.append(familyCaption);
  const familyHead = document.createElement("thead"), familyHeadRow = document.createElement("tr");
  for (const label of ["Family", "At 20,000", "Range low", "Range high"]) familyHeadRow.append(text("th", label));
  familyHead.append(familyHeadRow); familyTable.append(familyHead);
  const familyBody = document.createElement("tbody");
  familyNames.forEach((name, index) => {
    const row = document.createElement("tr");
    row.append(text("th", name), text("td", final.counts[index].toLocaleString()), text("td", familyWindow[index].minimum.toLocaleString()), text("td", familyWindow[index].maximum.toLocaleString()));
    familyBody.append(row);
  });
  familyTable.append(familyBody);
  byId<HTMLDivElement>(`family-summary-${run.seed}`).append(familyTable);

  const facts: Array<[string, string]> = [
    [final.population.toLocaleString(), "living cells at tick 20,000"],
    [final.births.toLocaleString(), "recorded births"],
    [final.deaths.toLocaleString(), "recorded deaths"],
    [final.mutations.toLocaleString(), "mutated births"],
    [final.classes.toLocaleString(), "living trait classes at 20,000"],
    [final.diversity.toFixed(2), "Shannon diversity"],
  ];
  const root = byId<HTMLDivElement>(`facts-${run.seed}`);
  for (const [value, label] of facts) {
    const item = document.createElement("div");
    item.className = "fact";
    item.append(text("strong", value), text("span", label));
    root.append(item);
  }

  const finalRaw = run.samples.at(-1);
  if (!finalRaw || finalRaw.tick !== 20000 || finalRaw.bins.length !== 125) return;
  const tables = byId<HTMLDivElement>(`traits-${run.seed}`);
  for (let family = 0; family < familyNames.length; family++) {
    const section = document.createElement("section");
    section.className = "trait-family";
    section.setAttribute("aria-label", `${familyNames[family]} final attack and defense counts`);
    section.append(text("h4", familyNames[family]));
    const table = document.createElement("table");
    const caption = document.createElement("caption");
    caption.textContent = "Defense →; attack ↓";
    table.append(caption);
    const head = document.createElement("thead"), headRow = document.createElement("tr");
    headRow.append(text("th", "A / D"));
    for (let defense = 0; defense < 5; defense++) headRow.append(text("th", String(defense)));
    head.append(headRow); table.append(head);
    const body = document.createElement("tbody");
    for (let attack = 0; attack < 5; attack++) {
      const row = document.createElement("tr");
      row.append(text("th", String(attack)));
      for (let defense = 0; defense < 5; defense++) {
        const count = finalRaw.bins[family * 25 + attack * 5 + defense];
        const cell = text("td", count.toLocaleString());
        if (count === 0) cell.className = "zero";
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body); section.append(table); tables.append(section);
  }
}

function renderTraitData(run: ArchiveRun): void {
  const details = byId<HTMLDetailsElement>(`trait-data-details-${run.seed}`);
  const root = byId<HTMLDivElement>(`trait-data-${run.seed}`);
  details.addEventListener("toggle", () => {
    if (!details.open || root.childElementCount > 0) return;
    const table = document.createElement("table");
    const caption = text("caption", "Attack and defense means from the recorded bins; empty means indicate an absent family.");
    table.append(caption);
    const head = document.createElement("thead"), headRow = document.createElement("tr");
    for (const label of ["Tick", "Family", "Mean attack", "Mean defense"]) headRow.append(text("th", label));
    head.append(headRow); table.append(head);
    const body = document.createElement("tbody");
    const means = familyNames.map((_name, family) => ({ attack: traitMeans(run, family, "attack"), defense: traitMeans(run, family, "defense") }));
    run.samples.forEach((sample, sampleIndex) => {
      familyNames.forEach((name, family) => {
        const row = document.createElement("tr");
        row.append(text("th", sample.tick.toLocaleString()), text("td", name));
        const attack = means[family].attack[sampleIndex], defense = means[family].defense[sampleIndex];
        row.append(text("td", attack === null ? "—" : attack.toFixed(4)), text("td", defense === null ? "—" : defense.toFixed(4)));
        body.append(row);
      });
    });
    table.append(body); root.append(table);
  });
}

function tickFromTime(seconds: number): number {
  return Math.min(20000, Math.max(0, Math.floor(seconds * 20) * 25));
}

function initializeVideo(seed: number): void {
  const video = byId<VideoWithFrameCallback>(`movie-${seed}`);
  const tick = byId<HTMLOutputElement>(`tick-${seed}`);
  const status = byId<HTMLParagraphElement>(`media-status-${seed}`);
  const retry = byId<HTMLButtonElement>(`retry-${seed}`);
  const src = media.get(seed);
  if (!src) {
    // Hide the whole figure: `.movie-figure video { display: block }` would override the video's own hidden attribute.
    video.closest<HTMLElement>(".movie-figure")!.hidden = true;
    status.textContent = "This movie is not included in this build. The census and family tables below are complete.";
    return;
  }
  video.src = src;
  video.defaultPlaybackRate = playbackRate;
  video.playbackRate = playbackRate;
  const showTick = (seconds: number): void => { tick.textContent = `${tickFromTime(seconds).toLocaleString()} / 20,000`; };
  let frameCallbackId: number | null = null;
  const showFrame = (allowPausedFrame = false): void => {
    if (video.requestVideoFrameCallback) {
      if (frameCallbackId !== null || (!allowPausedFrame && video.paused) || video.ended || document.hidden) return;
      frameCallbackId = video.requestVideoFrameCallback((_now, metadata) => {
        frameCallbackId = null;
        showTick(metadata.mediaTime);
        showFrame();
      });
    } else showTick(video.currentTime);
  };
  const stopFrameUpdates = (): void => {
    if (frameCallbackId !== null) video.cancelVideoFrameCallback?.(frameCallbackId);
    frameCallbackId = null;
  };
  const clearFailure = (): void => { status.textContent = ""; retry.hidden = true; };
  video.addEventListener("loadedmetadata", () => { showTick(video.currentTime); clearFailure(); });
  video.addEventListener("loadeddata", clearFailure);
  if (!video.requestVideoFrameCallback) video.addEventListener("timeupdate", () => showTick(video.currentTime));
  video.addEventListener("seeked", () => { showTick(video.currentTime); showFrame(true); });
  video.addEventListener("play", () => {
    clearFailure();
    renderPlaybackStatus();
    showFrame();
  });
  video.addEventListener("playing", () => {
    playbackFailures.delete(video);
    renderPlaybackStatus();
  });
  video.addEventListener("pause", stopFrameUpdates);
  video.addEventListener("ended", stopFrameUpdates);
  video.addEventListener("error", () => {
    status.textContent = loadFailureMessage;
    retry.disabled = false;
    retry.hidden = false;
  });
  retry.addEventListener("click", async () => {
    const intent = (retryGenerations.get(video) ?? 0) + 1;
    retryGenerations.set(video, intent);
    const pauseGeneration = globalPauseGeneration;
    playAllGeneration++;
    const isCurrentAttempt = (): boolean => retryGenerations.get(video) === intent && globalPauseGeneration === pauseGeneration;
    const resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    status.textContent = "Reloading the movie. Playback will start if it loads.";
    retry.disabled = true;
    retry.hidden = true;
    const loaded = await new Promise<boolean>(resolve => {
      let finished = false;
      const finish = (success: boolean): void => {
        if (finished) return;
        finished = true;
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        resolve(success);
      };
      const onLoaded = (): void => finish(true);
      const onError = (): void => finish(false);
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.load();
      video.defaultPlaybackRate = playbackRate;
      video.playbackRate = playbackRate;
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) finish(true);
    });
    if (!isCurrentAttempt()) {
      retry.disabled = false;
      if (video.error) { status.textContent = loadFailureMessage; retry.hidden = false; }
      else clearFailure();
      return;
    }
    if (!loaded) {
      status.textContent = loadFailureMessage;
      retry.disabled = false;
      retry.hidden = false;
      return;
    }
    video.defaultPlaybackRate = playbackRate;
    video.playbackRate = playbackRate;
    if (resumeAt > 0 && resumeAt < video.duration) video.currentTime = resumeAt;
    try {
      await video.play();
      if (!isCurrentAttempt()) return;
      clearFailure();
      playbackFailures.delete(video);
      renderPlaybackStatus();
      retry.disabled = false;
    } catch (error) {
      retry.disabled = false;
      if (!isCurrentAttempt() || (error instanceof DOMException && error.name === "AbortError")) {
        if (video.error) {
          status.textContent = loadFailureMessage;
          retry.hidden = false;
        } else {
          status.textContent = "Playback was canceled before this retry could start.";
          retry.hidden = false;
        }
        return;
      }
      if (video.error) {
        status.textContent = loadFailureMessage;
      } else status.textContent = "The movie loaded, but playback could not start. Use the player controls or choose ‘Retry and play this recording’.";
      retry.hidden = false;
    }
  });
}

for (const run of runs) {
  const summary = summaryBySeed.get(run.seed);
  if (!summary) continue;
  drawPopulation(run);
  drawTraitMeans(run, "attack");
  drawTraitMeans(run, "defense");
  renderFacts(run, summary);
  renderTraitData(run);
  initializeVideo(run.seed);
}

const videos = runs.filter(run => media.has(run.seed)).map(run => byId<VideoWithFrameCallback>(`movie-${run.seed}`));
if (videos.length === 0) for (const id of ["play-all", "pause-all", "restart-all"]) byId<HTMLButtonElement>(id).disabled = true;
byId<HTMLButtonElement>("play-all").addEventListener("click", async () => {
  const intent = ++playAllGeneration;
  const pauseGeneration = globalPauseGeneration;
  playbackFailures.clear();
  statusNotice = "";
  renderPlaybackStatus();
  const results = await Promise.allSettled(videos.map(video => video.play()));
  if (intent !== playAllGeneration || pauseGeneration !== globalPauseGeneration) return;
  playbackFailures.clear();
  results.forEach((result, index) => {
    if (result.status !== "rejected") return;
    const canceledByPlayerPause = result.reason instanceof DOMException && result.reason.name === "AbortError" && videos[index].paused;
    if (!canceledByPlayerPause) playbackFailures.add(videos[index]);
  });
  statusNotice = "";
  renderPlaybackStatus();
});
byId<HTMLButtonElement>("pause-all").addEventListener("click", () => {
  globalPauseGeneration++;
  playAllGeneration++;
  videos.forEach(video => video.pause());
  statusNotice = "All recordings paused.";
  renderPlaybackStatus();
});
byId<HTMLButtonElement>("restart-all").addEventListener("click", () => {
  globalPauseGeneration++;
  playAllGeneration++;
  videos.forEach(video => {
    video.pause();
    try { video.currentTime = 0; } catch { /* Metadata may not have loaded yet. */ }
  });
  statusNotice = "All recordings returned to the beginning and remain paused.";
  renderPlaybackStatus();
});
byId<HTMLSelectElement>("playback-speed").addEventListener("change", event => {
  playbackRate = Number((event.currentTarget as HTMLSelectElement).value);
  videos.forEach(video => {
    video.defaultPlaybackRate = playbackRate;
    video.playbackRate = playbackRate;
  });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    const wasPlaying = videos.some(video => !video.paused);
    globalPauseGeneration++;
    playAllGeneration++;
    videos.forEach(video => video.pause());
    statusNotice = wasPlaying ? "Recordings paused while this page is hidden. They stay paused when you return." : "";
  } else if (statusNotice.startsWith("Recordings paused while this page is hidden.")) {
    statusNotice = "";
  }
  renderPlaybackStatus();
});
window.addEventListener("resize", () => {
  for (const run of runs) {
    drawPopulation(run);
    drawTraitMeans(run, "attack");
    drawTraitMeans(run, "defense");
  }
});
