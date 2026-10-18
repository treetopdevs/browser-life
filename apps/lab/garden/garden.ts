// The shared garden's public page (/garden/): reads the frozen garden-v1 contract (apps/coordinator/README.md,
// "The garden") and posts the one letter kind that exists, a stone. The words and rules are written down first in
// docs/garden-page-v0-2026-10-17.md; this file implements them. Everything above `mount` is pure and safe to
// import without a DOM (apps/lab/test/garden.test.ts); `mount` touches the document only when it is called.

export const CONTRACT = "garden-v1";

// ---------- the contract's shape ----------

export interface Census {
  individuals: number | null;
  lineages: number | null;
  maxGeneration: number | null;
  mutations: number | null;
  extinct: boolean | null;
  conservationOk: boolean | null;
}
export interface TipCensus extends Census { day: number; step: number; verified: boolean; source: string }
export interface Letter {
  id: string; kind: string; x: number; y: number; r: number; postedAt: number; landsAtStep: number; day: number;
  status: string; landedIn: string | null; droppedAt: number | null;
}
export interface Day {
  day: number; startStep: number; endStep: number; status: string; releasedAt: number; doneAt: number | null;
  verifiedAt: number | null; digest: string | null; verification: string | null; letters: string[]; census: Census | null;
}
export interface Founding { step: number; kind: string; x: number; y: number; r: number; amount?: number }
export interface GardenView {
  contract: typeof CONTRACT;
  name: string; presetId: string; seed: number;
  world: { width: number; height: number };
  founding: Founding[];
  createdAt: number; now: number;
  /** "growing", "waiting-for-island", "resting", "stopped", "finished"; anything else is shown as given. */
  state: string;
  asleep: boolean;
  pace: { stepsPerDay: number; dawnPeriodMs: number; dawnOffsetMs: number; nextReleaseAt: number | null; releaseDue: boolean; nextDawnAt: number };
  clock: {
    step: number; verifiedStep: number; releasedStep: number; horizonStep: number; daysDone: number; daysTotal: number;
    lastMovedAt: number | null; sleptMs: number | null;
  };
  tending: { windowMs: number; islandsToday: number; deviceTypesToday: number; deviceTypesEver: number; activeNow: number };
  verification: {
    daysDone: number; daysVerified: number; byDifferentDeviceType: number; bySameDeviceType: number;
    diverged: number; failed: number; share: number | null;
  };
  census: TipCensus | null;
  tip: { day: number; step: number; digest: string | null; verified: boolean } | null;
  fork: { day: number; step: number; digest: string | null; checkpoint: string } | null;
  days: Day[];
  letters: {
    perDay: number; queueMax: number; queued: number;
    nextLanding: { day: number; step: number; open: number } | null;
    waiting: Letter[]; recent: Letter[];
  };
  limits: { stoneRadius: { min: number; max: number }; lettersPerAddressPerHour: number; logMax: number };
}

// A check returns null when the value fits, or the first thing wrong with it, named by its path.
type Check = (value: unknown, path: string) => string | null;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num: Check = (v, p) => (typeof v === "number" && Number.isFinite(v) ? null : `${p}: expected a number`);
const pos: Check = (v, p) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? null : `${p}: expected a positive number`);
const str: Check = (v, p) => (typeof v === "string" ? null : `${p}: expected a string`);
const bool: Check = (v, p) => (typeof v === "boolean" ? null : `${p}: expected true or false`);
/** The largest time a JavaScript Date holds, in ms either side of the epoch. */
export const TIME_MAX = 8.64e15;
export const isTime = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= TIME_MAX;
/** A time: an integer count of ms since the epoch that a Date can hold (README: "All times are integers"). */
const time: Check = (v, p) => (isTime(v) ? null : `${p}: expected a time`);
const orNull = (check: Check): Check => (v, p) => (v === null ? null : check(v, p));
const list = (check: Check): Check => (v, p) => {
  if (!Array.isArray(v)) return `${p}: expected a list`;
  for (let i = 0; i < v.length; i++) {
    const wrong = check(v[i], `${p}[${i}]`);
    if (wrong) return wrong;
  }
  return null;
};
/** Every named key must be present and fit; keys the shape does not name are ignored (the contract may add keys). */
const shape = (keys: Record<string, Check>): Check => (v, p) => {
  if (!isObject(v)) return `${p}: expected an object`;
  for (const [key, check] of Object.entries(keys)) {
    const at = p ? `${p}.${key}` : key;
    if (!(key in v)) return `${at}: missing`;
    const wrong = check(v[key], at);
    if (wrong) return wrong;
  }
  return null;
};

const censusKeys = {
  individuals: orNull(num), lineages: orNull(num), maxGeneration: orNull(num), mutations: orNull(num),
  extinct: orNull(bool), conservationOk: orNull(bool),
};
const letterShape = shape({
  id: str, kind: str, x: num, y: num, r: num, postedAt: time, landsAtStep: num, day: num, status: str,
  landedIn: orNull(str), droppedAt: orNull(time),
});
const viewShape = shape({
  name: str, presetId: str, seed: num,
  world: shape({ width: pos, height: pos }),
  // Founding entries are the keeper's lesions and feeds: a feed adds `amount`, a lesion does not.
  founding: list(shape({ step: num, kind: str, x: num, y: num, r: num })),
  createdAt: time, now: time, state: str, asleep: bool,
  pace: shape({ stepsPerDay: pos, dawnPeriodMs: pos, dawnOffsetMs: num, nextReleaseAt: orNull(time), releaseDue: bool, nextDawnAt: time }),
  clock: shape({
    step: num, verifiedStep: num, releasedStep: num, horizonStep: num, daysDone: num, daysTotal: num,
    lastMovedAt: orNull(time), sleptMs: orNull(num),
  }),
  tending: shape({ windowMs: num, islandsToday: num, deviceTypesToday: num, deviceTypesEver: num, activeNow: num }),
  verification: shape({
    daysDone: num, daysVerified: num, byDifferentDeviceType: num, bySameDeviceType: num, diverged: num, failed: num,
    share: orNull(num),
  }),
  census: orNull(shape({ day: num, step: num, ...censusKeys, verified: bool, source: str })),
  tip: orNull(shape({ day: num, step: num, digest: orNull(str), verified: bool })),
  fork: orNull(shape({ day: num, step: num, digest: orNull(str), checkpoint: str })),
  days: list(shape({
    day: num, startStep: num, endStep: num, status: str, releasedAt: time, doneAt: orNull(time), verifiedAt: orNull(time),
    digest: orNull(str), verification: orNull(str), letters: list(str), census: orNull(shape(censusKeys)),
  })),
  letters: shape({
    perDay: num, queueMax: num, queued: num,
    nextLanding: orNull(shape({ day: num, step: num, open: num })),
    waiting: list(letterShape), recent: list(letterShape),
  }),
  limits: shape({ stoneRadius: shape({ min: num, max: num }), lettersPerAddressPerHour: num, logMax: num }),
});

const clip = (text: string, n = 160) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** A GET body as a garden-v1 view, or the reason it is not one. Never throws. */
export function parseGarden(json: unknown): { ok: true; view: GardenView } | { ok: false; reason: string } {
  if (!isObject(json)) return { ok: false, reason: "expected an object" };
  if (json.contract !== CONTRACT) {
    const got = typeof json.contract === "string" ? `“${clip(json.contract, 40)}”` : "none";
    return { ok: false, reason: `contract: expected “${CONTRACT}”, got ${got}` };
  }
  const wrong = viewShape(json, "");
  return wrong ? { ok: false, reason: clip(wrong) } : { ok: true, view: json as unknown as GardenView };
}

// ---------- numbers, times and words ----------

export type Tone = "observed" | "measured" | "pending" | "negative" | "note";
export interface Fmt { locale?: string; timeZone?: string }

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/** Steps with en-GB grouping ("393,216"), whatever the visitor's locale. */
export const fmtSteps = (n: number, locale = "en-GB") => n.toLocaleString(locale);

/** Under a minute, minutes, hours and minutes, then days and hours. */
export function fmtDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${plural(hours, "hour")} and ${plural(minutes % 60, "minute")}` : plural(hours, "hour");
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${plural(days, "day")} and ${plural(hours % 24, "hour")}` : plural(days, "day");
}

/** An absolute time in the visitor's local time (or the given zone), with the zone named. */
export function fmtTime(ms: number, locale?: string, timeZone?: string): string {
  if (!isTime(ms)) return "an unreadable time";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone, timeZoneName: "short",
  }).format(new Date(ms));
}

/** The dawn grid, said once. */
export function dawnWords(view: GardenView): string {
  const { dawnPeriodMs: period, dawnOffsetMs: offset } = view.pace;
  if (period === 86_400_000) {
    const at = ((offset % period) + period) % period;
    const hh = String(Math.floor(at / 3_600_000)).padStart(2, "0");
    const mm = String(Math.floor((at % 3_600_000) / 60_000)).padStart(2, "0");
    return at === 0 ? "Dawn is midnight UTC." : `Dawn is ${hh}:${mm} UTC each day.`;
  }
  return `Dawn comes every ${fmtDuration(period)}.`;
}

/** The first dawn strictly after `t` on the garden's grid. */
export function dawnAfter(view: GardenView, t: number): number {
  const { dawnPeriodMs: period, dawnOffsetMs: offset } = view.pace;
  return offset + (Math.floor((t - offset) / period) + 1) * period;
}

/** The newest released day, R. */
export const releasedDay = (view: GardenView) => Math.round(view.clock.releasedStep / view.pace.stepsPerDay) - 1;

const NEW_WORD = "new to this page";

/**
 * Whether the day list can name "the oldest day that is X": `days` holds only the newest 14, so it can when it starts
 * at day 0, or when every day older than its oldest is done or verified (`clock.daysDone` counts those, listed or
 * not). A requeued early day rerun under a long garden is not in the list, and then no listed day may be named.
 */
export function olderDaysSettled(view: GardenView): boolean {
  if (!view.days.length) return true;
  const oldest = Math.min(...view.days.map((d) => d.day));
  const doneListed = view.days.filter((d) => d.status === "done" || d.status === "verified").length;
  return oldest === 0 || view.clock.daysDone - doneListed === oldest;
}

export interface StateWords { tone: Tone; label: string; sentence: string; known: boolean }

/** The garden's `state` in words (the note's state table). Relative times come from the response's `now`. */
export function stateWords(view: GardenView, fmt: Fmt = {}): StateWords {
  const R = releasedDay(view);
  const settled = olderDaysSettled(view);
  // The oldest listed day of these statuses, only when no unlisted older day could be the one meant.
  const oldest = (statuses: string[]): number | undefined =>
    settled ? view.days.filter((d) => statuses.includes(d.status)).map((d) => d.day).sort((a, b) => a - b)[0] : undefined;
  const slept = view.clock.sleptMs === null || view.clock.lastMovedAt === null
    ? "It has not moved yet."
    : `It has slept ${fmtDuration(view.clock.sleptMs)}.`;
  switch (view.state) {
    case "growing": {
      const d = oldest(["growing"]);
      return { tone: "measured", label: "Growing", sentence: d === undefined ? "Growing: an island is tending a day now." : `Growing: an island is tending day ${d} now.`, known: true };
    }
    case "waiting-for-island": {
      const d = oldest(["waiting"]) ?? (settled && view.pace.releaseDue ? R + 1 : undefined);
      const which = d === undefined ? "a day" : `day ${d}`;
      return view.asleep
        ? { tone: "pending", label: "Asleep", sentence: `Asleep: ${which} is ready and no island has come for it. ${slept}`, known: true }
        : { tone: "pending", label: "Waiting for an island", sentence: `Waiting for an island to take ${which}.`, known: true };
    }
    case "resting": {
      const at = view.pace.nextReleaseAt ?? view.pace.nextDawnAt;
      return { tone: "pending", label: "Resting", sentence: `Resting: today’s day is done; the next can open at dawn, ${fmtTime(at, fmt.locale, fmt.timeZone)}.`, known: true };
    }
    case "stopped": {
      const bad = settled ? view.days.filter((d) => d.status === "diverged" || d.status === "failed").sort((a, b) => a.day - b.day)[0] : undefined;
      const what = !bad ? "A day did not replay the same or could not run."
        : bad.status === "diverged" ? `Day ${bad.day} did not replay the same.` : `Day ${bad.day} could not run.`;
      return { tone: "negative", label: "Stopped", sentence: `Stopped: ${what.charAt(0).toLowerCase()}${what.slice(1)} Nothing after it runs until the keeper looks.`, known: true };
    }
    case "finished":
      return { tone: "pending", label: "Finished", sentence: "Finished: every day to the horizon is done.", known: true };
    default:
      return { tone: "pending", label: `${clip(view.state, 40)} (${NEW_WORD})`, sentence: `The garden says “${clip(view.state, 40)}”, a state ${NEW_WORD}.`, known: false };
  }
}

export interface Chip { tone: Tone; label: string }

/** A day's status and verification, in words; colour is never the only signal. */
export function dayChip(day: Pick<Day, "status" | "verification">): Chip {
  switch (day.status) {
    case "verified":
      if (day.verification === "different-device-type") return { tone: "observed", label: "Verified elsewhere" };
      if (day.verification === "same-device-type") return { tone: "note", label: "Replayed here, not yet verified elsewhere" };
      return { tone: "note", label: "Replayed by a second island" };
    case "done": return { tone: "pending", label: "Done, waiting for a replay" };
    case "growing": return { tone: "measured", label: "Growing" };
    case "waiting": return { tone: "pending", label: "Ready, no island yet" };
    case "diverged": return { tone: "negative", label: "Replay disagreed" };
    case "failed": return { tone: "negative", label: "Could not run" };
    case "blocked": return { tone: "negative", label: "Blocked by an earlier day" };
    default: return { tone: "pending", label: `${clip(day.status, 40)} (${NEW_WORD})` };
  }
}

export interface LetterWords extends Chip { words: string; mine: boolean }

/**
 * A letter's status in words. A letter whose day was verified on a different kind of computer is the clean pass; the
 * words say which kind of replay it was, so colour is never the only signal.
 */
export function letterWords(letter: Letter, mine: ReadonlySet<string> = new Set(), days: readonly Day[] = []): LetterWords {
  const s = fmtSteps(letter.landsAtStep);
  const base = { mine: mine.has(letter.id) };
  switch (letter.status) {
    case "waiting": return { ...base, tone: "pending", label: "Waiting", words: "Waiting: public, and the keeper may still set it aside." };
    // README: sealed means its day is assigned, so the letter is fixed; a day can still fail or be run again.
    case "sealed": return { ...base, tone: "measured", label: "Sealed", words: `Sealed: fixed to day ${letter.day}, which an island has taken; it lands when that day is done.` };
    case "landed": return { ...base, tone: "pending", label: "Landed", words: `Landed at step ${s}, not yet replayed.` };
    case "verified": {
      const kind = days.find((d) => d.day === letter.day)?.verification;
      if (kind === "different-device-type") return { ...base, tone: "observed", label: "Verified elsewhere", words: `Landed at step ${s}; its day was verified elsewhere.` };
      if (kind === "same-device-type") return { ...base, tone: "note", label: "Replayed here", words: `Landed at step ${s}; its day was replayed here, not yet verified elsewhere.` };
      return { ...base, tone: "note", label: "Replayed", words: `Landed at step ${s}; its day was replayed by a second island.` };
    }
    case "dropped": return { ...base, tone: "pending", label: "Set aside", words: "Set aside by the keeper." };
    case "stalled": return { ...base, tone: "negative", label: "Stalled", words: "Stalled: its day did not replay or could not run." };
    default: return { ...base, tone: "pending", label: `${clip(letter.status, 40)} (${NEW_WORD})`, words: `The garden says “${clip(letter.status, 40)}”, a status ${NEW_WORD}.` };
  }
}

/**
 * Who tends it (brainstorm decision 8): one kind of computer reads "Kept by one computer so far". A kind is the
 * adapter string an island reports, which names the browser as well as the GPU (apps/lab/src/island.ts), so two
 * browsers on one computer are two kinds: the caveat says so instead of calling it a lower bound on computers.
 */
export function tendingWords(view: GardenView): { kept: string; caveat: string; islands: string; active: string } {
  const t = view.tending;
  const kept = t.deviceTypesEver === 0 ? "No computer has tended it yet"
    : t.deviceTypesEver === 1 ? "Kept by one computer so far"
    : `Tended by at least ${t.deviceTypesEver} kinds of computer`;
  return {
    kept,
    caveat: "A kind of computer is the browser and GPU an island reports. Two browsers on one computer count as two kinds, so it is neither a count of computers nor an identity.",
    islands: `${plural(t.islandsToday, "island")} in the last ${t.windowMs % 3_600_000 === 0 ? plural(t.windowMs / 3_600_000, "hour") : fmtDuration(t.windowMs)} (two tabs on one computer are two islands), on ${plural(t.deviceTypesToday, "kind")} of computer.`,
    active: t.activeNow === 0 ? "No island is working on it right now." : `${plural(t.activeNow, "island")} working on it right now.`,
  };
}

/** A share in whole percent that never reads 100% short of all, nor 0% above none. */
export function sharePercent(part: number, whole: number): string {
  if (whole <= 0) return "—";
  if (part >= whole) return "100%";
  if (part <= 0) return "0%";
  const pct = Math.round((part * 100) / whole);
  return pct >= 100 ? "99%" : pct <= 0 ? "under 1%" : `${pct}%`;
}

/** The replay numbers in words. Same-device-type replays are "replayed here, not yet verified elsewhere". */
export function verificationSummary(view: GardenView): { headline: string; share: string; lines: string[] } {
  const v = view.verification;
  // Diverged and failed days leave the done count (garden.ex), so they are said even before any day is done.
  const trouble: string[] = [];
  if (v.diverged) trouble.push(`${plural(v.diverged, "day")} whose replay disagreed.`);
  if (v.failed) trouble.push(`${plural(v.failed, "day")} an island could not run.`);
  if (v.daysDone === 0 || v.share === null) {
    return { headline: "No day is done yet", share: "—", lines: trouble.length ? trouble : ["Nothing has been replayed yet."] };
  }
  const lines: string[] = [];
  if (v.daysVerified === 0) lines.push("No day has been replayed by a second island yet.");
  else if (v.byDifferentDeviceType === 0) lines.push(`Every replay so far ran on the same kind of computer: replayed here, not yet verified elsewhere.`);
  else if (v.bySameDeviceType === 0) lines.push(`Every replay so far ran on a different browser or GPU from the day’s first run: verified elsewhere, though perhaps on the same computer.`);
  else lines.push(`${plural(v.byDifferentDeviceType, "day")} verified elsewhere (a different browser or GPU, perhaps the same computer); ${plural(v.bySameDeviceType, "day")} replayed here, not yet verified elsewhere.`);
  lines.push(...trouble);
  // The share comes from the counts, not the rounded `share`, so it can say "99%" and "under 1%" honestly.
  return { headline: `${v.daysVerified} of ${v.daysDone} ${v.daysDone === 1 ? "day" : "days"}`, share: sharePercent(v.daysVerified, v.daysDone), lines };
}

/** The keeper's founding schedule in the site's words: a feed, and a wound (not a lesion). */
export function foundingWords(founding: readonly Founding[]): string {
  if (!founding.length) return "nothing added at the start";
  const feeds = founding.filter((f) => f.kind === "feed").length;
  const wounds = founding.filter((f) => f.kind === "lesion").length;
  const other = founding.length - feeds - wounds;
  const parts = [feeds ? plural(feeds, "feed") : "", wounds ? plural(wounds, "wound") : "", other ? plural(other, "other change") : ""].filter(Boolean);
  return `${parts.join(" and ")} at step 0, set by the keeper`;
}

// ---------- since your last visit ----------

/**
 * What the device keeps about one garden: which planting it saw (`createdAt`), the tip and the coordinator's time
 * then, the aggregate count of replayed days (the day list is only the newest 14), and the letters sent from here.
 */
export interface VisitRecord { createdAt: number; step: number; seenAt: number; daysVerified: number; mine: string[] }
export type Since =
  | { kind: "first" }
  | { kind: "replanted"; seenAt: number }
  | { kind: "behind"; seenAt: number; prevStep: number }
  | { kind: "unchanged"; seenAt: number; prevStep: number }
  | { kind: "changed"; seenAt: number; prevStep: number; steps: number; days: number; newlyVerified: number; landed: Letter[]; landedAtLeast: boolean };

export const MINE_MAX = 32;
/** `letters.recent` holds at most this many letters (README). */
export const RECENT_MAX = 32;
export const visitKey = (coordinator: string, garden: string) => `cadence-garden-visit:${coordinator}:${garden}`;

/** What changed between the record kept at the last visit and this reading. */
export function sinceLastVisit(prev: VisitRecord | null, view: GardenView): Since {
  if (!prev) return { kind: "first" };
  // Planted again under the same name: the old record describes another history.
  if (prev.createdAt !== view.createdAt) return { kind: "replanted", seenAt: prev.seenAt };
  const steps = view.clock.step - prev.step;
  if (steps < 0) return { kind: "behind", seenAt: prev.seenAt, prevStep: prev.step };
  const newlyVerified = Math.max(0, view.verification.daysVerified - prev.daysVerified);
  const recent = view.letters.recent;
  const landed = recent
    .filter((l) => (l.status === "landed" || l.status === "verified") && l.landsAtStep > prev.step && l.landsAtStep <= view.clock.step)
    .sort((a, b) => a.landsAtStep - b.landsAtStep || a.id.localeCompare(b.id));
  if (steps === 0 && newlyVerified === 0 && landed.length === 0) return { kind: "unchanged", seenAt: prev.seenAt, prevStep: prev.step };
  // The list is the newest 32 by posting, not by landing (a letter posted later can land on an earlier day), so a
  // full list may leave out a landing whatever the steps of the letters it shows.
  const landedAtLeast = recent.length >= RECENT_MAX;
  return {
    kind: "changed", seenAt: prev.seenAt, prevStep: prev.step, steps, days: Math.floor(steps / view.pace.stepsPerDay),
    newlyVerified, landed, landedAtLeast,
  };
}

export function recordFor(view: GardenView, mine: readonly string[]): VisitRecord {
  return {
    createdAt: view.createdAt, step: view.clock.step, seenAt: view.now,
    daysVerified: view.verification.daysVerified, mine: newestMine(mine),
  };
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** The device's record, or null when there is none, it is unreadable or of another shape, or storage throws. */
export function readVisit(storage: Pick<Storage, "getItem"> | null, key: string): VisitRecord | null {
  try {
    const text = storage?.getItem(key);
    if (!text) return null;
    const v = JSON.parse(text) as unknown;
    if (!isObject(v) || !isTime(v.createdAt) || !isTime(v.seenAt) || !count(v.step) || !count(v.daysVerified)) return null;
    const mine = Array.isArray(v.mine) ? newestMine(v.mine.filter((d): d is string => typeof d === "string")) : [];
    return { createdAt: v.createdAt, step: v.step, seenAt: v.seenAt, daysVerified: v.daysVerified, mine };
  } catch {
    return null;
  }
}

export function writeVisit(storage: Pick<Storage, "setItem"> | null, key: string, record: VisitRecord): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

const letterNumber = (id: string) => {
  const m = /^ltr-(\d{1,9})$/.exec(id);
  return m ? Number(m[1]) : -1;
};

/**
 * Letter ids once each, oldest first, capped at the newest MINE_MAX. Ids number a planting's letters in posting order
 * (README: "ltr-<n>"), so the cap keeps the newest whichever tab recorded them; an id of another form counts as oldest.
 */
export function newestMine(ids: readonly string[]): string[] {
  const once = [...new Set(ids)];
  return once
    .map((id, i) => ({ id, i, n: letterNumber(id) }))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .map((e) => e.id)
    .slice(-MINE_MAX);
}

/** This tab's letters joined with those another tab wrote for the same planting, newest last. */
export function mergeMine(stored: VisitRecord | null, createdAt: number, mine: readonly string[]): string[] {
  const theirs = stored && stored.createdAt === createdAt ? stored.mine : [];
  return newestMine([...theirs, ...mine]);
}

// ---------- the letter form ----------

export interface StoneBody { kind: "stone"; x: number; y: number; r: number }
export type StoneCheck = { ok: true; body: StoneBody } | { ok: false; field: "x" | "y" | "r"; words: string };

const whole = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v !== "string" || !/^\s*-?\d+\s*$/.test(v)) return null;
  return Number(v);
};

/** What the server checks, checked before sending: whole numbers, the centre inside the world, r within the limits. */
export function checkStone(input: { x?: unknown; y?: unknown; r?: unknown }, view: GardenView): StoneCheck {
  const { width, height } = view.world;
  const { min, max } = view.limits.stoneRadius;
  const x = whole(input.x), y = whole(input.y), r = whole(input.r);
  if (x === null || x < 0 || x >= width) return { ok: false, field: "x", words: `Across (x) is a whole number from 0 to ${width - 1}.` };
  if (y === null || y < 0 || y >= height) return { ok: false, field: "y", words: `Down (y) is a whole number from 0 to ${height - 1}.` };
  if (r === null || r < min || r > max) return { ok: false, field: "r", words: `The radius is a whole number from ${min} to ${max}.` };
  return { ok: true, body: { kind: "stone", x, y, r } };
}

/**
 * The earliest the landing day can open: already released; due (the next island to ask gets it); not before a time;
 * or only after day `afterDay` (the newest released day, not done yet) is done, with a time bound when one says more
 * than "now".
 */
export type Earliest = "released" | "due" | { notBefore: number } | { afterDay: number; notBefore: number | null };
export type Landing =
  | { open: false; reason: string }
  | { open: true; day: number; step: number; left: number; perDay: number; earliest: Earliest };

/**
 * Where a stone posted now would land (`letters.nextLanding`), and the earliest its day can open under the README's
 * release rule: day R+1 only once day R is done and a dawn has passed since R was released (`nextReleaseAt`; null
 * while R is not done), then one day per dawn. A bound, never a promise: a day opens only when an island asks for it.
 */
export function landingPreview(view: GardenView): Landing {
  const next = view.letters.nextLanding;
  if (!next) {
    const why = view.state === "stopped" ? "it has stopped until the keeper looks"
      : view.state === "finished" ? "every day to the horizon is done"
      : view.letters.queued >= view.letters.queueMax ? `the queue is full (${plural(view.letters.queued, "letter")} waiting)`
      : "its log is full or no day is left before the horizon";
    return { open: false, reason: `The garden takes no letters now: ${why}.` };
  }
  const R = releasedDay(view);
  const L = next.day;
  const base = { open: true as const, day: L, step: next.step, left: next.open, perDay: view.letters.perDay };
  if (L <= R) return { ...base, earliest: "released" };
  const after = (t: number) => {
    let at = Math.max(t, view.now);
    for (let d = R + 2; d <= L && d - R < 10_000; d++) at = dawnAfter(view, at);
    return at;
  };
  if (view.pace.nextReleaseAt === null) {
    // Day R is not done (with a landing offered, null means nothing else). R+1 cannot open before R is done, which is
    // after now, nor before the first dawn after R's release; later days each need a further dawn.
    const newest = view.days.find((d) => d.day === R);
    const first = newest ? dawnAfter(view, newest.releasedAt) : view.now;
    const bound = after(first);
    return { ...base, earliest: { afterDay: R, notBefore: bound > view.now ? bound : null } };
  }
  const first = view.pace.nextReleaseAt;
  if (L === R + 1) return { ...base, earliest: first <= view.now ? "due" : { notBefore: first } };
  return { ...base, earliest: { notBefore: after(first) } };
}

export function landingWords(landing: Landing, fmt: Fmt = {}): string {
  if (!landing.open) return landing.reason;
  const where = `Your stone would land at step ${fmtSteps(landing.step)}, the end of day ${landing.day}; ${landing.left} of the day’s ${landing.perDay} places ${landing.left === 1 ? "is" : "are"} left.`;
  const e = landing.earliest;
  const at = (ms: number) => fmtTime(ms, fmt.locale, fmt.timeZone);
  const when = e === "released" ? `Day ${landing.day} is already released: it lands when an island grows it.`
    : e === "due" ? `Day ${landing.day} can open as soon as an island asks for it.`
    : "afterDay" in e
      ? `Day ${landing.day} opens only after day ${e.afterDay} is done${landing.day > e.afterDay + 1 ? ", then one day a dawn" : " and a dawn has passed since it was released"}${e.notBefore === null ? "" : `, not before ${at(e.notBefore)}`}, and only if an island tends it.`
      : `Day ${landing.day} opens not before ${at(e.notBefore)}, and only if an island tends it.`;
  return `${where} ${when}`;
}

/** The courtesy (brainstorm §4): has this device posted since the last dawn? Uses the garden's grid, not the device clock. */
export function postedSinceDawn(view: GardenView, mine: ReadonlySet<string>): boolean {
  const lastDawn = view.pace.nextDawnAt - view.pace.dawnPeriodMs;
  return [...view.letters.waiting, ...view.letters.recent].some((l) => mine.has(l.id) && l.postedAt >= lastDawn);
}

// ---------- answers ----------

export interface Answer { tone: Tone; words: string; refresh: boolean; letter?: { id: string; landsAtStep: number; day: number } }

const serverWords = (body: unknown): string | null => {
  if (!isObject(body) || typeof body.error !== "string") return null;
  const text = clip(body.error.trim(), 200);
  return text ? (/[.!?]$/.test(text) ? text : `${text}.`) : null;
};

/** A `Retry-After` header in ms: only a count of seconds counts; a missing, empty or dated header is null. */
export function retryAfterMs(header: string | null | undefined): number | null {
  if (header === null || header === undefined || !/^\s*\d+(\.\d+)?\s*$/.test(header)) return null;
  return Number(header) * 1000;
}

/** Said when a letter's fate is unknown: the server keeps a letter before it answers, so it may be in the queue. */
const UNSURE = "so this page cannot tell whether your stone arrived. The queue below is read again: look for it there before sending another.";

/**
 * A POST to the letters route, in words (the note's answer table). Status 0 is no answer at all (no connection, or
 * none within the deadline); like an unexpected code, it leaves the stone's fate unknown, and the page says so.
 */
export function postAnswer(status: number, body: unknown, headers: { get(name: string): string | null } | null, view: GardenView | null): Answer {
  switch (status) {
    case 201: {
      const l = isObject(body) && isObject(body.letter) ? body.letter : null;
      if (l && typeof l.id === "string" && typeof l.landsAtStep === "number" && typeof l.day === "number") {
        return {
          tone: "note", refresh: true, letter: { id: l.id, landsAtStep: l.landsAtStep, day: l.day },
          words: `Posted as ${clip(l.id, 24)}. It is public now, lands at step ${fmtSteps(l.landsAtStep)} (end of day ${l.day}), and counts once a second island replays that day.`,
        };
      }
      return { tone: "note", refresh: true, words: "Posted. It is public now; the queue below shows where it lands." };
    }
    case 422: return { tone: "negative", refresh: false, words: `The garden refused the stone: ${serverWords(body) ?? "it is not a stone the garden takes."}` };
    case 409: return { tone: "negative", refresh: true, words: `The garden takes no letters now: ${serverWords(body) ?? "try again after the next dawn."}` };
    case 429: {
      // The limiter also answers 429 after too many refused letters, or for a new network while its table is full,
      // so the words name the limit without saying this network has sent that many.
      const fromBody = isObject(body) && typeof body.retryAfterMs === "number" && Number.isFinite(body.retryAfterMs) ? body.retryAfterMs : null;
      const wait = fromBody ?? retryAfterMs(headers?.get("retry-after"));
      const n = view?.limits.lettersPerAddressPerHour;
      const limit = n === undefined ? "a few letters an hour from one network" : `${plural(n, "letter")} an hour from one network`;
      const words = `The garden is not taking letters from this network just now: it takes at most ${limit}, and fewer when many are refused.`;
      return { tone: "negative", refresh: false, words: wait === null ? `${words} Try again later.` : `${words} Try again in ${fmtDuration(wait)}.` };
    }
    case 413:
    case 415: return { tone: "negative", refresh: false, words: "The page sent something the garden could not read. Reload the page and try again." };
    case 404: return { tone: "negative", refresh: false, words: "There is no garden by that name here." };
    case 503: return { tone: "negative", refresh: false, words: "The garden is busy; try again in a moment." };
    case 0: return { tone: "negative", refresh: true, words: `No answer came back, ${UNSURE}` };
    default: return { tone: "negative", refresh: true, words: `The garden answered ${status}, ${UNSURE}` };
  }
}

/** A GET of the view that did not give a garden, in words. */
export function getAnswer(status: number): string {
  switch (status) {
    case 404: return "No garden is planted here yet.";
    case 503: return "The garden is busy; try again in a moment.";
    case 0: return "The garden could not be reached.";
    default: return `The garden answered ${status}; try again later.`;
  }
}

export const shapeWords = (reason: string) => `The garden answered in a shape this page does not know (${reason}).`;

// ---------- where to read ----------

export interface Source {
  /** "" for the relative /api of this site; otherwise an http(s) origin. */
  base: string;
  /** The coordinator as the storage key names it. */
  coordinator: string;
  garden: string | null;
  mock: boolean;
  notes: string[];
  viewUrl: string;
  lettersUrl: string;
}

const GARDEN_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** `?coordinator=<http(s) origin>`, `?garden=<name>`, and `?mock=1` in the dev server only. Anything else is ignored, with a note. */
export function resolveSource(search: string, origin: string, dev: boolean): Source {
  const params = new URLSearchParams(search);
  const notes: string[] = [];
  let base = "";
  const asked = params.get("coordinator");
  if (asked !== null) {
    let url: URL | null = null;
    try { url = new URL(asked); } catch { url = null; }
    const bare = url && (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      && (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash && asked.replace(/\/$/, "") === url.origin;
    if (url && bare) base = url.origin;
    else notes.push("The coordinator address in the link is not a bare http(s) address, so this page reads its own.");
  }
  let garden: string | null = null;
  const name = params.get("garden");
  if (name !== null) {
    if (GARDEN_NAME.test(name)) garden = name;
    else notes.push("The garden name in the link is not one a garden can have, so this page reads the public garden.");
  }
  const mock = dev && params.get("mock") === "1";
  if (!dev && params.get("mock") !== null) notes.push("The example garden is only in the development build, so this page reads the live garden.");
  const path = garden === null ? "/api/public/garden" : `/api/public/gardens/${encodeURIComponent(garden)}`;
  return {
    base, coordinator: mock ? "mock" : base || origin, garden, mock, notes,
    viewUrl: `${base}${path}`, lettersUrl: `${base}${path}/letters`,
  };
}

/** Only the contract's own checkpoint path becomes a link; anything else from a response is shown as text. */
export function checkpointHref(source: Source, view: GardenView): string | null {
  const path = view.fork?.checkpoint;
  if (!path || !/^\/api\/public\/gardens\/[a-z0-9][a-z0-9_-]{0,63}\/checkpoints\/[0-9a-f]{16}$/.test(path)) return null;
  return `${source.base}${path}`;
}

// ---------- talking to the coordinator ----------

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export interface Reply { status: number; json: unknown; headers: Headers | null }

/**
 * One request and its JSON body under one deadline. The status is 0 when there was no answer, or when the answer
 * or its body did not arrive within `ms` (the request is aborted then). A body that is not JSON is null. Never throws.
 */
export async function requestJson(fetchFn: FetchLike, url: string, init: RequestInit, ms: number): Promise<Reply> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Reply>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve({ status: 0, json: null, headers: null }); }, ms);
  });
  const work = (async (): Promise<Reply> => {
    try {
      const response = await fetchFn(url, { ...init, signal: controller.signal });
      let json: unknown = null;
      try { json = await response.json(); } catch { json = null; }
      // A body cut off by the deadline is no answer, not a malformed one.
      return controller.signal.aborted ? { status: 0, json: null, headers: null } : { status: response.status, json, headers: response.headers };
    } catch {
      return { status: 0, json: null, headers: null };
    }
  })();
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- the page ----------

export interface Deps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  storage: () => Storage | null;
  /** The contract's fixture, in the dev server only; null in the production build. */
  fixture: (() => Promise<unknown>) | null;
  dev: boolean;
  search: string;
  origin: string;
  locale?: string;
  timeZone?: string;
  pollMs: number;
  /** How long one request, body included, may take before it counts as no answer. */
  timeoutMs: number;
}

export function browserDeps(): Deps {
  return {
    fetch: (url, init) => fetch(url, init),
    storage: () => { try { return window.localStorage; } catch { return null; } },
    // Dropped from the production build: import.meta.env.DEV is false there, and the import goes with it.
    fixture: import.meta.env.DEV
      ? () => import("../../coordinator/priv/static/garden-contract.example.json").then((m) => m.default as unknown)
      : null,
    dev: import.meta.env.DEV,
    search: location.search,
    origin: location.origin,
    pollMs: 60_000,
    timeoutMs: 20_000,
  };
}

type Child = Node | string | null | undefined | false;

export function mount(doc: Document, deps: Deps): { refresh: () => Promise<void> } {
  const fmt: Fmt = { locale: deps.locale, timeZone: deps.timeZone };
  const source = resolveSource(deps.search, deps.origin, deps.dev);
  const $ = (id: string) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`garden page: #${id} is missing`);
    return el;
  };
  const h = (tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement => {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    for (const c of children) if (c) el.append(c);
    return el;
  };
  const chip = (c: Chip) => h("span", { class: `state ${c.tone}` }, c.label);
  const fill = (id: string, ...children: Child[]) => { $(id).replaceChildren(...children.filter((c): c is Node | string => !!c)); };
  const stat = (value: string, label: string, id?: string) =>
    h("div", {}, h("span", { class: "status-value", ...(id ? { id } : {}) }, value), h("span", { class: "status-label" }, label));
  const n = (v: number | null) => (v === null ? "not reported" : fmtSteps(v));
  const time = (ms: number) => fmtTime(ms, fmt.locale, fmt.timeZone);

  const message = $("garden-message");
  const body = $("garden-body");
  const form = $("garden-form") as HTMLFormElement;
  const xIn = $("stone-x") as HTMLInputElement;
  const yIn = $("stone-y") as HTMLInputElement;
  const rIn = $("stone-r") as HTMLInputElement;
  const send = $("stone-send") as HTMLButtonElement;
  const sendWhy = $("stone-why");
  const preview = $("stone-preview");
  const answer = $("stone-answer");
  const map = $("stone-map") as unknown as SVGSVGElement;

  const notes = [...source.notes];
  if (source.mock) notes.unshift("The example garden from the contract, not a live one.");
  // Another coordinator is said plainly at the top: its numbers are not this site's.
  else if (source.base) notes.unshift(`Reading a garden at ${source.base}, not this site’s own: the numbers and the queue below come from there, and a stone is sent there.`);
  if (notes.length) { $("garden-source").textContent = notes.join(" "); $("garden-source").hidden = false; }

  let view: GardenView | null = null;
  /** The record this device kept before this page was opened, read once per planting and kept as the baseline. */
  let baseline: { id: string; prev: VisitRecord | null; readable: boolean } | null = null;
  let since: Since | null = null;
  /** Whether the last write of the record worked: without it, "next time" has nothing to compare. */
  let keeps = true;
  let mine: string[] = [];
  let reading = false;
  let readAgain = false;
  let sending = false;
  let placed = false;

  const key = (v: GardenView) => visitKey(source.coordinator, v.name);
  const storage = () => { try { return deps.storage(); } catch { return null; } };
  /** Writes this reading, joined with letters another tab of this device recorded for the same planting. */
  const persist = (v: GardenView) => {
    const store = storage();
    mine = mergeMine(readVisit(store, key(v)), v.createdAt, mine);
    keeps = writeVisit(store, key(v), recordFor(v, mine));
  };

  function render(v: GardenView): void {
    const mineSet = new Set(mine);
    const s = stateWords(v, fmt);
    fill("g-state", h("p", { class: "garden-headline" }, chip(s), " ", h("span", {}, s.sentence)));
    const dawnIn = v.pace.nextDawnAt - v.now;
    fill("g-clock",
      stat(fmtSteps(v.clock.step), "Steps grown (the tip)", "g-step"),
      stat(`${fmtSteps(v.clock.daysDone)} of ${fmtSteps(v.clock.daysTotal)}`, "Days done, to the horizon"),
      stat(fmtSteps(v.clock.verifiedStep), "Steps every replay agrees on"),
      stat(dawnIn > 0 ? fmtDuration(dawnIn) : "now", `Until the next dawn, ${time(v.pace.nextDawnAt)}`));
    fill("g-clock-note", `Read at ${time(v.now)} by the garden’s clock; times here count from that reading. ${dawnWords(v)} One day is ${fmtSteps(v.pace.stepsPerDay)} steps, released at most once a dawn, and only when an island asks.`);

    // Since your last visit: against the record kept before this page opened, recomputed on every reading.
    if (!since) fill("g-since", h("p", {}, "Nothing to compare: this device keeps no record of earlier visits."));
    else if (since.kind === "first") {
      fill("g-since", h("p", {}, keeps
        ? "First visit from this device. Next time, this says what changed since now."
        : "First visit from this device, and it cannot keep a record, so there will be nothing to compare next time."));
    } else if (since.kind === "replanted") fill("g-since", h("p", {}, `The garden was planted again since your last visit (${time(since.seenAt)}), so there is nothing to compare; this device’s record starts over.`));
    else if (since.kind === "unchanged") fill("g-since", h("p", {}, `No change since your last visit (${time(since.seenAt)}): still at step ${fmtSteps(since.prevStep)}.`));
    else if (since.kind === "behind") fill("g-since", h("p", {}, `The garden is behind what this device saw at ${time(since.seenAt)} (step ${fmtSteps(since.prevStep)}); a day may have been run again.`));
    else {
      fill("g-since",
        h("p", {}, `Since your last visit (${time(since.seenAt)}): `, h("strong", {}, plural(since.days, "day")), " done, ",
          h("strong", {}, fmtSteps(since.steps)), " steps grown."),
        since.newlyVerified ? h("p", {}, `${plural(since.newlyVerified, "more day")} replayed by a second island.`) : null,
        since.landed.length ? h("p", {}, `Letters landed since${since.landedAtLeast ? " (at least these; the garden lists only its newest 32)" : ""}: ${since.landed.map((l) => l.id).join(", ")}.`)
          : since.landedAtLeast && since.steps > 0 ? h("p", {}, "None of the garden’s newest 32 letters landed since; it lists no older ones, so some may have.") : null);
    }

    // Who tends it.
    const t = tendingWords(v);
    fill("g-tending", h("p", { class: "garden-headline" }, h("strong", {}, t.kept), "."), h("p", {}, t.islands), h("p", {}, t.active), h("p", { class: "fine" }, t.caveat));

    // Verification.
    const vs = verificationSummary(v);
    fill("g-verify",
      h("div", { class: "status-grid garden-pair" }, stat(vs.headline, "Days replayed by a second island", "g-verified"), stat(vs.share, "Share of the days done")),
      ...vs.lines.map((line) => h("p", {}, line)),
      h("p", { class: "fine" }, "Verified means a second island replayed the day and got the same state, bit for bit. It does not make anything in the garden a result."));

    // Census.
    const c = v.census;
    if (!c) fill("g-census", h("p", {}, "No day is done yet, so there is nothing to count."));
    else {
      fill("g-census",
        h("p", {}, `Day ${c.day}, at step ${fmtSteps(c.step)}: `, chip(c.verified ? { tone: "note", label: "Its day was replayed" } : { tone: "pending", label: "Not yet replayed" })),
        h("div", { class: "status-grid" },
          stat(n(c.individuals), "Individuals"), stat(n(c.lineages), "Lineages"),
          stat(n(c.maxGeneration), "Deepest generation"), stat(n(c.mutations), "Mutations")),
        h("p", {}, c.extinct === null ? "Whether anything is alive: not reported." : c.extinct ? "Nothing is alive." : "Something is alive.",
          " ", c.conservationOk === null ? "The matter count: not reported." : c.conservationOk ? "The matter adds up." : "The matter did not add up."),
        h("p", { class: "fine" }, "Reported by the island that ran the day; the replay checks the state, not these numbers."));
    }

    // Days.
    const dayList = h("ol", { class: "garden-days", id: "g-day-list" });
    for (const d of v.days) {
      const c2 = dayChip(d);
      const when = d.verifiedAt !== null ? `replayed ${time(d.verifiedAt)}` : d.doneAt !== null ? `done ${time(d.doneAt)}` : `released ${time(d.releasedAt)}`;
      dayList.append(h("li", {},
        h("span", { class: "garden-day-name" }, `Day ${d.day}`),
        h("span", { class: "garden-day-body" },
          chip(c2), " ",
          h("span", { class: "fine" }, `steps ${fmtSteps(d.startStep)} to ${fmtSteps(d.endStep)}; ${when}`),
          d.letters.length ? h("span", { class: "fine" }, `; carries ${d.letters.join(", ")}`) : null)));
    }
    fill("g-days", v.days.length ? dayList : h("p", {}, "No day is released yet."),
      h("p", { class: "fine" }, v.days.length === 1 ? "The newest day." : `The newest ${v.days.length} days, newest first.`));

    // Letters.
    const letterItem = (l: Letter) => {
      const w = letterWords(l, mineSet, v.days);
      return h("li", { "data-letter": l.id },
        h("span", { class: "garden-letter-id mono" }, l.id),
        h("span", { class: "garden-letter-body" },
          chip(w), w.mine ? h("span", { class: "state measured garden-mine" }, "Yours") : null, " ",
          h("span", {}, l.kind === "stone"
            ? `A stone of radius ${l.r} at (${l.x}, ${l.y}), landing at step ${fmtSteps(l.landsAtStep)} (end of day ${l.day}). `
            : `A letter of a kind ${NEW_WORD} (“${clip(l.kind, 24)}”), landing at step ${fmtSteps(l.landsAtStep)} (end of day ${l.day}). `),
          h("span", { class: "fine" }, w.words)));
    };
    const waiting = h("ul", { class: "garden-letters", id: "g-waiting" }, ...v.letters.waiting.map(letterItem));
    const recent = h("ul", { class: "garden-letters", id: "g-recent" }, ...v.letters.recent.map(letterItem));
    fill("g-letters",
      h("p", {}, `${plural(v.letters.queued, "letter")} waiting, of at most ${v.letters.queueMax}; one day carries ${plural(v.letters.perDay, "letter")}.`),
      h("h3", {}, "Waiting"), v.letters.waiting.length ? waiting : h("p", { class: "fine" }, "No letter is waiting."),
      h("h3", {}, "Recently"), v.letters.recent.length ? recent : h("p", { class: "fine" }, "No letter has landed or been set aside yet."),
      h("p", { class: "fine" }, "Letters carry a place and a size and nothing else, so no author is named. “Yours” comes from this device’s own list."));

    // Fork and limits.
    const href = checkpointHref(source, v);
    const lim = v.limits;
    const founding = foundingWords(v.founding);
    fill("g-fork",
      v.fork
        ? h("p", {}, `The newest checkpoint every replay agrees on: day ${v.fork.day}, step ${fmtSteps(v.fork.step)}. `,
          href ? h("a", { class: "text-link", href, id: "g-fork-link", download: "" }, "Download it (.blck)") : null,
          v.fork.digest ? h("span", { class: "fine mono garden-digest" }, ` digest ${v.fork.digest}`) : null)
        : h("p", {}, "No checkpoint to fork yet: the fork is offered once day 0 has been replayed by a second island."),
      h("p", {}, `${v.name} was planted ${time(v.createdAt)} on `, h("span", { class: "mono" }, v.presetId), `, seed ${v.seed}, ${v.world.width} by ${v.world.height} cells, with ${founding}. Its horizon is ${plural(v.clock.daysTotal, "day")} (step ${fmtSteps(v.clock.horizonStep)}).`),
      h("p", { class: "fine" }, `Limits: a stone’s radius is ${lim.stoneRadius.min} to ${lim.stoneRadius.max}; ${plural(lim.lettersPerAddressPerHour, "letter")} an hour from one network; at most ${fmtSteps(lim.logMax)} letters in the garden’s log.`));

    // The form's limits follow the garden.
    xIn.max = String(v.world.width - 1);
    yIn.max = String(v.world.height - 1);
    rIn.min = String(lim.stoneRadius.min);
    rIn.max = String(lim.stoneRadius.max);
    if (!placed) {
      xIn.value = String(Math.floor(v.world.width / 2));
      yIn.value = String(Math.floor(v.world.height / 2));
      placed = true;
    }
    fill("g-courtesy", postedSinceDawn(v, mineSet)
      ? "This device has sent a letter since the last dawn. The garden asks one letter per device per dawn: a courtesy, not a rule."
      : "The garden asks one letter per device per dawn: a courtesy, not a rule.");
    updateForm();
  }

  const SVG = "http://www.w3.org/2000/svg";
  const svg = (tag: string, attrs: Record<string, string | number>) => {
    const el = doc.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };

  function drawMap(v: GardenView, stone: StoneBody | null): void {
    const mineSet = new Set(mine);
    map.setAttribute("viewBox", `0 0 ${v.world.width} ${v.world.height}`);
    // The box takes the world's shape, so a click maps to the cell under it (the CSS default is square).
    map.style.aspectRatio = `${v.world.width} / ${v.world.height}`;
    const parts: Element[] = [svg("rect", { x: 0, y: 0, width: v.world.width, height: v.world.height, class: "map-world" })];
    for (const l of v.letters.waiting) {
      if (l.kind !== "stone") continue;
      parts.push(svg("circle", { cx: l.x + 0.5, cy: l.y + 0.5, r: Math.max(l.r, 2), class: mineSet.has(l.id) ? "map-mine" : "map-waiting" }));
    }
    if (stone) {
      parts.push(svg("circle", { cx: stone.x + 0.5, cy: stone.y + 0.5, r: Math.max(stone.r, 2), class: "map-stone" }));
      parts.push(svg("circle", { cx: stone.x + 0.5, cy: stone.y + 0.5, r: Math.max(v.world.width / 160, 1.5), class: "map-centre" }));
    }
    map.replaceChildren(...parts);
  }

  function updateForm(): void {
    if (!view) return;
    const check = checkStone({ x: xIn.value, y: yIn.value, r: rIn.value }, view);
    const landing = landingPreview(view);
    for (const input of [xIn, yIn, rIn]) input.removeAttribute("aria-invalid");
    if (!check.ok) ($(`stone-${check.field}`) as HTMLInputElement).setAttribute("aria-invalid", "true");
    preview.textContent = landingWords(landing, fmt);
    const why = !landing.open ? landing.reason : !check.ok ? check.words : sending ? "Sending…" : "";
    send.disabled = !landing.open || !check.ok || sending;
    sendWhy.textContent = why;
    drawMap(view, check.ok ? check.body : null);
  }

  function say(el: HTMLElement, words: string, tone: Tone | null = null): void {
    el.textContent = words;
    if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
  }

  async function getView(): Promise<{ status: number; json: unknown; retryAfter: number | null }> {
    if (source.mock) {
      if (!deps.fixture) return { status: 0, json: null, retryAfter: null };
      return { status: 200, json: structuredClone(await deps.fixture()), retryAfter: null };
    }
    const got = await requestJson(deps.fetch, source.viewUrl, { cache: "no-store", headers: { accept: "application/json" } }, deps.timeoutMs);
    return { status: got.status, json: got.json, retryAfter: retryAfterMs(got.headers?.get("retry-after")) };
  }

  function hide(words: string): void {
    say(message, words);
    view = null;
    body.hidden = true;
  }

  async function read(): Promise<void> {
    let got = await getView();
    if (got.status === 503) {
      await new Promise((r) => setTimeout(r, Math.min(got.retryAfter ?? 1000, 5000)));
      got = await getView();
    }
    if (got.status === 404) return hide(getAnswer(404));
    if (got.status !== 200) {
      // An earlier reading stays on the page, dated, rather than passing for the garden now.
      if (view) say(message, `${getAnswer(got.status)} The numbers below were read at ${fmtTime(view.now, fmt.locale, fmt.timeZone)}.`);
      else hide(getAnswer(got.status));
      return;
    }
    const parsed = parseGarden(got.json);
    if (!parsed.ok) return hide(shapeWords(parsed.reason));
    const v = parsed.view;
    const id = `${key(v)}@${v.createdAt}`;
    if (!baseline || baseline.id !== id) {
      const store = storage();
      const prev = readVisit(store, key(v));
      baseline = { id, prev, readable: store !== null };
      // Letters from an earlier planting under the same name are not this device's.
      mine = prev && prev.createdAt === v.createdAt ? prev.mine : [];
    }
    since = baseline.readable ? sinceLastVisit(baseline.prev, v) : null;
    persist(v);
    view = v;
    try {
      render(v);
    } catch (error) {
      return hide(shapeWords(`it could not be shown: ${clip(error instanceof Error ? error.message : String(error), 80)}`));
    }
    say(message, source.mock ? "Showing the example garden." : "The garden answered.");
    body.hidden = false;
  }

  async function refresh(): Promise<void> {
    if (reading) { readAgain = true; return; }
    reading = true;
    try {
      await read();
    } finally {
      reading = false;
      updateForm();
    }
    if (readAgain) { readAgain = false; await refresh(); }
  }

  /**
   * Keeps a confirmed letter as this device's, for the planting it was sent to, even when the page lost its view
   * meanwhile (a failed read): the record's numbers stay as they were, and only the letter is added.
   */
  function remember(id: string, target: GardenView): void {
    if (baseline && baseline.id !== `${key(target)}@${target.createdAt}`) return;
    mine = newestMine([...mine, id]);
    if (view && key(view) === key(target) && view.createdAt === target.createdAt) return persist(view);
    const store = storage();
    const stored = readVisit(store, key(target));
    const base = stored && stored.createdAt === target.createdAt ? stored : recordFor(target, []);
    mine = mergeMine(stored, target.createdAt, mine);
    keeps = writeVisit(store, key(target), { ...base, mine });
  }

  async function post(stone: StoneBody, target: GardenView): Promise<void> {
    if (source.mock) {
      say(answer, "This is the example garden from the contract, so nothing was sent.", "pending");
      return;
    }
    sending = true;
    updateForm();
    let got: Reply;
    try {
      got = await requestJson(deps.fetch, source.lettersUrl, {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(stone),
      }, deps.timeoutMs);
    } finally {
      sending = false;
    }
    const a = postAnswer(got.status, got.json, got.headers, target);
    if (a.letter) remember(a.letter.id, target);
    say(answer, a.words, a.tone);
    updateForm();
    if (a.refresh) await refresh();
  }

  for (const input of [xIn, yIn, rIn]) input.addEventListener("input", updateForm);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!view || sending) return;
    const check = checkStone({ x: xIn.value, y: yIn.value, r: rIn.value }, view);
    if (!check.ok) { updateForm(); return; }
    void post(check.body, view);
  });
  map.addEventListener("click", (event) => {
    if (!view) return;
    const box = map.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const x = Math.floor(((event.clientX - box.left) / box.width) * view.world.width);
    const y = Math.floor(((event.clientY - box.top) / box.height) * view.world.height);
    xIn.value = String(Math.min(Math.max(x, 0), view.world.width - 1));
    yIn.value = String(Math.min(Math.max(y, 0), view.world.height - 1));
    updateForm();
  });

  void refresh();
  setInterval(() => { if (!doc.hidden && !reading && !sending) void refresh(); }, deps.pollMs);
  return { refresh };
}
