// The garden page's pure logic against the contract's own fixture (docs/garden-page-v0-2026-10-17.md).
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../coordinator/priv/static/garden-contract.example.json";
import {
  checkStone, checkpointHref, dawnAfter, dayChip, fmtDuration, foodClosedWords, foodNoticeWords, foodWords, latchHolds, periodWords, foundingWords, fmtSteps, fmtTime, getAnswer, handAnswer, landingPreview, landingWords,
  letterWords, mergeMine, newestMine, olderDaysSettled, parseGarden, postAnswer, postedSinceDawn, readVisit, recordFor, requestJson, resolveSource, retryAfterMs,
  sharePercent, sinceLastVisit, stateWords, tendingWords, verificationSummary, visitKey, writeVisit, type GardenView, type VisitRecord,
} from "../garden/garden.ts";
import {
  RECEIPTS_MAX, addReceipt, addUnkept, canonicalJson, fieldTally, leadersOn, leadersWords, lineName, linesWords, makeReceipt, mergeReceipts, predictionKey, predictionWindow, windowId,
  readReceipts, readStoredReceipts, receiptHash, receiptId, settle, tallyWords, windowWords, writeReceipts, type Receipt, type ReceiptBody,
} from "../garden/garden.ts";
import { pageMeta } from "../src/social-meta.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MATTER_MAX, PRESETS, cellCount, defaultConfig, initWorld, maxLesionRadius, totalsOf, worldH, worldW } from "@bl/schema";
import { METEOR_READ, discCells, meteorClosedWords, meteorReadingWords, meteorWords } from "../garden/garden.ts";
import { carriesWords, sunBody, sunLandingWords, sunOffered } from "../garden/garden.ts";
import gardenHtml from "../garden/index.html?raw";
import sitemap from "../public/sitemap.xml?raw";

const fmt = { locale: "en-GB", timeZone: "UTC" };
const copy = (): Record<string, any> => structuredClone(fixture) as Record<string, any>;
const view = (mutate: (v: Record<string, any>) => void = () => {}): GardenView => {
  const v = copy();
  mutate(v);
  const parsed = parseGarden(v);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.view;
};
const iso = (ms: number) => new Date(ms).toISOString();

/** A garden just created: day 0 released, nothing done, and every nullable key null (README "The garden"). */
const fresh = () => view((v) => {
  v.state = "waiting-for-island";
  v.asleep = true;
  v.census = null; v.tip = null; v.fork = null;
  v.clock = { ...v.clock, step: 0, verifiedStep: 0, releasedStep: 131072, daysDone: 0, lastMovedAt: null, sleptMs: null };
  v.pace = { ...v.pace, nextReleaseAt: null, releaseDue: false };
  v.tending = { ...v.tending, islandsToday: 0, deviceTypesToday: 0, deviceTypesEver: 0, activeNow: 0 };
  v.verification = { daysDone: 0, daysVerified: 0, byDifferentDeviceType: 0, bySameDeviceType: 0, diverged: 0, failed: 0, share: null };
  v.days = [{ day: 0, startStep: 0, endStep: 131072, status: "waiting", releasedAt: v.createdAt, doneAt: null, verifiedAt: null, digest: null, verification: null, letters: [], census: null }];
  v.letters = { ...v.letters, queued: 0, nextLanding: { day: 0, step: 131072, open: 3 }, waiting: [], recent: [] };
});

afterEach(() => { vi.useRealTimers(); });

describe("reading the contract", () => {
  it("parses the contract's fixture as garden-v1", () => {
    const parsed = parseGarden(copy());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.view.clock.step).toBe(393216);
    expect(parsed.view.letters.waiting).toHaveLength(4);
    expect(parsed.view.letters.nextLanding?.day).toBe(4);
  });

  it("ignores added keys and refuses another contract or a missing or retyped key", () => {
    expect(parseGarden({ ...copy(), extra: 1, clock: { ...copy().clock, extra: "x" } }).ok).toBe(true);
    const reason = (v: unknown) => { const p = parseGarden(v); return p.ok ? "ok" : p.reason; };
    expect(reason({ ...copy(), contract: "garden-v2" })).toMatch(/garden-v2/);
    const noClock = copy(); delete noClock.clock;
    expect(reason(noClock)).toMatch(/^clock: missing/);
    const retyped = copy(); retyped.pace.stepsPerDay = "x";
    expect(reason(retyped)).toMatch(/pace\.stepsPerDay/);
    const zero = copy(); zero.pace.stepsPerDay = 0;
    expect(reason(zero)).toMatch(/pace\.stepsPerDay: expected a positive number/);
    const badLetter = copy(); badLetter.letters.waiting[2].x = null;
    expect(reason(badLetter)).toMatch(/letters\.waiting\[2\]\.x/);
    // Times must be integers a Date can hold, or rendering would throw (README: "All times are integers, ms").
    for (const [path, bad] of [["now", 1e20], ["pace.nextDawnAt", 8.64e15 + 1], ["createdAt", 1.5], ["days[0].releasedAt", -9e15]] as const) {
      const v = copy();
      const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
      let at: any = v;
      for (const part of parts.slice(0, -1)) at = at[part];
      at[parts.at(-1)!] = bad;
      expect(reason(v), path).toMatch(new RegExp(`${path.replace(/[.[\]]/g, "\\$&")}: expected a time`));
    }
    expect(fmtTime(1e20)).toBe("an unreadable time");
    for (const junk of [null, [], "garden", 3, undefined]) {
      expect(() => parseGarden(junk)).not.toThrow();
      expect(parseGarden(junk).ok).toBe(false);
    }
  });

  it("a fresh garden: nulls where the README allows them", () => {
    const v = fresh();
    expect(stateWords(v, fmt).sentence).toMatch(/day 0 is ready.*has not moved yet/);
    expect(verificationSummary(v)).toEqual({ headline: "No day is done yet", share: "—", lines: ["Nothing has been replayed yet."] });
    expect(tendingWords(v).kept).toBe("No computer has tended it yet");
    expect(checkpointHref(resolveSource("", "http://x", false), v)).toBeNull();
    expect(sinceLastVisit(null, v)).toEqual({ kind: "first" });
    expect(landingPreview(v)).toMatchObject({ open: true, day: 0, earliest: "released" });
    // Inner census values may each be null too.
    const partial = view((x) => { x.census.individuals = null; x.census.extinct = null; x.days[0].census.mutations = null; x.tip.digest = null; });
    expect(partial.census?.individuals).toBeNull();
  });
});

describe("words", () => {
  it("maps each state, with and without asleep, to words", () => {
    const asleep = stateWords(view(), fmt);
    expect(asleep.label).toBe("Asleep");
    expect(asleep.sentence).toBe("Asleep: day 3 is ready and no island has come for it. It has slept 1 day and 14 hours.");
    expect(stateWords(view((v) => { v.asleep = false; }), fmt).sentence).toBe("Waiting for an island to take day 3.");
    const growing = view((v) => { v.state = "growing"; v.asleep = false; v.clock.releasedStep = 524288; v.days.unshift({ ...v.days[0], day: 3, status: "growing", startStep: 393216, endStep: 524288, doneAt: null, digest: null, census: null, letters: [] }); });
    expect(stateWords(growing, fmt)).toMatchObject({ label: "Growing", tone: "measured", sentence: "Growing: an island is tending day 3 now." });
    const resting = view((v) => { v.state = "resting"; v.asleep = false; v.pace.nextReleaseAt = v.pace.nextDawnAt; });
    expect(stateWords(resting, fmt).sentence).toBe("Resting: today’s day is done; the next can open at dawn, 24 Oct 2026, 00:00 UTC.");
    const stopped = view((v) => { v.state = "stopped"; v.asleep = false; v.days[0].status = "diverged"; });
    expect(stateWords(stopped, fmt)).toMatchObject({ tone: "negative", sentence: "Stopped: day 2 did not replay the same. Nothing after it runs until the keeper looks." });
    const failed = view((v) => { v.state = "stopped"; v.days[0].status = "failed"; });
    expect(stateWords(failed, fmt).sentence).toMatch(/^Stopped: day 2 could not run\./);
    expect(stateWords(view((v) => { v.state = "finished"; }), fmt).sentence).toBe("Finished: every day to the horizon is done.");
    const unknown = stateWords(view((v) => { v.state = "composting"; }), fmt);
    expect(unknown.known).toBe(false);
    expect(unknown.label).toMatch(/composting.*new to this page/);
  });

  it("labels each day status and verification kind", () => {
    expect(dayChip({ status: "verified", verification: "different-device-type" })).toEqual({ tone: "observed", label: "Verified elsewhere" });
    expect(dayChip({ status: "verified", verification: "same-device-type" })).toEqual({ tone: "note", label: "Replayed here, not yet verified elsewhere" });
    expect(dayChip({ status: "done", verification: null })).toEqual({ tone: "pending", label: "Done, waiting for a replay" });
    expect(dayChip({ status: "growing", verification: null }).tone).toBe("measured");
    expect(dayChip({ status: "waiting", verification: null }).label).toBe("Ready, no island yet");
    expect(dayChip({ status: "diverged", verification: null })).toEqual({ tone: "negative", label: "Replay disagreed" });
    expect(dayChip({ status: "failed", verification: null })).toEqual({ tone: "negative", label: "Could not run" });
    expect(dayChip({ status: "blocked", verification: null })).toEqual({ tone: "negative", label: "Blocked by an earlier day" });
    expect(dayChip({ status: "pruned", verification: null }).label).toMatch(/new to this page/);
    for (const status of ["waiting", "growing", "done", "verified", "diverged", "failed", "blocked"]) {
      for (const verification of [null, "same-device-type", "different-device-type"]) {
        const chip = dayChip({ status, verification });
        expect(chip.label.length).toBeGreaterThan(0);
        if (chip.tone === "observed") expect(verification).toBe("different-device-type");
      }
    }
  });

  it("labels each letter status", () => {
    const v = view();
    const letter = (status: string) => ({ ...v.letters.waiting[0], status });
    expect(letterWords(letter("waiting")).words).toBe("Waiting: public, and the keeper may still set it aside.");
    expect(letterWords(letter("sealed")).words).toBe("Sealed: fixed to day 3, which an island has taken; it lands when that day is done.");
    expect(letterWords(letter("landed")).words).toBe("Landed at step 524,288, not yet replayed.");
    expect(letterWords(letter("verified"), new Set(), v.days)).toMatchObject({ label: "Replayed", tone: "note", words: "Landed at step 524,288; its day was replayed by a second island." });
    expect(letterWords(letter("dropped")).label).toBe("Set aside");
    expect(letterWords(letter("stalled")).tone).toBe("negative");
    expect(letterWords(letter("lost")).label).toMatch(/new to this page/);
    expect(letterWords(letter("waiting"), new Set(["ltr-4"])).mine).toBe(true);
    expect(letterWords(letter("waiting"), new Set(["ltr-5"])).mine).toBe(false);
    // The words, not only the colour, say which kind of replay the letter's day had.
    const here = letterWords(v.letters.recent[2], new Set(), v.days);
    expect(here).toMatchObject({ tone: "note", label: "Replayed here" });
    expect(here.words).toMatch(/replayed here, not yet verified elsewhere\.$/);
    const elsewhere = view((x) => { x.days[1].verification = "different-device-type"; });
    const clean = letterWords(elsewhere.letters.recent[2], new Set(), elsewhere.days);
    expect(clean).toMatchObject({ tone: "observed", label: "Verified elsewhere" });
    expect(clean.words).toMatch(/its day was verified elsewhere\.$/);
  });

  it("tending wording", () => {
    const at = (n: number) => tendingWords(view((v) => { v.tending.deviceTypesEver = n; })).kept;
    expect(at(0)).toBe("No computer has tended it yet");
    expect(at(1)).toBe("Kept by one computer so far");
    expect(at(3)).toBe("Tended by at least 3 kinds of computer");
    const t = tendingWords(view());
    expect(t.islands).toBe("0 islands in the last 24 hours (two tabs on one computer are two islands), on 0 kinds of computer.");
    // The adapter string names the browser too, so a kind is not a lower bound on computers.
    expect(t.caveat).toBe("A kind of computer is the browser and GPU an island reports. Two browsers on one computer count as two kinds, so it is neither a count of computers nor an identity.");
  });

  it("verification summary on the fixture", () => {
    const s = verificationSummary(view());
    expect(s.headline).toBe("2 of 3 days");
    expect(s.share).toBe("67%");
    expect(s.lines.join(" ")).toMatch(/replayed here, not yet verified elsewhere/);
    const mixed = verificationSummary(view((v) => { v.verification.byDifferentDeviceType = 1; v.verification.bySameDeviceType = 1; v.verification.diverged = 1; }));
    expect(mixed.lines).toEqual(["1 day verified elsewhere (a different browser or GPU, perhaps the same computer); 1 day replayed here, not yet verified elsewhere.", "1 day whose replay disagreed."]);
    // Day 0 diverged: nothing is done, and the disagreement is still said.
    const day0 = verificationSummary(view((v) => { v.verification = { daysDone: 0, daysVerified: 0, byDifferentDeviceType: 0, bySameDeviceType: 0, diverged: 1, failed: 0, share: null }; }));
    expect(day0).toEqual({ headline: "No day is done yet", share: "—", lines: ["1 day whose replay disagreed."] });
  });

  it("the share never reads 100% short of all, nor 0% above none", () => {
    expect(sharePercent(199, 200)).toBe("99%");
    expect(sharePercent(364, 365)).toBe("99%");
    expect(sharePercent(9996, 10000)).toBe("99%");
    expect(sharePercent(200, 200)).toBe("100%");
    expect(sharePercent(1, 365)).toBe("under 1%");
    expect(sharePercent(1, 3000)).toBe("under 1%");
    expect(sharePercent(0, 3)).toBe("0%");
    expect(sharePercent(2, 3)).toBe("67%");
    expect(sharePercent(0, 0)).toBe("—");
    const almost = verificationSummary(view((v) => { v.verification = { ...v.verification, daysDone: 200, daysVerified: 199, share: 0.995 }; }));
    expect(almost).toMatchObject({ headline: "199 of 200 days", share: "99%" });
  });

  it("formats steps, durations and times", () => {
    expect(fmtSteps(393216)).toBe("393,216");
    expect(fmtDuration(30_000)).toBe("under a minute");
    expect(fmtDuration(60_000)).toBe("1 minute");
    expect(fmtDuration(3_600_000)).toBe("1 hour");
    expect(fmtDuration(10_260_000)).toBe("2 hours and 51 minutes");
    expect(fmtDuration(136_800_000)).toBe("1 day and 14 hours");
    expect(fmtDuration(172_800_000)).toBe("2 days");
    expect(fmtTime(1792800000000, "en-GB", "UTC")).toBe("24 Oct 2026, 00:00 UTC");
    expect(foundingWords(view().founding)).toBe("1 feed at step 0, set by the keeper");
    expect(foundingWords([{ step: 0, kind: "lesion", x: 1, y: 1, r: 2 }, { step: 0, kind: "feed", x: 1, y: 1, r: 2, amount: 3 }, { step: 0, kind: "feed", x: 1, y: 1, r: 2, amount: 3 }])).toBe("2 feeds and 1 wound at step 0, set by the keeper");
    expect(foundingWords([])).toBe("nothing added at the start");
  });
});

describe("which day the state names", () => {
  // The fixture lists days 0 to 3; a long garden lists only the newest 14.
  const long = (mutate: (v: Record<string, any>) => void) => view((v) => {
    const D = 131072;
    v.clock = { ...v.clock, releasedStep: 31 * D, step: 30 * D, daysDone: 30 };
    v.days = Array.from({ length: 14 }, (_, i) => {
      const day = 30 - i;
      return { ...v.days[0], day, startStep: day * D, endStep: (day + 1) * D, status: "done", verification: null, verifiedAt: null, letters: [] };
    });
    mutate(v);
  });

  it("names a day only when no unlisted older day can be the one meant", () => {
    // Every day before the window is done: the oldest listed growing day is the one.
    const plain = long((v) => { v.state = "growing"; v.days[0].status = "growing"; v.clock.daysDone = 30; });
    expect(olderDaysSettled(plain)).toBe(true);
    expect(stateWords(plain, fmt).sentence).toBe("Growing: an island is tending day 30 now.");
    // Day 0 was requeued and is being rerun: the days after it were reset, and nothing listed is growing.
    const rerun = long((v) => {
      v.state = "growing";
      v.clock.daysDone = 0;
      for (const d of v.days) d.status = "waiting";
    });
    expect(olderDaysSettled(rerun)).toBe(false);
    expect(stateWords(rerun, fmt).sentence).toBe("Growing: an island is tending a day now.");
    const waiting = long((v) => { v.state = "waiting-for-island"; v.asleep = false; v.clock.daysDone = 0; for (const d of v.days) d.status = "waiting"; });
    expect(stateWords(waiting, fmt).sentence).toBe("Waiting for an island to take a day.");
    const stopped = long((v) => { v.state = "stopped"; v.clock.daysDone = 0; for (const d of v.days) d.status = "blocked"; v.days[13].status = "diverged"; });
    expect(stateWords(stopped, fmt).sentence).toMatch(/^Stopped: a day did not replay the same or could not run\./);
  });
});

describe("since your last visit", () => {
  const CREATED = (fixture as { createdAt: number }).createdAt;
  const prev = (step: number, daysVerified = 0, createdAt = CREATED): VisitRecord => ({ createdAt, step, seenAt: 1792560000000, daysVerified, mine: [] });

  it("compares the tip, the replayed-day count and the landed letters", () => {
    const v = view();
    expect(sinceLastVisit(null, v)).toEqual({ kind: "first" });
    const s = sinceLastVisit(prev(131072), v);
    expect(s).toMatchObject({ kind: "changed", steps: 262144, days: 2, newlyVerified: 2, landedAtLeast: false });
    if (s.kind !== "changed") return;
    expect(s.landed.map((l) => l.id)).toEqual(["ltr-1", "ltr-2"]);
    expect(sinceLastVisit(prev(393216, 2), v)).toEqual({ kind: "unchanged", seenAt: 1792560000000, prevStep: 393216 });
    expect(sinceLastVisit(prev(393216), v)).toMatchObject({ kind: "changed", steps: 0, newlyVerified: 2 });
    expect(sinceLastVisit(prev(524288, 2), v)).toMatchObject({ kind: "behind", prevStep: 524288 });
  });

  it("counts replayed days from the aggregate, not the 14-day list", () => {
    // Day 0 was replayed at the last visit; now 21 days are and the list shows only the newest 14 of them.
    const v = view((x) => { x.verification = { ...x.verification, daysDone: 21, daysVerified: 21, share: 1 }; });
    expect(sinceLastVisit(prev(131072, 1), v)).toMatchObject({ kind: "changed", newlyVerified: 20 });
  });

  it("a garden planted again under the same name is not compared, and its letters are not this device's", () => {
    const v = view();
    expect(sinceLastVisit(prev(393216, 2, CREATED - 86_400_000), v)).toEqual({ kind: "replanted", seenAt: 1792560000000 });
    expect(mergeMine({ ...prev(0, 0, CREATED - 1), mine: ["ltr-1"] }, CREATED, ["ltr-9"])).toEqual(["ltr-9"]);
  });

  it("says when the recent list may hide older landings", () => {
    const many = view((x) => {
      const base = x.letters.recent[1];
      x.letters.recent = Array.from({ length: 32 }, (_, i) => ({ ...base, id: `ltr-${100 - i}`, status: "landed", landsAtStep: 393216 }));
    });
    expect(sinceLastVisit(prev(262144), many)).toMatchObject({ kind: "changed", landedAtLeast: true });
    expect(sinceLastVisit(prev(393216 - 1), view())).toMatchObject({ landedAtLeast: false });
    // Posting order is not landing order: a full list whose newest letter landed on an early day (at the old tip) can
    // still have pushed out a letter that landed since, so a full list always says "at least".
    const mixed = view((x) => {
      const base = x.letters.recent[1];
      x.letters.recent = Array.from({ length: 32 }, (_, i) => ({ ...base, id: `ltr-${34 - i}`, status: "landed", landsAtStep: i === 0 ? 262144 : 393216 }));
    });
    expect(sinceLastVisit(prev(262144), mixed)).toMatchObject({ kind: "changed", landedAtLeast: true });
  });

  it("joins the letters two tabs recorded for one planting", () => {
    expect(mergeMine({ ...prev(0), mine: ["ltr-1", "ltr-2"] }, CREATED, ["ltr-2", "ltr-3"])).toEqual(["ltr-1", "ltr-2", "ltr-3"]);
    expect(mergeMine(null, CREATED, ["ltr-3"])).toEqual(["ltr-3"]);
    expect(mergeMine({ ...prev(0), mine: Array.from({ length: 32 }, (_, i) => `ltr-${i}`) }, CREATED, ["ltr-99"])).toHaveLength(32);
    // A stale tab holding 1..32 must not push out the newer 33 another tab stored: the cap keeps the newest by number.
    const stored = Array.from({ length: 32 }, (_, i) => `ltr-${i + 2}`);
    const stale = Array.from({ length: 32 }, (_, i) => `ltr-${i + 1}`);
    const merged = mergeMine({ ...prev(0), mine: stored }, CREATED, stale);
    expect(merged).toEqual(stored);
    expect(merged).toContain("ltr-33");
    expect(merged).not.toContain("ltr-1");
    expect(newestMine(["ltr-10", "ltr-9", "odd", "ltr-10"])).toEqual(["odd", "ltr-9", "ltr-10"]);
  });

  it("keeps the record on the device, and survives storage that throws", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const key = visitKey("http://localhost:5174", "commons");
    expect(key).toBe("cadence-garden-visit:http://localhost:5174:commons");
    expect(readVisit(storage, key)).toBeNull();
    const many = Array.from({ length: 40 }, (_, i) => `ltr-${i}`);
    expect(writeVisit(storage, key, recordFor(view(), many))).toBe(true);
    const back = readVisit(storage, key);
    expect(back).toMatchObject({ createdAt: CREATED, step: 393216, seenAt: 1792789740000, daysVerified: 2 });
    expect(back?.mine).toHaveLength(32);
    expect(back?.mine.at(-1)).toBe("ltr-39");
    for (const bad of ["{not json", JSON.stringify({ step: "x" }),
      // The old shape, a time a Date cannot hold, and an infinite one: no record.
      JSON.stringify({ step: 0, seenAt: 1792560000000, verifiedDays: [], mine: [] }),
      JSON.stringify({ ...prev(0), seenAt: 1e20 }), '{"createdAt":1,"step":0,"seenAt":1e309,"daysVerified":0,"mine":[]}',
      JSON.stringify({ ...prev(0), step: -1 })]) {
      store.set(key, bad);
      expect(readVisit(storage, key), bad).toBeNull();
    }
    const throwing = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(readVisit(throwing, key)).toBeNull();
    expect(writeVisit(throwing, key, recordFor(view(), []))).toBe(false);
    expect(readVisit(null, key)).toBeNull();
    expect(writeVisit(null, key, recordFor(view(), []))).toBe(false);
  });

  it("the courtesy uses the garden's dawn grid", () => {
    const v = view();
    // The last dawn is 2026-10-23T00:00Z; ltr-6 and ltr-7 were posted after it, ltr-4 before.
    expect(postedSinceDawn(v, new Set(["ltr-4"]))).toBe(false);
    expect(postedSinceDawn(v, new Set(["ltr-7"]))).toBe(true);
    expect(postedSinceDawn(v, new Set())).toBe(false);
  });
});

describe("the letter form", () => {
  it("checks a stone like the server", () => {
    const v = view();
    const ok = (x: unknown, y: unknown, r: unknown) => checkStone({ x, y, r }, v).ok;
    expect(ok(0, 0, 1)).toBe(true);
    expect(ok("511", "511", "32")).toBe(true);
    expect(checkStone({ x: "12", y: 3, r: "8" }, v)).toEqual({ ok: true, body: { kind: "stone", x: 12, y: 3, r: 8 } });
    expect(checkStone({ x: -1, y: 0, r: 8 }, v)).toMatchObject({ ok: false, field: "x" });
    expect(checkStone({ x: 512, y: 0, r: 8 }, v)).toMatchObject({ ok: false, field: "x", words: "Across (x) is a whole number from 0 to 511." });
    expect(checkStone({ x: 0, y: 512, r: 8 }, v)).toMatchObject({ ok: false, field: "y" });
    expect(checkStone({ x: 0, y: 0, r: 0 }, v)).toMatchObject({ ok: false, field: "r", words: "The radius is a whole number from 1 to 32." });
    expect(checkStone({ x: 0, y: 0, r: 33 }, v)).toMatchObject({ ok: false, field: "r" });
    expect(ok(1.5, 0, 8)).toBe(false);
    expect(ok("1.5", 0, 8)).toBe(false);
    expect(ok("", 0, 8)).toBe(false);
    expect(ok(0, 0, "1e1")).toBe(false);
    expect(checkStone({ y: 0, r: 8 }, v)).toMatchObject({ ok: false, field: "x" });
    expect(checkStone({ x: 0, y: 0 }, v)).toMatchObject({ ok: false, field: "r" });
  });

  it("previews the landing from nextLanding", () => {
    const p = landingPreview(view());
    expect(p).toMatchObject({ open: true, day: 4, step: 655360, left: 2, perDay: 3 });
    if (!p.open || typeof p.earliest === "string" || "afterDay" in p.earliest) throw new Error("expected a bound");
    expect(iso(p.earliest.notBefore)).toBe("2026-10-24T00:00:00.000Z");
    expect(landingWords(p, fmt)).toBe("Your stone would land at step 655,360, the end of day 4; 2 of the day’s 3 places are left. Day 4 opens not before 24 Oct 2026, 00:00 UTC, and only if an island tends it.");

    expect(landingPreview(view((v) => { v.letters.nextLanding = null; v.letters.queued = 64; })))
      .toEqual({ open: false, reason: "The garden takes no letters now: the queue is full (64 letters waiting)." });
    expect(landingPreview(view((v) => { v.letters.nextLanding = null; v.state = "stopped"; }))).toMatchObject({ reason: /stopped until the keeper looks/ });
    expect(landingPreview(view((v) => { v.letters.nextLanding = null; v.state = "finished"; }))).toMatchObject({ reason: /every day to the horizon is done/ });
    expect(landingPreview(view((v) => { v.letters.nextLanding = null; }))).toMatchObject({ reason: /log is full or no day is left/ });

    // Already released: L ≤ R.
    expect(landingPreview(view((v) => { v.letters.nextLanding = { day: 2, step: 393216, open: 1 }; }))).toMatchObject({ earliest: "released" });
    // The next day, due now.
    expect(landingPreview(view((v) => { v.letters.nextLanding = { day: 3, step: 524288, open: 1 }; }))).toMatchObject({ earliest: "due" });
    // The next day, not yet due: nextReleaseAt itself.
    const later = landingPreview(view((v) => { v.pace.nextReleaseAt = v.pace.nextDawnAt; v.pace.releaseDue = false; v.letters.nextLanding = { day: 3, step: 524288, open: 1 }; }));
    expect(later).toMatchObject({ earliest: { notBefore: 1792800000000 } });
    // Day R not done (README: nextReleaseAt null): day R is growing, its three places are full, released long ago.
    const growing = (landing: { day: number; step: number; open: number }) => view((v) => {
      v.state = "growing"; v.asleep = false; v.days[0].status = "growing"; v.days[0].doneAt = null; v.days[0].digest = null;
      v.pace.nextReleaseAt = null; v.pace.releaseDue = false; v.letters.nextLanding = landing;
    });
    const next = landingPreview(growing({ day: 3, step: 524288, open: 3 }));
    // Never "due": day 3 waits for day 2, whose release dawn is long past, so no time says more than "after day 2".
    expect(next).toMatchObject({ open: true, day: 3, earliest: { afterDay: 2, notBefore: null } });
    expect(landingWords(next, fmt)).toBe("Your stone would land at step 524,288, the end of day 3; 3 of the day’s 3 places are left. Day 3 opens only after day 2 is done and a dawn has passed since it was released, and only if an island tends it.");
    const two = landingPreview(growing({ day: 4, step: 655360, open: 1 }));
    if (!two.open || typeof two.earliest === "string" || !("afterDay" in two.earliest)) throw new Error("expected afterDay");
    expect(iso(two.earliest.notBefore!)).toBe("2026-10-24T00:00:00.000Z");
    expect(landingWords(two, fmt)).toMatch(/Day 4 opens only after day 2 is done, then one day a dawn, not before 24 Oct 2026, 00:00 UTC, and only if an island tends it\.$/);
    // A day released just now: its next dawn is still ahead, so day R+1 has a time bound as well.
    const fresh = landingPreview(view((v) => {
      v.days[0].status = "growing"; v.days[0].releasedAt = v.now - 60_000; v.pace.nextReleaseAt = null; v.pace.releaseDue = false;
      v.letters.nextLanding = { day: 3, step: 524288, open: 3 };
    }));
    expect(fresh).toMatchObject({ earliest: { afterDay: 2, notBefore: 1792800000000 } });
    // Each further day needs a dawn after the one before.
    const far = landingPreview(growing({ day: 6, step: 917504, open: 1 }));
    if (!far.open || typeof far.earliest === "string" || !("afterDay" in far.earliest)) throw new Error("expected afterDay");
    expect(iso(far.earliest.notBefore!)).toBe("2026-10-26T00:00:00.000Z");
  });

  it("the dawn grid is strictly after", () => {
    const v = view();
    expect(iso(dawnAfter(v, Date.parse("2026-10-23T00:00:00Z")))).toBe("2026-10-24T00:00:00.000Z");
    expect(iso(dawnAfter(v, Date.parse("2026-10-22T23:59:59Z")))).toBe("2026-10-23T00:00:00.000Z");
    const offset = view((x) => { x.pace.dawnOffsetMs = 6 * 3_600_000; });
    expect(iso(dawnAfter(offset, Date.parse("2026-10-23T05:00:00Z")))).toBe("2026-10-23T06:00:00.000Z");
  });

  it("words for every documented answer", () => {
    const v = view();
    const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });
    const created = postAnswer(201, { letter: { ...v.letters.waiting[3], id: "ltr-8" } }, null, v);
    expect(created).toMatchObject({ refresh: true, letter: { id: "ltr-8", landsAtStep: 655360, day: 4 } });
    expect(created.words).toBe("Posted as ltr-8. It is public now, lands at step 655,360 (end of day 4), and counts once a second island replays that day.");
    expect(postAnswer(422, { error: "r must be an integer in 1..32" }, null, v).words).toBe("The garden refused the stone: r must be an integer in 1..32.");
    expect(postAnswer(409, { error: "the letter queue is full" }, null, v)).toMatchObject({ refresh: true, words: "The garden takes no letters now: the letter queue is full." });
    // 429 can also mean too many refusals or a full table: the words name the limit, not what this network sent.
    expect(postAnswer(429, { error: "too many letters from this address", retryAfterMs: 1_500_000 }, headers({ "retry-after": "1500" }), v).words)
      .toBe("The garden is not taking letters from this network just now: it takes at most 3 letters an hour from one network, and fewer when many are refused. Try again in 25 minutes.");
    expect(postAnswer(429, null, headers({ "retry-after": "120" }), v).words).toMatch(/Try again in 2 minutes\.$/);
    expect(postAnswer(429, null, headers({}), v).words).toMatch(/Try again later\.$/);
    for (const code of [413, 415]) expect(postAnswer(code, null, null, v).words).toMatch(/Reload the page and try again\./);
    expect(postAnswer(404, { error: "not found" }, null, v).words).toBe("There is no garden by that name here.");
    expect(postAnswer(503, null, null, v).words).toBe("The garden is busy; try again in a moment.");
    // The server keeps a letter before it answers, so no answer never means "not sent".
    expect(postAnswer(0, null, null, v)).toMatchObject({ refresh: true, words: "No answer came back, so this page cannot tell whether your stone arrived. The queue below is read again: look for it there before sending another." });
    expect(postAnswer(500, "oops", null, v)).toMatchObject({ refresh: true, words: "The garden answered 500, so this page cannot tell whether your stone arrived. The queue below is read again: look for it there before sending another." });
    expect(postAnswer(422, "<html>", null, v).words).toMatch(/^The garden refused the stone: /);
    expect(getAnswer(404)).toBe("No garden is planted here yet.");
    expect(getAnswer(503)).toMatch(/busy/);
    expect(getAnswer(0)).toBe("The garden could not be reached.");
    expect(getAnswer(500)).toMatch(/answered 500/);
  });
});

describe("talking to the coordinator", () => {
  it("reads Retry-After only as a count of seconds", () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs(undefined)).toBeNull();
    expect(retryAfterMs("")).toBeNull();
    expect(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
    expect(retryAfterMs("1")).toBe(1000);
    expect(retryAfterMs(" 0 ")).toBe(0);
  });

  it("a request whose body never finishes counts as no answer, within the deadline", async () => {
    vi.useFakeTimers();
    const hanging = (async () => ({ status: 200, headers: new Headers(), json: () => new Promise(() => {}) }) as unknown as Response);
    const pending = requestJson(hanging, "/x", {}, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ status: 0, json: null, headers: null });
    const never = requestJson(() => new Promise(() => {}), "/x", {}, 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(never).resolves.toMatchObject({ status: 0 });
    vi.useRealTimers();
    const ok = await requestJson(async () => new Response('{"a":1}', { status: 201 }), "/x", {}, 1000);
    expect(ok).toMatchObject({ status: 201, json: { a: 1 } });
    expect((await requestJson(async () => new Response("<html>", { status: 502 }), "/x", {}, 1000)).json).toBeNull();
    expect(await requestJson(async () => { throw new TypeError("offline"); }, "/x", {}, 1000)).toEqual({ status: 0, json: null, headers: null });
  });
});

describe("times and sources", () => {
  it("relative times come from the response, not the visitor's clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    const v = view();
    expect(stateWords(v, fmt).sentence).toMatch(/slept 1 day and 14 hours\.$/);
    expect(fmtDuration(v.pace.nextDawnAt - v.now)).toBe("2 hours and 51 minutes");
    const p = landingPreview(v);
    expect(p.open && p.earliest).toEqual({ notBefore: 1792800000000 });
  });

  it("source resolution", () => {
    const at = (search: string, dev = false) => resolveSource(search, "http://localhost:5174", dev);
    expect(at("")).toMatchObject({ base: "", coordinator: "http://localhost:5174", garden: null, mock: false, viewUrl: "/api/public/garden", lettersUrl: "/api/public/garden/letters", notes: [] });
    expect(at("?coordinator=http://localhost:4100")).toMatchObject({ base: "http://localhost:4100", coordinator: "http://localhost:4100", viewUrl: "http://localhost:4100/api/public/garden" });
    expect(at("?coordinator=https://example.org/")).toMatchObject({ base: "https://example.org" });
    for (const bad of ["javascript:alert(1)", "http://localhost:4100/api", "ftp://x.org", "http://a@b.org", "http://x.org?y=1", "nonsense"]) {
      const s = at(`?coordinator=${encodeURIComponent(bad)}`);
      expect(s.base, bad).toBe("");
      expect(s.notes.length, bad).toBe(1);
    }
    expect(at("?garden=pond-2")).toMatchObject({ garden: "pond-2", viewUrl: "/api/public/gardens/pond-2", lettersUrl: "/api/public/gardens/pond-2/letters" });
    expect(at("?garden=../admin")).toMatchObject({ garden: null, viewUrl: "/api/public/garden" });
    expect(at("?garden=Commons").notes).toHaveLength(1);
    expect(at("?mock=1")).toMatchObject({ mock: false, notes: ["The example garden is only in the development build, so this page reads the live garden."] });
    expect(at("?mock=1", true)).toMatchObject({ mock: true, coordinator: "mock" });
  });

  it("only the contract's checkpoint path becomes a link", () => {
    const src = resolveSource("", "http://localhost:5174", false);
    expect(checkpointHref(src, view())).toBe("/api/public/gardens/commons/checkpoints/4e0b7a19c3d2f856");
    expect(checkpointHref(resolveSource("?coordinator=http://localhost:4100", "http://x", false), view())).toBe("http://localhost:4100/api/public/gardens/commons/checkpoints/4e0b7a19c3d2f856");
    expect(checkpointHref(src, view((v) => { v.fork.checkpoint = "javascript:alert(1)"; }))).toBeNull();
    expect(checkpointHref(src, view((v) => { v.fork.checkpoint = "//evil.example/x"; }))).toBeNull();
  });
});

describe("food (docs/garden-food-2026-10-18.md)", () => {
  it("the fixture parses with food; a view without food parses as food off; a malformed food is refused by path", () => {
    const v = view();
    expect(v.food?.enabled).toBe(true);
    expect(v.food?.foods[0].id).toBe("food-1");
    expect(v.days.map((d) => d.food)).toEqual([null, "food-1", null]);

    const old = copy();
    delete old.food;
    for (const d of old.days) delete d.food;
    const parsed = parseGarden(old);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(foodWords(parsed.view, fmt)).toBeNull();

    const reason = (mutate: (v: Record<string, any>) => void) => { const x = copy(); mutate(x); const p = parseGarden(x); return p.ok ? "ok" : p.reason; };
    expect(reason((x) => { x.food.hands = "two"; })).toMatch(/^food\.hands: expected a number/);
    expect(reason((x) => { x.food.foods[0].calledAt = 1.5; })).toMatch(/^food\.foods\[0\]\.calledAt: expected a time/);
    expect(reason((x) => { delete x.food.open; })).toMatch(/^food\.open: missing/);
    expect(reason((x) => { x.days[1].food = 7; })).toMatch(/^days\[1\]\.food: expected a string/);
    expect(reason((x) => { x.food = null; })).toMatch(/^food: expected an object/);
    // Keys the food block gained later are read with the coordinator's fallbacks when absent.
    const older = copy();
    delete older.food.sharedAddress;
    for (const f of older.food.foods) delete f.noticeUntil;
    const read = parseGarden(older);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.view.food!.sharedAddress).toBe(false);
      for (const f of read.view.food!.foods) expect(f.noticeUntil).toBe(f.calledAt + read.view.pace.dawnPeriodMs);
    }
    expect(reason((x) => { x.food.sharedAddress = "yes"; })).toMatch(/^food\.sharedAddress: expected/);
    expect(reason((x) => { x.food.foods[0].noticeUntil = null; })).toMatch(/^food\.foods\[0\]\.noticeUntil: expected a time/);
  });

  it("the ask in words: open, cooldown, off, stopped and an unknown reason", () => {
    const open = foodWords(view(), fmt)!;
    expect(open.headline).toBe("2 of 5 networks have asked today.");
    expect(open).toMatchObject({ hands: 2, asks: 5, open: true, closed: null });
    expect(open.timeLeft).toBe("Today’s hands expire at the next dawn, in 2 hours and 51 minutes (24 Oct 2026, 00:00 UTC), unless 3 more networks ask before then.");
    expect(open.landing).toBe("A food called now would land at step 524,288, the end of day 3, at the centre (256, 256): 16 quanta of nutrient per cell over a disc of radius 32.");
    expect(open.why).toMatch(/^Food is the one thing that adds matter to this closed world, so it is kept rare on purpose\./);
    expect(open.why).toMatch(/only when 5 networks ask within one dawn, at most once every 2 days, as one modest feed at the centre \(256, 256\), and a called food waits a whole dawn period before its day is run/);
    expect(foodWords(view((v) => { v.food.hands = 1; }), fmt)!.headline).toBe("1 of 5 networks has asked today.");
    expect(foodWords(view((v) => { v.food.hands = 4; }), fmt)!.timeLeft).toMatch(/unless 1 more network ask before then\.$/);
    expect(foodWords(view((v) => { v.food.hands = 0; }), fmt)!.timeLeft).toMatch(/unless 5 networks ask before then\.$/);
    expect(open.why).toMatch(/The keeper’s guess is that a garden fed at will grows fat and dull and that hunger is what makes it build; nobody has tested that yet\./);
    expect(open.why).toMatch(/one person with several connections can be several/);
    expect(open.why).not.toMatch(/hunger is what makes it build\. So/);
    expect(open.shared).toBeNull();

    // A garden whose dawn is not daily says "this dawn period", never "today".
    const quick = view((v) => { v.pace.dawnPeriodMs = 1000; });
    expect(periodWords(quick)).toBe("this dawn period");
    expect(foodWords(quick, fmt)!.headline).toBe("2 of 5 networks have asked this dawn period.");
    expect(foodWords(quick, fmt)!.timeLeft).toMatch(/^This dawn period’s hands expire at the next dawn/);
    expect(foodWords(quick, fmt)!.why).not.toMatch(/today/);

    // Every visitor one address (D-17): said in plain words.
    expect(foodWords(view((v) => { v.food.sharedAddress = true; }), fmt)!.shared).toMatch(/^Right now every visitor reaches this garden through one shared address/);

    const cooldown = foodWords(view((v) => { Object.assign(v.food, { open: false, closed: "cooldown", opensAtDay: 9, landing: null }); }), fmt)!;
    expect(cooldown).toMatchObject({ open: false, closed: "A food lands at most once every 2 days: the next can land on day 9 at the earliest." });
    expect(cooldown.landing).toBe(cooldown.closed);
    // Closed: no count of zero and no expiry line; a waiting food is the headline.
    expect(cooldown.headline).toBe("The food ask is closed just now.");
    expect(cooldown.timeLeft).toBe("");
    const waiting = foodWords(view((v) => {
      Object.assign(v.food, { open: false, closed: "cooldown", opensAtDay: 5, landing: null, hands: 0 });
      v.food.foods.unshift({ ...v.food.foods[0], id: "food-2", day: 3, landsAtStep: 524288, status: "waiting", landedIn: null });
    }), fmt)!;
    expect(waiting.headline).toBe("A food is waiting: food-2 lands at step 524,288, the end of day 3. Hands count again once the ask reopens.");

    const off = view((v) => { v.food = { ...v.food, enabled: false, asks: null, everyDays: null, amount: null, r: null, place: null, hands: 0, open: false, closed: "off", landing: null, foods: [] }; });
    expect(foodWords(off, fmt)).toBeNull();
    expect(foodClosedWords(off.food!)).toBe("This garden takes no food.");

    const stopped = foodWords(view((v) => { Object.assign(v.food, { open: false, closed: "stopped", landing: null }); }), fmt)!;
    expect(stopped.closed).toBe("The garden has stopped, so it takes no food until the keeper looks.");
    for (const [code, words] of [["finished", /horizon is done/], ["horizon", /No day is left/], ["log-full", /log is full/], ["<b>new</b>", /The garden says “<b>new<\/b>”, a reason new to this page\./]] as const) {
      expect(foodWords(view((v) => { Object.assign(v.food, { open: false, closed: code, landing: null }); }), fmt)!.closed, code).toMatch(words);
    }
    // Open without a landing is not open.
    expect(foodWords(view((v) => { v.food.landing = null; }), fmt)!.open).toBe(false);
  });

  it("a hand's answer in words, for every documented status", () => {
    const v = view();
    const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });
    const block = { ...v.food, hands: 3 };
    expect(handAnswer(201, { counted: true, called: null, food: block }, null, v)).toEqual({ tone: "note", refresh: true, in: true, expiresAt: 1792800000000, words: "Your hand is in. 3 of 5 networks have asked today." });
    // A hand that crossed a dawn on its way belongs to the answer's period, not the page's last reading.
    expect(handAnswer(200, { counted: false, called: null, food: { ...block, expiresAt: 1792886400000 } }, null, v).expiresAt).toBe(1792886400000);
    const called = handAnswer(201, { counted: true, called: { ...v.food!.foods[0], id: "food-2", day: 3, landsAtStep: 524288 }, food: { ...block, hands: 0 } }, null, v);
    expect(called).toMatchObject({ refresh: true, in: true, food: { id: "food-2", day: 3, landsAtStep: 524288 } });
    expect(called.words).toBe("Yours was the hand that called the food: food-2 is public now, lands at step 524,288 (end of day 3), and counts once a second island replays that day.");
    expect(handAnswer(201, null, null, v).words).toBe("Your hand is in.");
    expect(handAnswer(200, { counted: false, called: null, food: block }, null, v)).toMatchObject({ in: true, words: "A hand from your network was already in for today: one hand per network per dawn. 3 of 5 networks have asked today." });
    // After a call the ask is closed: no count of zero, and with a shared address it may be someone else's hand.
    expect(handAnswer(200, { counted: false, called: null, food: { ...block, hands: 0, open: false, closed: "cooldown", sharedAddress: true } }, null, v).words)
      .toBe("A hand from your network was already in for today: one hand per network per dawn. Every visitor shares one address just now, so it may be someone else’s.");
    expect(handAnswer(409, { error: "a food lands at most once every 2 days; the next can land on day 9 at the earliest", closed: "cooldown", opensAtDay: 9 }, null, v))
      .toMatchObject({ in: false, refresh: true, words: "The food ask is closed: a food lands at most once every 2 days; the next can land on day 9 at the earliest." });
    expect(handAnswer(422, { error: "a hand is exactly {}: it carries nothing" }, null, v).words).toBe("The garden refused the hand: a hand is exactly {}: it carries nothing.");
    expect(handAnswer(429, { retryAfterMs: 1_500_000 }, headers({ "retry-after": "1500" }), v).words)
      .toBe("The garden is not taking hands from this network just now: it takes at most 3 letters and hands an hour from one network, together, and fewer when many are refused. Try again in 25 minutes.");
    expect(handAnswer(429, null, headers({ "retry-after": "120" }), v).words).toMatch(/Try again in 2 minutes\.$/);
    expect(handAnswer(429, null, headers({}), v).words).toMatch(/Try again later\.$/);
    for (const code of [413, 415]) expect(handAnswer(code, null, null, v).words).toMatch(/Reload the page and try again\./);
    expect(handAnswer(404, null, null, v).words).toBe("There is no garden by that name here.");
    expect(handAnswer(503, null, null, v)).toMatchObject({ in: false, words: "The garden is busy; try again in a moment. Your hand was not counted." });
    expect(handAnswer(503, { error: "the garden is busy; retry shortly", counted: false }, null, v).words).toMatch(/Your hand was not counted\.$/);
    // The Queue did not answer: the hand may still count.
    expect(handAnswer(503, { error: "the garden is busy; retry shortly", counted: null }, null, v)).toMatchObject({ in: false, refresh: true, words: "The garden was too busy to answer, so this page cannot tell whether your hand was counted. The count below is read again: a second hand from this network is never counted twice." });
    expect(handAnswer(0, null, null, v)).toMatchObject({ refresh: true, in: false, words: "No answer came back, so this page cannot tell whether your hand was counted. The count below is read again: a second hand from this network is never counted twice." });
    expect(handAnswer(502, "<html>", null, v).words).toMatch(/^The garden answered 502, so this page cannot tell whether your hand was counted\./);
  });

  it("a day held for a food's notice is said as held, not asleep", () => {
    const held = view((v) => {
      // Day 3 is the ready day in the fixture ("Asleep: day 3 is ready").
      v.food.foods.unshift({ ...v.food.foods[0], id: "food-2", day: 3, status: "waiting", landedIn: null, noticeUntil: v.now + 7_200_000 });
    });
    const w = stateWords(held, fmt);
    expect(w.label).toBe("Holding for the food");
    expect(w.sentence).toBe(`Holding: day 3 carries the food food-2, so no island is given it before ${fmtTime(held.now + 7_200_000, fmt.locale, fmt.timeZone)}, in 2 hours; until then the keeper can still set the food aside.`);
    // Past the notice it is the ordinary story again.
    const past = view((v) => {
      v.food.foods.unshift({ ...v.food.foods[0], id: "food-2", day: 3, status: "waiting", landedIn: null, noticeUntil: v.now });
    });
    expect(stateWords(past, fmt).label).toBe(stateWords(view(), fmt).label);
  });

  it("a waiting food's veto window in words", () => {
    const v = view();
    const f = { status: "waiting", noticeUntil: v.now + 3_600_000 };
    expect(foodNoticeWords(f, v.now, fmt)).toBe(`Its day is not run before ${fmtTime(v.now + 3_600_000, fmt.locale, fmt.timeZone)}, in 1 hour, so the keeper can still set it aside.`);
    expect(foodNoticeWords({ ...f, noticeUntil: v.now }, v.now, fmt)).toBeNull();
    expect(foodNoticeWords({ ...f, status: "sealed" }, v.now, fmt)).toBeNull();
  });

  it("the tab's hand latch: one garden, until its dawn, and dropped when the server forgot the hand", () => {
    const v = view();
    const latch = { name: v.name, since: v.now - 1000, until: v.now + 60_000 };
    expect(latchHolds(latch, v)).toBe(true);
    expect(latchHolds(null, v)).toBe(false);
    expect(latchHolds(latch, null)).toBe(false);
    // Another garden in the same tab.
    expect(latchHolds({ ...latch, name: "elsewhere" }, v)).toBe(false);
    // Its dawn has come.
    expect(latchHolds({ ...latch, until: v.now }, v)).toBe(false);
    // A count of zero: a food called since the hand explains it; nothing does after a restart.
    const zero = view((x) => { x.food.hands = 0; });
    expect(latchHolds(latch, zero)).toBe(false);
    const called = view((x) => { x.food.hands = 0; x.food.foods[0].calledAt = x.now; });
    expect(latchHolds(latch, called)).toBe(true);
    expect(latchHolds(latch, view((x) => { delete x.food; }))).toBe(false);
    // A view read before the hand was answered (the one it was sent from, or a poll on its way) cannot show it
    // forgotten: its zero count may predate the hand. Its dawn and garden still count.
    expect(latchHolds(latch, zero, false)).toBe(true);
    expect(latchHolds({ ...latch, until: v.now }, zero, false)).toBe(false);
    expect(latchHolds({ ...latch, name: "elsewhere" }, zero, false)).toBe(false);
  });

  it("the hands route sits beside the letters route", () => {
    expect(resolveSource("", "http://x", false).handsUrl).toBe("/api/public/garden/food/hands");
    expect(resolveSource("?garden=pond-2&coordinator=http://localhost:4100", "http://x", false).handsUrl).toBe("http://localhost:4100/api/public/gardens/pond-2/food/hands");
    expect(gardenHtml).toMatch(/<button id="food-send" class="button primary" type="button"/);
    expect(gardenHtml).toMatch(/<section class="garden-row" id="g-food-row" aria-labelledby="h-food" hidden>/);
  });

  // The coordinator founds a garden with food only if the worst case fits MATTER_MAX, with a start allowance of 128
  // quanta per cell and a food radius the runner never clamps (apps/coordinator/lib/coordinator/queue.ex). Both are
  // assumptions about the garden presets, checked here against packages/schema.
  it("garden presets fit the coordinator's food bound", () => {
    const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    const queue = read("../../coordinator/lib/coordinator/queue.ex");
    const num = (src: string, re: RegExp) => { const m = src.match(re); if (!m) throw new Error(`no ${re}`); return Number(m[1].replace(/_/g, "")); };
    expect(num(queue, /@matter_max ([\d_]+)/)).toBe(MATTER_MAX);
    const perCell = num(queue, /@start_matter_per_cell ([\d_]+)/);
    expect(perCell).toBe(128);
    const config = read("../../coordinator/config/config.exs");
    const radius = num(config, /garden_food_radius: ([\d_]+)/);
    const presetsIn = (src: string) => { const m = src.match(/garden_presets: ~w\(([^)]*)\)/); if (!m) throw new Error("no garden_presets"); return m[1].split(/\s+/).filter(Boolean); };
    const ids = new Set([...presetsIn(config), ...presetsIn(read("../../coordinator/config/dev.exs"))]);
    expect([...ids].sort()).toEqual(["spots", "wild-storm-large"]);
    for (const id of ids) {
      const preset = PRESETS.find((p) => p.id === id)!;
      const cfg = { ...defaultConfig(), ...preset.cfg, seed: 1 };
      const matter = totalsOf(cfg, initWorld(cfg, preset.init).cells).matter;
      expect(matter <= BigInt(cellCount(cfg) * perCell), `${id}: ${matter} quanta at the start`).toBe(true);
      expect(maxLesionRadius(cfg), id).toBeGreaterThanOrEqual(Math.max(32, radius));
    }
  });
});

describe("meteor (docs/garden-meteor-2026-10-18.md)", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  /** The fixture with the meteor ask open for day 9, two hands in. */
  const openAsk = (v: Record<string, any>) => {
    Object.assign(v.meteor, { open: true, closed: null, opensAtDay: null, landing: { day: 9, step: 1310720 }, hands: 2 });
  };

  it("the fixture parses with meteor", () => {
    const v = view();
    expect(v.meteor).toMatchObject({ enabled: true, asks: 5, everyDays: 7, r: 64, place: { x: 337, y: 440 }, closed: "cooldown", opensAtDay: 9 });
    expect(v.meteor!.meteors.map((m) => [m.id, m.day, m.status, m.x, m.y])).toEqual([["meteor-1", 2, "landed", 497, 403]]);
    expect(v.days.map((d) => d.meteor)).toEqual(["meteor-1", null, null]);
  });

  it("a view without meteor parses as off", () => {
    const old = copy();
    delete old.meteor;
    for (const d of old.days) delete d.meteor;
    const parsed = parseGarden(old);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.view.meteor).toBeUndefined();
      expect(meteorWords(parsed.view, fmt)).toBeNull();
      expect(latchHolds({ name: parsed.view.name, since: 0, until: parsed.view.now + 1 }, parsed.view, true, "meteor")).toBe(false);
    }
    // Off as the coordinator sends it: no section either.
    expect(meteorWords(view((v) => { v.meteor = { ...v.meteor, enabled: false, asks: null, everyDays: null, r: null, place: null, hands: 0, open: false, closed: "off", opensAtDay: null, landing: null, meteors: [] }; }), fmt)).toBeNull();
  });

  it("a malformed meteor block is refused with its path", () => {
    const reason = (mutate: (v: Record<string, any>) => void) => {
      const v = copy();
      mutate(v);
      const parsed = parseGarden(v);
      return parsed.ok ? "parsed" : parsed.reason;
    };
    expect(reason((x) => { x.meteor.hands = "two"; })).toMatch(/^meteor\.hands: expected a number/);
    expect(reason((x) => { x.meteor.meteors[0].calledAt = 1.5; })).toMatch(/^meteor\.meteors\[0\]\.calledAt: expected a time/);
    expect(reason((x) => { delete x.meteor.meteors[0].noticeUntil; })).toMatch(/^meteor\.meteors\[0\]\.noticeUntil: missing/);
    expect(reason((x) => { delete x.meteor.sharedAddress; })).toMatch(/^meteor\.sharedAddress: missing/);
    expect(reason((x) => { x.meteor.place = { x: 1 }; })).toMatch(/^meteor\.place\.y: missing/);
    expect(reason((x) => { x.days[0].meteor = 7; })).toMatch(/^days\[0\]\.meteor: expected a string/);
    expect(reason((x) => { x.meteor = null; })).toMatch(/^meteor: expected an object/);
    // Added keys are ignored, as anywhere in the contract.
    expect(reason((x) => { x.meteor.later = 1; x.meteor.meteors[0].later = 1; })).toBe("parsed");
  });

  it("discCells(64) is 12,853", () => {
    expect(discCells(64)).toBe(12_853);
    expect(discCells(0)).toBe(1);
    expect(discCells(1)).toBe(5);
    expect(discCells(32)).toBe(3_209);
    // The same rule as applyLesion: dx^2 + dy^2 <= r^2, counted the slow way.
    let slow = 0;
    for (let dy = -40; dy <= 40; dy++) for (let dx = -40; dx <= 40; dx++) if (dx * dx + dy * dy <= 40 * 40) slow++;
    expect(discCells(40)).toBe(slow);
  });

  it("meteor words in each state, with and without the readings", () => {
    const open = meteorWords(view(openAsk), fmt)!;
    expect(open.open).toBe(true);
    expect(open.headline).toBe("2 of 5 networks have asked today.");
    expect(open.landing).toBe("A meteor called now would land at step 1,310,720, the end of day 9, at (337, 440), a stone of radius 64.");
    expect(open.timeLeft).toMatch(/^Today’s hands expire at the next dawn, in 2 hours and 51 minutes \(.+\), unless 3 more networks ask before then\.$/);
    expect(open.closed).toBeNull();
    expect(open.what).toBe("A meteor is a stone of radius 64: where it lands, every body in a disc of 12,853 cells (4.9% of this world) turns to waste and its stored energy to heat. It lands at a place fixed before anyone asks, (337, 440) for the next one, never one a visitor picks, and chosen without looking at what lives there, so its disc may hold many bodies, few or none. “Meteor” is only this letter’s name for a large stone; it promises no lasting change.");
    expect(open.why).toMatch(/^A meteor is the one large act a visitor can ask for, so it is kept rare: it comes only when 5 networks ask within one dawn, at most once every 7 days, and a called meteor waits a whole dawn period/);
    expect(open.why).toMatch(/Hands are counted per network, not per person/);
    expect(open.shared).toBeNull();
    expect(meteorWords(view((v) => { openAsk(v); v.meteor.sharedAddress = true; }), fmt)!.shared).toMatch(/^Right now every visitor reaches this garden through one shared address/);
    expect(meteorWords(view((v) => { openAsk(v); v.meteor.hands = 1; }), fmt)!.headline).toBe("1 of 5 networks has asked today.");

    // The fixture: closed for its cooldown.
    const cooldown = meteorWords(view(), fmt)!;
    expect(cooldown).toMatchObject({ open: false, timeLeft: "", headline: "The meteor ask is closed just now.", closed: "A meteor lands at most once every 7 days: the next can land on day 9 at the earliest." });
    expect(cooldown.landing).toBe(cooldown.closed);
    const waiting = meteorWords(view((v) => {
      v.meteor.meteors.unshift({ ...v.meteor.meteors[0], id: "meteor-2", day: 3, x: 337, y: 440, landsAtStep: 524288, status: "waiting", landedIn: null });
    }), fmt)!;
    expect(waiting.headline).toBe("A meteor is waiting: meteor-2 lands at (337, 440) at step 524,288, the end of day 3. Hands count again once the ask reopens.");
    for (const [code, words] of [
      ["stopped", /^The garden has stopped, so it takes no meteor/],
      ["finished", /no day left for a meteor\.$/],
      ["horizon", /^No day is left before the horizon that a meteor could land on\.$/],
      ["log-full", /^The garden’s log is full\.$/],
      ["later", /^The garden says “later”, a reason new to this page\.$/],
    ] as const) {
      expect(meteorWords(view((v) => { Object.assign(v.meteor, { open: false, closed: code, opensAtDay: null, landing: null }); }), fmt)!.closed, code).toMatch(words);
    }
    expect(meteorClosedWords({ ...view().meteor!, closed: "off" })).toBe("This garden takes no meteor.");

    // The readings: only on the big storm at radius 64.
    const reading = open.reading;
    expect(reading).toMatch(/^What a stone this size did, as far as anyone has looked: in twin worlds of this big storm founded as the commons was \(one feed at the centre at step 0, radius 255, 16 quanta per cell; as this garden was too\), forked early, at steps 131,072 to 393,216, a radius-64 stone’s neighbourhood stayed more different from its undisturbed twin than the rest of the jar for a median of about 35,800 steps \(from about 2,000 to about 68,600, over nine pairs\), about 27% of a day here\./);
    expect(reading).toMatch(/that is a mark with no lasting effect, not a lasting change\. Those stones were each aimed at a living cell; a meteor’s place is not, so it may clear less\./);
    expect(reading).toMatch(/A one-cell nudge in the same checkpoint worlds, at a separately chosen cell, stayed distinguishable for a median of about 9,200 steps, so by that rule the stone read as a stone effect: its mark outlasted a one-cell change’s, which the size of the change alone could explain\./);
    expect(reading).toMatch(/Pair by pair, the nudge lasted at least half as long as the stone in five of nine, and in the worlds forked at step 262,144 it outlasted the stone in all three histories\./);
    expect(reading).toMatch(/In the first 8,192 steps after the stones in the worlds forked at step 131,072, the stone’s summed excess of difference near it over the rest of the jar was more than twice the nudge’s in two of three histories, not all three\./);
    expect(reading).not.toMatch(/drift|same places|founded as this one was/);
    // A big-storm garden founded otherwise still gets the readings, saying they were not taken in a world founded like it.
    for (const other of [
      (v: Record<string, any>) => { v.founding = [{ step: 0, kind: "lesion", x: 0, y: 0, r: 1 }]; },
      (v: Record<string, any>) => { v.founding[0].amount = 32; },
      (v: Record<string, any>) => { v.founding.push({ step: 0, kind: "feed", x: 10, y: 10, r: 4, amount: 16 }); },
    ]) {
      expect(meteorReadingWords(view(other))).toMatch(/radius 255, 16 quanta per cell; not as this garden was\), forked early/);
    }
    expect(reading).toMatch(/Three histories, one of them a carpet; one founding; the measure saturates; and no null stone of this size could be placed\./);
    expect(reading).toMatch(/These are what rules written before the runs said, not settled facts about this garden\.$/);
    expect(METEOR_READ).toEqual({ presetId: "wild-storm-large", r: 64, medianSteps: 35_839, founding: { step: 0, kind: "feed", x: 256, y: 256, r: 255, amount: 16 } });
    const nobody = "Nobody has yet measured what a stone of this size does in this world.";
    expect(meteorWords(view((v) => { openAsk(v); v.presetId = "spots"; }), fmt)!.reading).toBe(nobody);
    expect(meteorWords(view((v) => { openAsk(v); v.meteor.r = 96; }), fmt)!.reading).toBe(nobody);
    expect(meteorReadingWords(view((v) => { delete v.meteor; }))).toBe(nobody);
    // A short test day says the median in days.
    expect(meteorReadingWords(view((v) => { v.pace.stepsPerDay = 20; }))).toMatch(/about 1,792 days here\./);
    expect(meteorReadingWords(view((v) => { v.pace.stepsPerDay = 36_000; }))).toMatch(/about a day here\./);
    // Under half a percent is not rounded up to 1% (35,839 of 10,000,000 is 0.36%).
    expect(meteorReadingWords(view((v) => { v.pace.stepsPerDay = 10_000_000; }))).toMatch(/\), under 1% of a day here\./);
    expect(meteorReadingWords(view((v) => { v.pace.stepsPerDay = 2_000_000; }))).toMatch(/\), about 2% of a day here\./);
    // A view that says open without a landing is said as closed, never as an empty line.
    const odd = meteorWords(view((v) => { Object.assign(v.meteor, { open: true, closed: null, landing: null }); }), fmt)!;
    expect(odd).toMatchObject({ open: false, closed: "The meteor ask is closed just now.", landing: "The meteor ask is closed just now." });
    const oddFood = foodWords(view((v) => { Object.assign(v.food, { open: true, closed: null, landing: null }); }), fmt)!;
    expect(oddFood).toMatchObject({ open: false, closed: "The food ask is closed just now.", landing: "The food ask is closed just now." });
  });

  it("a meteor hand's answer per status", () => {
    const v = view(openAsk);
    const block = { ...v.meteor, hands: 3 };
    expect(handAnswer(201, { counted: true, called: null, meteor: block }, null, v, "meteor")).toEqual({ tone: "note", refresh: true, in: true, expiresAt: 1792800000000, words: "Your hand is in. 3 of 5 networks have asked today." });
    // The food block of the answer is not read for a meteor hand.
    expect(handAnswer(201, { counted: true, called: null, food: block }, null, v, "meteor").words).toBe("Your hand is in.");
    const called = handAnswer(201, { counted: true, called: { ...v.meteor!.meteors[0], id: "meteor-2", day: 9, landsAtStep: 1310720, x: 337, y: 440 }, meteor: { ...block, hands: 0 } }, null, v, "meteor");
    expect(called).toMatchObject({ refresh: true, in: true, meteor: { id: "meteor-2", day: 9, landsAtStep: 1310720 } });
    expect(called.food).toBeUndefined();
    expect(called.words).toBe("Yours was the hand that called the meteor: meteor-2 is public now, lands at (337, 440) at step 1,310,720 (end of day 9), and counts once a second island replays that day.");
    expect(handAnswer(200, { counted: false, called: null, meteor: block }, null, v, "meteor")).toMatchObject({ in: true, words: "A hand from your network was already in for today: one hand per network per dawn. 3 of 5 networks have asked today." });
    expect(handAnswer(409, { error: "a meteor lands at most once every 7 days; the next can land on day 9 at the earliest", closed: "cooldown", opensAtDay: 9 }, null, v, "meteor"))
      .toMatchObject({ in: false, refresh: true, words: "The meteor ask is closed: a meteor lands at most once every 7 days; the next can land on day 9 at the earliest." });
    expect(handAnswer(422, { error: "a hand is exactly {}: it carries nothing" }, null, v, "meteor").words).toBe("The garden refused the hand: a hand is exactly {}: it carries nothing.");
    expect(handAnswer(429, { retryAfterMs: 120_000 }, null, v, "meteor").words).toMatch(/^The garden is not taking hands from this network just now: .* Try again in 2 minutes\.$/);
    for (const code of [413, 415]) expect(handAnswer(code, null, null, v, "meteor").words).toMatch(/Reload the page and try again\./);
    expect(handAnswer(404, null, null, v, "meteor").words).toBe("There is no garden by that name here.");
    expect(handAnswer(503, { counted: false }, null, v, "meteor").words).toMatch(/Your hand was not counted\.$/);
    expect(handAnswer(503, { counted: null }, null, v, "meteor")).toMatchObject({ refresh: true, in: false, words: expect.stringMatching(/^The garden was too busy to answer/) });
    expect(handAnswer(0, null, null, v, "meteor").words).toMatch(/^No answer came back, so this page cannot tell whether your hand was counted\./);
  });

  it("the meteor latch: kept apart from the food one", () => {
    const v = view(openAsk);
    const latch = { name: v.name, since: v.now - 1000, until: v.now + 60_000 };
    expect(latchHolds(latch, v, true, "meteor")).toBe(true);
    // A meteor count of zero with no meteor called since: forgotten, whatever the food block says.
    const zero = view((x) => { openAsk(x); x.meteor.hands = 0; });
    expect(latchHolds(latch, zero, true, "meteor")).toBe(false);
    expect(latchHolds(latch, zero, true, "food")).toBe(true);
    const called = view((x) => { openAsk(x); x.meteor.hands = 0; x.meteor.meteors[0].calledAt = x.now; });
    expect(latchHolds(latch, called, true, "meteor")).toBe(true);
    expect(latchHolds(latch, zero, false, "meteor")).toBe(true);
  });

  it("a day held for a meteor's notice is said as held", () => {
    const held = view((v) => {
      v.meteor.meteors.unshift({ ...v.meteor.meteors[0], id: "meteor-2", day: 3, status: "waiting", landedIn: null, noticeUntil: v.now + 7_200_000 });
    });
    const w = stateWords(held, fmt);
    expect(w.label).toBe("Holding for the meteor");
    expect(w.sentence).toBe(`Holding: day 3 carries the meteor meteor-2, so no island is given it before ${fmtTime(held.now + 7_200_000, fmt.locale, fmt.timeZone)}, in 2 hours; until then the keeper can still set the meteor aside.`);
  });

  it("a day held for both a food and a meteor names both and the later notice", () => {
    for (const [food, meteor] of [[3_600_000, 7_200_000], [7_200_000, 3_600_000]]) {
      const both = view((v) => {
        v.meteor.meteors.unshift({ ...v.meteor.meteors[0], id: "meteor-2", day: 3, status: "waiting", landedIn: null, noticeUntil: v.now + meteor });
        v.food.foods.unshift({ ...v.food.foods[0], id: "food-9", day: 3, status: "waiting", droppedAt: null, noticeUntil: v.now + food });
      });
      const w = stateWords(both, fmt);
      expect(w.label).toBe("Holding for the food and the meteor");
      expect(w.sentence).toBe(`Holding: day 3 carries the food food-9 and the meteor meteor-2, so no island is given it before ${fmtTime(both.now + 7_200_000, fmt.locale, fmt.timeZone)}, in 2 hours; until then the keeper can still set either aside.`);
    }
  });

  it("the meteor hands route sits beside the food one", () => {
    expect(resolveSource("", "http://x", false).meteorHandsUrl).toBe("/api/public/garden/meteor/hands");
    expect(resolveSource("?garden=pond-2&coordinator=http://localhost:4100", "http://x", false).meteorHandsUrl).toBe("http://localhost:4100/api/public/gardens/pond-2/meteor/hands");
    expect(gardenHtml).toMatch(/<section class="garden-row" id="g-meteor-row" aria-labelledby="h-meteor" hidden>/);
    expect(gardenHtml).toMatch(/<h2 id="h-meteor">Ask for a meteor \(a large stone\)<\/h2>/);
    expect(gardenHtml).toMatch(/<button id="meteor-send" class="button primary" type="button"/);
    // The meteor row follows the food row.
    expect(gardenHtml.indexOf('id="g-meteor-row"')).toBeGreaterThan(gardenHtml.indexOf('id="g-food-row"'));
  });

  // The coordinator bounds a meteor's radius by the world's size, which equals the runner's maxLesionRadius only for
  // a world of one tile; and tools/stitch.ts compares a logged lesion with the clamped scheduled one, so a clamped
  // meteor would make the view's r a lie. Every garden preset is held to both here.
  it("every garden preset is one tile with maxLesionRadius at least garden_meteor_radius, and above 32", () => {
    const config = read("../../coordinator/config/config.exs");
    const m = config.match(/garden_meteor_radius: ([\d_]+)/);
    expect(m).not.toBeNull();
    const radius = Number(m![1].replace(/_/g, ""));
    expect(radius).toBe(64);
    expect(radius).toBeGreaterThan(32);
    const presetsIn = (src: string) => { const x = src.match(/garden_presets: ~w\(([^)]*)\)/); if (!x) throw new Error("no garden_presets"); return x[1].split(/\s+/).filter(Boolean); };
    const ids = new Set([...presetsIn(config), ...presetsIn(read("../../coordinator/config/dev.exs")), ...presetsIn(read("../../coordinator/config/test.exs"))]);
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) {
      const preset = PRESETS.find((p) => p.id === id)!;
      const cfg = { ...defaultConfig(), ...preset.cfg, seed: 1 };
      expect(worldW(cfg), `${id}: one tile across`).toBe(cfg.tileW);
      expect(worldH(cfg), `${id}: one tile down`).toBe(cfg.tileH);
      expect(maxLesionRadius(cfg), id).toBeGreaterThanOrEqual(radius);
      // The coordinator's own bound for this world (queue.ex `max_world_radius`) is the runner's.
      expect(Math.floor((Math.min(worldW(cfg), worldH(cfg)) - 1) / 2), id).toBe(maxLesionRadius(cfg));
    }
    expect(read("../../coordinator/lib/coordinator/queue.ex")).toMatch(/defp max_world_radius\(\{w, h\}\), do: div\(min\(w, h\) - 1, 2\)/);
  });
});

describe("the page is hidden", () => {
  it("has no canonical link, says noindex, is not in the sitemap and loads its module", () => {
    expect(pageMeta(gardenHtml)).toBeNull();
    expect(gardenHtml).toMatch(/<meta name="robots" content="noindex" \/>/);
    expect(sitemap).not.toMatch(/\/garden\//);
    expect(gardenHtml).toMatch(/<script type="module" src="\/garden\/main\.ts"><\/script>/);
    expect(gardenHtml).not.toMatch(/aria-current/);
    // The prediction panel says the answer can be worked out ahead (the note's third amendment, item 5).
    expect(gardenHtml).toMatch(/anyone can replay the next day before it is released/);
  });
});

describe("dawn predictions (docs/garden-predictions-2026-10-18.md)", () => {
  const subtle = globalThis.crypto.subtle;
  const D = 131072;
  /** Day 2 (the newest released) verified with an ok block of 100 living cells: the window for day 3 is open. */
  const day2Leaders = {
    status: "ok",
    census: {
      step: 3 * D, livingCells: 100, lineages: 7, clearLeader: "0:14",
      top: [
        { key: "0:14", label: "founder 14", cells: 50, share: 0.5 },
        { key: "0:3", label: "founder 3", cells: 30, share: 0.3 },
        { key: "48211:90377", label: "born step 48210 at 265,176", cells: 20, share: 0.2 },
      ],
    },
    lines: null,
  };
  const openMutate = (v: Record<string, any>) => {
    v.days[0].status = "verified"; v.days[0].verifiedAt = v.days[0].doneAt + 600_000; v.days[0].verification = "same-device-type";
    v.days[0].leaders = structuredClone(day2Leaders);
  };
  const openView = () => view(openMutate);
  /** Day 3 released after the guess, verified, with lines from day 2 (`winner`). */
  const day3 = (winner: string | null, over: Record<string, any> = {}) => (v: Record<string, any>) => {
    openMutate(v);
    v.clock.releasedStep = 4 * D;
    v.days.unshift({
      ...structuredClone(v.days[0]), day: 3, startStep: 3 * D, endStep: 4 * D, releasedAt: v.now + 3_600_000, doneAt: v.now + 4_000_000,
      verifiedAt: v.now + 5_000_000, digest: "aa00bb11cc22dd33", letters: [], food: null,
      leaders: {
        status: "ok",
        census: { step: 4 * D, livingCells: 200, lineages: 9, clearLeader: null, top: [{ key: "400001:5", label: "born step 400000 at 5,0", cells: 30, share: 0.15 }] },
        lines: {
          fromDay: 2,
          groups: [
            { key: "0:14", label: "founder 14", cells: 60, share: 0.3 },
            { key: "0:3", label: "founder 3", cells: 20, share: 0.1 },
            { key: "48211:90377", label: "born step 48210 at 265,176", cells: 10, share: 0.05 },
          ],
          rest: { cells: 110, share: 0.55 }, winner,
        },
      },
      ...over,
    });
  };
  const hasher = (body: ReceiptBody) => receiptHash(body, subtle);
  const receiptFor = async (choice: string, v: GardenView = openView()) => {
    const made = await makeReceipt(v, choice, subtle);
    if (!made.ok) throw new Error(made.words);
    return made.receipt;
  };

  it("the fixture parses with leaders; a view without them parses with the panel off; a malformed block is refused by path", () => {
    const v = view();
    expect(leadersOn(v)).toBe(true);
    expect(v.leadersRule).toEqual({ name: "lines-v1", top: 3, clearLeaderPercent: 10 });
    expect(v.days.map((d) => d.leaders?.status ?? null)).toEqual([null, "ok", "ok"]);
    expect(v.days[1].leaders?.lines?.winner).toBe("0:14");
    const old = view((x) => { delete x.leadersRule; for (const d of x.days) delete d.leaders; });
    expect(leadersOn(old)).toBe(false);
    expect(predictionWindow(old)).toMatchObject({ open: false, reason: "no-leaders" });
    const reason = (mutate: (x: Record<string, any>) => void) => { const c = copy(); mutate(c); const p = parseGarden(c); return p.ok ? "ok" : p.reason; };
    expect(reason((x) => { x.days[1].leaders.census.top[0].key = "x"; })).toBe("days[1].leaders.census.top[0].key: expected a lineage key");
    expect(reason((x) => { x.days[1].leaders.lines.winner = "nobody"; })).toBe("days[1].leaders.lines.winner: expected a lineage key");
    expect(reason((x) => { x.days[2].leaders.census = "x"; })).toBe("days[2].leaders.census: expected an object");
    expect(reason((x) => { x.leadersRule.top = 0; })).toBe("leadersRule.top: expected a positive number");
    expect(reason((x) => { x.days[1].leaders.lines.winner = "rest"; })).toBe("ok");
  });

  it("the window: open on a verified newest day, and each reason it is shut", () => {
    expect(predictionWindow(openView())).toMatchObject({ open: true, basis: 2, target: 3, digest: "9c41e07d2b5a8f13" });
    const shut = (mutate: (x: Record<string, any>) => void) => { const w = predictionWindow(view((x) => { openMutate(x); mutate(x); })); return w.open ? "open" : w.reason; };
    expect(predictionWindow(view())).toMatchObject({ open: false, reason: "basis-unverified", basis: 2 });
    expect(shut((x) => { x.state = "stopped"; })).toBe("stopped");
    expect(shut((x) => { x.state = "finished"; })).toBe("finished");
    expect(shut((x) => { x.clock.daysTotal = 3; })).toBe("horizon");
    expect(shut((x) => { x.days[0].leaders = { status: "pending", census: null, lines: null }; })).toBe("basis-pending");
    expect(shut((x) => { x.days[0].leaders = { status: "unchecked", census: null, lines: null }; })).toBe("basis-unchecked");
    expect(shut((x) => { x.days[0].leaders = { status: "unreadable", census: null, lines: null }; })).toBe("basis-unreadable");
    expect(shut((x) => { x.days[0].leaders.census = { step: 3 * D, livingCells: 0, lineages: 0, top: [], clearLeader: null }; })).toBe("nothing-living");
    expect(shut((x) => { x.days[0].leaders = null; })).toBe("basis-unverified");
    expect(windowWords(predictionWindow(view()))).toBe("Predictions open when the newest day is verified and the next is not yet released. Day 2 is not verified yet.");
    expect(windowWords(predictionWindow(view((x) => { openMutate(x); x.days[0].leaders.status = "pending"; })))).toBe("Day 2 is verified; its files are still being counted.");
    expect(windowWords(predictionWindow(openView()))).toBe("Guesses about day 3 are open until it is released to an island.");
    expect(windowWords(predictionWindow(view((x) => { openMutate(x); x.days[0].leaders = { status: "unreadable", census: null, lines: null }; })))).toBe("Day 2 is verified, but its files could not be read, so there are no numbers to guess from.");
    // A guess belongs to one window: another basis day, a recount that changed it, or a new planting is another.
    const id = (mutate: (x: Record<string, any>) => void) => { const v = view((x) => { openMutate(x); mutate(x); }); return windowId(v, predictionWindow(v)); };
    const base = id(() => {});
    expect(base).not.toBeNull();
    expect(id(() => {})).toBe(base);
    expect(id((x) => { x.now += 60_000; })).toBe(base);
    expect(id((x) => { x.days[0].digest = "0000000000000000"; })).not.toBe(base);
    expect(id((x) => { x.days[0].leaders.census.top[0].cells -= 1; })).not.toBe(base);
    expect(id((x) => { x.createdAt += 1; })).not.toBe(base);
    expect(id((x) => { x.state = "stopped"; })).toBeNull();
  });

  it("the receipt's canonical text and hash: a fixed vector, whatever the key order", async () => {
    const body: ReceiptBody = {
      v: 1, garden: "commons", createdAt: 1792454700000, madeAt: 1792789740000,
      basis: { day: 2, digest: "9c41e07d2b5a8f13", step: 393216, livingCells: 100, top: [["0:14", 50], ["0:3", 30], ["48211:90377", 20]] },
      target: 3, releasedStep: 393216,
    };
    expect(canonicalJson(body)).toBe('{"basis":{"day":2,"digest":"9c41e07d2b5a8f13","livingCells":100,"step":393216,"top":[["0:14",50],["0:3",30],["48211:90377",20]]},"createdAt":1792454700000,"garden":"commons","madeAt":1792789740000,"releasedStep":393216,"target":3,"v":1}');
    const vector = "f48b4db611e55c15e168b53e31070a42658a9739e448dfd761e40dbd4c5e6ccf";
    expect(await receiptHash(body, subtle)).toBe(vector);
    const shuffled = JSON.parse('{"target":3,"releasedStep":393216,"basis":{"top":[["0:14",50],["0:3",30],["48211:90377",20]],"step":393216,"livingCells":100,"digest":"9c41e07d2b5a8f13","day":2},"v":1,"madeAt":1792789740000,"garden":"commons","createdAt":1792454700000}') as ReceiptBody;
    expect(await receiptHash(shuffled, subtle)).toBe(vector);
    expect(await receiptHash(body, null)).toBeNull();
    // The page's own receipt for that view is this body, with the choice beside it.
    const r = await receiptFor("rest");
    expect(r).toMatchObject({ choice: "rest", target: 3, madeAt: fixture.now, basis: { day: 2, livingCells: 100 } });
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await makeReceipt(openView(), "9:9", subtle)).toEqual({ ok: false, words: "Choose one of the three lines, or the rest." });
    expect(await makeReceipt(openView(), "rest", null)).toMatchObject({ ok: false, words: expect.stringMatching(/receipts can’t be made/) });
    expect(await makeReceipt(view(), "rest", subtle)).toMatchObject({ ok: false, words: expect.stringMatching(/^Predictions open when/) });
  });

  it("checks a receipt row by row (the note's section 7)", async () => {
    const r = await receiptFor("rest");
    const top = await receiptFor("0:14");
    const words = async (rec: Receipt, mutate: (x: Record<string, any>) => void) => {
      const st = await settle(rec, view(mutate), hasher);
      return st.kind === "replanted" ? "replanted" : `${st.kind}: ${st.words}`;
    };
    expect(await words(r, (x) => { day3("rest")(x); x.createdAt += 1; })).toBe("replanted");
    expect(await words(r, (x) => { day3("rest")(x); x.days = x.days.filter((d: { day: number }) => d.day !== 2); })).toBe("old: Cannot be checked here: day 2 is older than the 3 days this garden lists.");
    // The hash is checked against the listed day B, so an edited hash or madeAt does not match; the copy of the basis
    // in the receipt is for reading only.
    expect(await words({ ...r, hash: "0".repeat(64) }, day3("rest"))).toBe("mismatch: Does not match the garden’s record of day 2.");
    expect(await words({ ...r, madeAt: r.madeAt - 1 }, day3("rest"))).toBe("mismatch: Does not match the garden’s record of day 2.");
    expect(await words(r, (x) => { day3("rest")(x); x.days[1].leaders.census.top[0].cells = 49; })).toBe("mismatch: Does not match the garden’s record of day 2.");
    expect(await words(r, day3("rest", { releasedAt: fixture.now }))).toBe("late: Made after day 3 was released; not counted.");
    expect(await words(r, day3("rest", { status: "diverged", leaders: null }))).toBe("stalled: Day 3 did not replay the same (or could not run); nothing to check.");
    expect(await words(r, openMutate)).toBe("waiting: Waiting: day 3 is not verified yet.");
    expect(await words(r, day3("rest", { status: "done", leaders: null }))).toBe("waiting: Waiting: day 3 is not verified yet.");
    expect(await words(r, day3("rest", { leaders: { status: "pending", census: null, lines: null } }))).toBe("waiting: Waiting: day 3 is not verified yet.");
    expect(await words(r, day3("rest", { leaders: { status: "unchecked", census: null, lines: null } }))).toBe("unchecked: Cannot be checked: the replay did not check day 3’s files.");
    expect(await words(r, day3("rest", { leaders: { status: "unreadable", census: null, lines: null } }))).toBe("unreadable: Cannot be checked: day 3’s files could not be read.");
    // Day 3 counted before day 2's lines could be: a recount is on its way, not a fault.
    expect(await words(r, (x) => { day3("rest")(x); x.days[0].leaders.lines = null; })).toBe("waiting: Waiting: day 3 is verified; the lines into it are still being counted.");
    expect(await words(r, (x) => { day3("rest")(x); x.days[0].leaders.lines.fromDay = 1; })).toBe("mismatch: Does not match the garden’s record of day 2.");
    // Day 2's count not there now (a recount, or the day run again) cannot be checked now; it is not a mismatch.
    expect(await words(r, (x) => { day3("rest")(x); x.days[1].leaders = { status: "pending", census: null, lines: null }; })).toBe("unavailable: Cannot be checked now: day 2’s count is not there just now (it is being counted again, or the day is being run again).");
    expect(await words(r, (x) => { day3("rest")(x); x.days[1].status = "done"; })).toMatch(/^unavailable: /);
    expect(await words(r, (x) => { day3("rest")(x); x.days[1].leaders = { status: "unreadable", census: null, lines: null }; })).toBe("unavailable: Cannot be checked now: day 2’s files could not be read when they were counted again.");
    expect(await words(r, day3("rest"))).toBe("held: Held: the rest held 55% of the field at day 3’s end. Day 3 was replayed here, not yet verified elsewhere.");
    expect(await words(top, day3("rest"))).toBe("missed: Did not hold: the rest held 55% of the field at day 3’s end. Day 3 was replayed here, not yet verified elsewhere.");
    expect(await words(top, day3("0:14"))).toBe("held: Held: the line of founder 14 (0:14) held 30% of the field at day 3’s end. Day 3 was replayed here, not yet verified elsewhere.");
    expect(await words(r, day3(null))).toBe("missed: Did not hold: no line held the field. Day 3 was replayed here, not yet verified elsewhere.");
    // The tone follows how day 3 was verified, as its chip does: a clean pass only on another device type.
    const tone = async (rec: Receipt, verification: string | null) => { const st = await settle(rec, view(day3("rest", { verification })), hasher); return st.kind === "replanted" ? null : [st.tone, st.words]; };
    expect(await tone(r, "different-device-type")).toEqual(["observed", "Held: the rest held 55% of the field at day 3’s end."]);
    expect(await tone(top, "different-device-type")).toEqual(["negative", "Did not hold: the rest held 55% of the field at day 3’s end."]);
    expect(await tone(r, "same-device-type")).toEqual(["note", "Held: the rest held 55% of the field at day 3’s end. Day 3 was replayed here, not yet verified elsewhere."]);
    expect(await tone(r, null)).toEqual(["note", "Held: the rest held 55% of the field at day 3’s end. Day 3 was replayed by a second island."]);
    // A receipt edited to another choice still matches its hash: the choice is beside it, and only its holder is fooled.
    expect(await words({ ...top, choice: "rest" }, day3("rest"))).toMatch(/^held:/);
    // A browser that cannot make the fingerprint (no crypto.subtle, or digest refused) cannot check: not a mismatch.
    const blind = await settle(r, view(day3("rest")), async () => null);
    expect(blind).toEqual({ kind: "unavailable", tone: "pending", words: "Cannot be checked in this browser: it cannot make the receipt’s fingerprint (it has no crypto.subtle here)." });
    const refused = await settle(r, view(day3("rest")), (body) => receiptHash(body, { digest: () => Promise.reject(new Error("no")) }));
    expect(refused.kind).toBe("unavailable");
  });

  it("an unstored receipt shows over a stored one for the same day only while storage holds what it replaced", async () => {
    const r = await receiptFor("rest");
    // Three guesses against one reading: the same hash and the same madeAt, told apart only by their ids.
    const a = await receiptFor("0:14");
    const b = await receiptFor("0:3");
    const c = await receiptFor("0:14");
    expect(new Set([a.hash, b.hash, c.hash, r.hash]).size).toBe(1);
    expect(new Set([a.madeAt, b.madeAt, c.madeAt]).size).toBe(1);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(a.id).toMatch(/^[0-9a-f]{32}$/);
    expect(receiptId(a)).toBe(a.id);
    // This tab replaced stored A with B but could not store B: B shows, and stays in the tab.
    expect(mergeReceipts([a], [{ receipt: b, over: receiptId(a) }])).toEqual({ all: [b], unkept: [{ receipt: b, over: receiptId(a) }] });
    // Another tab stored C since, with A's very choice, hash and time: C shows, and the tab forgets B.
    expect(mergeReceipts([c], [{ receipt: b, over: receiptId(a) }])).toEqual({ all: [c], unkept: [] });
    expect(mergeReceipts([{ ...c, madeAt: r.madeAt - 9 }], [{ receipt: b, over: receiptId(a) }]).unkept).toEqual([]);
    // B replaced nothing: a stored receipt for that day was written since, so it wins.
    expect(mergeReceipts([c], [{ receipt: b, over: null }]).all).toEqual([c]);
    // Nothing stored for that day (storage off, or it never held one): B shows.
    expect(mergeReceipts([], [{ receipt: b, over: null }]).all).toEqual([b]);
    // Storage later holds B itself: shown once.
    expect(mergeReceipts([b], [{ receipt: b, over: receiptId(a) }]).all).toEqual([b]);
    // Receipts stored before ids existed are told apart by hash, choice and time.
    const { id: _a, ...oldA } = a;
    const { id: _c, ...oldC } = { ...c, choice: "0:3" };
    expect(receiptId(oldA)).toBe(`${a.hash}:0:14:${a.madeAt}`);
    expect(mergeReceipts([oldA], [{ receipt: b, over: receiptId(oldA) }]).all).toEqual([b]);
    expect(mergeReceipts([oldC], [{ receipt: b, over: receiptId(oldA) }]).all).toEqual([oldC]);
    // Storage unreadable when B was made (over undefined), then readable holding A: B keeps showing, now over A.
    expect(mergeReceipts(null, [{ receipt: b, over: undefined }])).toEqual({ all: [b], unkept: [{ receipt: b, over: undefined }] });
    const back = mergeReceipts([a], [{ receipt: b, over: undefined }]);
    expect(back).toEqual({ all: [b], unkept: [{ receipt: b, over: receiptId(a) }] });
    // ... and a later stored guess from another tab still wins over it.
    expect(mergeReceipts([c], back.unkept)).toEqual({ all: [c], unkept: [] });
    expect(mergeReceipts([], [{ receipt: b, over: undefined }]).unkept).toEqual([{ receipt: b, over: null }]);
    // Newest first by madeAt across both lists, then the cap: an older unstored day sits behind newer stored days.
    const older = { ...b, target: r.target - 1, madeAt: r.madeAt - 100 };
    const newer = Array.from({ length: RECEIPTS_MAX }, (_, i) => ({ ...a, target: r.target + 1 + i, madeAt: r.madeAt + 1 + i })).reverse();
    const merged = mergeReceipts(newer, [{ receipt: older, over: null }]);
    expect(merged.all).toEqual(newer);
    expect(merged.unkept).toEqual([{ receipt: older, over: null }]);
    expect(mergeReceipts([a], [{ receipt: older, over: null }]).all).toEqual([a, older]);
    expect(addUnkept(addUnkept([], { receipt: a, over: null }), { receipt: b, over: null })).toEqual([{ receipt: b, over: null }]);
    expect(mergeReceipts([], [])).toEqual({ all: [], unkept: [] });
    expect(mergeReceipts(null, [])).toEqual({ all: [], unkept: [] });
  });

  it("keeps receipts on the device: newest first, one per day, at most 32, and survives storage that throws", async () => {
    const r = await receiptFor("rest");
    const again = { ...r, choice: "0:14", madeAt: r.madeAt + 1 };
    expect(addReceipt(addReceipt([], r), again)).toEqual([again]);
    const many = Array.from({ length: 40 }, (_, i) => ({ ...r, target: i + 3 }));
    const list = many.reduce<Receipt[]>((acc, x) => addReceipt(acc, x), []);
    expect(list).toHaveLength(RECEIPTS_MAX);
    expect(list[0].target).toBe(42);
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    const key = predictionKey("http://localhost:5173", "commons");
    expect(key).toBe("cadence-garden-predictions:http://localhost:5173:commons");
    expect(writeReceipts(storage, key, list)).toBe(true);
    expect(readReceipts(storage, key)).toEqual(list);
    store.set(key, JSON.stringify([r, { ...r, hash: "nope" }, { ...r, choice: "<b>" }, 7, null]));
    expect(readReceipts(storage, key)).toEqual([r]);
    store.set(key, "{");
    expect(readReceipts(storage, key)).toEqual([]);
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(readReceipts(throwing, key)).toEqual([]);
    // Storage that cannot be read is unknown, not empty; a list that does not parse is empty.
    expect(readStoredReceipts(throwing, key)).toBeNull();
    expect(readStoredReceipts(null, key)).toBeNull();
    expect(readStoredReceipts(storage, "cadence-garden-predictions:none")).toEqual([]);
    expect(readStoredReceipts(storage, key)).toEqual([]);
    // An id is optional (receipts stored before ids), and must be hex when there.
    const { id: _id, ...noId } = r;
    store.set(key, JSON.stringify([noId, { ...r, target: r.target + 1, id: "<x>" }]));
    expect(readReceipts(storage, key)).toEqual([noId]);
    expect(writeReceipts(throwing, key, list)).toBe(false);
    expect(writeReceipts(null, key, list)).toBe(false);
  });

  it("words for the field: a clear leader or none, the lines, and the garden's own tally", () => {
    const v = view();
    expect(leadersWords(v.days[2], v.leadersRule)).toBe("At the end of day 0, founder 14 (0:14) holds 16% of 61,240 living cells: a clear leader (at least 10% and more than any other key).");
    expect(leadersWords(v.days[1], v.leadersRule)).toBe("At the end of day 1, no key clearly leads: the biggest holds 7% of 58,410 living cells (a clear leader needs at least 10% and more than any other key).");
    expect(leadersWords({ day: 4, leaders: { status: "unchecked", census: null, lines: null } }, v.leadersRule)).toBe("Day 4 was verified without its files being checked, so it has no count.");
    // Whole percents never seem to meet the rule that was missed: 10 of 101 rounds to 10% but is under it, and a tie
    // for the most is named.
    const e = (key: string, cells: number) => ({ key, label: `founder ${key.slice(2)}`, cells, share: 0 });
    const block = (living: number, top: ReturnType<typeof e>[]) => ({ day: 5, leaders: { status: "ok", census: { step: 0, livingCells: living, lineages: top.length, top, clearLeader: null }, lines: null } });
    expect(leadersWords(block(101, [e("0:1", 10), e("0:2", 7)]), v.leadersRule)).toBe("At the end of day 5, no key clearly leads: the biggest holds just under 10% of 101 living cells (a clear leader needs at least 10% and more than any other key).");
    expect(leadersWords(block(100, [e("0:1", 30), e("0:2", 30)]), v.leadersRule)).toBe("At the end of day 5, no key clearly leads: the biggest holds 30% of 100 living cells and is tied with another key (a clear leader needs at least 10% and more than any other key).");
    expect(leadersWords(block(1000, [e("0:1", 94), e("0:2", 94)]), v.leadersRule)).toBe("At the end of day 5, no key clearly leads: the biggest holds 9% of 1,000 living cells (a clear leader needs at least 10% and more than any other key).");
    expect(linesWords(v.days[1].leaders!.lines!, 58410)).toBe("The line of founder 14 (0:14) held the field at the end of day 1: 52% of its living cells, counting day 0’s three biggest keys each with its mutants born on those two days.");
    expect(lineName("rest")).toBe("the rest");
    expect(lineName("9:9")).toBe("the line of 9:9");
    expect(fieldTally(v)).toEqual({ days: 1, rest: 0, top: 1, none: 0 });
    expect(tallyWords(v)).toBe("Of the 1 listed day with lines counted, the rest held the field on 0, one of the day before’s three biggest lines on 1.");
    expect(tallyWords(view((x) => { for (const d of x.days) d.leaders = null; }))).toBe("No listed day has its lines counted yet, so there is no tally.");
  });
});

describe("the sun switch (the sun note's amendment of 2026-10-18, slice 41)", () => {
  it("offers the sun form only when the garden takes suns", () => {
    expect(view().sun?.enabled).toBe(true);
    expect(sunOffered(view())).toBe(true);
    // Founded with suns off: the coordinator empties percents, but the page does not rely on it.
    expect(sunOffered(view((v) => { v.sun.enabled = false; v.sun.percents = []; v.sun.nextLanding = null; }))).toBe(false);
    expect(sunOffered(view((v) => { v.sun.enabled = false; }))).toBe(false);
    // A light that takes no sun, and a coordinator from before the sun.
    expect(sunOffered(view((v) => { v.sun.percents = []; }))).toBe(false);
    expect(sunOffered(view((v) => { delete v.sun; }))).toBe(false);
    // A coordinator from before the switch has no enabled: absent means on.
    expect(sunOffered(view((v) => { delete v.sun.enabled; }))).toBe(true);
  });

  it("checks enabled as a boolean when it is there", () => {
    const bad = copy();
    bad.sun.enabled = "yes";
    expect(parseGarden(bad)).toEqual({ ok: false, reason: "sun.enabled: expected true or false" });
  });

  it("says the garden takes no sun letters when suns are off", () => {
    const off = view((v) => { v.sun.enabled = false; });
    expect(sunBody(off, 50)).toEqual({ ok: false, words: "This garden takes no sun letters." });
    expect(sunLandingWords(off)).toBe("This garden takes no sun letters.");
  });
});

describe("what a letter carries, in words (the sun note's amendment of 2026-10-18, review fixes)", () => {
  const sun = (v: Record<string, any>) => ({ ...v.letters.waiting[0], id: "ltr-99", kind: "sun", x: null, y: null, r: null, percent: 50, span: v.pace.stepsPerDay });
  const off = (v: Record<string, any>) => { v.sun.enabled = false; v.sun.percents = []; v.sun.nextLanding = null; };
  it("names only the kinds this garden takes", () => {
    expect(carriesWords(view())).toBe("A stone carries only its place and size, a sun only its brightness, and a hand for food or a meteor carries nothing. None of them names who sent it.");
    expect(carriesWords(view((v) => { off(v); v.food.enabled = false; v.meteor.enabled = false; }))).toBe("A stone carries only its place and size. Nothing in it names who sent it.");
    expect(carriesWords(view((v) => { v.food.enabled = false; v.meteor.enabled = false; }))).toBe("A stone carries only its place and size, and a sun only its brightness. None of them names who sent it.");
    expect(carriesWords(view((v) => { off(v); v.meteor.enabled = false; }))).toBe("A stone carries only its place and size, and a hand for food carries nothing. None of them names who sent it.");
    expect(carriesWords(view((v) => { delete v.food; delete v.meteor; delete v.sun; }))).toBe("A stone carries only its place and size. Nothing in it names who sent it.");
  });
  it("names the sun while the garden holds one, even when its light no longer offers it", () => {
    expect(carriesWords(view((v) => { v.sun.percents = []; v.sun.nextLanding = null; v.food.enabled = false; v.meteor.enabled = false; v.letters.recent.push(sun(v)); })))
      .toBe("A stone carries only its place and size, and a sun only its brightness. None of them names who sent it.");
  });
});
