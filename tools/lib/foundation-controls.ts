/**
 * Constructed readback controls for the existing census/observer metrics.
 * These fixtures exercise detectors, not simulator dynamics or viable life.
 */
import { census, CollectiveTracker, morphology, Tracker, type Census, type Individual } from "@bl/metrics";
import { CH, CELL_CHANNELS, G, defaultConfig, type WorldConfig, cellCount } from "@bl/schema";

export type Assertion = "supported" | "refuted" | "unavailable";

export interface ControlCase {
  id: string;
  observer: string;
  purpose: string;
  expected: Record<string, string | number | boolean | null>;
  measured: Record<string, string | number | boolean | null>;
  asserted: Record<string, Assertion>;
  sampling: { frames: number; expectedMeasurements: number; measuredMeasurements: number; missingMeasurements: number };
}

export interface ObservationSummary {
  scheduled: number;
  readbacks: number;
  finite: number;
  missing: number;
  mean: number | null;
  min: number | null;
  max: number | null;
}

export interface FoundationControlReport {
  format: "browser-life-foundation-controls-v1";
  evidenceScope: string;
  controls: ControlCase[];
  sensitivity: {
    censusCadence: { censusEvery: number; readbacks: number; fissions: number; fusions: number }[];
    deepCadence: { deepEvery: number; scheduledDeepReadbacks: number; finite: number; missing: number; compartmentalised: number | null }[];
    componentThresholds: { cellThreshold: number; minMass: number; components: number; trackedIndividuals: number }[];
  };
  limits: string[];
}

export function summarizeObservations(values: readonly (number | null | undefined)[], scheduled = values.length): ObservationSummary {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return {
    scheduled,
    readbacks: values.length,
    finite: finite.length,
    missing: Math.max(0, scheduled - finite.length),
    mean: finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null,
    min: finite.length ? Math.min(...finite) : null,
    max: finite.length ? Math.max(...finite) : null,
  };
}

interface CellPaint {
  x: number;
  y: number;
  mass?: number;
  membrane?: number;
  lineage?: number;
}

interface Readback {
  cells: Uint32Array;
  genomeHead: Uint32Array;
  census: Census;
}

function makeReadback(cfg: WorldConfig, step: number, paint: readonly CellPaint[], cellThreshold = 48): Readback {
  const n = cellCount(cfg);
  const cells = new Uint32Array(CELL_CHANNELS * n);
  const genomeHead = new Uint32Array(4 * n);
  for (const cell of paint) {
    const i = cell.y * cfg.tileW * cfg.tilesX + cell.x;
    const mass = cell.mass ?? 100;
    const membrane = cell.membrane ?? Math.floor(mass / 2);
    cells[CH.B * n + i] = mass - membrane;
    cells[CH.P * n + i] = membrane;
    genomeHead[G.LIN_HI * n + i] = 1;
    genomeHead[G.LIN_LO * n + i] = (cell.lineage ?? 0) + 1;
    genomeHead[G.PARAM0 * n + i] = 60 | (20 << 16);
  }
  const c = census({ cfg, step, cells, genomeHead }, { threshold: cellThreshold, minMass: 1 });
  return { cells, genomeHead, census: c };
}

function rect(x0: number, y0: number, w: number, h: number, lineage = 0, mass = 100): CellPaint[] {
  const cells: CellPaint[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push({ x, y, lineage, mass });
  return cells;
}

function connectedBridge(): CellPaint[] {
  return rect(2, 5, 7, 3);
}

function splitBridge(): CellPaint[] {
  return connectedBridge().filter((cell) => cell.x !== 5);
}

function makePair(cfg: WorldConfig, rows: Readback[], minMass = 300): { events: string[]; tracker: Tracker } {
  const tracker = new Tracker({ threshold: 48, minMass });
  const events: string[] = [];
  for (const row of rows) for (const event of tracker.update(row.census)) events.push(event.kind);
  return { events, tracker };
}

function caseResult(
  id: string,
  observer: string,
  purpose: string,
  expected: ControlCase["expected"],
  measured: ControlCase["measured"],
  sampleFrames: number,
): ControlCase {
  const asserted: Record<string, Assertion> = {};
  for (const key of Object.keys(expected)) {
    const actual = measured[key];
    const want = expected[key];
    asserted[key] = actual === null || actual === undefined || want === null ? "unavailable" : actual === want ? "supported" : "refuted";
  }
  const measuredMeasurements = Object.values(measured).filter((value) => typeof value === "number" && Number.isFinite(value)).length;
  const expectedMeasurements = Object.keys(expected).length;
  return {
    id,
    observer,
    purpose,
    expected,
    measured,
    asserted,
    sampling: { frames: sampleFrames, expectedMeasurements, measuredMeasurements, missingMeasurements: expectedMeasurements - measuredMeasurements },
  };
}

function tracked(readback: Readback, minMass: number): Individual[] {
  const t = new Tracker({ threshold: 48, minMass });
  t.update(readback.census);
  return [...t.alive.values()];
}

/** Execute the same deterministic readbacks through current observer implementations. */
export function buildFoundationControlReport(options: {
  censusCadences?: readonly number[];
  deepCadences?: readonly number[];
} = {}): FoundationControlReport {
  const cfg = defaultConfig({ tileW: 24, tileH: 16, tilesX: 1, tilesY: 1 });
  const minMass = 300;
  const isolated = makeReadback(cfg, 0, [...rect(2, 3, 2, 2, 0), ...rect(8, 3, 2, 2, 1)]);
  const contacting = makeReadback(cfg, 0, [...rect(2, 3, 2, 2, 0), ...rect(4, 3, 2, 2, 1)]);
  const compIsolated = isolated.census.components.length;
  const compContact = contacting.census.components.length;
  const lineageContact = contacting.census.lineages.length;

  const separatedPoints = makeReadback(cfg, 0, [{ x: 2, y: 12 }, { x: 7, y: 12 }, { x: 12, y: 12 }]);
  const nearbyCollectives = new CollectiveTracker({ linkDist: 5, minMembers: 3, tileW: cfg.tileW, tileH: cfg.tileH });
  const farCollectives = new CollectiveTracker({ linkDist: 3, minMembers: 3, tileW: cfg.tileW, tileH: cfg.tileH });
  const nearbyGroups = nearbyCollectives.group(tracked(separatedPoints, 1)).length;
  const farGroups = farCollectives.group(tracked(separatedPoints, 1)).length;

  const splitPair = [makeReadback(cfg, 0, connectedBridge()), makeReadback(cfg, 1, splitBridge())];
  const fusionPair = [makeReadback(cfg, 0, [...rect(2, 5, 3, 3, 0), ...rect(6, 5, 3, 3, 1)]), makeReadback(cfg, 1, connectedBridge())];
  const movedPair = [makeReadback(cfg, 0, rect(2, 5, 3, 3)), makeReadback(cfg, 1, rect(13, 5, 3, 3))];
  const split = makePair(cfg, splitPair, minMass);
  const fused = makePair(cfg, fusionPair, minMass);
  const moved = makePair(cfg, movedPair, minMass);

  const membranePaint: CellPaint[] = [];
  const uniformPaint: CellPaint[] = [];
  const shellPaint: CellPaint[] = [];
  for (let y = 3; y < 8; y++) for (let x = 5; x < 10; x++) {
    const rim = x === 5 || x === 9 || y === 3 || y === 7;
    membranePaint.push({ x, y, membrane: rim ? 90 : 10, lineage: 0 });
    uniformPaint.push({ x, y, membrane: 50, lineage: 0 });
  }
  for (let y = 3; y < 8; y++) for (let x = 5; x < 10; x++) {
    if (x === 5 || x === 9 || y === 3 || y === 7) shellPaint.push({ x, y, membrane: 90, lineage: 0 });
  }
  const membrane = makeReadback(cfg, 0, membranePaint);
  const uniform = makeReadback(cfg, 0, uniformPaint);
  const hollowShell = makeReadback(cfg, 0, shellPaint);
  const morphologyCount = (r: Readback) => morphology(cfg, r.cells, r.census, minMass).compartmentalised;

  const cadenceList = [...new Set(options.censusCadences ?? [1, 2])].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  const deepCadenceList = [...new Set(options.deepCadences ?? [1, 2])].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  const eventFrames = [makeReadback(cfg, 0, connectedBridge()), makeReadback(cfg, 1, splitBridge()), makeReadback(cfg, 2, connectedBridge())];
  const censusCadence = cadenceList.map((censusEvery) => {
    const sampled = eventFrames.filter((_, idx) => idx % censusEvery === 0);
    const result = makePair(cfg, sampled, minMass);
    return { censusEvery, readbacks: sampled.length, fissions: result.tracker.fissions, fusions: result.tracker.fusions };
  });
  const transientMorphFrames = [makeReadback(cfg, 0, []), membrane, makeReadback(cfg, 2, [])];
  const deepCadence = deepCadenceList.map((deepEvery) => {
    const selected = transientMorphFrames.filter((_, idx) => idx % deepEvery === 0);
    const values = selected.map(morphologyCount);
    const sum = summarizeObservations(values, selected.length);
    return { deepEvery, scheduledDeepReadbacks: sum.scheduled, finite: sum.finite, missing: sum.missing, compartmentalised: sum.mean };
  });

  const thresholdPaint = [...rect(2, 5, 3, 3, 0), ...rect(6, 5, 3, 3, 1), { x: 5, y: 6, mass: 48, lineage: 2 }];
  const componentThresholds = [48, 49].flatMap((cellThreshold) => [300, 2000].map((minIndividualMass) => {
    const readback = makeReadback(cfg, 0, thresholdPaint, cellThreshold);
    const tracker = new Tracker({ threshold: cellThreshold, minMass: minIndividualMass });
    tracker.update(readback.census);
    return {
      cellThreshold,
      minMass: minIndividualMass,
      components: readback.census.components.length,
      trackedIndividuals: tracker.alive.size,
    };
  }));

  const controlRows: ControlCase[] = [
    caseResult("separate-vs-contacting", "census", "Connected bound-mass topology; contact merges lineages into one component.", { isolatedComponents: 2, contactingComponents: 1, contactingLineages: 2 }, { isolatedComponents: compIsolated, contactingComponents: compContact, contactingLineages: lineageContact }, 2),
    caseResult("proximity-collective", "CollectiveTracker.group", "Three distinct census components form one collective only under the selected centroid link distance and minimum size.", { censusComponents: 3, nearbyCollectives: 1, farCollectives: 0 }, { censusComponents: separatedPoints.census.components.length, nearbyCollectives: nearbyGroups, farCollectives: farGroups }, 1),
    caseResult("split-readback", "Tracker.update", "A connected component becoming two overlapping tracked components emits a topology fission event.", { fissions: 1 }, { fissions: split.tracker.fissions }, 2),
    caseResult("fusion-readback", "Tracker.update", "Two overlapping tracked components becoming one emits a topology fusion event.", { fusions: 1 }, { fusions: fused.tracker.fusions }, 2),
    caseResult("zero-overlap-transport", "Tracker.update", "A component translated without any overlapping occupied cells is labelled death plus birth.", { births: 1, deaths: 1, fissions: 0 }, { births: moved.events.filter((e) => e === "birth").length, deaths: moved.events.filter((e) => e === "death").length, fissions: moved.tracker.fissions }, 2),
    caseResult("membrane-rim-core", "morphology.compartmentalised", "A filled connected component with higher membrane fraction at rim than core by the classifier margin is counted.", { membraneRimCore: 1, uniformComposition: 0 }, { membraneRimCore: morphologyCount(membrane), uniformComposition: morphologyCount(uniform) }, 2),
    caseResult("hollow-shell-limit", "morphology.compartmentalised", "A one-cell-thick enclosing shell with no tracked bound-mass core is not counted by this rim-versus-core classifier.", { hollowShellCounted: 0 }, { hollowShellCounted: morphologyCount(hollowShell) }, 1),
  ];

  return {
    format: "browser-life-foundation-controls-v1",
    evidenceScope: "Deterministic constructed readbacks passed through current observers; controls establish detector behavior only, not physical viability, reproduction, evolutionary fitness, or autonomous life.",
    controls: controlRows,
    sensitivity: { censusCadence, deepCadence, componentThresholds },
    limits: [
      "No physics steps or GPU execution occur; cell arrays are hand-constructed observer inputs.",
      "Tracker fission and fusion mean overlap/topology transitions between observed censuses. They do not establish offspring viability, resource acquisition, subsequent reproduction, or an inherited life cycle.",
      "A no-overlap translation is observationally indistinguishable from death plus birth to this overlap tracker; true transport between censuses can therefore be overlabelled.",
      "Census component connectivity is four-neighbour bound-mass connectivity within each tile torus; the minMass cutoff and per-cell bound-mass threshold change which components qualify.",
      "The compartment classifier tests only a tracked component's mean membrane fraction at its rim against its mean in-component core, with a fixed 0.15 margin. It does not detect arbitrary enclosure, nested compartments, permeability, or function.",
      "Cadence controls use a short, scripted transition sequence. They demonstrate aliasing/missed observations, not a calibrated false-negative rate for natural runs.",
      "An absent or non-finite observer value remains missing with its denominator; it is never converted to zero.",
    ],
  };
}
