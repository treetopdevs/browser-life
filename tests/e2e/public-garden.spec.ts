// The shared garden's page (/garden/) against the garden-v1 fixture, served by route interception: the honesty
// numbers, each state, each answer to a letter, the food ask and each answer to a hand (docs/garden-food-2026-10-18.md),
// the meteor ask and its answers (docs/garden-meteor-2026-10-18.md), "since your last visit" with and without storage,
// and mock mode.
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import contractFixture from "../../apps/coordinator/priv/static/garden-contract.example.json" with { type: "json" };

// The tests' tsconfig carries no Node types: the one thing read from the environment is declared here.
declare const process: { env: Record<string, string | undefined> };
const FIXTURE = contractFixture as Record<string, any>;
const VIEW = "**/api/public/garden";
const LETTERS = "**/api/public/garden/letters";
const HANDS = "**/api/public/garden/food/hands";
const METEOR_HANDS = "**/api/public/garden/meteor/hands";
/** The fixture's meteor ask opened for day 9, two hands in (the fixture itself shows it closed for its cooldown). */
const openMeteor = (v: Json) => { Object.assign(v.meteor, { open: true, closed: null, opensAtDay: null, landing: { day: 9, step: 1310720 }, hands: 2 }); };
// The page under test is served at the configured baseURL (BL_E2E_PORT in playwright.config.ts): its origin names the
// record the page keeps, so it is read from the test, never written down.
const originOf = (info: TestInfo) => new URL(info.project.use.baseURL!).origin;
const keyFor = (info: TestInfo) => `cadence-garden-visit:${originOf(info)}:commons`;
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

/** The view with no query, or one of the page's two fonts: fixed URLs, so no guess can ride in them. */
function pinnedRequest(method: string, url: string, origin: string): boolean {
  const u = new URL(url);
  if (method !== "GET" || u.origin !== origin || u.search !== "" || u.hash !== "") return false;
  return u.pathname === "/api/public/garden" || /^\/fonts\/rubik-latin(?:-italic)?\.woff2$/.test(u.pathname);
}

/**
 * A request the garden page may make: a pinned one, or a same-origin GET of the page's own files with only Vite's own
 * query marks (a version hash or a timestamp). A file name could still carry a guess (`/src/rest.ts`), so the test also
 * requires every request after the first guess to be pinned or one already made before any guess existed.
 */
function ownRequest(method: string, url: string, origin: string): boolean {
  if (pinnedRequest(method, url, origin)) return true;
  const u = new URL(url);
  if (method !== "GET" || u.origin !== origin || u.hash !== "" || u.pathname.startsWith("/api/")) return false;
  const vite = /^(\?(?:v=[0-9a-f]{6,}|t=\d{10,}|import|direct|used)(?:&(?:v=[0-9a-f]{6,}|t=\d{10,}|import|direct|used))*)?$/;
  const files = /^\/(?:garden\/(?:|index\.html|main\.ts|garden\.ts|garden\.css)|favicon\.svg|@vite\/(?:client|env)|(?:src|@fs|@id|node_modules)\/[\w@./+-]+\.(?:m?js|ts|css|svg))$/;
  return files.test(u.pathname) && vite.test(u.search);
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

for (const width of [1280, 375]) test(`food ask: count, threshold, time left and landing at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await serve(page);
  await page.goto("/garden/");
  await expect(page.locator("#g-food-row")).toBeVisible();
  await expect(page.locator("#g-food-count")).toHaveText("2 of 5 networks have asked today.");
  await expect(page.locator("#g-food-time")).toContainText("Today’s hands expire at the next dawn, in 2 hours and 51 minutes");
  await expect(page.locator("#g-food-landing")).toHaveText("A food called now would land at step 524,288, the end of day 3, at the centre (256, 256): 16 quanta of nutrient per cell over a disc of radius 32.");
  await expect(page.locator("#g-food-why")).toContainText("Food is the one thing that adds matter to this closed world, so it is kept rare on purpose.");
  await expect(page.locator("#g-food-why")).toContainText("nobody has tested that yet");
  await expect(page.locator("#g-food-time")).toContainText("unless 3 more networks ask before then.");
  await expect(page.locator("#food-shared")).toBeHidden();
  await expect(page.locator("#g-food-why")).toContainText("at most once every 2 days");
  await expect(page.locator("#food-send")).toBeEnabled();
  await expect(page.locator("#food-send")).toHaveText("Add my hand");
  await expect(page.locator('#g-foods [data-food="food-1"]')).toContainText("Replayed here");
  await expect(page.locator('#g-foods [data-food="food-1"]')).toContainText("called by 5 networks, landing at step 262,144 (end of day 1)");
  await expect(page.locator("#g-day-list li").nth(1)).toContainText("carries the food food-1");
  // A food is never listed as a letter.
  await expect(page.locator('[data-letter="food-1"]')).toHaveCount(0);
  await noOverflow(page);
});

test("food ask: each answer in words", async ({ page }) => {
  let hands = 2;
  const counter = await serve(page, () => fixture((v) => { v.food.hands = hands; }));
  const bodies: { body: string | null; type: string | undefined }[] = [];
  let answer: (route: Route) => Promise<void> = (route) => json(route, { error: "nope" }, 409);
  await page.route(HANDS, async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    bodies.push({ body: request.postData(), type: request.headers()["content-type"] });
    await answer(route);
  });
  await page.goto("/garden/");
  await expect(page.locator("#food-send")).toBeEnabled();

  const cases: [string, (route: Route) => Promise<void>, string][] = [
    ["409", (route) => json(route, { error: "a food lands at most once every 2 days; the next can land on day 9 at the earliest", closed: "cooldown", opensAtDay: 9 }, 409), "The food ask is closed: a food lands at most once every 2 days; the next can land on day 9 at the earliest."],
    ["422", (route) => json(route, { error: "a hand is exactly {}: it carries nothing" }, 422), "The garden refused the hand: a hand is exactly {}: it carries nothing."],
    ["429", (route) => json(route, { error: "too many letters and hands from this address", retryAfterMs: 1_500_000 }, 429, { "retry-after": "1500" }), "The garden is not taking hands from this network just now: it takes at most 3 letters and hands an hour from one network, together, and fewer when many are refused. Try again in 25 minutes."],
    ["413", (route) => route.fulfill({ status: 413, body: "" }), "The page sent something the garden could not read. Reload the page and try again."],
    ["415", (route) => route.fulfill({ status: 415, contentType: "text/html", body: "<h1>Unsupported</h1>" }), "The page sent something the garden could not read. Reload the page and try again."],
    ["404", (route) => json(route, { error: "not found" }, 404), "There is no garden by that name here."],
    ["503", (route) => json(route, { error: "the garden is busy; retry shortly", counted: false }, 503, { "retry-after": "1" }), "The garden is busy; try again in a moment. Your hand was not counted."],
    ["503 unsure", (route) => json(route, { error: "the garden is busy; retry shortly", counted: null }, 503, { "retry-after": "1" }), "The garden was too busy to answer, so this page cannot tell whether your hand was counted. The count below is read again: a second hand from this network is never counted twice."],
    ["no answer", (route) => route.abort(), "No answer came back, so this page cannot tell whether your hand was counted. The count below is read again: a second hand from this network is never counted twice."],
    ["500", (route) => route.fulfill({ status: 500, body: "" }), "The garden answered 500, so this page cannot tell whether your hand was counted. The count below is read again: a second hand from this network is never counted twice."],
  ];
  for (const [name, handler, words] of cases) {
    answer = handler;
    const gets = counter.gets;
    await page.locator("#food-send").click();
    await expect(page.locator("#food-answer"), name).toHaveText(words);
    await expect(page.locator("#food-send"), name).toBeEnabled();
    if (name === "no answer" || name === "500" || name === "409" || name === "503 unsure") await expect.poll(() => counter.gets, name).toBeGreaterThan(gets);
    await noOverflow(page);
  }

  // Counted: the count is read again, and this tab's hand is in until the dawn (in memory only).
  answer = (route) => { hands = 3; return json(route, { counted: true, called: null, food: { ...FIXTURE.food, hands: 3 } }, 201); };
  await page.locator("#food-send").click();
  await expect(page.locator("#food-answer")).toHaveText("Your hand is in. 3 of 5 networks have asked today.");
  await expect(page.locator("#g-food-count")).toHaveText("3 of 5 networks have asked today.");
  await expect(page.locator("#food-send")).toBeDisabled();
  await expect(page.locator("#food-why")).toHaveText("Your hand is in for today.");
  expect(bodies.every((b) => b.body === "{}" && b.type === "application/json")).toBe(true);
  expect(bodies).toHaveLength(cases.length + 1);
  // Nothing about the hand is kept on the device.
  expect(await page.evaluate(() => Object.values(localStorage).some((v) => v.includes("hand")))).toBe(false);

  // A new tab: a repeat is said kindly, and a calling hand names its food.
  await page.reload();
  await expect(page.locator("#food-send")).toBeEnabled();
  answer = (route) => json(route, { counted: false, called: null, food: { ...FIXTURE.food, hands: 3 } }, 200);
  await page.locator("#food-send").click();
  await expect(page.locator("#food-answer")).toHaveText("A hand from your network was already in for today: one hand per network per dawn. 3 of 5 networks have asked today.");
  await page.reload();
  answer = (route) => json(route, { counted: true, called: { ...FIXTURE.food.foods[0], id: "food-2", day: 3, landsAtStep: 524288, status: "waiting", landedIn: null }, food: { ...FIXTURE.food, hands: 0 } }, 201);
  await page.locator("#food-send").click();
  await expect(page.locator("#food-answer")).toHaveText("Yours was the hand that called the food: food-2 is public now, lands at step 524,288 (end of day 3), and counts once a second island replays that day.");
});

test("a closed ask shows its reason and a disabled button", async ({ page }) => {
  const variants: [string, (v: Json) => void, string][] = [
    ["cooldown", (v) => Object.assign(v.food, { open: false, closed: "cooldown", opensAtDay: 9, landing: null }), "A food lands at most once every 2 days: the next can land on day 9 at the earliest."],
    ["stopped", (v) => Object.assign(v.food, { open: false, closed: "stopped", landing: null }), "The garden has stopped, so it takes no food until the keeper looks."],
    ["log-full", (v) => Object.assign(v.food, { open: false, closed: "log-full", landing: null }), "The garden’s log is full."],
  ];
  let current = fixture();
  await serve(page, () => current);
  for (const [name, mutate, words] of variants) {
    current = fixture(mutate);
    await page.goto("/garden/");
    await expect(page.locator("#g-food-row"), name).toBeVisible();
    await expect(page.locator("#food-send"), name).toBeDisabled();
    await expect(page.locator("#food-why"), name).toHaveText(words);
    await expect(page.locator("#g-food-landing"), name).toHaveText(words);
    // A closed ask does not headline a count of zero.
    await expect(page.locator("#g-food-count"), name).toHaveText("The food ask is closed just now.");
  }
  // A food waiting on its notice: named in the headline, its veto window in words.
  current = fixture((v) => {
    Object.assign(v.food, { open: false, closed: "cooldown", opensAtDay: 5, landing: null, hands: 0 });
    v.food.foods.unshift({ ...v.food.foods[0], id: "food-2", day: 3, landsAtStep: 524288, status: "waiting", landedIn: null, calledAt: v.now - 3_600_000, noticeUntil: v.now + 3_600_000 });
  });
  await page.goto("/garden/");
  await expect(page.locator("#g-food-count")).toHaveText("A food is waiting: food-2 lands at step 524,288, the end of day 3. Hands count again once the ask reopens.");
  await expect(page.locator('#g-foods [data-food="food-2"]')).toContainText("Its day is not run before");
  await expect(page.locator('#g-foods [data-food="food-2"]')).toContainText("in 1 hour, so the keeper can still set it aside.");
});

test("food ask: the tab's hand is dropped at its dawn or when the server forgot it; a shared address is said", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const page = await context.newPage();
  await page.clock.install({ time: FIXTURE.now });
  let body = fixture();
  const counter = await serve(page, () => body);
  await page.route(HANDS, (route) => { body = fixture((v) => { v.food.hands = 3; }); return json(route, { counted: true, called: null, food: body.food }, 201); });
  await page.goto("/garden/");
  await page.locator("#food-send").click();
  await expect(page.locator("#food-send")).toBeDisabled();
  await expect(page.locator("#food-why")).toHaveText("Your hand is in for today.");

  // The garden's server restarted and forgot the period's hands: the next poll lets this tab ask again.
  body = fixture((v) => { v.food.hands = 0; v.now += 60_000; });
  let before = counter.gets;
  await page.clock.runFor(60_000);
  await expect.poll(() => counter.gets).toBeGreaterThan(before);
  await expect(page.locator("#food-send")).toBeEnabled();

  // Hand in again, from a view that counts 0: the view the hand was sent from cannot show it forgotten, so the
  // tab's hand holds through the answer and the read after it. Then a dawn passes in this tab (the view's now
  // reaches the hand's expiry).
  before = counter.gets;
  await page.locator("#food-send").click();
  await expect.poll(() => counter.gets).toBeGreaterThan(before);
  await expect(page.locator("#food-why")).toHaveText("Your hand is in for today.");
  await expect(page.locator("#food-send")).toBeDisabled();
  body = fixture((v) => { v.now = v.food.expiresAt; v.food.expiresAt += 86_400_000; v.food.hands = 1; v.pace.nextDawnAt = v.food.expiresAt; });
  before = counter.gets;
  await page.clock.runFor(60_000);
  await expect.poll(() => counter.gets).toBeGreaterThan(before);
  await expect(page.locator("#food-send")).toBeEnabled();
  await expect(page.locator("#food-why")).toHaveText("");

  // Every visitor one address (production until the proxy is fixed): said beside the button.
  body = fixture((v) => { v.food.sharedAddress = true; });
  before = counter.gets;
  await page.clock.runFor(60_000);
  await expect.poll(() => counter.gets).toBeGreaterThan(before);
  await expect(page.locator("#food-shared")).toBeVisible();
  await expect(page.locator("#food-shared")).toContainText("Right now every visitor reaches this garden through one shared address");
  await noOverflow(page);
  await context.close();
});

test("a view without food shows no ask", async ({ page }) => {
  const variants: [string, (v: Json) => void][] = [
    ["a coordinator from before food", (v) => { delete v.food; for (const d of v.days) delete d.food; }],
    ["a garden founded without food", (v) => { v.food = { ...v.food, enabled: false, asks: null, everyDays: null, amount: null, r: null, place: null, hands: 0, open: false, closed: "off", landing: null, foods: [] }; for (const d of v.days) d.food = null; }],
  ];
  let current = fixture();
  await serve(page, () => current);
  for (const [name, mutate] of variants) {
    current = fixture(mutate);
    await page.goto("/garden/");
    await expect(page.locator("#garden-message"), name).toHaveText("The garden answered.");
    await expect(page.locator("#g-food-row"), name).toBeHidden();
    await expect(page.locator("#g-step"), name).toHaveText("393,216");
  }
});
for (const width of [1280, 375]) test(`meteor ask: count, threshold, time left, landing and place at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await serve(page, fixture(openMeteor));
  await page.goto("/garden/");
  await expect(page.locator("#g-meteor-row")).toBeVisible();
  await expect(page.locator("#h-meteor")).toHaveText("Ask for a meteor (a large stone)");
  await expect(page.locator("#g-meteor-what")).toHaveText("A meteor is a stone of radius 64: where it lands, every body in a disc of 12,853 cells (4.9% of this world) turns to waste and its stored energy to heat. It lands at a place fixed before anyone asks, (337, 440) for the next one, never one a visitor picks, and chosen without looking at what lives there, so its disc may hold many bodies, few or none. “Meteor” is only this letter’s name for a large stone; it promises no lasting change.");
  await expect(page.locator("#g-meteor-count")).toHaveText("2 of 5 networks have asked today.");
  await expect(page.locator("#g-meteor-time")).toHaveText(/^Today’s hands expire at the next dawn, in 2 hours and 51 minutes \(.+\), unless 3 more networks ask before then\.$/);
  await expect(page.locator("#g-meteor-landing")).toHaveText("A meteor called now would land at step 1,310,720, the end of day 9, at (337, 440), a stone of radius 64.");
  await expect(page.locator("#g-meteor-why")).toContainText("A meteor is the one large act a visitor can ask for, so it is kept rare");
  await expect(page.locator("#g-meteor-why")).toContainText("at most once every 7 days");
  await expect(page.locator("#meteor-shared")).toBeHidden();
  await expect(page.locator("#meteor-send")).toBeEnabled();
  await expect(page.locator("#meteor-send")).toHaveText("Add my hand");
  await expect(page.locator('#g-meteors [data-meteor="meteor-1"]')).toContainText("A stone of radius 64 at (497, 403), called by 5 networks, landing at step 393,216 (end of day 2).");
  await expect(page.locator('#g-meteors [data-meteor="meteor-1"]')).toContainText("Landed");
  await expect(page.locator("#g-day-list li").nth(0)).toContainText("carries the meteor meteor-1");
  // A meteor is never listed as a letter, nor as a food.
  await expect(page.locator('[data-letter="meteor-1"]')).toHaveCount(0);
  await expect(page.locator('[data-food="meteor-1"]')).toHaveCount(0);
  // The two asks are apart: the food ask keeps its own count.
  await expect(page.locator("#g-food-count")).toHaveText("2 of 5 networks have asked today.");
  await noOverflow(page);
});

test("meteor answers in words", async ({ page }) => {
  let hands = 2;
  const counter = await serve(page, () => fixture((v) => { openMeteor(v); v.meteor.hands = hands; }));
  const bodies: { body: string | null; type: string | undefined }[] = [];
  let answer: (route: Route) => Promise<void> = (route) => json(route, { error: "nope" }, 409);
  let foodPosts = 0;
  await page.route(HANDS, (route) => { foodPosts++; return json(route, { error: "not this one" }, 500); });
  await page.route(METEOR_HANDS, async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    bodies.push({ body: request.postData(), type: request.headers()["content-type"] });
    await answer(route);
  });
  await page.goto("/garden/");
  await expect(page.locator("#meteor-send")).toBeEnabled();
  const block = () => fixture(openMeteor).meteor;

  const cases: [string, (route: Route) => Promise<void>, string][] = [
    ["409", (route) => json(route, { error: "a meteor lands at most once every 7 days; the next can land on day 9 at the earliest", closed: "cooldown", opensAtDay: 9 }, 409), "The meteor ask is closed: a meteor lands at most once every 7 days; the next can land on day 9 at the earliest."],
    ["422", (route) => json(route, { error: "a hand is exactly {}: it carries nothing" }, 422), "The garden refused the hand: a hand is exactly {}: it carries nothing."],
    ["429", (route) => json(route, { error: "too many letters and hands from this address", retryAfterMs: 1_500_000 }, 429, { "retry-after": "1500" }), "The garden is not taking hands from this network just now: it takes at most 3 letters and hands an hour from one network, together, and fewer when many are refused. Try again in 25 minutes."],
    ["413", (route) => route.fulfill({ status: 413, body: "" }), "The page sent something the garden could not read. Reload the page and try again."],
    ["415", (route) => route.fulfill({ status: 415, contentType: "text/html", body: "<h1>Unsupported</h1>" }), "The page sent something the garden could not read. Reload the page and try again."],
    ["404", (route) => json(route, { error: "not found" }, 404), "There is no garden by that name here."],
    ["503", (route) => json(route, { error: "the garden is busy; retry shortly", counted: false }, 503, { "retry-after": "1" }), "The garden is busy; try again in a moment. Your hand was not counted."],
    ["503 unsure", (route) => json(route, { error: "the garden is busy; retry shortly", counted: null }, 503, { "retry-after": "1" }), "The garden was too busy to answer, so this page cannot tell whether your hand was counted. The count below is read again: a second hand from this network is never counted twice."],
    ["no answer", (route) => route.abort(), "No answer came back, so this page cannot tell whether your hand was counted. The count below is read again: a second hand from this network is never counted twice."],
  ];
  for (const [name, handler, words] of cases) {
    answer = handler;
    const gets = counter.gets;
    await page.locator("#meteor-send").click();
    await expect(page.locator("#meteor-answer"), name).toHaveText(words);
    await expect(page.locator("#meteor-send"), name).toBeEnabled();
    if (name === "no answer" || name === "409" || name === "503 unsure") await expect.poll(() => counter.gets, name).toBeGreaterThan(gets);
    await noOverflow(page);
  }

  // Counted: this tab's meteor hand is in until the dawn; the food ask's button is untouched.
  answer = (route) => { hands = 3; return json(route, { counted: true, called: null, meteor: { ...block(), hands: 3 } }, 201); };
  await page.locator("#meteor-send").click();
  await expect(page.locator("#meteor-answer")).toHaveText("Your hand is in. 3 of 5 networks have asked today.");
  await expect(page.locator("#g-meteor-count")).toHaveText("3 of 5 networks have asked today.");
  await expect(page.locator("#meteor-send")).toBeDisabled();
  await expect(page.locator("#meteor-why")).toHaveText("Your hand is in for today.");
  await expect(page.locator("#food-send")).toBeEnabled();
  await expect(page.locator("#food-why")).toHaveText("");
  expect(bodies.every((b) => b.body === "{}" && b.type === "application/json")).toBe(true);
  expect(bodies).toHaveLength(cases.length + 1);
  expect(foodPosts).toBe(0);

  // A new tab: a repeat, then a hand that calls the meteor names its place.
  await page.reload();
  await expect(page.locator("#meteor-send")).toBeEnabled();
  answer = (route) => json(route, { counted: false, called: null, meteor: { ...block(), hands: 3 } }, 200);
  await page.locator("#meteor-send").click();
  await expect(page.locator("#meteor-answer")).toHaveText("A hand from your network was already in for today: one hand per network per dawn. 3 of 5 networks have asked today.");
  await page.reload();
  answer = (route) => json(route, { counted: true, called: { ...FIXTURE.meteor.meteors[0], id: "meteor-2", day: 9, x: 337, y: 440, landsAtStep: 1310720, status: "waiting", landedIn: null }, meteor: { ...block(), hands: 0 } }, 201);
  await page.locator("#meteor-send").click();
  await expect(page.locator("#meteor-answer")).toHaveText("Yours was the hand that called the meteor: meteor-2 is public now, lands at (337, 440) at step 1,310,720 (end of day 9), and counts once a second island replays that day.");
});

test("closed meteor ask shows its reason and a disabled button", async ({ page }) => {
  const variants: [string, (v: Json) => void, string][] = [
    ["cooldown (the fixture)", () => {}, "A meteor lands at most once every 7 days: the next can land on day 9 at the earliest."],
    ["stopped", (v) => Object.assign(v.meteor, { open: false, closed: "stopped", opensAtDay: null, landing: null }), "The garden has stopped, so it takes no meteor until the keeper looks."],
    ["horizon", (v) => Object.assign(v.meteor, { open: false, closed: "horizon", opensAtDay: null, landing: null }), "No day is left before the horizon that a meteor could land on."],
    ["log-full", (v) => Object.assign(v.meteor, { open: false, closed: "log-full", opensAtDay: null, landing: null }), "The garden’s log is full."],
  ];
  let current = fixture();
  await serve(page, () => current);
  for (const [name, mutate, words] of variants) {
    current = fixture(mutate);
    await page.goto("/garden/");
    await expect(page.locator("#g-meteor-row"), name).toBeVisible();
    await expect(page.locator("#meteor-send"), name).toBeDisabled();
    await expect(page.locator("#meteor-why"), name).toHaveText(words);
    await expect(page.locator("#g-meteor-landing"), name).toHaveText(words);
    await expect(page.locator("#g-meteor-count"), name).toHaveText("The meteor ask is closed just now.");
    await expect(page.locator("#g-meteor-time"), name).toHaveText("");
  }
  // A meteor waiting on its notice: named in the headline with its place, its veto window in words, its day held.
  current = fixture((v) => {
    Object.assign(v.meteor, { open: false, closed: "cooldown", opensAtDay: 10, landing: null, hands: 0 });
    v.meteor.meteors.unshift({ ...v.meteor.meteors[0], id: "meteor-2", day: 3, x: 337, y: 440, landsAtStep: 524288, status: "waiting", landedIn: null, calledAt: v.now - 3_600_000, noticeUntil: v.now + 3_600_000 });
  });
  await page.goto("/garden/");
  await expect(page.locator("#g-meteor-count")).toHaveText("A meteor is waiting: meteor-2 lands at (337, 440) at step 524,288, the end of day 3. Hands count again once the ask reopens.");
  await expect(page.locator('#g-meteors [data-meteor="meteor-2"]')).toContainText("in 1 hour, so the keeper can still set it aside.");
  await expect(page.locator("#g-state")).toContainText("Holding: day 3 carries the meteor meteor-2");
  // A shared address is said beside the button.
  current = fixture((v) => { openMeteor(v); v.meteor.sharedAddress = true; });
  await page.goto("/garden/");
  await expect(page.locator("#meteor-shared")).toBeVisible();
  await expect(page.locator("#meteor-shared")).toContainText("a meteor cannot be called");
});

test("readings paragraph on the big storm at r 64; 'nobody has measured' otherwise", async ({ page }) => {
  let current = fixture();
  await serve(page, () => current);
  await page.goto("/garden/");
  const reading = page.locator("#g-meteor-reading");
  await expect(reading).toContainText("What a stone this size did, as far as anyone has looked");
  await expect(reading).toContainText("for a median of about 35,800 steps (from about 2,000 to about 68,600, over nine pairs), about 27% of a day here.");
  await expect(reading).toContainText("that is a mark with no lasting effect, not a lasting change.");
  await expect(reading).toContainText("founded as the commons was (one feed at the centre at step 0, radius 255, 16 quanta per cell; as this garden was too)");
  await expect(reading).toContainText("Those stones were each aimed at a living cell; a meteor’s place is not, so it may clear less.");
  await expect(reading).toContainText("so by that rule the stone read as a stone effect: its mark outlasted a one-cell change’s, which the size of the change alone could explain.");
  await expect(reading).not.toContainText("drift");
  await expect(reading).toContainText("Three histories, one of them a carpet; one founding; the measure saturates; and no null stone of this size could be placed.");
  await expect(reading).toContainText("These are what rules written before the runs said, not settled facts about this garden.");
  for (const [name, mutate] of [
    ["another preset", (v: Json) => { v.presetId = "spots"; }],
    ["another radius", (v: Json) => { v.meteor.r = 96; for (const m of v.meteor.meteors) m.r = 96; }],
  ] as const) {
    current = fixture(mutate);
    await page.goto("/garden/");
    await expect(reading, name).toHaveText("Nobody has yet measured what a stone of this size does in this world.");
  }
  // The big storm founded otherwise keeps the readings and says they were not taken in a world founded like it.
  current = fixture((v) => { v.founding = [{ step: 0, kind: "lesion", x: 0, y: 0, r: 1 }]; });
  await page.goto("/garden/");
  await expect(reading).toContainText("radius 255, 16 quanta per cell; not as this garden was)");
});

test("a view without meteor shows no meteor section", async ({ page }) => {
  const variants: [string, (v: Json) => void][] = [
    ["a coordinator from before the meteor", (v) => { delete v.meteor; for (const d of v.days) delete d.meteor; }],
    ["a garden founded without meteor", (v) => { v.meteor = { ...v.meteor, enabled: false, asks: null, everyDays: null, r: null, place: null, hands: 0, open: false, closed: "off", opensAtDay: null, landing: null, meteors: [] }; for (const d of v.days) d.meteor = null; }],
  ];
  let current = fixture();
  await serve(page, () => current);
  for (const [name, mutate] of variants) {
    current = fixture(mutate);
    await page.goto("/garden/");
    await expect(page.locator("#garden-message"), name).toHaveText("The garden answered.");
    await expect(page.locator("#g-meteor-row"), name).toBeHidden();
    await expect(page.locator("#g-food-row"), name).toBeVisible();
    await expect(page.locator("#g-step"), name).toHaveText("393,216");
  }
});


// ---------- who holds the field, and dawn predictions (docs/garden-predictions-2026-10-18.md) ----------

const D = 131072;
/** Day 2, the newest released day, verified with an ok block: guesses about day 3 are open. */
const openMutate = (v: Json) => {
  v.days[0].status = "verified"; v.days[0].verifiedAt = v.days[0].doneAt + 600_000; v.days[0].verification = "same-device-type";
  v.days[0].leaders = {
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
};
/** Then day 3 released after the guess and verified, with lines from day 2 that `winner` held. */
const day3Mutate = (winner: string | null) => (v: Json) => {
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
  });
};

for (const width of [1280, 375]) test(`dawn predictions: a guess, its receipt after a reload, and its check at ${width}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  let current = fixture(openMutate);
  // Every request must be a same-origin GET of the page's own files (Vite's dev paths, with only Vite's own query
  // marks) or of the view with no query: a guess could leave in a path or a query string as well as in a body.
  // Once choosing starts, only pinned requests or ones made before any choice existed: a new file name is a leak too.
  const sent: string[] = [];
  const before = new Set<string>();
  let guessed = false;
  page.on("request", (r) => {
    const o = originOf(testInfo);
    if (!ownRequest(r.method(), r.url(), o)) sent.push(`${r.method()} ${r.url()}`);
    else if (!guessed) before.add(r.url());
    else if (!pinnedRequest(r.method(), r.url(), o) && !before.has(r.url())) sent.push(`new after the guess: ${r.method()} ${r.url()}`);
  });
  await serve(page, () => current);
  await page.goto("/garden/");
  await expect(page.locator("#g-field-row")).toBeVisible();
  await expect(page.locator("#g-field-words")).toHaveText("At the end of day 2, founder 14 (0:14) holds 50% of 100 living cells: a clear leader (at least 10% and more than any other key).");
  await expect(page.locator("#g-predict-words")).toHaveText("Guesses about day 3 are open until it is released to an island.");
  await expect(page.locator("#predict-send")).toBeDisabled();
  await expect(page.locator("#predict-choices label")).toHaveCount(4);
  // The baseline closes before any choice is made: a request made while choosing could carry the choice too.
  expect(before.size).toBeGreaterThan(0);
  guessed = true;
  await page.getByLabel("the rest (every other line)").check();
  await expect(page.locator("#predict-send")).toBeEnabled();
  await page.locator("#predict-send").click();
  await expect(page.locator("#predict-answer")).toHaveText(/^Kept on this device: day 3, the rest, receipt [0-9a-f]{12}\. Nothing was sent anywhere\.$/);
  const receipt = page.locator('#g-receipt-list li[data-receipt="3"]');
  await expect(receipt).toHaveAttribute("data-outcome", "waiting");
  await expect(receipt).toContainText("Waiting: day 3 is not verified yet.");
  const hash = (await receipt.locator(".garden-digest").textContent()) ?? "";
  expect(hash).toMatch(/^[0-9a-f]{12}$/);
  await noOverflow(page);
  await page.reload();
  await expect(page.locator('#g-receipt-list li[data-receipt="3"] .garden-digest')).toHaveText(hash);

  // Day 3 is verified and the rest held the field: the receipt held.
  current = fixture(day3Mutate("rest"));
  await page.reload();
  await expect(receipt).toHaveAttribute("data-outcome", "held");
  await expect(receipt).toContainText("Held: the rest held 55% of the field at day 3’s end.");
  // The window has moved on: day 3 is the newest released day and verified, so guesses are about day 4.
  await expect(page.locator("#g-predict-words")).toHaveText("Guesses about day 4 are open until it is released to an island.");
  // Another history in which founder 14's line held it: the receipt did not hold.
  current = fixture(day3Mutate("0:14"));
  await page.reload();
  await expect(receipt).toHaveAttribute("data-outcome", "missed");
  await expect(receipt).toContainText("Did not hold: the line of founder 14 (0:14) held 30% of the field at day 3’s end.");
  await noOverflow(page);
  // A guess is never sent: the page made no request but its GETs.
  expect(sent).toEqual([]);
  // The allowlist itself refuses a guess carried anywhere but a body.
  const o = originOf(testInfo);
  for (const leak of [
    "/garden/?choice=rest", "/garden/rest/0:14", "/garden/0:14", "/api/public/garden?receipt=ab", "/api/public/garden#rest",
    "/api/public/gardens/commons/predictions", "/fonts/rest.woff2", "/garden/main.ts?t=rest", "/garden/main.ts?v=rest",
    "/garden/main.ts?import&choice=rest", "/garden/main.ts#rest",
  ]) expect(ownRequest("GET", o + leak, o), leak).toBe(false);
  expect(ownRequest("POST", `${o}/api/public/garden`, o)).toBe(false);
  expect(ownRequest("HEAD", `${o}/api/public/garden`, o)).toBe(false);
  expect(ownRequest("GET", `${o}/garden/main.ts?t=1729000000000`, o)).toBe(true);
  // A file name that passes the shape (`/@fs/rest.ts`) is caught by the after-the-guess rule: it is pinned by nothing.
  expect(pinnedRequest("GET", `${o}/@fs/rest.ts`, o)).toBe(false);
  expect(pinnedRequest("GET", `${o}/fonts/rubik-latin-italic.woff2`, o)).toBe(true);
});

test("dawn predictions: a guess is made against a fresh reading, so a window shut since the last poll makes no receipt", async ({ page }) => {
  let current = fixture(openMutate);
  await serve(page, () => current);
  await page.goto("/garden/");
  await page.getByLabel("the rest (every other line)").check();
  // Day 3 was released since this page last read the garden: the guess is refused, not stamped with the old reading.
  current = fixture((v) => {
    openMutate(v);
    v.clock.releasedStep = 4 * D;
    v.days.unshift({ ...structuredClone(v.days[0]), day: 3, startStep: 3 * D, endStep: 4 * D, status: "waiting", releasedAt: v.now, doneAt: null, verifiedAt: null, digest: null, verification: null, letters: [], food: null, census: null, leaders: null });
  });
  await page.locator("#predict-send").click();
  await expect(page.locator("#predict-answer")).toHaveText("Predictions open when the newest day is verified and the next is not yet released. Day 3 is not verified yet. No receipt was made for day 3.");
  await expect(page.locator("#g-receipts")).toContainText("No receipt from this device for this planting yet.");
  // Beside the shut button, the same reason.
  await expect(page.locator("#predict-why")).toHaveText("Predictions open when the newest day is verified and the next is not yet released. Day 3 is not verified yet.");
  // Day 3 released and already verified since the last poll: the window moved on to day 4. The choice made for day 3
  // is not carried over to a guess about day 4.
  current = fixture(openMutate);
  await page.reload();
  await page.getByLabel("the rest (every other line)").check();
  current = fixture(day3Mutate("rest"));
  await page.locator("#predict-send").click();
  await expect(page.locator("#predict-answer")).toHaveText("The garden moved on while you chose: guesses are now about day 4, not day 3, so no receipt was made. Choose again.");
  await expect(page.locator("#g-receipts")).toContainText("No receipt from this device for this planting yet.");
  await expect(page.locator("#predict-send")).toBeDisabled();
  await expect(page.locator("#predict-choices input:checked")).toHaveCount(0);
  // A garden that cannot be read makes none either.
  current = fixture(openMutate);
  await page.reload();
  await page.getByLabel("the rest (every other line)").check();
  await page.unroute(VIEW);
  await page.route(VIEW, (route) => json(route, { error: "busy" }, 500));
  await page.locator("#predict-send").click();
  await expect(page.locator("#predict-answer")).toHaveText("The garden could not be read just now, so no receipt was made; try again.");
  await expect(page.locator("#g-receipts")).toContainText("No receipt from this device for this planting yet.");
});

test("dawn predictions: without storage the receipt lasts in this tab; a later stored guess replaces it", async ({ page, browser }, testInfo) => {
  // Storage that refuses the first write of the receipts and takes the next ones.
  await page.addInitScript(() => {
    let refused = false;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("cadence-garden-predictions:") && !refused) { refused = true; throw new DOMException("quota", "QuotaExceededError"); }
      return set.call(this, key, value);
    };
  });
  await serve(page, () => fixture(openMutate));
  await page.goto("/garden/");
  await page.getByLabel("the rest (every other line)").check();
  await page.locator("#predict-send").click();
  await expect(page.locator("#predict-answer")).toHaveText(/^This device keeps no storage here, so the receipt lasts only while this tab is open: day 3, the rest, receipt [0-9a-f]{12}\. Nothing was sent anywhere\.$/);
  const receipt = page.locator('#g-receipt-list li[data-receipt="3"]');
  await expect(receipt).toContainText("You guessed the rest, from day 2");
  // Storage works again; a changed mind is stored and replaces the tab's unstored receipt, not the other way round.
  await page.getByLabel("the line of founder 14 (0:14)").check();
  await page.locator("#predict-send").click();
  await expect(page.locator("#predict-answer")).toHaveText(/^Kept on this device: day 3, the line of founder 14 \(0:14\)/);
  await expect(page.locator("#g-receipt-list li")).toHaveCount(1);
  await expect(receipt).toContainText("You guessed the line of founder 14 (0:14), from day 2");

  // No crypto.subtle (an insecure origin): no receipt can be made, and the page says why beside the button.
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const bare = await context.newPage();
  await bare.clock.setFixedTime(FIXTURE.now);
  await bare.addInitScript(() => { Object.defineProperty(Crypto.prototype, "subtle", { configurable: true, get() { return undefined; } }); });
  await serve(bare, () => fixture(openMutate));
  await bare.goto("/garden/");
  await expect(bare.locator("#g-predict-words")).toHaveText("Guesses about day 3 are open until it is released to an island.");
  await bare.getByLabel("the rest (every other line)").check();
  await expect(bare.locator("#predict-send")).toBeDisabled();
  await expect(bare.locator("#predict-why")).toHaveText("This browser has no crypto.subtle here, so receipts can’t be made.");
  await context.close();
});

test("dawn predictions: a shut window says why; a view without leaders shows no panel", async ({ page }) => {
  let current = fixture();
  await serve(page, () => current);
  await page.goto("/garden/");
  // The fixture's newest day is done, not verified.
  await expect(page.locator("#g-predict-words")).toHaveText("Predictions open when the newest day is verified and the next is not yet released. Day 2 is not verified yet.");
  await expect(page.locator("#predict-send")).toBeDisabled();
  await expect(page.locator("#predict-choices")).toBeHidden();
  await expect(page.locator("#g-field-words")).toContainText("At the end of day 1, no key clearly leads");
  await expect(page.locator("#g-lines-words")).toHaveText("The line of founder 14 (0:14) held the field at the end of day 1: 52% of its living cells, counting day 0’s three biggest keys each with its mutants born on those two days.");
  await expect(page.locator("#g-tally")).toContainText("the rest held the field on 0, one of the day before’s three biggest lines on 1");
  await expect(page.locator("#predict-privacy")).toContainText("The garden has no route for guesses and this page sends none");

  current = fixture((v) => { openMutate(v); v.days[0].leaders = { status: "pending", census: null, lines: null }; });
  await page.reload();
  await expect(page.locator("#g-predict-words")).toHaveText("Day 2 is verified; its files are still being counted.");

  current = fixture((v) => { delete v.leadersRule; for (const d of v.days) delete d.leaders; });
  await page.reload();
  await expect(page.locator("#garden-message")).toHaveText("The garden answered.");
  await expect(page.locator("#g-field-row")).toBeHidden();
  await expect(page.locator("#g-predict-row")).toBeHidden();
  await expect(page.locator("#g-step")).toHaveText("393,216");
});

test("since your last visit, and without storage", async ({ page, browser }, testInfo) => {
  await serve(page);
  await page.goto("/garden/");
  await expect(page.locator("#g-since")).toHaveText("First visit from this device. Next time, this says what changed since now.");
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [keyFor(testInfo), record(131072, 0)] as const);
  await page.reload();
  await expect(page.locator("#g-since")).toContainText("2 days");
  await expect(page.locator("#g-since")).toContainText("262,144");
  await expect(page.locator("#g-since")).toContainText("2 more days replayed by a second island.");
  await expect(page.locator("#g-since")).toContainText("Letters landed since: ltr-1, ltr-2.");
  await page.reload();
  await expect(page.locator("#g-since")).toHaveText(/^No change since your last visit \(.+\): still at step 393,216\.$/);
  // Planted again under the same name: no comparison, and the old "Yours" marks go.
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [keyFor(testInfo), record(393216, 2, ["ltr-4"], FIXTURE.createdAt - 86_400_000)] as const);
  await page.reload();
  await expect(page.locator("#g-since")).toContainText("The garden was planted again since your last visit");
  await expect(page.locator("#g-waiting .garden-mine")).toHaveCount(0);

  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const locked = await context.newPage();
  await locked.clock.setFixedTime(FIXTURE.now);
  await locked.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("The operation is insecure.", "SecurityError"); } });
  });
  const errors: string[] = [];
  locked.on("pageerror", (e) => errors.push(e.message));
  await serve(locked);
  await locked.goto("/garden/");
  await expect(locked.locator("#g-step")).toHaveText("393,216");
  await expect(locked.locator("#g-since")).toHaveText("Nothing to compare: this device keeps no record of earlier visits.");
  expect(errors).toEqual([]);
  await context.close();

  // Storage that reads but will not write: the page does not promise a "next time".
  const full = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const quota = await full.newPage();
  await quota.clock.setFixedTime(FIXTURE.now);
  await quota.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); };
  });
  await serve(quota);
  await quota.goto("/garden/");
  await expect(quota.locator("#g-since")).toHaveText("First visit from this device, and it cannot keep a record, so there will be nothing to compare next time.");
  await full.close();
});

test("polls, recomputes since-your-last-visit and counts times from the response", async ({ browser }, testInfo) => {
  // A visitor clock five minutes after the response's `now`: relative times must still come from `now`.
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const page = await context.newPage();
  await page.clock.install({ time: FIXTURE.now + 5 * 60_000 });
  await page.addInitScript(([key, value]) => { localStorage.setItem(key, value); }, [keyFor(testInfo), record(393216, 2)] as const);
  let body = fixture();
  const counter = await serve(page, () => body);
  await page.goto("/garden/");
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

test("a stone confirmed while an overlapping read failed is still this device's", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
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
  await page.goto("/garden/");
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
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), keyFor(testInfo));
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
  await page.locator("#food-send").click();
  await expect(page.locator("#food-answer")).toHaveText("This is the example garden from the contract, so nothing was sent.");
  expect(requests).toEqual([]);
});

test("another coordinator and a bad link are named", async ({ page }, testInfo) => {
  // A routed (never listening) coordinator on a port that is not the page's own, so the read stays cross-origin.
  const other = `http://localhost:${new URL(originOf(testInfo)).port === "4199" ? 4198 : 4199}`;
  await page.route(`${other}/api/public/garden`, (route) => json(route, fixture(), 200, { "access-control-allow-origin": originOf(testInfo) }));
  await page.goto(`/garden/?coordinator=${other}&garden=..%2Fx`);
  await expect(page.locator("#garden-source")).toContainText(`Reading a garden at ${other}, not this site’s own`);
  await expect(page.locator("#garden-source")).toContainText("The garden name in the link is not one a garden can have");
  await expect(page.locator("#g-fork-link")).toHaveAttribute("href", `${other}/api/public/gardens/commons/checkpoints/4e0b7a19c3d2f856`);
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
test("screenshots", async ({ browser }, testInfo) => {
  test.skip(!shots, "set BL_GARDEN_SHOTS=<dir> to write the screenshots");
  for (const theme of ["light", "dark"] as const) {
    for (const [name, size] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]] as const) {
      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: size, colorScheme: theme });
      const page = await context.newPage();
      await page.clock.setFixedTime(FIXTURE.now);
      await page.addInitScript((t) => { try { localStorage.setItem("browser-life-theme", t); } catch { /* none */ } }, theme);
      await serve(page);
      await page.goto("/garden/");
      await expect(page.locator("#g-step")).toHaveText("393,216");
      await page.screenshot({ path: `${shots}/garden-${theme}-${name}.png`, fullPage: true });
      await context.close();
    }
  }
});

// The sun letter (docs/garden-sun-2026-10-18.md): the page offers the garden's percents, posts exactly {kind, percent}, and lists
// the sun with the day it shines.
test("sun form: posts {kind: \"sun\", percent} and the letter says the day it shines", async ({ page }) => {
  let posted = false;
  await serve(page, () => fixture((v) => {
    if (posted) {
      v.letters.queued = 5;
      v.letters.waiting.push({ ...v.letters.waiting[3], id: "ltr-8", kind: "sun", x: null, y: null, r: null, percent: 75, span: v.pace.stepsPerDay, postedAt: v.now });
      v.sun.nextLanding = { day: 5, step: 786432 };
    }
  }));
  const bodies: unknown[] = [];
  await page.route(LETTERS, async (route) => {
    bodies.push(route.request().postDataJSON());
    await json(route, { letter: { ...FIXTURE.letters.waiting[3], id: "ltr-8", kind: "sun", x: null, y: null, r: null, percent: 75, span: FIXTURE.pace.stepsPerDay } }, 201);
  });
  await page.goto("/garden/");
  await expect(page.locator("#g-sun")).toBeVisible();
  await expect(page.locator("#sun-choices input")).toHaveCount(2);
  await expect(page.locator("#sun-preview")).toHaveText("Your sun would land at step 655,360, the end of day 4, and shine on day 5, all 131,072 steps of it; then the world’s own light returns.");
  await expect(page.locator("#sun-send")).toBeDisabled();
  await expect(page.locator("#sun-why")).toHaveText("Choose how bright: 50%, 75%.");
  await page.locator('#sun-choices input[value="75"]').check();
  await expect(page.locator("#sun-send")).toBeEnabled();
  posted = true;
  await page.locator("#sun-send").click();
  await expect(page.locator("#sun-answer")).toHaveText("Posted as ltr-8. It is public now, lands at step 655,360 (end of day 4), shines on day 5, and counts once a second island replays that day.");
  expect(bodies).toEqual([{ kind: "sun", percent: 75 }]);
  const letter = page.locator('#g-waiting [data-letter="ltr-8"]');
  await expect(letter).toContainText("A sun of 75% (three quarters of the light), landing at step 655,360 (end of day 4); it shines on day 5");
  await expect(letter).toContainText("Yours");
  // The map draws stones only: a sun has no place.
  await expect(page.locator("#stone-map circle.map-mine")).toHaveCount(0);
});

test("sun form: hidden for a garden that takes no sun, or a coordinator from before the sun", async ({ page }) => {
  let body = fixture((v) => { v.sun.percents = []; });
  await serve(page, () => body);
  await page.goto("/garden/");
  await expect(page.locator("#stone-send")).toBeEnabled();
  await expect(page.locator("#g-sun")).toBeHidden();
  body = fixture((v) => { delete v.sun; });
  await page.reload();
  await expect(page.locator("#stone-send")).toBeEnabled();
  await expect(page.locator("#g-sun")).toBeHidden();
});
