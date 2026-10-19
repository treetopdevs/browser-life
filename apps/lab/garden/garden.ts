// The shared garden's public page (/garden/): reads the frozen garden-v1 contract (apps/coordinator/README.md,
// "The garden") and posts the one letter kind that exists, a stone, and (in a garden founded with food or meteor) a hand
// on the food or meteor ask. The words and rules are written down first in docs/garden-page-v0-2026-10-17.md and, for
// food, docs/garden-food-2026-10-18.md, for the meteor, docs/garden-meteor-2026-10-18.md; this file implements them. Everything above `mount` is pure and safe to
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
  /** A sun (docs/garden-sun-2026-10-18.md) has no place: its `x`, `y` and `r` are null. */
  id: string; kind: string; x: number | null; y: number | null; r: number | null; postedAt: number; landsAtStep: number; day: number;
  status: string; landedIn: string | null; droppedAt: number | null;
  /** A sun's brightness (percent of the world's own light) and how many steps it shines; null for a stone. Added with the sun. */
  percent?: number | null; span?: number | null;
}
/**
 * The sun letter's terms (README "The garden", `sun`): the keeper's founding switch, the percents this garden's light takes, the
 * span, where the next lands. `enabled` (added 2026-10-18) is absent from a coordinator from before the switch: absent means on.
 */
export interface SunBlock { enabled?: boolean; percents: number[]; span: number; nextLanding: { day: number; step: number } | null }
export interface Day {
  day: number; startStep: number; endStep: number; status: string; releasedAt: number; doneAt: number | null;
  verifiedAt: number | null; digest: string | null; verification: string | null; letters: string[]; census: Census | null;
  /** The live food the day carries (added to garden-v1 with food; absent from a coordinator from before). */
  food?: string | null;
  /** The live meteor the day carries (added to garden-v1 with the meteor; absent from a coordinator from before). */
  meteor?: string | null;
  /** Who held the field at the day's end (added with dawn predictions); null unless the day is verified. */
  leaders?: Leaders | null;
}
/** One lineage key in a day's top three, or one line into a day (docs/garden-predictions-2026-10-18.md). */
export interface LeaderEntry { key: string; label: string; cells: number; share: number }
export interface LeadersCensus { step: number; livingCells: number; lineages: number; top: LeaderEntry[]; clearLeader: string | null }
export interface Lines { fromDay: number; groups: LeaderEntry[]; rest: { cells: number; share: number }; winner: string | null }
/** A verified day's block: "ok", "pending", "unchecked" or "unreadable"; numbers only when "ok". */
export interface Leaders { status: string; census: LeadersCensus | null; lines: Lines | null }
export interface LeadersRule { name: string; top: number; clearLeaderPercent: number }
/** A food: a feed visitors called together. Its statuses are a letter's. */
export interface Food {
  id: string; x: number; y: number; r: number; amount: number; calledAt: number;
  /** The food's day is not run before this (one dawn period after the call): the keeper's veto window. */
  noticeUntil: number;
  hands: number; landsAtStep: number; day: number; status: string; landedIn: string | null; droppedAt: number | null;
}
/** The food ask (README "The garden", `food`). A view without it is a garden with food off. */
export interface FoodBlock {
  enabled: boolean; asks: number | null; everyDays: number | null; amount: number | null; r: number | null;
  place: { x: number; y: number } | null; hands: number; expiresAt: number;
  /** Every visitor reaches the coordinator as one address (the proxy hides their own), so the ask holds one hand. */
  sharedAddress: boolean;
  open: boolean; closed: string | null;
  opensAtDay: number | null; landing: { day: number; step: number } | null; foods: Food[];
}
/** A meteor: a stone of the garden's large radius, called by hands, at a place fixed by rule. Its statuses are a letter's. */
export interface Meteor {
  id: string; x: number; y: number; r: number; calledAt: number;
  /** The meteor's day is not run before this (one dawn period after the call): the keeper's veto window. */
  noticeUntil: number;
  hands: number; landsAtStep: number; day: number; status: string; landedIn: string | null; droppedAt: number | null;
}
/** The meteor ask (README "The garden", `meteor`): food's block without `amount`. A view without it has the meteor off. */
export interface MeteorBlock {
  enabled: boolean; asks: number | null; everyDays: number | null; r: number | null;
  /** Where the next meteor would land (a rule of the garden's name, seed and number), or null when off. */
  place: { x: number; y: number } | null; hands: number; expiresAt: number; sharedAddress: boolean;
  open: boolean; closed: string | null;
  opensAtDay: number | null; landing: { day: number; step: number } | null; meteors: Meteor[];
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
  /** Added to garden-v1 with food (docs/garden-food-2026-10-18.md); absent from a coordinator from before. */
  food?: FoodBlock;
  /** Added to garden-v1 with the meteor (docs/garden-meteor-2026-10-18.md); absent from a coordinator from before. */
  meteor?: MeteorBlock;
  /** Added with dawn predictions (docs/garden-predictions-2026-10-18.md); absent from a coordinator from before. */
  leadersRule?: LeadersRule;
  /** Added with the sun letter (docs/garden-sun-2026-10-18.md); absent from a coordinator from before. */
  sun?: SunBlock;
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
/**
 * Every named key must be present and fit; keys the shape does not name are ignored (the contract may add keys).
 * `optional` keys (added to the contract later, so absent from an older coordinator) are checked only when present.
 */
const shape = (keys: Record<string, Check>, optional: Record<string, Check> = {}): Check => (v, p) => {
  if (!isObject(v)) return `${p}: expected an object`;
  for (const [key, check] of Object.entries(keys)) {
    const at = p ? `${p}.${key}` : key;
    if (!(key in v)) return `${at}: missing`;
    const wrong = check(v[key], at);
    if (wrong) return wrong;
  }
  for (const [key, check] of Object.entries(optional)) {
    if (!(key in v)) continue;
    const wrong = check(v[key], p ? `${p}.${key}` : key);
    if (wrong) return wrong;
  }
  return null;
};

const censusKeys = {
  individuals: orNull(num), lineages: orNull(num), maxGeneration: orNull(num), mutations: orNull(num),
  extinct: orNull(bool), conservationOk: orNull(bool),
};
const letterKeys = shape({
  id: str, kind: str, x: orNull(num), y: orNull(num), r: orNull(num), postedAt: time, landsAtStep: num, day: num, status: str,
  landedIn: orNull(str), droppedAt: orNull(time),
}, { percent: orNull(num), span: orNull(num) });
/** A letter: a stone has its place (x, y, r numbers); only a letter of another kind, a sun, may have them null. */
const stonePlace = shape({ x: num, y: num, r: num });
const letterShape: Check = (v, p) => letterKeys(v, p) ?? (isObject(v) && v.kind === "stone" ? stonePlace(v, p) : null);
const sunBlockShape = shape({ percents: list(num), span: pos, nextLanding: orNull(shape({ day: num, step: num })) }, { enabled: bool });
const foodShape = shape({
  id: str, x: num, y: num, r: num, amount: num, calledAt: time, hands: num, landsAtStep: num, day: num,
  status: str, landedIn: orNull(str), droppedAt: orNull(time),
}, { noticeUntil: time });
const foodBlockShape = shape({
  enabled: bool, asks: orNull(pos), everyDays: orNull(pos), amount: orNull(num), r: orNull(num),
  place: orNull(shape({ x: num, y: num })), hands: num, expiresAt: time, open: bool, closed: orNull(str),
  opensAtDay: orNull(num), landing: orNull(shape({ day: num, step: num })), foods: list(foodShape),
}, { sharedAddress: bool });
const meteorShape = shape({
  id: str, x: num, y: num, r: num, calledAt: time, noticeUntil: time, hands: num, landsAtStep: num, day: num,
  status: str, landedIn: orNull(str), droppedAt: orNull(time),
});
const meteorBlockShape = shape({
  enabled: bool, asks: orNull(pos), everyDays: orNull(pos), r: orNull(num),
  place: orNull(shape({ x: num, y: num })), hands: num, expiresAt: time, sharedAddress: bool, open: bool, closed: orNull(str),
  opensAtDay: orNull(num), landing: orNull(shape({ day: num, step: num })), meteors: list(meteorShape),
});
/** A lineage key as the census writes it: birth step plus one, then the birth cell. */
export const LINEAGE_KEY = /^\d{1,10}:\d{1,10}$/;
const lineageKey: Check = (v, p) => (typeof v === "string" && LINEAGE_KEY.test(v) ? null : `${p}: expected a lineage key`);
const count0: Check = (v, p) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? null : `${p}: expected a count`);
const entryShape = shape({ key: lineageKey, label: str, cells: count0, share: num });
const winnerCheck: Check = (v, p) => (v === null || v === "rest" ? null : lineageKey(v, p));
const leadersShape = shape({
  status: str,
  census: orNull(shape({ step: num, livingCells: count0, lineages: count0, top: list(entryShape), clearLeader: orNull(lineageKey) })),
  lines: orNull(shape({ fromDay: count0, groups: list(entryShape), rest: shape({ cells: count0, share: num }), winner: winnerCheck })),
});
const leadersRuleShape = shape({ name: str, top: pos, clearLeaderPercent: num });
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
  }, { food: orNull(str), meteor: orNull(str), leaders: orNull(leadersShape) })),
  letters: shape({
    perDay: num, queueMax: num, queued: num,
    nextLanding: orNull(shape({ day: num, step: num, open: num })),
    waiting: list(letterShape), recent: list(letterShape),
  }),
  limits: shape({ stoneRadius: shape({ min: num, max: num }), lettersPerAddressPerHour: num, logMax: num }),
}, { food: foodBlockShape, meteor: meteorBlockShape, leadersRule: leadersRuleShape, sun: sunBlockShape });

const clip = (text: string, n = 160) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** A GET body as a garden-v1 view, or the reason it is not one. Never throws. */
export function parseGarden(json: unknown): { ok: true; view: GardenView } | { ok: false; reason: string } {
  if (!isObject(json)) return { ok: false, reason: "expected an object" };
  if (json.contract !== CONTRACT) {
    const got = typeof json.contract === "string" ? `“${clip(json.contract, 40)}”` : "none";
    return { ok: false, reason: `contract: expected “${CONTRACT}”, got ${got}` };
  }
  const wrong = viewShape(json, "");
  if (wrong) return { ok: false, reason: clip(wrong) };
  const view = json as unknown as GardenView;
  // Keys the food block gained after it was first written (a food's `noticeUntil`, the block's `sharedAddress`) are
  // read with the coordinator's own fallbacks when absent: a notice of one dawn period from the call, no shared address.
  if (view.food) {
    const food = view.food;
    view.food = {
      ...food,
      sharedAddress: food.sharedAddress === true,
      foods: food.foods.map((f) => ((f as Partial<Food>).noticeUntil === undefined ? { ...f, noticeUntil: f.calledAt + view.pace.dawnPeriodMs } : f)),
    };
  }
  return { ok: true, view };
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
      // A day carrying a food called less than a dawn period ago is held from islands (the keeper's veto window):
      // it is not asleep, it is waiting on purpose.
      const held = d === undefined ? undefined : view.food?.foods.find((f) => f.day === d && f.status === "waiting" && f.droppedAt === null && f.noticeUntil > view.now);
      // A meteor holds its day the same way, and a food and a meteor may share one: the day is held to the later notice.
      const struck = d === undefined ? undefined : view.meteor?.meteors.find((m) => m.day === d && m.status === "waiting" && m.droppedAt === null && m.noticeUntil > view.now);
      if (held && struck) {
        const until = Math.max(held.noticeUntil, struck.noticeUntil);
        return { tone: "pending", label: "Holding for the food and the meteor", sentence: `Holding: day ${d} carries the food ${clip(held.id, 24)} and the meteor ${clip(struck.id, 24)}, so no island is given it before ${fmtTime(until, fmt.locale, fmt.timeZone)}, in ${fmtDuration(until - view.now)}; until then the keeper can still set either aside.`, known: true };
      }
      if (held) {
        return { tone: "pending", label: "Holding for the food", sentence: `Holding: day ${d} carries the food ${clip(held.id, 24)}, so no island is given it before ${fmtTime(held.noticeUntil, fmt.locale, fmt.timeZone)}, in ${fmtDuration(held.noticeUntil - view.now)}; until then the keeper can still set the food aside.`, known: true };
      }
      if (struck) {
        return { tone: "pending", label: "Holding for the meteor", sentence: `Holding: day ${d} carries the meteor ${clip(struck.id, 24)}, so no island is given it before ${fmtTime(struck.noticeUntil, fmt.locale, fmt.timeZone)}, in ${fmtDuration(struck.noticeUntil - view.now)}; until then the keeper can still set the meteor aside.`, known: true };
      }
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
export function letterWords(letter: Pick<Letter, "id" | "status" | "landsAtStep" | "day">, mine: ReadonlySet<string> = new Set(), days: readonly Day[] = []): LetterWords {
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
/** A sun letter's body: exactly its kind and percent (the span is one garden day, the coordinator's to set). */
export interface SunBody { kind: "sun"; percent: number }
export type LetterBody = StoneBody | SunBody;
export type SunCheck = { ok: true; body: SunBody } | { ok: false; words: string };

/** What a sun of `percent` would do, in words: "Half the light", and so on. */
export const SUN_WORDS: Readonly<Record<number, string>> = { 50: "Half the light", 75: "Three quarters of the light", 125: "A quarter more light", 150: "Half again more light" };

/**
 * Whether the garden takes sun letters: it has a sun block, its keeper did not found it with suns off (`enabled` false; absent
 * means on, the coordinator's rule for a garden founded before the switch), and its light takes some percent.
 */
export function sunOffered(view: GardenView): boolean {
  return !!view.sun && view.sun.enabled !== false && view.sun.percents.length > 0;
}

/**
 * What each thing a visitor sends carries, in words, naming only the kinds this garden takes: a stone its place and size; a sun
 * (when the garden takes suns or holds one) its brightness; a hand for food or a meteor (when it has either) nothing, its body
 * being exactly `{}`. None of them names who sent it (the sun note's amendment of 2026-10-18 and its review fixes).
 */
export function carriesWords(view: GardenView): string {
  const suns = sunOffered(view) || [...view.letters.waiting, ...view.letters.recent].some((l) => l.kind === "sun");
  const food = !!view.food?.enabled;
  const meteor = !!view.meteor?.enabled;
  const parts = ["A stone carries only its place and size"];
  if (suns) parts.push("a sun only its brightness");
  if (food || meteor) parts.push(`a hand for ${food && meteor ? "food or a meteor" : food ? "food" : "a meteor"} carries nothing`);
  const said = parts.length === 1 ? parts[0] : parts.length === 2 ? `${parts[0]}, and ${parts[1]}` : `${parts[0]}, ${parts[1]}, and ${parts[2]}`;
  return `${said}. ${parts.length === 1 ? "Nothing in it names" : "None of them names"} who sent it.`;
}

/** What the server checks of a sun, checked before sending: the garden takes suns, and this percent. */
export function sunBody(view: GardenView, percent: number | null): SunCheck {
  const sun = view.sun;
  if (!sun || !sunOffered(view)) return { ok: false, words: "This garden takes no sun letters." };
  if (percent === null || !sun.percents.includes(percent)) return { ok: false, words: `Choose how bright: ${sun.percents.map((p) => `${p}%`).join(", ")}.` };
  return { ok: true, body: { kind: "sun", percent } };
}

/** Where a sun posted now would land and shine, in words, or why none can. */
export function sunLandingWords(view: GardenView): string {
  const sun = view.sun;
  if (!sun || !sunOffered(view)) return "This garden takes no sun letters.";
  if (!sun.nextLanding) {
    // The garden's own reason first (stopped, finished, the queue or log full): the sun's rule is only why when letters are open.
    const letters = landingPreview(view);
    if (!letters.open) return letters.reason;
    return "No day before the last has room for a sun just now: one sun a day, and never on the last day.";
  }
  const { day, step } = sun.nextLanding;
  return `Your sun would land at step ${fmtSteps(step)}, the end of day ${day}, and shine on day ${day + 1}, all ${fmtSteps(sun.span)} steps of it; then the world’s own light returns.`;
}

/** A letter's body as the page lists it: a stone's place and size, a sun's brightness and the day it shines. */
export function letterBodyWords(l: Pick<Letter, "kind" | "x" | "y" | "r" | "percent" | "span" | "landsAtStep" | "day">): string {
  const lands = `landing at step ${fmtSteps(l.landsAtStep)} (end of day ${l.day})`;
  if (l.kind === "stone") return `A stone of radius ${l.r} at (${l.x}, ${l.y}), ${lands}. `;
  if (l.kind === "sun" && typeof l.percent === "number") {
    const span = typeof l.span === "number" ? `, ${fmtSteps(l.span)} steps` : "";
    return `A sun of ${l.percent}% (${(SUN_WORDS[l.percent] ?? "a dial").toLowerCase()}), ${lands}; it shines on day ${l.day + 1}${span}. `;
  }
  return `A letter of a kind ${NEW_WORD} (“${clip(l.kind, 24)}”), ${lands}. `;
}
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

// ---------- food ----------

export interface FoodWords {
  /** "2 of 5 networks have asked today.", or, while the ask is closed, what it is waiting on. */
  headline: string;
  hands: number;
  asks: number;
  /** When this period's hands expire, in words, from the response's own clock ("" while the ask is closed). */
  timeLeft: string;
  /** Where and when a food called now would land, or why none can. */
  landing: string;
  /** The closed reason in words, or null when a hand can be added. */
  closed: string | null;
  open: boolean;
  /** Said beside the button when every visitor is one address to the garden (README: `food.sharedAddress`), else null. */
  shared: string | null;
  /** Why food is rare, with this garden's numbers. */
  why: string;
}

/** "today" for a daily garden, else "this dawn period" (a test garden's dawn may be a second). */
export const periodWords = (view: Pick<GardenView, "pace">) => view.pace.dawnPeriodMs === 86_400_000 ? "today" : "this dawn period";

/** A closed food ask in words (README: `food.closed`); an unknown code is said as given. */
export function foodClosedWords(food: FoodBlock): string {
  switch (food.closed) {
    case "off": return "This garden takes no food.";
    case "stopped": return "The garden has stopped, so it takes no food until the keeper looks.";
    case "finished": return "Every day to the horizon is done, so there is no day left to feed.";
    case "horizon": return "No day is left before the horizon that a food could land on.";
    case "log-full": return "The garden’s log is full.";
    case "cooldown": {
      const every = food.everyDays === null ? "" : ` once every ${plural(food.everyDays, "day")}`;
      return food.opensAtDay === null
        ? `A food lands at most${every}, and one landed or is waiting too recently.`
        : `A food lands at most${every}: the next can land on day ${food.opensAtDay} at the earliest.`;
    }
    case null: return "";
    default: return `The garden says “${clip(food.closed, 40)}”, a reason ${NEW_WORD}.`;
  }
}

const SHARED_WORDS = "Right now every visitor reaches this garden through one shared address (the site’s proxy does not pass on visitors’ own yet), so all of you count as one network: the ask can hold one hand, a food cannot be called, an “already in” answer may be someone else’s hand, and a counted hand spends a letter from the budget that stones share. This changes once the proxy passes on visitors’ own addresses.";

/** The food ask in words, or null when the garden takes no food (no section is shown then). */
export function foodWords(view: GardenView, fmt: Fmt = {}): FoodWords | null {
  const food = view.food;
  if (!food || !food.enabled || food.asks === null) return null;
  const today = periodWords(view);
  const left = food.expiresAt - view.now;
  const at = fmtTime(food.expiresAt, fmt.locale, fmt.timeZone);
  const place = food.place ? `at the centre (${food.place.x}, ${food.place.y})` : "at the centre";
  const size = food.amount !== null && food.r !== null ? `: ${food.amount} quanta of nutrient per cell over a disc of radius ${food.r}` : "";
  const open = food.open && food.landing !== null;
  // A closed ask always says why; a view that says neither why nor where (open without a landing) says it is closed.
  const shut = foodClosedWords(food) || "The food ask is closed just now.";
  const landing = open
    ? `A food called now would land at step ${fmtSteps(food.landing!.step)}, the end of day ${food.landing!.day}, ${place}${size}.`
    : shut;
  const every = food.everyDays === null ? "" : `, at most once every ${plural(food.everyDays, "day")}`;
  const more = Math.max(food.asks - food.hands, 1);
  const need = food.hands === 0 ? plural(food.asks, "network") : `${plural(more, "more network", "more networks")}`;
  const hands = today === "today" ? "Today’s hands" : "This dawn period’s hands";
  // While the ask is closed the count is not the story: it restarts when the ask opens. A waiting food is.
  const waiting = food.foods.find((f) => f.status === "waiting" && f.droppedAt === null);
  const headline = open
    ? `${fmtSteps(food.hands)} of ${plural(food.asks, "network")} ${food.hands === 1 ? "has" : "have"} asked ${today}.`
    : waiting
      ? `A food is waiting: ${clip(waiting.id, 24)} lands at step ${fmtSteps(waiting.landsAtStep)}, the end of day ${waiting.day}. Hands count again once the ask reopens.`
      : "The food ask is closed just now.";
  return {
    headline,
    hands: food.hands, asks: food.asks,
    timeLeft: !open ? "" : left > 0 ? `${hands} expire at the next dawn, in ${fmtDuration(left)} (${at}), unless ${need} ask before then.` : `${hands} expire at the next dawn, now.`,
    landing,
    closed: open ? null : shut,
    open,
    shared: food.sharedAddress === true ? SHARED_WORDS : null,
    why: `Food is the one thing that adds matter to this closed world, so it is kept rare on purpose. The keeper’s guess is that a garden fed at will grows fat and dull and that hunger is what makes it build; nobody has tested that yet. So food comes only when ${plural(food.asks, "network")} ask within one dawn${every}, as one modest feed ${place}, and a called food waits a whole dawn period before its day is run, so the keeper can still set it aside. Hands are counted per network, not per person: people behind one connection are one hand, and one person with several connections can be several. A hand carries nothing about you, and a restart of the garden’s server forgets ${today}’s hands.`,
  };
}

/** A waiting food's veto window in words, or null once its day may run (README: a food's `noticeUntil`). */
export function foodNoticeWords(food: Pick<Food, "status" | "noticeUntil">, now: number, fmt: Fmt = {}): string | null {
  if (food.status !== "waiting" || food.noticeUntil <= now) return null;
  return `Its day is not run before ${fmtTime(food.noticeUntil, fmt.locale, fmt.timeZone)}, in ${fmtDuration(food.noticeUntil - now)}, so the keeper can still set it aside.`;
}

/**
 * What this tab remembers of its own hand: the garden, when it was given (by the garden's clock) and its dawn. `afterRead`
 * is the page's count of view reads started when the hand was answered: only a read started after that can show the
 * hand forgotten (an earlier one may have been read before the hand counted).
 */
export interface HandLatch { name: string; since: number; until: number; afterRead?: number }

/**
 * Whether the tab's "my hand is in" still holds for `view`: the same garden, before the hand's dawn, and not forgotten.
 * A counted hand keeps the count at 1 or more until its dawn unless a food was called since (which shows in `foods`,
 * dropped or not); a count of 0 with no such food means the garden's server forgot the hand (a restart).
 */
export function latchHolds(latch: HandLatch | null, view: GardenView | null, fresh = true, kind: HandKind = "food"): boolean {
  if (!latch || !view || view.name !== latch.name || view.now >= latch.until) return false;
  const ask = kind === "food" ? view.food : view.meteor;
  if (!ask || !ask.enabled) return false;
  // A view read before the hand was answered (the one the hand was sent from, or a poll already on its way) may show
  // the count without it; only a later read can say the server forgot it.
  if (!fresh) return true;
  const called: { calledAt: number }[] = kind === "food" ? view.food?.foods ?? [] : view.meteor?.meteors ?? [];
  return ask.hands > 0 || called.some((f) => f.calledAt >= latch.since);
}

// ---------- meteor (docs/garden-meteor-2026-10-18.md) ----------

/** Which collective ask a hand is for. */
export type HandKind = "food" | "meteor";

/** The cells a lesion of radius `r` clears: `dx² + dy² <= r²` (`applyLesion`); 12,853 at r 64. */
export function discCells(r: number): number {
  const R = Math.max(0, Math.floor(r));
  let n = 0;
  for (let dy = -R; dy <= R; dy++) n += 2 * Math.floor(Math.sqrt(R * R - dy * dy)) + 1;
  return n;
}

export interface MeteorWords {
  /** "1 of 5 networks have asked today.", or, while the ask is closed, what it is waiting on. */
  headline: string;
  hands: number;
  asks: number;
  timeLeft: string;
  /** Where and when a meteor called now would land, or why none can. */
  landing: string;
  closed: string | null;
  open: boolean;
  shared: string | null;
  /** What a meteor is, with this garden's numbers and the next place. */
  what: string;
  /** What a stone this size did, as far as anyone has looked (the stone-horizon readings), or that nobody has. */
  reading: string;
  /** Why it is rare. */
  why: string;
}

/** A closed meteor ask in words (README: `meteor.closed`); an unknown code is said as given. */
export function meteorClosedWords(meteor: MeteorBlock): string {
  switch (meteor.closed) {
    case "off": return "This garden takes no meteor.";
    case "stopped": return "The garden has stopped, so it takes no meteor until the keeper looks.";
    case "finished": return "Every day to the horizon is done, so there is no day left for a meteor.";
    case "horizon": return "No day is left before the horizon that a meteor could land on.";
    case "log-full": return "The garden’s log is full.";
    case "cooldown": {
      const every = meteor.everyDays === null ? "" : ` once every ${plural(meteor.everyDays, "day")}`;
      return meteor.opensAtDay === null
        ? `A meteor lands at most${every}, and one landed or is waiting too recently.`
        : `A meteor lands at most${every}: the next can land on day ${meteor.opensAtDay} at the earliest.`;
    }
    case null: return "";
    default: return `The garden says “${clip(meteor.closed, 40)}”, a reason ${NEW_WORD}.`;
  }
}

const METEOR_SHARED_WORDS = "Right now every visitor reaches this garden through one shared address (the site’s proxy does not pass on visitors’ own yet), so all of you count as one network: the ask can hold one hand, a meteor cannot be called, an “already in” answer may be someone else’s hand, and a counted hand spends a letter from the budget that stones share. This changes once the proxy passes on visitors’ own addresses.";

/** The one preset and radius the stone-horizon runs measured (docs/garden-stone-horizon-2026-10-18.md, #55 and #59). */
export const METEOR_READ = {
  presetId: "wild-storm-large", r: 64, medianSteps: 35_839,
  /** The founding those runs used: the commons' own feed (stone-horizon note, section 1). */
  founding: { step: 0, kind: "feed", x: 256, y: 256, r: 255, amount: 16 },
} as const;

/** A share of a day in words: "about 27% of a day", "under 1% of a day", or "about 2 days". */
function dayShare(steps: number, stepsPerDay: number): string {
  const days = steps / stepsPerDay;
  if (days >= 1.5) return `about ${plural(Math.round(days), "day")}`;
  if (days >= 0.95) return "about a day";
  const pct = Math.round(days * 100);
  return pct < 1 ? "under 1% of a day" : `about ${pct}% of a day`;
}

/**
 * What a radius-64 stone did on the big storm, as recorded by the stone-horizon rules (#55, #59), or that nobody has
 * measured this size here. Shown only for the preset and radius those runs used.
 */
export function meteorReadingWords(view: GardenView): string {
  const m = view.meteor;
  if (!m || m.r !== METEOR_READ.r || view.presetId !== METEOR_READ.presetId) return "Nobody has yet measured what a stone of this size does in this world.";
  const share = dayShare(METEOR_READ.medianSteps, view.pace.stepsPerDay);
  const f = METEOR_READ.founding;
  const same = view.founding.length === 1 && view.founding[0].step === f.step && view.founding[0].kind === f.kind &&
    view.founding[0].x === f.x && view.founding[0].y === f.y && view.founding[0].r === f.r && view.founding[0].amount === f.amount;
  const founded = same ? "as this garden was too" : "not as this garden was";
  return `What a stone this size did, as far as anyone has looked: in twin worlds of this big storm founded as the commons was (one feed at the centre at step 0, radius 255, 16 quanta per cell; ${founded}), forked early, at steps 131,072 to 393,216, a radius-64 stone’s neighbourhood stayed more different from its undisturbed twin than the rest of the jar for a median of about 35,800 steps (from about 2,000 to about 68,600, over nine pairs), ${share} here. By the rule written before that run, that is a mark with no lasting effect, not a lasting change. Those stones were each aimed at a living cell; a meteor’s place is not, so it may clear less. A one-cell nudge in the same checkpoint worlds, at a separately chosen cell, stayed distinguishable for a median of about 9,200 steps, so by that rule the stone read as a stone effect: its mark outlasted a one-cell change’s, which the size of the change alone could explain. Pair by pair, the nudge lasted at least half as long as the stone in five of nine, and in the worlds forked at step 262,144 it outlasted the stone in all three histories. In the first 8,192 steps after the stones in the worlds forked at step 131,072, the stone’s summed excess of difference near it over the rest of the jar was more than twice the nudge’s in two of three histories, not all three. Three histories, one of them a carpet; one founding; the measure saturates; and no null stone of this size could be placed. These are what rules written before the runs said, not settled facts about this garden.`;
}

/** The meteor ask in words, or null when the garden takes no meteor (no section is shown then). */
export function meteorWords(view: GardenView, fmt: Fmt = {}): MeteorWords | null {
  const m = view.meteor;
  if (!m || !m.enabled || m.asks === null) return null;
  const today = periodWords(view);
  const left = m.expiresAt - view.now;
  const at = fmtTime(m.expiresAt, fmt.locale, fmt.timeZone);
  const place = m.place ? `at (${m.place.x}, ${m.place.y})` : "at its fixed place";
  const size = m.r === null ? "" : `, a stone of radius ${m.r}`;
  const open = m.open && m.landing !== null;
  const shut = meteorClosedWords(m) || "The meteor ask is closed just now.";
  const landing = open
    ? `A meteor called now would land at step ${fmtSteps(m.landing!.step)}, the end of day ${m.landing!.day}, ${place}${size}.`
    : shut;
  const every = m.everyDays === null ? "" : `, at most once every ${plural(m.everyDays, "day")}`;
  const more = Math.max(m.asks - m.hands, 1);
  const need = m.hands === 0 ? plural(m.asks, "network") : `${plural(more, "more network", "more networks")}`;
  const hands = today === "today" ? "Today’s hands" : "This dawn period’s hands";
  const waiting = m.meteors.find((x) => x.status === "waiting" && x.droppedAt === null);
  const headline = open
    ? `${fmtSteps(m.hands)} of ${plural(m.asks, "network")} ${m.hands === 1 ? "has" : "have"} asked ${today}.`
    : waiting
      ? `A meteor is waiting: ${clip(waiting.id, 24)} lands at (${waiting.x}, ${waiting.y}) at step ${fmtSteps(waiting.landsAtStep)}, the end of day ${waiting.day}. Hands count again once the ask reopens.`
      : "The meteor ask is closed just now.";
  const cells = view.world.width * view.world.height;
  const disc = m.r === null ? null : discCells(m.r);
  const pct = disc === null ? "" : ` (${(Math.round((1000 * disc) / cells) / 10).toLocaleString("en-GB")}% of this world)`;
  return {
    headline,
    hands: m.hands, asks: m.asks,
    timeLeft: !open ? "" : left > 0 ? `${hands} expire at the next dawn, in ${fmtDuration(left)} (${at}), unless ${need} ask before then.` : `${hands} expire at the next dawn, now.`,
    landing,
    closed: open ? null : shut,
    open,
    shared: m.sharedAddress === true ? METEOR_SHARED_WORDS : null,
    what: `A meteor is a stone${m.r === null ? "" : ` of radius ${m.r}`}: where it lands, every body in a disc of ${disc === null ? "its" : fmtSteps(disc)} cells${pct} turns to waste and its stored energy to heat. It lands at a place fixed before anyone asks, ${m.place ? `(${m.place.x}, ${m.place.y})` : "its own"} for the next one, never one a visitor picks, and chosen without looking at what lives there, so its disc may hold many bodies, few or none. “Meteor” is only this letter’s name for a large stone; it promises no lasting change.`,
    reading: meteorReadingWords(view),
    why: `A meteor is the one large act a visitor can ask for, so it is kept rare: it comes only when ${plural(m.asks, "network")} ask within one dawn${every}, and a called meteor waits a whole dawn period before its day is run, so the keeper can still set it aside (the next one then lands at the next place). Hands are counted per network, not per person: people behind one connection are one hand, and one person with several connections can be several. A hand carries nothing about you, and a restart of the garden’s server forgets ${today}’s hands.`,
  };
}

// ---------- who holds the field, and dawn predictions (docs/garden-predictions-2026-10-18.md) ----------

/** Whether the coordinator publishes the leaders blocks: without `leadersRule` the panel is off. */
export const leadersOn = (view: GardenView) => view.leadersRule !== undefined;

const dayOfView = (view: GardenView, d: number) => view.days.find((x) => x.day === d);

/** The "someone else" choice: every line but the three named. */
export const REST_CHOICE = "someone else: the rest (every other line)";

/** Which open window a reading shows (planting, basis day and its digest), or null when shut: a guess belongs to one. */
export function windowId(view: GardenView, w: PredictionWindow): string | null {
  return w.open ? `${view.name}|${view.createdAt}|${w.basis}|${w.digest}|${w.census.step}|${w.census.top.map((e) => `${e.key}=${e.cells}`).join(",")}` : null;
}

/** Why a guess cannot be made now. */
export type ClosedReason = "no-leaders" | "stopped" | "finished" | "horizon" | "basis-pending" | "basis-unverified" | "basis-unchecked" | "basis-unreadable" | "nothing-living";
export type PredictionWindow =
  | { open: true; basis: number; target: number; census: LeadersCensus; digest: string }
  | { open: false; reason: ClosedReason; basis: number; target: number };

/**
 * The note's section 5: a guess is about T = B + 1, B the newest released day, and can be made only while B is verified
 * with an `ok` block holding a living cell, T is before the horizon, and the garden is neither stopped nor finished. T
 * is not released by definition (B is the newest released day), so the cut-off is T's release.
 */
export function predictionWindow(view: GardenView): PredictionWindow {
  const basis = releasedDay(view);
  const target = basis + 1;
  const shut = (reason: ClosedReason): PredictionWindow => ({ open: false, reason, basis, target });
  if (!leadersOn(view)) return shut("no-leaders");
  if (view.state === "stopped") return shut("stopped");
  if (view.state === "finished") return shut("finished");
  if (target >= view.clock.daysTotal) return shut("horizon");
  const b = dayOfView(view, basis);
  if (!b || b.status !== "verified" || !b.leaders || b.digest === null) return shut("basis-unverified");
  if (b.leaders.status === "pending") return shut("basis-pending");
  if (b.leaders.status === "unchecked") return shut("basis-unchecked");
  if (b.leaders.status !== "ok" || !b.leaders.census) return shut("basis-unreadable");
  if (b.leaders.census.livingCells === 0 || b.leaders.census.top.length === 0) return shut("nothing-living");
  return { open: true, basis, target, census: b.leaders.census, digest: b.digest };
}

/** A shut window in words (the note's section 5). */
export function windowWords(w: PredictionWindow): string {
  if (w.open) return `Guesses about day ${w.target} are open until it is released to an island.`;
  switch (w.reason) {
    case "no-leaders": return "This garden does not publish who held the field.";
    case "stopped": return "The garden has stopped, so no next day is coming to guess about.";
    case "finished": return "Every day to the horizon is done; there is no next day to guess about.";
    case "horizon": return `Day ${w.basis} is the last before the horizon; there is no next day to guess about.`;
    case "basis-pending": return `Day ${w.basis} is verified; its files are still being counted.`;
    case "basis-unchecked": return `Day ${w.basis} was verified without its files being checked, so there are no numbers to guess from.`;
    case "basis-unreadable": return `Day ${w.basis} is verified, but its files could not be read, so there are no numbers to guess from.`;
    case "nothing-living": return `Nothing is living at the end of day ${w.basis}, so there is nothing to guess about.`;
    case "basis-unverified": return `Predictions open when the newest day is verified and the next is not yet released. Day ${w.basis} is not verified yet.`;
  }
}

/** A key's line in words, with its label when the day lists it. */
export function lineName(key: string, entries: readonly LeaderEntry[] = []): string {
  if (key === "rest") return "the rest";
  const e = entries.find((x) => x.key === key);
  return e ? `the line of ${e.label} (${key})` : `the line of ${key}`;
}

/** A day's census block in words: its top three and whether one key clearly leads (a word, not the game's outcome). */
export function leadersWords(day: Pick<Day, "day"> & { leaders?: Leaders | null }, rule: LeadersRule | undefined): string {
  const l = day.leaders;
  if (!l) return `Day ${day.day} is not verified, so it has no count.`;
  if (l.status === "pending") return `Day ${day.day} is verified; its files are still being counted.`;
  if (l.status === "unchecked") return `Day ${day.day} was verified without its files being checked, so it has no count.`;
  if (l.status !== "ok" || !l.census) return `Day ${day.day}’s files could not be read, so it has no count.`;
  const c = l.census;
  if (c.livingCells === 0) return `Nothing is living at the end of day ${day.day}.`;
  const pct = rule?.clearLeaderPercent ?? 10;
  const top = c.top[0];
  if (c.clearLeader !== null && top)
    return `At the end of day ${day.day}, ${top.label} (${top.key}) holds ${sharePercent(top.cells, c.livingCells)} of ${plural(c.livingCells, "living cell")}: a clear leader (at least ${pct}% and more than any other key).`;
  // Whole percents round: a share just under the threshold is said so, never as the threshold itself, and a tie for
  // the most is named, so the words never seem to meet the rule they say was missed.
  const under = !!top && top.cells * 100 < pct * c.livingCells;
  const shown = !top ? "none" : under && Math.round((top.cells * 100) / c.livingCells) >= pct ? `just under ${pct}%` : sharePercent(top.cells, c.livingCells);
  const tied = !!top && !under && c.top.length > 1 && c.top[1].cells === top.cells ? " and is tied with another key" : "";
  return `At the end of day ${day.day}, no key clearly leads: the biggest holds ${shown} of ${plural(c.livingCells, "living cell")}${tied} (a clear leader needs at least ${pct}% and more than any other key).`;
}

/** The lines into a day in words: who held the field at its end. */
export function linesWords(lines: Lines, living: number): string {
  if (lines.winner === null) return `No line held the field at the end of day ${lines.fromDay + 1}: ${living === 0 ? "nothing was living" : "a tie for the most cells"}.`;
  const cells = lines.winner === "rest" ? lines.rest.cells : lines.groups.find((g) => g.key === lines.winner)?.cells ?? 0;
  return `${capital(lineName(lines.winner, lines.groups))} held the field at the end of day ${lines.fromDay + 1}: ${sharePercent(cells, living)} of its living cells, counting day ${lines.fromDay}’s three biggest keys each with its mutants born on those two days.`;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The garden's own tally over its listed days: how often each kind of line held the field. */
export function fieldTally(view: GardenView): { days: number; rest: number; top: number; none: number } {
  const t = { days: 0, rest: 0, top: 0, none: 0 };
  for (const d of view.days) {
    const lines = d.status === "verified" && d.leaders?.status === "ok" ? d.leaders.lines : null;
    if (!lines) continue;
    t.days++;
    if (lines.winner === "rest") t.rest++;
    else if (lines.winner === null) t.none++;
    else t.top++;
  }
  return t;
}

export function tallyWords(view: GardenView): string {
  const t = fieldTally(view);
  if (t.days === 0) return "No listed day has its lines counted yet, so there is no tally.";
  return `Of the ${plural(t.days, "listed day")} with lines counted, the rest held the field on ${t.rest}, one of the day before’s three biggest lines on ${t.top}${t.none ? `, and no line on ${t.none}` : ""}.`;
}

/** What a guess was made against: the part of the view the receipt's hash covers (the choice sits beside it). */
export interface ReceiptBody {
  v: 1; garden: string; createdAt: number; madeAt: number;
  basis: { day: number; digest: string; step: number; livingCells: number; top: [string, number][] };
  target: number; releasedStep: number;
}
/**
 * A receipt: the body, the choice beside it, the body's hash, and `id`, a random name this device gives each guess so
 * two guesses against one reading (same hash) are still told apart; neither the choice nor the id is hashed, and the id
 * never leaves the device. Receipts stored before ids existed have none.
 */
export interface Receipt extends ReceiptBody { choice: string; hash: string; id?: string }

/** A fresh random id for a guess: 32 hex characters from `crypto.getRandomValues` (or Math.random without it). */
export function newReceiptId(): string {
  const bytes = new Uint8Array(16);
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What tells one guess from another on this device: its id, or for a receipt without one its hash, choice and time. */
export const receiptId = (r: Receipt): string => r.id ?? `${r.hash}:${r.choice}:${r.madeAt}`;

/** JSON with every object's keys sorted and no spaces; arrays keep their order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

export type Subtle = Pick<SubtleCrypto, "digest">;

/** SHA-256 (hex) of the body's canonical JSON, or null without `crypto.subtle`. */
export async function receiptHash(body: ReceiptBody, subtle: Subtle | null | undefined): Promise<string | null> {
  if (!subtle) return null;
  try {
    const bytes = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(body))));
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** The body a guess made now would carry, from the open window. */
export function receiptBody(view: GardenView, w: Extract<PredictionWindow, { open: true }>): ReceiptBody {
  return {
    v: 1, garden: view.name, createdAt: view.createdAt, madeAt: view.now,
    basis: { day: w.basis, digest: w.digest, step: w.census.step, livingCells: w.census.livingCells, top: w.census.top.map((e) => [e.key, e.cells]) },
    target: w.target, releasedStep: view.clock.releasedStep,
  };
}

/** A receipt for `choice` (one of the basis's top keys, or "rest"), or why none can be made. */
export async function makeReceipt(view: GardenView, choice: string, subtle: Subtle | null | undefined, id: string = newReceiptId()): Promise<{ ok: true; receipt: Receipt } | { ok: false; words: string }> {
  const w = predictionWindow(view);
  if (!w.open) return { ok: false, words: windowWords(w) };
  if (choice !== "rest" && !w.census.top.some((e) => e.key === choice)) return { ok: false, words: "Choose one of the three lines, or the rest." };
  const body = receiptBody(view, w);
  const hash = await receiptHash(body, subtle);
  if (hash === null) return { ok: false, words: "This browser cannot make the receipt’s fingerprint (it has no crypto.subtle here), so receipts can’t be made." };
  return { ok: true, receipt: { ...body, choice, hash, id } };
}

export const RECEIPTS_MAX = 32;
export const predictionKey = (coordinator: string, garden: string) => `cadence-garden-predictions:${coordinator}:${garden}`;

const isReceipt = (v: unknown): v is Receipt => {
  if (!isObject(v) || v.v !== 1 || typeof v.garden !== "string" || !isTime(v.createdAt) || !isTime(v.madeAt)) return false;
  if (!count(v.target) || !count(v.releasedStep) || typeof v.choice !== "string" || typeof v.hash !== "string" || !/^[0-9a-f]{64}$/.test(v.hash)) return false;
  if (v.choice !== "rest" && !LINEAGE_KEY.test(v.choice)) return false;
  if (v.id !== undefined && (typeof v.id !== "string" || !/^[0-9a-f]{16,64}$/.test(v.id))) return false;
  const b = v.basis;
  return isObject(b) && count(b.day) && typeof b.digest === "string" && count(b.step) && count(b.livingCells) && Array.isArray(b.top)
    && b.top.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && LINEAGE_KEY.test(e[0]) && count(e[1]));
};

/**
 * The device's receipts for one garden, newest first, or null when storage cannot be read (none, or it throws): then
 * what it holds is unknown, which is not the same as holding nothing. A list or entry that does not parse counts as none.
 */
export function readStoredReceipts(storage: Pick<Storage, "getItem"> | null, key: string): Receipt[] | null {
  let text: string | null;
  try {
    if (!storage) return null;
    text = storage.getItem(key);
  } catch {
    return null;
  }
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v.filter(isReceipt).slice(0, RECEIPTS_MAX) : [];
  } catch {
    return [];
  }
}

/** As readStoredReceipts, with storage that cannot be read counting as none. */
export function readReceipts(storage: Pick<Storage, "getItem"> | null, key: string): Receipt[] {
  return readStoredReceipts(storage, key) ?? [];
}

export function writeReceipts(storage: Pick<Storage, "setItem"> | null, key: string, receipts: readonly Receipt[]): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(receipts.slice(0, RECEIPTS_MAX)));
    return true;
  } catch {
    return false;
  }
}

/** A new receipt replaces the device's earlier one for the same planting and day; newest first, at most 32. */
export function addReceipt(receipts: readonly Receipt[], r: Receipt): Receipt[] {
  return [r, ...receipts.filter((x) => !(x.createdAt === r.createdAt && x.target === r.target))].slice(0, RECEIPTS_MAX);
}

/**
 * A receipt this tab could not store, with the `receiptId` of the stored receipt for the same planting and day it
 * replaced: null when storage held none, undefined when storage could not be read (the first reading that works then
 * sets it). Which guess is later is told by what storage held, never by clocks or hashes: two guesses can carry the same
 * `madeAt` and the same hash (one cached reading), and two tabs' clocks need not agree.
 */
export interface Unkept { receipt: Receipt; over: string | null | undefined }

const sameDay = (a: Receipt, b: Receipt) => a.createdAt === b.createdAt && a.target === b.target;

/** This tab's unstored receipts with a new one: one per planting and day, newest first, at most 32. */
export function addUnkept(unkept: readonly Unkept[], u: Unkept): Unkept[] {
  return [u, ...unkept.filter((x) => !sameDay(x.receipt, u.receipt))].slice(0, RECEIPTS_MAX);
}

/**
 * The receipts to show: the stored ones, with this tab's unstored ones over them for the same planting and day while
 * storage still holds, for that day, what the unstored one replaced (or nothing, or the same receipt), told by
 * `receiptId`. A different stored receipt was written after the unstored one was made (in another tab), so it is the
 * later guess and the tab forgets its own. `kept` null (storage unreadable now): the unstored ones show and all wait. An
 * unstored one made while storage was unreadable takes what storage holds at the first reading that works as what it
 * replaced (a write by another tab during the outage then loses to it: nothing records which came first). Newest first by
 * `madeAt` (ties keep this tab's first), at most 32; also the unstored ones still worth keeping in the tab.
 */
export function mergeReceipts(kept: readonly Receipt[] | null, unkept: readonly Unkept[]): { all: Receipt[]; unkept: Unkept[] } {
  const live: Unkept[] = [];
  for (const u of unkept) {
    if (kept === null) { live.push(u); continue; }
    const k = kept.find((x) => sameDay(x, u.receipt));
    if (u.over === undefined) live.push({ receipt: u.receipt, over: k ? receiptId(k) : null });
    else if (!k || receiptId(k) === u.over || receiptId(k) === receiptId(u.receipt)) live.push(u);
  }
  const all = [...live.map((u) => u.receipt), ...(kept ?? []).filter((k) => !live.some((u) => sameDay(u.receipt, k)))]
    .sort((a, b) => b.madeAt - a.madeAt)
    .slice(0, RECEIPTS_MAX);
  return { all, unkept: live };
}

export type Settled =
  | { kind: "replanted" }
  | { kind: "old" | "mismatch" | "unavailable" | "late" | "stalled" | "waiting" | "unchecked" | "unreadable" | "held" | "missed"; tone: Tone; words: string };

/**
 * A receipt against this reading (the note's section 7 and its second amendment), the first row that applies. `hash`
 * hashes a body (receiptHash with the page's crypto); the basis it hashes is the listed day B's, so an edited receipt
 * does not match. A day B whose count is not there now (being counted again, or run again) cannot be checked now; that
 * is not a mismatch.
 */
export async function settle(r: Receipt, view: GardenView, hash: (body: ReceiptBody) => Promise<string | null>): Promise<Settled> {
  if (r.createdAt !== view.createdAt || r.garden !== view.name) return { kind: "replanted" };
  const B = r.basis.day, T = r.target;
  const oldest = view.days.length ? Math.min(...view.days.map((d) => d.day)) : 0;
  const listed = (d: number) => dayOfView(view, d);
  const old = (d: number): Settled => ({ kind: "old", tone: "pending", words: `Cannot be checked here: day ${d} is older than the ${view.days.length} days this garden lists.` });
  const mismatch: Settled = { kind: "mismatch", tone: "negative", words: `Does not match the garden’s record of day ${B}.` };
  const b = listed(B);
  if (!b) return old(B);
  const c = b.leaders?.census;
  if (!c || b.digest === null || b.status !== "verified" || b.leaders?.status !== "ok") {
    const why = b.leaders?.status === "unreadable"
      ? `day ${B}’s files could not be read when they were counted again`
      : b.leaders?.status === "unchecked"
        ? `day ${B} has no count now (its replay did not check its files)`
        : `day ${B}’s count is not there just now (it is being counted again, or the day is being run again)`;
    return { kind: "unavailable", tone: "pending", words: `Cannot be checked now: ${why}.` };
  }
  if (T !== B + 1) return mismatch;
  const fromView: ReceiptBody = {
    v: 1, garden: view.name, createdAt: view.createdAt, madeAt: r.madeAt,
    basis: { day: B, digest: b.digest, step: c.step, livingCells: c.livingCells, top: c.top.map((e) => [e.key, e.cells]) },
    target: T, releasedStep: (B + 1) * view.pace.stepsPerDay,
  };
  const again = await hash(fromView);
  // A fingerprint this browser cannot make is no evidence either way.
  if (again === null) return { kind: "unavailable", tone: "pending", words: "Cannot be checked in this browser: it cannot make the receipt’s fingerprint (it has no crypto.subtle here)." };
  if (again !== r.hash) return mismatch;
  const t = listed(T);
  const waiting: Settled = { kind: "waiting", tone: "pending", words: `Waiting: day ${T} is not verified yet.` };
  if (!t) return T > releasedDay(view) ? waiting : T < oldest ? old(T) : waiting;
  if (t.releasedAt <= r.madeAt) return { kind: "late", tone: "pending", words: `Made after day ${T} was released; not counted.` };
  if (t.status === "diverged" || t.status === "failed") return { kind: "stalled", tone: "negative", words: `Day ${T} did not replay the same (or could not run); nothing to check.` };
  if (t.status !== "verified" || !t.leaders || t.leaders.status === "pending") return waiting;
  if (t.leaders.status === "unchecked") return { kind: "unchecked", tone: "pending", words: `Cannot be checked: the replay did not check day ${T}’s files.` };
  if (t.leaders.status !== "ok" || !t.leaders.census) return { kind: "unreadable", tone: "pending", words: `Cannot be checked: day ${T}’s files could not be read.` };
  const lines = t.leaders.lines;
  // Day B is `ok` here, so lines that are missing are being counted (the two days' answers came in either order).
  if (!lines) return { kind: "waiting", tone: "pending", words: `Waiting: day ${T} is verified; the lines into it are still being counted.` };
  if (lines.fromDay !== B) return mismatch;
  const living = t.leaders.census.livingCells;
  const who = lines.winner === null ? null : lineName(lines.winner, lines.groups);
  const cells = lines.winner === "rest" ? lines.rest.cells : lines.groups.find((g) => g.key === lines.winner)?.cells ?? 0;
  const held = who === null ? "no line held the field" : `${who} held ${sharePercent(cells, living)} of the field at day ${T}’s end`;
  // As a day's chip: only a replay on another device type is a clean pass (dayChip).
  const elsewhere = t.verification === "different-device-type";
  const how = elsewhere ? "" : t.verification === "same-device-type" ? ` Day ${T} was replayed here, not yet verified elsewhere.` : ` Day ${T} was replayed by a second island.`;
  if (lines.winner !== null && r.choice === lines.winner) return { kind: "held", tone: elsewhere ? "observed" : "note", words: `Held: ${held}.${how}` };
  return { kind: "missed", tone: elsewhere ? "negative" : "note", words: `Did not hold: ${held}.${how}` };
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
const unsure = (kind: "stone" | "sun") => `so this page cannot tell whether your ${kind} arrived. The queue below is read again: look for it there before sending another.`;

/**
 * A POST to the letters route, in words (the note's answer table). Status 0 is no answer at all (no connection, or
 * none within the deadline); like an unexpected code, it leaves the letter's fate unknown, and the page says so.
 */
export function postAnswer(status: number, body: unknown, headers: { get(name: string): string | null } | null, view: GardenView | null, kind: "stone" | "sun" = "stone"): Answer {
  switch (status) {
    case 201: {
      const l = isObject(body) && isObject(body.letter) ? body.letter : null;
      if (l && typeof l.id === "string" && typeof l.landsAtStep === "number" && typeof l.day === "number") {
        const shines = kind === "sun" ? `, shines on day ${l.day + 1}` : "";
        return {
          tone: "note", refresh: true, letter: { id: l.id, landsAtStep: l.landsAtStep, day: l.day },
          words: `Posted as ${clip(l.id, 24)}. It is public now, lands at step ${fmtSteps(l.landsAtStep)} (end of day ${l.day})${shines}, and counts once a second island replays that day.`,
        };
      }
      return { tone: "note", refresh: true, words: "Posted. It is public now; the queue below shows where it lands." };
    }
    case 422: return { tone: "negative", refresh: false, words: `The garden refused the ${kind}: ${serverWords(body) ?? `it is not a ${kind} the garden takes.`}` };
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
    case 0: return { tone: "negative", refresh: true, words: `No answer came back, ${unsure(kind)}` };
    default: return { tone: "negative", refresh: true, words: `The garden answered ${status}, ${unsure(kind)}` };
  }
}

/** A hand that may or may not have been counted. */
const HAND_UNSURE = "so this page cannot tell whether your hand was counted. The count below is read again: a second hand from this network is never counted twice.";

export interface HandAnswer {
  tone: Tone; words: string; refresh: boolean; in: boolean; food?: { id: string; landsAtStep: number; day: number };
  /** The meteor this hand called, for a hand on the meteor ask. */
  meteor?: { id: string; landsAtStep: number; day: number };
  /** When the hand's own period ends (the answer's `food.expiresAt`): the hand may have crossed a dawn on its way. */
  expiresAt?: number;
}

/** A POST to the food (or meteor) hands route, in words: the same table as a stone's, with a hand's own 201 and 200. */
export function handAnswer(status: number, body: unknown, headers: { get(name: string): string | null } | null, view: GardenView | null, kind: HandKind = "food"): HandAnswer {
  const block = isObject(body) && isObject(body[kind]) ? body[kind] as Record<string, unknown> : null;
  const today = view ? periodWords(view) : "today";
  const count = block && typeof block.hands === "number" && typeof block.asks === "number" && block.open === true ? `${fmtSteps(block.hands)} of ${plural(block.asks, "network")} ${block.hands === 1 ? "has" : "have"} asked ${today}.` : null;
  const until = block && isTime(block.expiresAt) ? { expiresAt: block.expiresAt } : {};
  switch (status) {
    case 201: {
      const c = isObject(body) && isObject(body.called) ? body.called : null;
      if (c && typeof c.id === "string" && typeof c.landsAtStep === "number" && typeof c.day === "number") {
        const where = kind === "meteor" && typeof c.x === "number" && typeof c.y === "number" ? ` at (${c.x}, ${c.y})` : "";
        const record = { id: c.id, landsAtStep: c.landsAtStep, day: c.day };
        return {
          ...until, tone: "note", refresh: true, in: true, ...(kind === "food" ? { food: record } : { meteor: record }),
          words: `Yours was the hand that called the ${kind}: ${clip(c.id, 24)} is public now, lands${where} at step ${fmtSteps(c.landsAtStep)} (end of day ${c.day}), and counts once a second island replays that day.`,
        };
      }
      return { ...until, tone: "note", refresh: true, in: true, words: `Your hand is in.${count ? ` ${count}` : ""}` };
    }
    case 200: {
      const shared = isObject(block) && block.sharedAddress === true ? " Every visitor shares one address just now, so it may be someone else’s." : "";
      return { ...until, tone: "note", refresh: true, in: true, words: `A hand from your network was already in for ${today}: one hand per network per dawn.${shared}${count ? ` ${count}` : ""}` };
    }
    case 409: return { tone: "negative", refresh: true, in: false, words: `The ${kind} ask is closed: ${serverWords(body) ?? "try again after the next dawn."}` };
    case 422: return { tone: "negative", refresh: false, in: false, words: `The garden refused the hand: ${serverWords(body) ?? "it is not a hand the garden takes."}` };
    case 429: {
      const fromBody = isObject(body) && typeof body.retryAfterMs === "number" && Number.isFinite(body.retryAfterMs) ? body.retryAfterMs : null;
      const wait = fromBody ?? retryAfterMs(headers?.get("retry-after"));
      const n = view?.limits.lettersPerAddressPerHour;
      const limit = n === undefined ? "a few letters and hands an hour from one network" : `${plural(n, "letter")} and hands an hour from one network, together`;
      const words = `The garden is not taking hands from this network just now: it takes at most ${limit}, and fewer when many are refused.`;
      return { tone: "negative", refresh: false, in: false, words: wait === null ? `${words} Try again later.` : `${words} Try again in ${fmtDuration(wait)}.` };
    }
    case 413:
    case 415: return { tone: "negative", refresh: false, in: false, words: "The page sent something the garden could not read. Reload the page and try again." };
    case 404: return { tone: "negative", refresh: false, in: false, words: "There is no garden by that name here." };
    // `counted: null`: the garden did not answer in time, and the hand may still count when it catches up.
    case 503: return isObject(body) && body.counted === null
      ? { tone: "negative", refresh: true, in: false, words: `The garden was too busy to answer, ${HAND_UNSURE}` }
      : { tone: "negative", refresh: false, in: false, words: "The garden is busy; try again in a moment. Your hand was not counted." };
    case 0: return { tone: "negative", refresh: true, in: false, words: `No answer came back, ${HAND_UNSURE}` };
    default: return { tone: "negative", refresh: true, in: false, words: `The garden answered ${status}, ${HAND_UNSURE}` };
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
  handsUrl: string;
  /** The meteor ask's hands route, beside the food one. */
  meteorHandsUrl: string;
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
    viewUrl: `${base}${path}`, lettersUrl: `${base}${path}/letters`, handsUrl: `${base}${path}/food/hands`,
    meteorHandsUrl: `${base}${path}/meteor/hands`,
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
  /** SHA-256 for prediction receipts (`crypto.subtle`); without it no receipt can be made. */
  subtle?: Subtle | null;
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
    subtle: (() => { try { return globalThis.crypto?.subtle ?? null; } catch { return null; } })(),
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
  const foodRow = $("g-food-row");
  const handSend = $("food-send") as HTMLButtonElement;
  // The sun letter (docs/garden-sun-2026-10-18.md): a choice of brightness, shown only when the garden takes suns.
  const sunRow = $("g-sun");
  const sunForm = $("sun-form") as HTMLFormElement;
  const sunChoices = $("sun-choices");
  const sunPreview = $("sun-preview");
  const sunSend = $("sun-send") as HTMLButtonElement;
  const sunWhy = $("sun-why");
  const sunAnswer = $("sun-answer");
  let sunPercentsShown = "";
  const handWhy = $("food-why");
  const handSaid = $("food-answer");
  const handShared = $("food-shared");
  const meteorRow = $("g-meteor-row");
  const meteorSend = $("meteor-send") as HTMLButtonElement;
  const meteorWhy = $("meteor-why");
  const meteorSaid = $("meteor-answer");
  const meteorShared = $("meteor-shared");
  const fieldRow = $("g-field-row");
  const predictRow = $("g-predict-row");
  const predictForm = $("predict-form") as HTMLFormElement;
  const predictSend = $("predict-send") as HTMLButtonElement;
  const predictWhy = $("predict-why");
  const predictSaid = $("predict-answer");

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
  let handing = false;
  /** This tab's hand (`latchHolds`): in memory only, never in the device's record. */
  let latch: HandLatch | null = null;
  /** The same for this tab's meteor hand, kept apart: the two asks are independent. */
  let meteorLatch: HandLatch | null = null;
  let meteorHanding = false;
  /** View reads started so far, and which one `view` came from (`HandLatch.afterRead`). */
  let reads = 0;
  let viewRead = 0;
  /** The line this tab has chosen to guess (a key or "rest"), kept across readings only while the same window is open. */
  let choice: string | null = null;
  /** The window the choice was made in (`windowId`): a new basis day, or a recount of it, clears the choice. */
  let choiceFor: string | null = null;
  /** The radios now drawn (`windowId` and the keys offered): a reading that offers the same keeps them, and focus. */
  let radiosDrawn = "";
  let making = false;
  /** Receipts made while the device keeps none (storage off): shown in this tab only. */
  let unkept: Unkept[] = [];
  let receiptsDrawn = 0;

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

    // Who holds the field, and the guess about tomorrow (docs/garden-predictions-2026-10-18.md).
    renderField(v);

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
          d.letters.length ? h("span", { class: "fine" }, `; carries ${d.letters.join(", ")}`) : null,
          d.food ? h("span", { class: "fine" }, `; carries the food ${d.food}`) : null,
          d.meteor ? h("span", { class: "fine" }, `; carries the meteor ${d.meteor}`) : null)));
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
          h("span", {}, letterBodyWords(l)),
          h("span", { class: "fine" }, w.words)));
    };
    const waiting = h("ul", { class: "garden-letters", id: "g-waiting" }, ...v.letters.waiting.map(letterItem));
    const recent = h("ul", { class: "garden-letters", id: "g-recent" }, ...v.letters.recent.map(letterItem));
    fill("g-letters",
      h("p", {}, `${plural(v.letters.queued, "letter")} waiting, of at most ${v.letters.queueMax}; one day carries ${plural(v.letters.perDay, "letter")}.`),
      h("h3", {}, "Waiting"), v.letters.waiting.length ? waiting : h("p", { class: "fine" }, "No letter is waiting."),
      h("h3", {}, "Recently"), v.letters.recent.length ? recent : h("p", { class: "fine" }, "No letter has landed or been set aside yet."),
      h("p", { class: "fine" }, `${carriesWords(v)} “Yours” comes from this device’s own list.`));

    // Food, in a garden founded with it.
    renderFood(v);
    // The meteor, likewise.
    renderMeteor(v);

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

  const pct = (part: number, whole: number) => sharePercent(part, whole);
  const entryItem = (e: { key: string; label?: string; cells: number }, living: number, name?: string) =>
    h("li", { "data-key": e.key },
      h("span", { class: "garden-letter-id mono" }, e.key),
      h("span", { class: "garden-letter-body" },
        h("span", {}, `${name ?? e.label ?? e.key}: ${plural(e.cells, "cell")}, ${pct(e.cells, living)} of the living cells.`)));

  function renderField(v: GardenView): void {
    const on = leadersOn(v);
    fieldRow.hidden = !on;
    predictRow.hidden = !on;
    if (!on) return;
    // The newest listed verified day: its exact keys, and the lines into it.
    const shown = v.days.find((d) => d.status === "verified" && d.leaders);
    const l = shown?.leaders;
    const c = l?.status === "ok" ? l.census : null;
    fill("g-field",
      shown ? h("p", { class: "garden-headline", id: "g-field-words" }, leadersWords(shown, v.leadersRule)) : h("p", { id: "g-field-words" }, "No day is verified yet, so nobody has counted the field."),
      c && c.top.length ? h("ol", { class: "garden-letters", id: "g-top" }, ...c.top.map((e) => entryItem(e, c.livingCells))) : null,
      c && l?.lines ? h("h3", {}, `The lines into day ${shown!.day}`) : null,
      c && l?.lines ? h("p", { id: "g-lines-words" }, linesWords(l.lines, c.livingCells)) : null,
      c && l?.lines ? h("ul", { class: "garden-letters", id: "g-lines" },
        ...l.lines.groups.map((g) => entryItem(g, c.livingCells, `the line of ${g.label}`)),
        entryItem({ key: "rest", cells: l.lines.rest.cells }, c.livingCells, "the rest (every other line)")) : null,
      h("p", { id: "g-tally" }, tallyWords(v)),
      h("p", { class: "fine" }, `Counted by the garden from a day’s own files once a second island regenerated them byte for byte, not from the island’s report${shown ? ` (day ${shown.day}: ${shown.verification === "different-device-type" ? "by an island of another device type" : shown.verification === "same-device-type" ? "replayed here, by an island of the same device type, not yet verified elsewhere" : "by a second island"})` : ""}. A key is one line without a mutation; a line here is a key together with the keys descended from it born on the two days, so those mutants count for it, and older ones count with the rest. Rule ${v.leadersRule?.name ?? ""}.`));

    const w = predictionWindow(v);
    fill("g-predict-window", h("p", { class: "garden-preview", id: "g-predict-words" }, windowWords(w)));
    const offered = w.open ? [...w.census.top.map((e) => e.key), "rest"] : [];
    const wid = windowId(v, w);
    if (choice !== null && (choiceFor !== wid || !offered.includes(choice))) choice = null;
    const drawn = `${wid ?? ""}|${offered.join(",")}`;
    if (drawn !== radiosDrawn) {
      radiosDrawn = drawn;
      const radios = offered.map((key) => {
        const input = h("input", { type: "radio", name: "line", value: key }) as HTMLInputElement;
        input.checked = key === choice;
        input.addEventListener("change", () => { choice = key; choiceFor = wid; updatePredict(); });
        return h("label", { class: "garden-choice" }, input, " ", w.open ? (key === "rest" ? REST_CHOICE : lineName(key, w.census.top)) : key);
      });
      fill("predict-choices", h("legend", { class: "fine" }, "Your guess"), ...radios);
      $("predict-choices").hidden = radios.length === 0;
    }
    updatePredict();
    void renderReceipts(v);
  }

  function updatePredict(): void {
    const w = view ? predictionWindow(view) : null;
    const open = !!w && w.open;
    predictSend.disabled = !open || choice === null || making || !deps.subtle;
    predictWhy.textContent = !w ? "" : !open ? windowWords(w) : !deps.subtle ? "This browser has no crypto.subtle here, so receipts can’t be made." : making ? "Making…" : choice === null ? "Choose a line first." : "";
  }

  async function renderReceipts(v: GardenView): Promise<void> {
    const seq = ++receiptsDrawn;
    const kept = readStoredReceipts(storage(), predictionKey(source.coordinator, v.name));
    // A receipt this tab could not store replaces the stored one for the same planting and day, as a stored one would,
    // unless another tab has stored a different one since (mergeReceipts); storage that cannot be read shows only those.
    const merged = mergeReceipts(kept, unkept);
    unkept = merged.unkept;
    const all = merged.all.filter((r) => r.createdAt === v.createdAt && r.garden === v.name);
    const items: Node[] = [];
    for (const r of all) {
      const st = await settle(r, v, (body) => receiptHash(body, deps.subtle));
      if (st.kind === "replanted") continue;
      const basisTop = dayOfView(v, r.basis.day)?.leaders?.census?.top ?? [];
      items.push(h("li", { "data-receipt": String(r.target), "data-outcome": st.kind },
        h("span", { class: "garden-letter-id mono" }, `Day ${r.target}`),
        h("span", { class: "garden-letter-body" },
          chip({ tone: st.tone, label: st.kind === "held" ? "Held" : st.kind === "missed" ? "Did not hold" : st.kind === "waiting" ? "Waiting" : "Not checked" }), " ",
          h("span", {}, `You guessed ${lineName(r.choice, basisTop)}, from day ${r.basis.day}, at ${time(r.madeAt)}. Receipt `, h("span", { class: "mono garden-digest" }, r.hash.slice(0, 12)), ". "),
          h("span", { class: "fine" }, st.words))));
    }
    if (seq !== receiptsDrawn) return;
    fill("g-receipts", items.length ? h("ul", { class: "garden-letters", id: "g-receipt-list" }, ...items) : h("p", { class: "fine" }, "No receipt from this device for this planting yet."));
  }

  async function makeGuess(): Promise<void> {
    if (choice === null || !view) return;
    // What the visitor chose, and in which window: a reading taken below that has moved on (the target released, a
    // new basis day, a recount of it, a new planting) makes no receipt, whatever is selected by then.
    const asked = { choice, wid: windowId(view, predictionWindow(view)), target: predictionWindow(view).target };
    if (asked.wid === null || choiceFor !== asked.wid) return;
    making = true;
    updatePredict();
    let made: Awaited<ReturnType<typeof makeReceipt>>;
    let target: GardenView;
    try {
      // The guess is stamped with the garden's clock, so it is made against a reading taken now, never one kept from
      // an earlier poll (the window may have shut since): a read that fails makes no receipt.
      const before = reads;
      await refresh();
      // A poll already under way makes `refresh` return early and read again after it: wait for that read too.
      while (reading) await new Promise((r) => setTimeout(r, 50));
      if (!view || viewRead <= before) {
        say(predictSaid, "The garden could not be read just now, so no receipt was made; try again.", "negative");
        return;
      }
      target = view;
      const now = predictionWindow(target);
      if (windowId(target, now) !== asked.wid) {
        choice = null;
        say(predictSaid, now.open
          ? `The garden moved on while you chose: guesses are now about day ${now.target}, not day ${asked.target}, so no receipt was made. Choose again.`
          : `${windowWords(now)} No receipt was made for day ${asked.target}.`, "negative");
        renderField(target);
        return;
      }
      made = await makeReceipt(target, asked.choice, deps.subtle);
    } finally {
      making = false;
      updatePredict();
    }
    if (!made.ok) {
      say(predictSaid, made.words, "negative");
      updatePredict();
      return;
    }
    const r = made.receipt;
    const key = predictionKey(source.coordinator, target.name);
    // The example garden's receipts are never stored: there is no such garden to check them against later.
    const store = source.mock ? null : storage();
    // Storage that cannot be read is not written: a write over a list it could not read would drop the other receipts.
    const stored = source.mock ? [] : readStoredReceipts(store, key);
    const kept = !source.mock && stored !== null && writeReceipts(store, key, addReceipt(stored, r));
    // A stored receipt replaces this tab's unstored one for the same day; an unstored one waits in this tab, with the
    // stored receipt it replaced, or undefined when storage could not be read (mergeReceipts).
    const replaced = stored?.find((x) => sameDay(x, r));
    unkept = kept
      ? unkept.filter((u) => !sameDay(u.receipt, r))
      : addUnkept(unkept, { receipt: r, over: stored === null ? undefined : replaced ? receiptId(replaced) : null });
    const what = `day ${r.target}, ${lineName(r.choice, target.days.find((d) => d.day === r.basis.day)?.leaders?.census?.top ?? [])}, receipt ${r.hash.slice(0, 12)}`;
    say(predictSaid, kept
      ? `Kept on this device: ${what}. Nothing was sent anywhere.`
      : source.mock
        ? `This is the example garden from the contract, so the receipt is kept only while this tab is open: ${what}. Nothing was sent anywhere.`
        : `This device keeps no storage here, so the receipt lasts only while this tab is open: ${what}. Nothing was sent anywhere.`, "note");
    updatePredict();
    if (view) await renderReceipts(view);
  }

  function renderFood(v: GardenView): void {
    const fw = foodWords(v, fmt);
    foodRow.hidden = fw === null;
    if (!fw || !v.food) return;
    const foods = h("ul", { class: "garden-letters", id: "g-foods" }, ...v.food.foods.map((f) => {
      const w = letterWords(f, new Set(), v.days);
      return h("li", { "data-food": f.id },
        h("span", { class: "garden-letter-id mono" }, f.id),
        h("span", { class: "garden-letter-body" }, chip(w), " ",
          h("span", {}, `A feed of ${f.amount} per cell over radius ${f.r} at (${f.x}, ${f.y}), called by ${plural(f.hands, "network")}, landing at step ${fmtSteps(f.landsAtStep)} (end of day ${f.day}). `),
          h("span", { class: "fine" }, w.words),
          foodNoticeWords(f, v.now, fmt) ? h("span", { class: "fine" }, ` ${foodNoticeWords(f, v.now, fmt)}`) : null));
    }));
    fill("g-food",
      h("p", { class: "garden-headline", id: "g-food-count" }, fw.headline),
      h("p", { id: "g-food-time" }, fw.timeLeft),
      h("p", { class: "garden-preview", id: "g-food-landing" }, fw.landing));
    fill("g-food-list",
      h("h3", {}, "Foods so far"),
      v.food.foods.length ? foods : h("p", { class: "fine" }, "No food has been called yet."));
    fill("g-food-why", fw.why);
    updateHand();
  }

  function updateHand(): void {
    const fw = view ? foodWords(view, fmt) : null;
    // A latch for another garden, past its dawn or forgotten by the server is dropped.
    if (latch && !latchHolds(latch, view, viewRead > (latch.afterRead ?? 0))) latch = null;
    const mineIn = latch !== null;
    handSend.disabled = !fw || !fw.open || handing || mineIn;
    handWhy.textContent = !fw ? "" : !fw.open ? fw.closed ?? "" : handing ? "Sending…" : mineIn ? `Your hand is in for ${view ? periodWords(view) : "today"}.` : "";
    handShared.textContent = fw?.shared ?? "";
    handShared.hidden = !fw?.shared;
  }

  async function addHand(target: GardenView): Promise<void> {
    if (source.mock) {
      say(handSaid, "This is the example garden from the contract, so nothing was sent.", "pending");
      return;
    }
    handing = true;
    updateHand();
    let got: Reply;
    try {
      got = await requestJson(deps.fetch, source.handsUrl, {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}",
      }, deps.timeoutMs);
    } finally {
      handing = false;
    }
    const a = handAnswer(got.status, got.json, got.headers, target);
    if (a.in) latch = { name: target.name, since: target.now, until: a.expiresAt ?? target.food?.expiresAt ?? target.pace.nextDawnAt, afterRead: reads };
    say(handSaid, a.words, a.tone);
    updateHand();
    if (a.refresh) await refresh();
  }

  function renderMeteor(v: GardenView): void {
    const mw = meteorWords(v, fmt);
    meteorRow.hidden = mw === null;
    if (!mw || !v.meteor) return;
    const meteors = h("ul", { class: "garden-letters", id: "g-meteors" }, ...v.meteor.meteors.map((m) => {
      const w = letterWords(m, new Set(), v.days);
      const notice = foodNoticeWords(m, v.now, fmt);
      return h("li", { "data-meteor": m.id },
        h("span", { class: "garden-letter-id mono" }, m.id),
        h("span", { class: "garden-letter-body" }, chip(w), " ",
          h("span", {}, `A stone of radius ${m.r} at (${m.x}, ${m.y}), called by ${plural(m.hands, "network")}, landing at step ${fmtSteps(m.landsAtStep)} (end of day ${m.day}). `),
          h("span", { class: "fine" }, w.words),
          notice ? h("span", { class: "fine" }, ` ${notice}`) : null));
    }));
    fill("g-meteor",
      h("p", { id: "g-meteor-what" }, mw.what),
      h("p", { class: "garden-headline", id: "g-meteor-count" }, mw.headline),
      h("p", { id: "g-meteor-time" }, mw.timeLeft),
      h("p", { class: "garden-preview", id: "g-meteor-landing" }, mw.landing));
    fill("g-meteor-list",
      h("h3", {}, "Meteors so far"),
      v.meteor.meteors.length ? meteors : h("p", { class: "fine" }, "No meteor has been called yet."));
    fill("g-meteor-why",
      h("p", { class: "fine", id: "g-meteor-reading" }, mw.reading),
      h("p", { class: "fine" }, mw.why));
    updateMeteorHand();
  }

  function updateMeteorHand(): void {
    const mw = view ? meteorWords(view, fmt) : null;
    if (meteorLatch && !latchHolds(meteorLatch, view, viewRead > (meteorLatch.afterRead ?? 0), "meteor")) meteorLatch = null;
    const mineIn = meteorLatch !== null;
    meteorSend.disabled = !mw || !mw.open || meteorHanding || mineIn;
    meteorWhy.textContent = !mw ? "" : !mw.open ? mw.closed ?? "" : meteorHanding ? "Sending…" : mineIn ? `Your hand is in for ${view ? periodWords(view) : "today"}.` : "";
    meteorShared.textContent = mw?.shared ?? "";
    meteorShared.hidden = !mw?.shared;
  }

  async function addMeteorHand(target: GardenView): Promise<void> {
    if (source.mock) {
      say(meteorSaid, "This is the example garden from the contract, so nothing was sent.", "pending");
      return;
    }
    meteorHanding = true;
    updateMeteorHand();
    let got: Reply;
    try {
      got = await requestJson(deps.fetch, source.meteorHandsUrl, {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}",
      }, deps.timeoutMs);
    } finally {
      meteorHanding = false;
    }
    const a = handAnswer(got.status, got.json, got.headers, target, "meteor");
    if (a.in) meteorLatch = { name: target.name, since: target.now, until: a.expiresAt ?? target.meteor?.expiresAt ?? target.pace.nextDawnAt, afterRead: reads };
    say(meteorSaid, a.words, a.tone);
    updateMeteorHand();
    if (a.refresh) await refresh();
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
      if (l.kind !== "stone" || l.x === null || l.y === null || l.r === null) continue;
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
    updateSun();
  }

  /** The chosen sun's percent, or null. */
  function sunChosen(): number | null {
    const on = sunChoices.querySelector<HTMLInputElement>("input:checked");
    return on ? Number(on.value) : null;
  }

  function updateSun(): void {
    if (!view) return;
    const sun = view.sun;
    sunRow.hidden = !sunOffered(view);
    if (!sun) return;
    // The choices are rebuilt only when the garden's percents change, so a choice (and its focus) survives a refresh.
    const offered = sun.percents.join(",");
    if (offered !== sunPercentsShown) {
      const keep = sunChosen();
      const legend = sunChoices.querySelector("legend");
      const choices = sun.percents.map((p) => {
        const input = h("input", { type: "radio", name: "sun-percent", value: String(p) }) as HTMLInputElement;
        input.checked = keep === p;
        input.addEventListener("change", updateSun);
        return h("label", { class: "garden-sun-choice" }, input, ` ${SUN_WORDS[p] ?? `${p}%`} (${p}%)`);
      });
      sunChoices.replaceChildren(...(legend ? [legend] : []), ...choices);
      sunPercentsShown = offered;
    }
    const check = sunBody(view, sunChosen());
    sunPreview.textContent = sunLandingWords(view);
    const open = sun.nextLanding !== null;
    sunSend.disabled = !open || !check.ok || sending;
    sunWhy.textContent = !open ? "" : !check.ok ? check.words : sending ? "Sending…" : "";
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
    const seq = ++reads;
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
    viewRead = seq;
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
      updateHand();
      updateMeteorHand();
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

  async function post(stone: LetterBody, target: GardenView, out: HTMLElement = answer): Promise<void> {
    if (source.mock) {
      say(out, "This is the example garden from the contract, so nothing was sent.", "pending");
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
    const a = postAnswer(got.status, got.json, got.headers, target, stone.kind);
    if (a.letter) remember(a.letter.id, target);
    say(out, a.words, a.tone);
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
  sunForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!view || sending) return;
    const check = sunBody(view, sunChosen());
    if (!check.ok || !view.sun?.nextLanding) { updateSun(); return; }
    void post(check.body, view, sunAnswer);
  });
  handSend.addEventListener("click", () => {
    if (!view || handing) return;
    void addHand(view);
  });
  meteorSend.addEventListener("click", () => {
    if (!view || meteorHanding) return;
    void addMeteorHand(view);
  });
  predictForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!view || making) return;
    void makeGuess();
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
  setInterval(() => { if (!doc.hidden && !reading && !sending && !handing && !meteorHanding) void refresh(); }, deps.pollMs);
  return { refresh };
}
