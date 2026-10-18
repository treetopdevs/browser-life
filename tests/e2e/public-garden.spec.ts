// The shared garden's page (/garden/) against the garden-v1 fixture, served by route interception: the honesty
// numbers, each state, each answer to a letter, "since your last visit" with and without storage, and mock mode.
import { expect, test, type Page, type Route } from "@playwright/test";
import contractFixture from "../../apps/coordinator/priv/static/garden-contract.example.json" with { type: "json" };

// The tests' tsconfig carries no Node types: the one thing read from the environment is declared here.
declare const process: { env: Record<string, string | undefined> };
const FIXTURE = contractFixture as Record<string, any>;
const VIEW = "**/api/public/garden";
const LETTERS = "**/api/public/garden/letters";
const KEY = "cadence-garden-visit:http://localhost:5174:commons";
/** The record a device keeps, in the shape the page writes (createdAt names the planting). */
const record = (step: number, daysVerified: number, mine: string[] = [], createdAt: number = FIXTURE.createdAt) =>
  JSON.stringify({ createdAt, step, seenAt: 1792560000000, daysVerified, mine });

type Json = Record<string, any>;
const fixture = (mutate: (v: Json) => void = () => {}): Json => {
  const v = structuredClone(FIXTURE) as Json;
  mutate(v);
  return v;
};
const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: "application/json", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

/** Serves the view; returns a counter of GETs. */
async function serve(page: Page, body: Json | (() => Json) = fixture()): Promise<{ gets: number }> {
  const counter = { gets: 0 };
  await page.route(VIEW, (route) => {
    counter.gets++;
    return json(route, typeof body === "function" ? body() : body);
  });
  return counter;
}

async function noOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, "the page overflows horizontally").toBe(false);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXTURE.now);
});

for (const width of [1280, 375]) {
  test(`shows the fixture's honesty numbers at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await serve(page);
    await page.goto("/garden/");
    await expect(page.locator("#garden-message")).toHaveText("The garden answered.");
    await expect(page.locator("#g-state")).toContainText("Asleep: day 3 is ready and no island has come for it. It has slept 1 day and 14 hours.");
    await expect(page.locator("#g-step")).toHaveText("393,216");
    await expect(page.locator("#g-clock")).toContainText("2 hours and 51 minutes");
    await expect(page.locator("#g-tending")).toContainText("Kept by one computer so far");
    await expect(page.locator("#g-verified")).toHaveText("2 of 3 days");
    await expect(page.locator("#g-verify")).toContainText("replayed here, not yet verified elsewhere");
    await expect(page.locator("#g-census")).toContainText("2,412");
    await expect(page.locator("#g-census")).toContainText("Not yet replayed");
    const days = page.locator("#g-day-list li");
    await expect(days).toHaveCount(3);
    await expect(days.nth(0)).toContainText("Done, waiting for a replay");
    await expect(days.nth(1)).toContainText("Replayed here, not yet verified elsewhere");
    await expect(page.locator("#g-waiting li")).toHaveCount(4);
    expect(await page.locator("#g-waiting li").evaluateAll((els) => els.map((e) => e.getAttribute("data-letter")))).toEqual(["ltr-4", "ltr-5", "ltr-6", "ltr-7"]);
    const recent = page.locator("#g-recent");
    await expect(recent.locator('[data-letter="ltr-3"]')).toContainText("Set aside");
    await expect(recent.locator('[data-letter="ltr-2"]')).toContainText("Landed");
    await expect(recent.locator('[data-letter="ltr-1"]')).toContainText("Replayed");
    await expect(page.locator("#g-fork-link")).toHaveAttribute("href", /\/checkpoints\/4e0b7a19c3d2f856$/);
    await expect(page.locator("#stone-preview")).toContainText("Your stone would land at step 655,360, the end of day 4; 2 of the day’s 3 places are left.");
    await expect(page.locator("#stone-send")).toBeEnabled();
    await expect(page.locator("#stone-x")).toHaveValue("256");
    await noOverflow(page);
  });
}

test("state variants", async ({ page }) => {
  const variants: [string, (v: Json) => void, RegExp][] = [
    ["growing", (v) => {
      v.state = "growing"; v.asleep = false; v.clock.releasedStep = 524288; v.clock.sleptMs = 0;
      v.pace.nextReleaseAt = null; v.pace.releaseDue = false;
      v.days.unshift({ ...v.days[0], day: 3, startStep: 393216, endStep: 524288, status: "growing", doneAt: null, digest: null, census: null, letters: ["ltr-4", "ltr-5", "ltr-6"] });
    }, /Growing: an island is tending day 3 now\./],
    ["resting", (v) => { v.state = "resting"; v.asleep = false; v.pace.nextReleaseAt = v.pace.nextDawnAt; v.pace.releaseDue = false; }, /Resting: today’s day is done; the next can open at dawn/],
    ["stopped", (v) => { v.state = "stopped"; v.asleep = false; v.days[0].status = "diverged"; v.letters.nextLanding = null; }, /Stopped: day 2 did not replay the same\./],
    ["finished", (v) => { v.state = "finished"; v.asleep = false; v.letters.nextLanding = null; }, /Finished: every day to the horizon is done\./],
    // Server strings are text, never markup.
    ["hostile", (v) => { v.state = '<img src=x onerror="window.__pwned=1">'; v.letters.waiting[0].id = "<b>ltr-4</b>"; }, /The garden says “<img src=x onerror="window.__pwned=1">”/],
  ];
  let current = fixture();
  await serve(page, () => current);
  for (const [name, mutate, words] of variants) {
    current = fixture(mutate);
    await page.goto("/garden/");
    await expect(page.locator("#g-state"), name).toContainText(words);
    if (name === "growing") {
      // Day 3 is not done, so day 4 is never "as soon as an island asks".
      await expect(page.locator("#stone-preview")).toContainText("Day 4 opens only after day 3 is done");
      await expect(page.locator("#stone-preview")).not.toContainText("as soon as");
    }
    if (name === "finished") {
      await expect(page.locator("#stone-send")).toBeDisabled();
      await expect(page.locator("#stone-why")).toHaveText("The garden takes no letters now: every day to the horizon is done.");
    }
    if (name === "hostile") {
      await expect(page.locator("#g-state img, #g-waiting b")).toHaveCount(0);
      await expect(page.locator("#g-waiting")).toContainText("<b>ltr-4</b>");
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    }
    if (name === "stopped") {
      await expect(page.locator("#stone-send")).toBeDisabled();
      await expect(page.locator("#stone-why")).toHaveText("The garden takes no letters now: it has stopped until the keeper looks.");
      await expect(page.locator("#g-day-list li").first()).toContainText("Replay disagreed");
    }
  }
});

test("a fresh garden, a missing garden and a busy one", async ({ page }) => {
  const fresh = fixture((v) => {
    v.census = null; v.tip = null; v.fork = null;
    v.clock = { ...v.clock, step: 0, verifiedStep: 0, releasedStep: 131072, daysDone: 0, lastMovedAt: null, sleptMs: null };
    v.pace = { ...v.pace, nextReleaseAt: null, releaseDue: false };
    v.tending = { ...v.tending, deviceTypesEver: 0 };
    v.verification = { daysDone: 0, daysVerified: 0, byDifferentDeviceType: 0, bySameDeviceType: 0, diverged: 0, failed: 0, share: null };
    v.days = [{ day: 0, startStep: 0, endStep: 131072, status: "waiting", releasedAt: v.createdAt, doneAt: null, verifiedAt: null, digest: null, verification: null, letters: [], census: null }];
    v.letters = { ...v.letters, queued: 0, nextLanding: { day: 0, step: 131072, open: 3 }, waiting: [], recent: [] };
  });
  await serve(page, fresh);
  await page.goto("/garden/");
  await expect(page.locator("#g-state")).toContainText("Asleep: day 0 is ready and no island has come for it. It has not moved yet.");
  await expect(page.locator("#g-census")).toContainText("No day is done yet");
  await expect(page.locator("#g-fork")).toContainText("No checkpoint to fork yet");
  await expect(page.locator("#g-verify")).toContainText("Nothing has been replayed yet.");
  await expect(page.locator("#stone-preview")).toContainText("Day 0 is already released");
  await page.unroute(VIEW);

  await page.route(VIEW, (route) => json(route, { error: "not found" }, 404));
  await page.goto("/garden/");
  await expect(page.locator("#garden-message")).toHaveText("No garden is planted here yet.");
  await expect(page.locator("#garden-body")).toBeHidden();
  await page.unroute(VIEW);

  let calls = 0;
  await page.route(VIEW, (route) => {
    calls++;
    return calls === 1
      ? json(route, { error: "the garden is busy; retry shortly" }, 503, { "retry-after": "1" })
      : json(route, fixture());
  });
  await page.goto("/garden/");
  await expect(page.locator("#garden-message")).toHaveText("The garden answered.");
  expect(calls).toBe(2);
  await page.unroute(VIEW);

  // A 503 without Retry-After waits the default second, not none, then says busy.
  const at: number[] = [];
  await page.route(VIEW, (route) => { at.push(Date.now()); return json(route, { error: "the garden is busy; retry shortly" }, 503); });
  await page.goto("/garden/");
  await expect(page.locator("#garden-message")).toHaveText("The garden is busy; try again in a moment.");
  expect(at).toHaveLength(2);
  expect(at[1] - at[0]).toBeGreaterThanOrEqual(900);
  await page.unroute(VIEW);

  await page.route(VIEW, (route) => route.abort());
  await page.goto("/garden/");
  await expect(page.locator("#garden-message")).toHaveText("The garden could not be reached.");
});

test("refuses a shape it does not know", async ({ page }) => {
  let body = fixture((v) => { v.contract = "garden-v2"; });
  await serve(page, () => body);
  await page.goto("/garden/");
  await expect(page.locator("#garden-message")).toContainText("The garden answered in a shape this page does not know (contract: expected “garden-v1”, got “garden-v2”)");
  await expect(page.locator("#garden-body")).toBeHidden();
  body = fixture((v) => { delete v.clock; });
  await page.reload();
  await expect(page.locator("#garden-message")).toContainText("(clock: missing)");
  await expect(page.locator("#garden-body")).toBeHidden();
});

for (const width of [1280, 375]) test(`letter form: each answer in words at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  let posted = false;
  const counter = await serve(page, () => fixture((v) => {
    if (posted) {
      v.letters.queued = 5;
      v.letters.waiting.push({ ...v.letters.waiting[3], id: "ltr-8", x: 100, y: 200, r: 8, postedAt: v.now });
    }
  }));
  const bodies: unknown[] = [];
  let answer: (route: Route) => Promise<void> = (route) => json(route, { letter: { ...FIXTURE.letters.waiting[3], id: "ltr-8" } }, 201);
  await page.route(LETTERS, async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    expect(request.headers()["content-type"]).toBe("application/json");
    bodies.push(request.postDataJSON());
    await answer(route);
  });
  await page.goto("/garden/");
  await expect(page.locator("#stone-send")).toBeEnabled();

  // The map sets the place.
  const map = page.locator("#stone-map");
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width * 0.25, y: box.height * 0.75 } });
  expect(Math.abs(Number(await page.locator("#stone-x").inputValue()) - 128)).toBeLessThanOrEqual(2);
  expect(Math.abs(Number(await page.locator("#stone-y").inputValue()) - 384)).toBeLessThanOrEqual(2);

  // A stone the server would refuse is never sent.
  await page.locator("#stone-r").fill("33");
  await expect(page.locator("#stone-send")).toBeDisabled();
  await expect(page.locator("#stone-why")).toHaveText("The radius is a whole number from 1 to 32.");
  await expect(page.locator("#stone-r")).toHaveAttribute("aria-invalid", "true");
  await page.locator("#stone-r").press("Enter");
  expect(bodies).toHaveLength(0);

  await page.locator("#stone-x").fill("100");
  await page.locator("#stone-y").fill("200");
  await page.locator("#stone-r").fill("8");
  await expect(page.locator("#stone-send")).toBeEnabled();
  const before = counter.gets;
  posted = true;
  await page.locator("#stone-send").click();
  await expect(page.locator("#stone-answer")).toHaveText("Posted as ltr-8. It is public now, lands at step 655,360 (end of day 4), and counts once a second island replays that day.");
  expect(bodies.at(-1)).toEqual({ kind: "stone", x: 100, y: 200, r: 8 });
  await expect(page.locator('#g-waiting [data-letter="ltr-8"]')).toContainText("Yours");
  expect(counter.gets).toBeGreaterThan(before);
  await expect(page.locator("#g-courtesy")).toContainText("This device has sent a letter since the last dawn");
  await expect(page.locator("#stone-send")).toBeEnabled();

  const cases: [string, (route: Route) => Promise<void>, string][] = [
    ["422", (route) => json(route, { error: "r must be an integer in 1..32" }, 422), "The garden refused the stone: r must be an integer in 1..32."],
    ["409", (route) => json(route, { error: "the letter queue is full" }, 409), "The garden takes no letters now: the letter queue is full."],
    ["429", (route) => json(route, { error: "too many letters from this address", retryAfterMs: 1_500_000 }, 429, { "retry-after": "1500" }), "The garden is not taking letters from this network just now: it takes at most 3 letters an hour from one network, and fewer when many are refused. Try again in 25 minutes."],
    ["413", (route) => route.fulfill({ status: 413, body: "" }), "The page sent something the garden could not read. Reload the page and try again."],
    ["415", (route) => route.fulfill({ status: 415, contentType: "text/html", body: "<h1>Unsupported</h1>" }), "The page sent something the garden could not read. Reload the page and try again."],
    ["404", (route) => json(route, { error: "not found" }, 404), "There is no garden by that name here."],
    // No answer, or an unexpected one: the letter may be kept, so the page never says it was not sent, and reads the queue.
    ["no answer", (route) => route.abort(), "No answer came back, so this page cannot tell whether your stone arrived. The queue below is read again: look for it there before sending another."],
    ["500", (route) => route.fulfill({ status: 500, body: "" }), "The garden answered 500, so this page cannot tell whether your stone arrived. The queue below is read again: look for it there before sending another."],
  ];
  for (const [name, handler, words] of cases) {
    answer = handler;
    const gets = counter.gets;
    await page.locator("#stone-send").click();
    await expect(page.locator("#stone-answer"), name).toHaveText(words);
    await expect(page.locator("#stone-send")).toBeEnabled();
    if (name === "no answer" || name === "500") await expect.poll(() => counter.gets, name).toBeGreaterThan(gets);
    await noOverflow(page);
  }
  expect(bodies).toHaveLength(1 + cases.length);
});

test("since your last visit, and without storage", async ({ page, browser }) => {
  await serve(page);
  await page.goto("/garden/");
  await expect(page.locator("#g-since")).toHaveText("First visit from this device. Next time, this says what changed since now.");
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, record(131072, 0)] as const);
  await page.reload();
  await expect(page.locator("#g-since")).toContainText("2 days");
  await expect(page.locator("#g-since")).toContainText("262,144");
  await expect(page.locator("#g-since")).toContainText("2 more days replayed by a second island.");
  await expect(page.locator("#g-since")).toContainText("Letters landed since: ltr-1, ltr-2.");
  await page.reload();
  await expect(page.locator("#g-since")).toHaveText(/^No change since your last visit \(.+\): still at step 393,216\.$/);
  // Planted again under the same name: no comparison, and the old "Yours" marks go.
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, record(393216, 2, ["ltr-4"], FIXTURE.createdAt - 86_400_000)] as const);
  await page.reload();
  await expect(page.locator("#g-since")).toContainText("The garden was planted again since your last visit");
  await expect(page.locator("#g-waiting .garden-mine")).toHaveCount(0);

  const context = await browser.newContext();
  const locked = await context.newPage();
  await locked.clock.setFixedTime(FIXTURE.now);
  await locked.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("The operation is insecure.", "SecurityError"); } });
  });
  const errors: string[] = [];
  locked.on("pageerror", (e) => errors.push(e.message));
  await serve(locked);
  await locked.goto("http://localhost:5174/garden/");
  await expect(locked.locator("#g-step")).toHaveText("393,216");
  await expect(locked.locator("#g-since")).toHaveText("Nothing to compare: this device keeps no record of earlier visits.");
  expect(errors).toEqual([]);
  await context.close();

  // Storage that reads but will not write: the page does not promise a "next time".
  const full = await browser.newContext();
  const quota = await full.newPage();
  await quota.clock.setFixedTime(FIXTURE.now);
  await quota.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); };
  });
  await serve(quota);
  await quota.goto("http://localhost:5174/garden/");
  await expect(quota.locator("#g-since")).toHaveText("First visit from this device, and it cannot keep a record, so there will be nothing to compare next time.");
  await full.close();
});

test("polls, recomputes since-your-last-visit and counts times from the response", async ({ browser }) => {
  // A visitor clock five minutes after the response's `now`: relative times must still come from `now`.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.clock.install({ time: FIXTURE.now + 5 * 60_000 });
  await page.addInitScript(([key, value]) => { localStorage.setItem(key, value); }, [KEY, record(393216, 2)] as const);
  let body = fixture();
  const counter = await serve(page, () => body);
  await page.goto("http://localhost:5174/garden/");
  await expect(page.locator("#g-clock")).toContainText("2 hours and 51 minutes");
  await expect(page.locator("#g-since")).toHaveText(/^No change since your last visit \(.+\): still at step 393,216\.$/);

  // The garden moves on while the tab is open: day 3 done. The next poll must not say "no change".
  body = fixture((v) => {
    v.now += 60_000; v.state = "resting"; v.asleep = false;
    v.clock = { ...v.clock, step: 524288, daysDone: 4, lastMovedAt: v.now, sleptMs: 0 };
    v.verification = { ...v.verification, daysDone: 4 };
    v.days.unshift({ ...v.days[0], day: 3, startStep: 393216, endStep: 524288, status: "done", releasedAt: v.now - 3_600_000, doneAt: v.now, digest: "00000000000000aa" });
  });
  const before = counter.gets;
  await page.clock.runFor(60_000);
  await expect.poll(() => counter.gets).toBeGreaterThan(before);
  await expect(page.locator("#g-step")).toHaveText("524,288");
  await expect(page.locator("#g-since")).toContainText("1 day");
  await expect(page.locator("#g-since")).toContainText("131,072");
  await expect(page.locator("#g-since")).not.toContainText("No change");

  // A later reading that fails keeps the last numbers, dated, instead of passing them off as now.
  await page.unroute(VIEW);
  await page.route(VIEW, (route) => route.abort());
  await page.clock.runFor(60_000);
  await expect(page.locator("#garden-message")).toContainText("The garden could not be reached. The numbers below were read at");
  await expect(page.locator("#garden-body")).toBeVisible();
  await context.close();
});

test("a stone confirmed while an overlapping read failed is still this device's", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.clock.install({ time: FIXTURE.now });
  let release!: () => void;
  const readGate = new Promise<void>((r) => { release = r; });
  let answerPost!: () => void;
  const postGate = new Promise<void>((r) => { answerPost = r; });
  let gets = 0;
  const withLetter = fixture((v) => {
    v.letters.queued = 5;
    v.letters.waiting.push({ ...v.letters.waiting[3], id: "ltr-8", x: 100, y: 200, r: 8, postedAt: v.now });
  });
  await page.route(VIEW, async (route) => {
    gets++;
    if (gets === 1) return json(route, fixture());
    if (gets === 2) { await readGate; return json(route, '{"contract":"garden-v1","na'); }
    return json(route, withLetter);
  });
  await page.route(LETTERS, async (route) => { await postGate; await json(route, { letter: { ...FIXTURE.letters.waiting[3], id: "ltr-8" } }, 201); });
  await page.goto("http://localhost:5174/garden/");
  await expect(page.locator("#stone-send")).toBeEnabled();
  // A poll starts and hangs; the visitor sends meanwhile (a read never disables Send).
  await page.clock.runFor(60_000);
  await expect.poll(() => gets).toBe(2);
  await page.locator("#stone-x").fill("100");
  await page.locator("#stone-y").fill("200");
  await page.locator("#stone-send").click();
  // The read fails first: the page loses its view.
  release();
  await expect(page.locator("#garden-message")).toContainText("shape this page does not know");
  // Then the stone is confirmed: it is still recorded as this device's, and the next reading marks it.
  answerPost();
  await expect(page.locator('#g-waiting [data-letter="ltr-8"]')).toContainText("Yours");
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), KEY);
  expect(stored?.mine).toContain("ltr-8");
  await context.close();
});

test("mock mode in the dev server", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/public/garden")) requests.push(r.url()); });
  await page.goto("/garden/?mock=1");
  await expect(page.locator("#garden-source")).toHaveText("The example garden from the contract, not a live one.");
  await expect(page.locator("#g-step")).toHaveText("393,216");
  await page.locator("#stone-send").click();
  await expect(page.locator("#stone-answer")).toHaveText("This is the example garden from the contract, so nothing was sent.");
  expect(requests).toEqual([]);
});

test("another coordinator and a bad link are named", async ({ page }) => {
  await page.route("http://localhost:4199/api/public/garden", (route) => json(route, fixture(), 200, { "access-control-allow-origin": "http://localhost:5174" }));
  await page.goto("/garden/?coordinator=http://localhost:4199&garden=..%2Fx");
  await expect(page.locator("#garden-source")).toContainText("Reading a garden at http://localhost:4199, not this site’s own");
  await expect(page.locator("#garden-source")).toContainText("The garden name in the link is not one a garden can have");
  await expect(page.locator("#g-fork-link")).toHaveAttribute("href", "http://localhost:4199/api/public/gardens/commons/checkpoints/4e0b7a19c3d2f856");
});

test("a named garden is read from its own route", async ({ page }) => {
  const urls: string[] = [];
  await page.route("**/api/public/gardens/pond-2", (route) => { urls.push(route.request().url()); return json(route, fixture((v) => { v.name = "pond-2"; })); });
  await page.goto("/garden/?garden=pond-2");
  await expect(page.locator("#g-step")).toHaveText("393,216");
  expect(urls[0]).toMatch(/\/api\/public\/gardens\/pond-2$/);
  await expect(page.locator("#garden-source")).toBeHidden();
});

const shots = process.env.BL_GARDEN_SHOTS;
test("screenshots", async ({ browser }) => {
  test.skip(!shots, "set BL_GARDEN_SHOTS=<dir> to write the screenshots");
  for (const theme of ["light", "dark"] as const) {
    for (const [name, size] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]] as const) {
      const context = await browser.newContext({ viewport: size, colorScheme: theme });
      const page = await context.newPage();
      await page.clock.setFixedTime(FIXTURE.now);
      await page.addInitScript((t) => { try { localStorage.setItem("browser-life-theme", t); } catch { /* none */ } }, theme);
      await serve(page);
      await page.goto("http://localhost:5174/garden/");
      await expect(page.locator("#g-step")).toHaveText("393,216");
      await page.screenshot({ path: `${shots}/garden-${theme}-${name}.png`, fullPage: true });
      await context.close();
    }
  }
});
