// The record named by --picks-from (tools/run.ts) and the same file read by tools/submit-picks.ts: a picks.jsonl, a lab run
// manifest (`<runId>.run.json`) or a session file. Moved out of run.ts unchanged in behaviour: the same checks, the same
// messages, and `die` (run.ts exits 2) is the caller's. No GPU, no coordinator.
import { PRESETS, RULE_VERSION, initWorld, stateHash, type WorldConfig } from "@bl/schema";
import { labHistory, parsePickLogPrefix, sameConfig, specConfig, type PickEntry, type PressureEntry, type RunSpec, type ScheduledIntervention } from "@bl/runner";

/** The record: a picks.jsonl or a lab run manifest (then a boundary without an entry takes the rule's donors). */
export type PickRecord = { entries: PickEntry[]; text?: string; implicit: boolean };

/**
 * A lab run manifest's other half (packages/runner/src/interventions.ts `labHistory`): its lesions and feeds, which become the run's
 * schedule, and what the lab recorded to compare the replay with (its checkpoints, and every logged intervention of any kind, which a
 * checkpoint counts). `pondPicks`: the manifest's config is a pond config whose arm chooses donors, or the manifest holds picks, so
 * the replay is a picked run; a plain (fed or wounded) world is not.
 */
export type LabRecord = { scheduled: ScheduledIntervention[]; pressures: PressureEntry[]; checkpoints: { step?: unknown; hash?: unknown; interventions?: unknown; file?: unknown }[]; logged: { step?: unknown }[]; pondPicks: boolean };

export interface PickRecordContext {
  /** The --picks-from path, for messages. */
  file: string;
  /** The run's one spec (preset, seed, census and deep settings are checked against the manifest). */
  spec: RunSpec;
  /** How many lesions, feeds or interventions the flags scheduled (refused beside a lab manifest). */
  scheduledCount: number;
  /** Whether --solo-founder, --solo-genome or --founder-set was given. */
  founderOption: boolean;
  /** Prints a message and ends the caller's process (run.ts: exit 2); never returns. */
  die(msg: string): never;
  /** Prints a note that does not stop anything. */
  note(msg: string): void;
}

/** Reads the text of a --picks-from file into its record (and, for a lab manifest, its lab half), or dies exactly as tools/run.ts always has. */
export function loadPickRecord(text: string, ctx: PickRecordContext): { record: PickRecord; lab?: LabRecord } {
  const { file, scheduledCount, die } = ctx;
  let record!: PickRecord;
  let lab: LabRecord | undefined;
  try {
    let manifest: Record<string, unknown> | undefined;
    if (text.trimStart().startsWith("{")) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed?.interventions)) manifest = parsed;
      } catch { /* several JSON lines: a pick log */ }
    }
    if (manifest) {
      if (scheduledCount > 0) die("--lesion, --feed and --interventions cannot be combined with a lab run manifest in --picks-from: the manifest is the history, and its lesions and feeds are the schedule");
      // The start world is the preset's, which the lab planted and whose hash is checked below; a founder option would build
      // another world under the same config, which that check cannot see (it hashes the preset's start).
      if (ctx.founderOption)
        die("--solo-founder, --solo-genome and --founder-set cannot be combined with a lab run manifest in --picks-from: the manifest is the history, and its start world is the preset's");
      const spec = ctx.spec;
      const labPreset = PRESETS.find((x) => x.id === spec.presetId);
      const mismatches = [
        manifest.presetId !== spec.presetId && "presetId",
        manifest.seed !== spec.seed && "seed",
        manifest.ruleVersion !== RULE_VERSION && "ruleVersion",
        !sameConfig(manifest.cfg as WorldConfig, specConfig(spec)) && "cfg",
        JSON.stringify(manifest.init) !== JSON.stringify(labPreset?.init) && "init",
      ].filter(Boolean);
      if (mismatches.length) die(`the lab manifest does not describe this run: ${mismatches.join(", ")} differ`);
      // The lab recorded the hash of the world it planted. Its lesions and feeds are at absolute coordinates, so a start world that this
      // checkout builds differently (initWorld or a founder set drifted without a RULE_VERSION bump) would take them on another world.
      if (typeof manifest.startHash === "string" && labPreset !== undefined) {
        const here = stateHash(initWorld(specConfig(spec), labPreset.init));
        if (manifest.startHash !== here)
          die(`the lab planted a start world with hash ${manifest.startHash}, but this checkout builds ${here} from the same preset, config and seed: the start world has changed since, so the manifest's lesions and feeds would land on another world`);
      }
      const settings = manifest.settings as { censusEvery?: number; deepEvery?: number } | undefined;
      if (settings && (settings.censusEvery !== spec.censusEvery || settings.deepEvery !== spec.deepEvery))
        ctx.note(`note: the lab observed with census ${settings.censusEvery} / deep ${settings.deepEvery}, this run with ${spec.censusEvery} / ${spec.deepEvery}: the physics replays, but summary.finalHash can differ from the lab's`);
      const history = labHistory(manifest); // refuses edgesFrom > 0 and a lesion or feed that does not validate
      record = { entries: history.picks, implicit: true }; // no pick lines of its own: a recovery copy gets them written out
      const labCfg = specConfig(spec);
      lab = {
        scheduled: history.scheduled,
        pressures: history.pressures,
        checkpoints: Array.isArray(manifest.checkpoints) ? manifest.checkpoints : [],
        logged: manifest.interventions as { step?: unknown }[],
        pondPicks: history.picks.length > 0 || (labCfg.pondPeriod !== undefined && (labCfg.pondArm === "scaf" || labCfg.pondArm === "rand" || labCfg.pondArm === "breed")),
      };
    } else {
      // A log cut mid-record by a crash is replayed up to its last complete line; any other damage is an error.
      const log = parsePickLogPrefix(text);
      if (log.torn !== null) ctx.note(`note: ${file} ends in a torn record (${log.torn.length} bytes, not JSON); replaying its ${log.entries.length} complete picks`);
      record = { entries: log.entries, text: log.text, implicit: false };
    }
  } catch (e) {
    die(`--picks-from ${file}: ${(e as Error).message}`);
  }
  return { record, lab };
}

/**
 * The submit-only policy (tools/submit-picks.ts): a picked run on islands carries picks and nothing else, so a lab history that
 * also holds lesions, feeds, suns or pressures is refused, naming what it holds (never silently dropped, which would submit another
 * history than the one the lab observed). `run.ts` accepts all of those in a replay; a distributed run does not take them
 * (a pressured run is never distributed, and a schedule beside a pick log is a separate, unbuilt thing).
 */
export function submitRefusal(lab: LabRecord | undefined, text?: string): string | null {
  if (!lab) return text === undefined ? null : jsonlExtrasRefusal(text);
  const count = (kind: string) => lab.scheduled.filter((e) => (e as { kind: string }).kind === kind).length;
  const held = [
    ...(["lesion", "feed", "sun"] as const).flatMap((k) => (count(k) ? [`${count(k)} ${k}${count(k) > 1 ? "s" : ""}`] : [])),
    ...(lab.pressures.length ? [`${lab.pressures.length} pressure${lab.pressures.length > 1 ? "s" : ""}`] : []),
  ];
  if (!held.length) return null;
  return `the lab history holds ${held.join(", ")} besides its picks; a picked run on islands carries picks only (no lesions, feeds, suns or pressures), so this history cannot be submitted`;
}

/**
 * A picks.jsonl may also hold other record kinds (a run's own log can carry lesion, feed, sun or pressure lines), which
 * `parsePickLogPrefix` skips on a replay. Submitting would silently drop them, so name them and refuse. A line that does not parse
 * (a torn tail) is the loader's to judge, not this check's.
 */
function jsonlExtrasRefusal(text: string): string | null {
  const kinds = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }
    const kind = typeof v === "object" && v !== null ? (v as { kind?: unknown }).kind : undefined;
    if (typeof kind === "string" && kind !== "pick") kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  if (!kinds.size) return null;
  const held = [...kinds].map(([k, n]) => `${n} ${k}${n > 1 ? "s" : ""}`);
  return `the pick log holds ${held.join(", ")} besides its picks; a picked run on islands carries picks only (no lesions, feeds, suns or pressures), so this log cannot be submitted`;
}
