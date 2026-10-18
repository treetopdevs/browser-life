// The garden page's pure logic against the contract's own fixture (docs/garden-page-v0-2026-10-17.md).
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../coordinator/priv/static/garden-contract.example.json";
import {
  checkStone, checkpointHref, dawnAfter, dayChip, fmtDuration, foodClosedWords, foodNoticeWords, foodWords, latchHolds, periodWords, foundingWords, fmtSteps, fmtTime, getAnswer, handAnswer, landingPreview, landingWords,
  letterWords, mergeMine, newestMine, olderDaysSettled, parseGarden, postAnswer, postedSinceDawn, readVisit, recordFor, requestJson, resolveSource, retryAfterMs,
  sharePercent, sinceLastVisit, stateWords, tendingWords, verificationSummary, visitKey, writeVisit, type GardenView, type VisitRecord,
} from "../garden/garden.ts";
import { pageMeta } from "../src/social-meta.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MATTER_MAX, PRESETS, cellCount, defaultConfig, initWorld, maxLesionRadius, totalsOf } from "@bl/schema";
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

describe("the page is hidden", () => {
  it("has no canonical link, says noindex, is not in the sitemap and loads its module", () => {
    expect(pageMeta(gardenHtml)).toBeNull();
    expect(gardenHtml).toMatch(/<meta name="robots" content="noindex" \/>/);
    expect(sitemap).not.toMatch(/\/garden\//);
    expect(gardenHtml).toMatch(/<script type="module" src="\/garden\/main\.ts"><\/script>/);
    expect(gardenHtml).not.toMatch(/aria-current/);
  });
});
