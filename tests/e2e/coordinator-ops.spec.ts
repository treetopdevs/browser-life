/// <reference types="node" />
// The coordinator's operator page (apps/coordinator/priv/static/index.html; docs/ops-dashboard-2026-10-18.md), served
// by route interception from the file on disk, with the admin status (test/fixtures/ops-status.example.json, held to
// a real /api/status by ops_status_test.exs), the garden view (garden-v1's fixture) and discovery mocked. Every /api
// request is answered here, so no coordinator runs. The token, sections, hostile strings and partial failures.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import statusFixture from "../../apps/coordinator/test/fixtures/ops-status.example.json" with { type: "json" };
import gardenFixture from "../../apps/coordinator/priv/static/garden-contract.example.json" with { type: "json" };

type Json = Record<string, any>;
type Answer = [number, unknown];
const PAGE = fileURLToPath(new URL("../../apps/coordinator/priv/static/index.html", import.meta.url));
const TOKEN = "test-token";
const HOSTILE_A = `<img src=x onerror="window.__pwned=1">`;
const HOSTILE_B = `</td><script>window.__pwned=1</script>`;

const clone = <T>(v: T): T => structuredClone(v);
/** The status fixture, changed by `mutate`. */
const status = (mutate: (s: Json) => void = () => {}): Json => { const s = clone(statusFixture) as Json; mutate(s); return s; };
/** The garden view with a failed day (so a requeue line is offered) and its four waiting letters. */
const garden = (name: string): Json => {
  const g = clone(gardenFixture) as Json;
  g.name = name;
  g.state = "stopped";
  g.asleep = false;
  g.pace.nextReleaseAt = null;
  g.pace.releaseDue = false;
  g.days[0].status = "failed";
  g.verification.failed = 1;
  return g;
};
const COMMONS_RUN = "commons/wild-storm-large/treatment/seed-1";
const DISCOVERY = {
  campaigns: [{ campaign: "rv2-local", manifestDigest: "ab".repeat(32), cases: 48, decisions: { accepted: 30, missing: 18 }, activeLeases: 2 }],
  workers: [{ id: "dw-1a2b3c4d5e6f", label: "studio", host: "mac-studio", backend: "wgpu metal", qualified: ["ab".repeat(32)], lastSeen: 1792799990000 }],
};

type Seen = { path: string; url: string; auth: string | undefined; at: number };
type Mock = { status: () => Answer; garden: (name: string) => Answer; discovery: () => Answer | Promise<Answer>; seen: Seen[]; errors: Error[] };
/** An answer that drops the connection instead of responding. */
const DROP: Answer = [0, null];

/** Answers every /api request (anything unexpected is a 404); `mock`'s handlers can be swapped mid-test. */
async function serve(page: Page, overrides: Partial<Omit<Mock, "seen">> = {}): Promise<Mock> {
  const mock: Mock = {
    status: () => [200, status()],
    garden: (name) => [200, garden(name)],
    discovery: () => [200, DISCOVERY],
    seen: [],
    errors: [],
    ...overrides,
  };
  page.on("pageerror", (error) => mock.errors.push(error));
  await page.route("**/coordinator-ops/", (route) => route.fulfill({ status: 200, contentType: "text/html", body: readFileSync(PAGE, "utf8") }));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const auth = request.headers()["authorization"];
    mock.seen.push({ path: url.pathname, url: request.url(), auth, at: Date.now() });
    let answer: Answer = [404, { error: "not found" }];
    if (url.pathname === "/api/status") answer = auth === `Bearer ${TOKEN}` ? mock.status() : [401, { error: "admin authentication required" }];
    else if (url.pathname.startsWith("/api/public/gardens/")) answer = mock.garden(decodeURIComponent(url.pathname.slice("/api/public/gardens/".length)));
    else if (url.pathname === "/api/discovery/status") answer = auth === `Bearer ${TOKEN}` ? await mock.discovery() : [401, { error: "admin authentication required" }];
    if (answer[0] === 0) return route.abort("connectionreset").catch(() => {});
    // A request the page gave up on (its own timeout) can no longer be answered.
    await route.fulfill({ status: answer[0], contentType: "application/json", body: JSON.stringify(answer[1]) }).catch(() => {});
  });
  return mock;
}

async function connect(page: Page): Promise<void> {
  await page.goto("/coordinator-ops/");
  await expect(page.locator("#connection")).toHaveText("Enter an administrator token to view operations.");
  await page.locator("#admin-token").fill(TOKEN);
  await page.locator("#connect").click();
  await expect(page.locator("#connection")).toHaveText("Connected.");
}

const statusAsks = (mock: Mock, from = 0) => mock.seen.slice(from).filter((s) => s.path === "/api/status").length;

/** The cells of the first row of table `id` whose text contains `text`. */
const row = (page: Page, id: string, text: string) => page.locator(`#${id} tr`).filter({ hasText: text }).first().locator("td");

async function noOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, "the page scrolls sideways").toBe(false);
}

test("asks for a token, then sends it only to the admin routes", async ({ page }) => {
  const mock = await serve(page);
  await page.goto("/coordinator-ops/");
  await expect(page.locator("#connection")).toHaveText("Enter an administrator token to view operations.");
  await expect(page.locator("#data")).toBeHidden();
  await expect(page.locator("#experiments tr")).toHaveCount(0);

  await page.locator("#admin-token").fill(TOKEN);
  await page.locator("#connect").click();
  await expect(page.locator("#connection")).toHaveText("Connected.");
  await expect(page.locator("#data")).toBeVisible();
  await expect(page.locator("#admin-token")).toHaveValue("");

  const statusAsks = mock.seen.filter((s) => s.path === "/api/status");
  expect(statusAsks.some((s) => s.auth === `Bearer ${TOKEN}`)).toBe(true);
  expect(mock.seen.filter((s) => s.path === "/api/discovery/status").some((s) => s.auth === `Bearer ${TOKEN}`)).toBe(true);
  const gardens = mock.seen.filter((s) => s.path.startsWith("/api/public/gardens/"));
  expect(gardens.map((s) => s.path)).toContain("/api/public/gardens/commons");
  for (const g of gardens) expect(g.auth, "a garden view never carries the token").toBeUndefined();
  // The token is never on the page.
  expect(await page.locator("body").innerText()).not.toContain(TOKEN);
});

for (const width of [1280, 375]) {
  test(`renders every section from the fixture at ${width} px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const mock = await serve(page);
    await connect(page);

    // Totals
    await expect(page.locator("#totals .card").filter({ hasText: "islands / max" }).locator(".num")).toHaveText("4 / 20000");
    await expect(page.locator("#totals .card").filter({ hasText: "failed" }).first().locator(".num")).toHaveText("1");

    // Experiments: kind, needs and open (segments − done − diverged − failed − blocked).
    const expect_row = async (name: string, cells: Record<number, string>) => {
      const r = row(page, "experiments", name);
      for (const [i, text] of Object.entries(cells)) await expect(r.nth(Number(i))).toHaveText(text);
    };
    await expect_row("breed-trial", { 0: "breed-trial", 1: "breeder", 2: "bred", 3: "breed-v1 + ponds-v1", 11: "8" });
    await expect_row("pond-mix", { 2: "bred", 3: "pond-rand: ponds-v1; pond-breed-mass: breed-v1 + ponds-v1", 11: "6" });
    await expect_row("m5-spots", { 2: "plain", 3: "none", 8: "1", 10: "2", 11: "1" });
    await expect_row("wound-feed", { 2: "scheduled", 3: "interventions-v1", 9: "1", 11: "0" });
    await expect_row("commons", { 2: "garden", 11: "362" });

    // Open work by capability: gardens left out; runs with open segments, open segments, then done but not verified
    // (an upper bound on replay work, which can run in parallel even within one run).
    // The last column: live islands whose last ask advertised every need (island 2, stale, is never counted; island
    // 3 advertised nothing, so it counts only where nothing is needed, where every live island is said to qualify).
    for (const [needs, runs, open, unverified, advertising] of [["breed-v1 + ponds-v1", "3", "12", "1", "1"], ["ponds-v1", "1", "2", "1", "2"], ["none", "1", "1", "8", "all live (3)"], ["interventions-v1", "0", "0", "1", "2"]]) {
      const cells = page.locator("#capabilities tr").filter({ has: page.locator("td:first-child", { hasText: new RegExp(`^${needs.replace(/[+]/g, "\\+")}$`) }) }).locator("td");
      await expect(cells.nth(1)).toHaveText(runs);
      await expect(cells.nth(2)).toHaveText(open);
      await expect(cells.nth(3)).toHaveText(unverified);
      await expect(cells.nth(5)).toHaveText(advertising);
    }
    await expect(page.locator("#capabilities th").nth(5)).toHaveText("live islands that last advertised all of these");
    await expect(page.locator("#capabilities tr")).toHaveCount(5);

    // The garden card: state, days, verification and keeper lines (as text, with the token variable, never the token).
    const card = page.locator('#gardens article[data-garden="commons"]');
    await expect(card.locator("dd").first()).toHaveText("stopped");
    await expect(card).toContainText("3 done of 365");
    await expect(card).toContainText("2 of 3 replayed and matched: 0 verified on a different device type, 2 replayed here, not yet verified elsewhere");
    await expect(card).toContainText("4 queued of 64");
    await expect(card).toContainText("— (stopped at a diverged or failed day)");
    // A same-device-type replay is never shown as verified.
    const day1 = card.locator("table tr").filter({ has: page.locator("td:first-child", { hasText: /^1$/ }) }).locator("td");
    await expect(day1.nth(1)).toHaveText("replayed here, not yet verified elsewhere");
    await expect(day1.nth(1)).not.toHaveClass(/\bok\b/);
    const cmds = card.locator("pre.cmd");
    await expect(cmds).toHaveCount(5);
    const origin = new URL(page.url()).origin;
    await expect(cmds.first()).toHaveText(`curl -sS -X POST -H "authorization: Bearer $BL_ADMIN_TOKEN" '${origin}/api/gardens/commons/days/2/requeue'`);
    await expect(cmds.nth(1)).toContainText("/api/gardens/commons/letters/ltr-4/drop");
    await expect(page.locator("#gardens button, #gardens form, #gardens a")).toHaveCount(0);

    // Failures, divergences and observation mismatches.
    const failure = row(page, "failures", "wound-feed");
    await expect(failure.nth(0)).toHaveText("wound-feed");
    await expect(failure.nth(2)).toHaveText("1");
    await expect(failure.nth(7)).toContainText("past MATTER_MAX (67108864)");
    await expect(row(page, "divergences", "m5-spots").nth(4)).toHaveText("3f9a0c71d2e4b856");
    await expect(row(page, "mismatches", "breed-trial").nth(3)).toHaveText("wgpu Apple M1 Pro");

    // Islands by device type and by runner; the garden flag (a token is configured in the fixture).
    const m1 = row(page, "islands-by-device", "wgpu Apple M1 Pro");
    await expect(m1.nth(1)).toHaveText("2");
    await expect(m1.nth(2)).toHaveText("1");
    await expect(m1.nth(3)).toHaveText("1");
    await expect(row(page, "islands-by-runner", "headless (deno)").nth(1)).toHaveText("2");
    await expect(row(page, "islands-by-runner", "browser").nth(1)).toHaveText("2");
    await expect(page.locator("#islands tr")).toHaveCount(5);
    await expect(page.locator("#islands tr").nth(1).locator("td").first()).toHaveText("isl-Pp1oO2iI3uU4");
    await expect(page.locator("#island-totals .card").filter({ hasText: "garden islands" }).locator(".num")).toHaveText("2");
    // Each island's last advertised list (the first listed advertised nothing).
    await expect(page.locator("#islands th").nth(4)).toHaveText("last advertised");
    await expect(page.locator("#islands tr").nth(1).locator("td").nth(4)).toHaveText("—");
    await expect(row(page, "islands", "isl-Ab3dE9fGh1Jk").nth(4)).toHaveText("breed-v1, interventions-v1, ponds-v1, ponds-v2");

    // Islands by capability, as last advertised: most islands first, then by name; the gating column; and a row
    // for the islands with none recorded.
    await expect(page.locator("#islands-capability-state")).toHaveText("");
    const byCap = page.locator("#islands-by-capability tr");
    await expect(byCap).toHaveCount(7);
    const capRows = [
      ["interventions-v1", "3", "2", "1", "yes"], ["ponds-v1", "3", "2", "1", "yes"], ["ponds-v2", "3", "2", "1", "yes"],
      ["breed-v1", "2", "1", "1", "yes"], ["zz-preview", "1", "0", "1", "no"], ["(none recorded)", "1", "1", "0", "—"],
    ];
    for (const [i, cells] of capRows.entries()) await expect(byCap.nth(i + 1).locator("td")).toHaveText(cells);

    // Limits and discovery.
    await expect(row(page, "limits", "joins per client address").nth(1)).toHaveText("off");
    await expect(row(page, "limits", "task requests (next) per island").nth(1)).toHaveText("120 per 1 min");
    await expect(row(page, "limits", "islands in the table").nth(1)).toHaveText("4 of 20000");
    await expect(row(page, "limits", "garden island token").nth(1)).toContainText("configured: gardens go only");
    await expect(row(page, "discovery-campaigns", "rv2-local").nth(2)).toHaveText("accepted: 30, missing: 18");
    await expect(row(page, "discovery-workers", "studio").nth(3)).toHaveText("1");
    await expect(page.locator("#discovery-state")).toHaveText("");
    expect(mock.errors).toEqual([]);

    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(width === 1280 ? "coordinator-ops.png" : `coordinator-ops-${width}.png`), fullPage: true });
  });
}

test("escapes a hostile experiment name, failure reason, adapter and user agent", async ({ page }) => {
  const mock = await serve(page, {
    status: () => [200, status((s) => {
      s.experiments[HOSTILE_A] = { ...s.experiments.commons, experiment: HOSTILE_A, garden: true };
      s.capabilityNeeds[HOSTILE_A] = { treatment: ["interventions-v1"] };
      s.runs.push({ run: `${HOSTILE_A}/wild-storm-large/treatment/seed-1`, segments: 365, done: 0, verified: 0, diverged: 0, failed: 1, blocked: 364 });
      s.failures.push({ ...s.failures[0], run: `${HOSTILE_A}/wild-storm-large/treatment/seed-1`, index: 0, reason: HOSTILE_B });
      s.islands[0].adapter = HOSTILE_A;
      s.islands[0].user_agent = HOSTILE_B;
      s.islands[0].capabilities = [HOSTILE_A, HOSTILE_B];
      s.islandCapabilities.byCapability[HOSTILE_A] = { islands: 1, live: 1, known: false };
      s.islandCapabilities.byCapability[HOSTILE_B] = { islands: 1, live: 1, known: false };
    })],
  });
  await connect(page);

  await expect(page.locator("#experiments td").filter({ hasText: HOSTILE_A }).first()).toHaveText(HOSTILE_A);
  await expect(page.locator("#failures td.reason").filter({ hasText: "window.__pwned" })).toHaveText(HOSTILE_B);
  await expect(page.locator("#islands-by-device td").filter({ hasText: "onerror" })).toHaveText(HOSTILE_A);
  await expect(page.locator("#islands td").filter({ hasText: "</script>" }).first()).toHaveText(HOSTILE_B);
  // A recorded capability name, in the by-capability table and on the island's row.
  await expect(page.locator("#islands-by-capability td").filter({ hasText: "onerror" })).toHaveText(HOSTILE_A);
  await expect(page.locator("#islands-by-capability td").filter({ hasText: "</script>" })).toHaveText(HOSTILE_B);
  await expect(page.locator("#islands td.mono").filter({ hasText: "onerror" })).toHaveText(`${HOSTILE_A}, ${HOSTILE_B}`);

  // The hostile garden: fetched under its percent-encoded name, rendered, and given no shell line.
  const card = page.locator("#gardens article").filter({ has: page.locator("h3", { hasText: "onerror" }) });
  await expect(card.locator("h3.mono")).toHaveText(HOSTILE_A);
  await expect(card.locator(".unsafe")).toContainText("not safe to paste");
  await expect(card.locator("pre.cmd")).toHaveCount(0);
  expect(mock.seen.some((s) => s.url.endsWith(`/api/public/gardens/${encodeURIComponent(HOSTILE_A)}`))).toBe(true);
  await expect(page.locator('#gardens article[data-garden="commons"] pre.cmd')).toHaveCount(5);

  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.locator("script")).toHaveCount(1);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
});

test("one garden's 404 or 503, a failing discovery call, and a later 401", async ({ page }) => {
  const mock = await serve(page, {
    status: () => [200, status((s) => {
      s.experiments.meadow = { ...s.experiments.commons, experiment: "meadow" };
      s.capabilityNeeds.meadow = { treatment: ["interventions-v1"] };
    })],
    garden: (name) => (name === "commons" ? [404, { error: "not found" }] : [503, { error: "the garden is busy; retry shortly" }]),
    discovery: () => [500, { error: "boom" }],
  });
  await connect(page);

  await expect(page.locator('#gardens article[data-garden="commons"] .garden-error')).toHaveText("No garden view for this name (404).");
  await expect(page.locator('#gardens article[data-garden="meadow"] .garden-error')).toContainText("busy (503)");
  await expect(page.locator("#discovery-state")).toHaveText("discovery is not answering (status 500)");
  // The rest of the page is unaffected.
  await expect(row(page, "experiments", "breed-trial").nth(11)).toHaveText("8");
  await expect(row(page, "failures", "wound-feed").nth(0)).toHaveText("wound-feed");
  await expect(row(page, "limits", "islands in the table").nth(1)).toHaveText("4 of 20000");

  // The token stops working: the data goes, the page says the token was refused and stops asking until a token
  // is entered again.
  const ok = mock.status;
  mock.status = () => [401, { error: "admin authentication required" }];
  await expect(page.locator("#connection")).toHaveText("The coordinator refused that token (401). Enter the administrator token.");
  await expect(page.locator("#data")).toBeHidden();
  await expect(page.locator("#experiments tr")).toHaveCount(0);
  await expect(page.locator("#gardens article")).toHaveCount(0);
  const at = mock.seen.length;
  await page.waitForTimeout(7_000);
  expect(statusAsks(mock, at), "no poll after a 401").toBe(0);
  mock.status = ok;
  await page.locator("#admin-token").fill(TOKEN);
  await page.locator("#connect").click();
  await expect(page.locator("#connection")).toHaveText("Connected.");
  await expect(row(page, "experiments", "breed-trial").nth(11)).toHaveText("8");
});

test("a discovery call that does not answer in time holds nothing else back", async ({ page }) => {
  const mock = await serve(page, { discovery: () => new Promise<Answer>((resolve) => setTimeout(() => resolve([200, DISCOVERY]), 30_000)) });
  // Discovery requests in flight, from the browser's own request events (start, then abort or finish), in order.
  let inFlight = 0;
  let most = 0;
  let started = 0;
  const isDiscovery = (r: { url(): string }) => new URL(r.url()).pathname === "/api/discovery/status";
  page.on("request", (r) => { if (isDiscovery(r)) { started++; most = Math.max(most, ++inFlight); } });
  page.on("requestfailed", (r) => { if (isDiscovery(r)) inFlight--; });
  page.on("requestfinished", (r) => { if (isDiscovery(r)) inFlight--; });

  await page.goto("/coordinator-ops/");
  await page.locator("#admin-token").fill(TOKEN);
  await page.locator("#connect").click();
  // The page gives discovery five seconds, then renders everything else.
  await expect(page.locator("#connection")).toHaveText("Connected.", { timeout: 15_000 });
  await expect(page.locator("#discovery-state")).toHaveText("discovery is not answering (no response)");
  await expect(row(page, "experiments", "breed-trial").nth(11)).toHaveText("8");
  // It keeps refreshing: a change to the status shows up on a later poll.
  mock.status = () => [200, status((s) => { s.runs[0].done = 5; s.runs[0].verified = 5; })];
  await expect(row(page, "experiments", "breed-trial").nth(11)).toHaveText("5", { timeout: 20_000 });
  // Polls never overlap: each discovery call was given up before the next poll asked again.
  expect(started).toBeGreaterThanOrEqual(2);
  expect(most).toBe(1);
});

test("a garden day or letter id that is not safe to paste gets no shell line", async ({ page }) => {
  await serve(page, {
    garden: (name) => {
      const g = garden(name);
      g.days[0].day = "1;x";
      g.days[1].status = "failed";
      g.days[1].day = 10_000_000_000;
      g.letters.waiting[0].id = "ltr-1'; rm -rf ~; '";
      return [200, g];
    },
  });
  await connect(page);
  const card = page.locator('#gardens article[data-garden="commons"]');
  await expect(card.locator(".unsafe")).toHaveCount(3);
  await expect(card.locator(".unsafe").first()).toContainText("not safe to paste");
  // Only the three letters that pass are offered.
  await expect(card.locator("pre.cmd")).toHaveCount(3);
  for (const text of await card.locator("pre.cmd").allTextContents()) {
    expect(text).not.toContain("rm -rf");
    expect(text).not.toContain(";x");
    expect(text).not.toContain("10000000000");
  }
});

test("a failed or diverged garden day older than the days shown still gets its requeue line", async ({ page }) => {
  await serve(page, {
    status: () => [200, status((s) => {
      // Day 0 diverged after days 1–20 were done; days 1–20 are blocked behind it.
      s.divergences.push({ ...s.divergences[0], run: COMMONS_RUN, index: 0 });
    })],
    garden: (name) => {
      const g = garden(name);
      const day = g.days[0];
      g.days = Array.from({ length: 14 }, (_, i) => ({ ...day, day: 20 - i, status: "blocked", verification: null }));
      g.verification.failed = 0;
      g.verification.diverged = 1;
      g.letters.waiting = [];
      return [200, g];
    },
  });
  await connect(page);
  const card = page.locator('#gardens article[data-garden="commons"]');
  await expect(card.locator("pre.cmd")).toHaveCount(1);
  await expect(card.locator("pre.cmd")).toContainText("/api/gardens/commons/days/0/requeue");
  await expect(card).toContainText("Requeue day 0 (diverged; older than the days shown):");
  await expect(card).not.toContainText("Nothing to requeue or drop.");
});

test("a failed poll keeps the last view, dimmed, and the page recovers", async ({ page }) => {
  const mock = await serve(page);
  await connect(page);
  const ok = mock.status;

  mock.status = () => [500, { error: "boom" }];
  await expect(page.locator("#connection")).toContainText("Status unavailable (500). Showing the view from", { timeout: 15_000 });
  await expect(page.locator("#data")).toBeVisible();
  await expect(page.locator("#data")).toHaveClass(/stale/);
  await expect(row(page, "experiments", "breed-trial").nth(11)).toHaveText("8");
  await expect(row(page, "failures", "wound-feed").nth(0)).toHaveText("wound-feed");

  mock.status = ok;
  await expect(page.locator("#connection")).toHaveText("Connected.", { timeout: 30_000 });
  await expect(page.locator("#data")).not.toHaveClass(/stale/);

  // A dropped connection: the same.
  mock.status = () => DROP;
  await expect(page.locator("#connection")).toContainText("Coordinator unavailable. Showing the view from", { timeout: 15_000 });
  await expect(row(page, "experiments", "breed-trial").nth(11)).toHaveText("8");
  expect(mock.errors).toEqual([]);
});

test("a malformed status row or body is reported, not thrown", async ({ page }) => {
  const mock = await serve(page, { status: () => [200, status((s) => { s.failures = [null]; })] });
  await page.goto("/coordinator-ops/");
  await page.locator("#admin-token").fill(TOKEN);
  await page.locator("#connect").click();
  await expect(page.locator("#connection")).toContainText("The status could not be drawn", { timeout: 15_000 });
  await expect(page.locator("#data")).toBeVisible();

  mock.status = () => [200, null];
  await expect(page.locator("#connection")).toContainText("The status could not be read.", { timeout: 30_000 });
  expect(mock.errors).toEqual([]);
});

test("a status without islandCapabilities (an older coordinator) says so, not throws", async ({ page }) => {
  const mock = await serve(page, { status: () => [200, status((s) => { delete s.islandCapabilities; for (const i of s.islands) delete i.capabilities; })] });
  await connect(page);
  await expect(page.locator("#islands-capability-state")).toContainText("carries no islandCapabilities");
  await expect(page.locator("#islands-by-capability tr")).toHaveCount(0);
  // No count is made up for the "advertised" column; the rest of the table stands.
  const none = page.locator("#capabilities tr").filter({ has: page.locator("td:first-child", { hasText: /^none$/ }) }).locator("td");
  await expect(none.nth(3)).toHaveText("8");
  await expect(none.nth(5)).toHaveText("—");
  await expect(row(page, "islands", "isl-Ab3dE9fGh1Jk").nth(4)).toHaveText("—");
  await expect(page.locator("#connection")).toHaveText("Connected.");
  expect(mock.errors).toEqual([]);
});

test("islands by capability: names the coordinator left out, and more rows than the page draws, become one row", async ({ page }) => {
  await serve(page, { status: () => [200, status((s) => {
    s.islandCapabilities.omittedNames = 5;
    for (let n = 0; n < 120; n++) s.islandCapabilities.byCapability[`x-${String(n).padStart(3, "0")}`] = { islands: 5, live: 5, known: false };
  })] });
  await connect(page);
  const byCap = page.locator("#islands-by-capability tr");
  // Header, 100 drawn names, the "other names" row and "(none recorded)".
  await expect(byCap).toHaveCount(103);
  await expect(byCap.nth(101).locator("td")).toHaveText(["(30 other names not listed)", "—", "—", "—", "no"]);
  await expect(byCap.nth(102).locator("td").first()).toHaveText("(none recorded)");
  // The cut keeps every gated name, though 120 others are on more islands; it drops "zz-preview" and 24 of the others (30 with the 5 the coordinator left out).
  for (const name of ["breed-v1", "interventions-v1", "ponds-v1", "ponds-v2"]) await expect(page.locator("#islands-by-capability td", { hasText: new RegExp(`^${name}$`) })).toHaveCount(1);
  await expect(page.locator("#islands-by-capability td", { hasText: /^zz-preview$/ })).toHaveCount(0);
});

test("open work by capability: a need missing from capabilityNeeds gets no island count", async ({ page }) => {
  await serve(page, { status: () => [200, status((s) => { for (const name of Object.keys(s.capabilityNeeds)) delete s.capabilityNeeds[name]; })] });
  await connect(page);
  const none = page.locator("#capabilities tr").filter({ has: page.locator("td:first-child", { hasText: /^none$/ }) }).locator("td");
  await expect(none.nth(5)).toHaveText("—");
});

test("limits: a key missing from config, and no pending cap", async ({ page }) => {
  await serve(page, { status: () => [200, status((s) => { s.limits.unset = ["island_next_per_island"]; s.limits.budgets.next.limit = null; s.limits.islandMaxPending = null; })] });
  await connect(page);
  await expect(row(page, "limits", "task requests (next) per island").nth(1)).toHaveText("not configured: the coordinator applies its built-in default");
  await expect(row(page, "limits", "joins per client address").nth(1)).toHaveText("off");
  await expect(row(page, "limits", "pending assignments per island").nth(1)).toHaveText("no cap");
});

test("a selected curl line survives the next poll, and a hidden tab stops polling", async ({ page }) => {
  const mock = await serve(page);
  await connect(page);
  const cmd = page.locator('#gardens article[data-garden="commons"] pre.cmd').first();
  const text = await cmd.textContent();
  await cmd.evaluate((node) => { const r = document.createRange(); r.selectNodeContents(node); const s = document.getSelection()!; s.removeAllRanges(); s.addRange(r); });

  mock.status = () => [200, status((s) => { s.runs[0].done = 5; s.runs[0].verified = 5; })];
  await expect(page.locator("#connection")).toContainText("Updates are held while text on the page is selected", { timeout: 15_000 });
  expect(await page.evaluate(() => document.getSelection()!.toString())).toBe(text);
  await expect(row(page, "experiments", "breed-trial").nth(11)).toHaveText("8");

  await page.evaluate(() => document.getSelection()!.removeAllRanges());
  await expect(row(page, "experiments", "breed-trial").nth(11)).toHaveText("5", { timeout: 15_000 });

  // Hidden just after a poll settles (its next is then scheduled): that scheduled poll never runs, nor any other;
  // visible again: polling resumes.
  const setVisibility = (state: string) => page.evaluate((v) => { Object.defineProperty(document, "visibilityState", { value: v, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }, state);
  const before = statusAsks(mock);
  await expect.poll(() => statusAsks(mock), { timeout: 15_000 }).toBeGreaterThan(before);
  await page.waitForTimeout(500);
  // The page's status requests are counted in the page from the moment it hides, in the same task as the hide, so
  // there is neither a race with a poll that fires while still visible nor a blind interval after hiding. (A poll
  // already in flight has made its status request before; its later requests are not to /api/status.)
  const at = mock.seen.length;
  await page.evaluate(() => {
    const w = window as unknown as { __hiddenAsks: number; fetch: typeof fetch };
    const original = w.fetch.bind(window);
    w.__hiddenAsks = 0;
    w.fetch = (input, init) => { if (String(input).includes("/api/status")) w.__hiddenAsks++; return original(input, init); };
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(7_000);
  expect(await page.evaluate(() => (window as unknown as { __hiddenAsks: number }).__hiddenAsks), "no poll while hidden").toBe(0);
  await setVisibility("visible");
  await expect.poll(() => statusAsks(mock, at), { timeout: 10_000 }).toBeGreaterThan(0);
  expect(mock.errors).toEqual([]);
});

test("a double-clicked Connect keeps the token", async ({ page }) => {
  const mock = await serve(page);
  await page.goto("/coordinator-ops/");
  await expect(page.locator("#connection")).toHaveText("Enter an administrator token to view operations.");
  await page.locator("#admin-token").fill(TOKEN);
  await page.locator("#connect").dblclick();
  await expect(page.locator("#connection")).toHaveText("Connected.");
  // A later poll still carries the token: the second (empty) submission replaced nothing.
  const at = mock.seen.length;
  await expect.poll(() => statusAsks(mock, at), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator("#connection")).toHaveText("Connected.");
  expect(mock.seen.filter((s) => s.path === "/api/status").every((s, i) => i === 0 || s.auth === `Bearer ${TOKEN}`)).toBe(true);
});

test("an admin failure record for a day the garden view shows otherwise is offered, with the conflict said", async ({ page }) => {
  await serve(page, {
    // The status lists day 1 failed; the view (cached for a few seconds, so not known to be newer) shows it verified.
    status: () => [200, status((s) => { s.failures.push({ ...s.failures[0], run: COMMONS_RUN, index: 1 }); })],
  });
  await connect(page);
  const card = page.locator('#gardens article[data-garden="commons"]');
  await expect(card.locator("pre.cmd")).toHaveCount(6);
  const conflict = card.locator("p.conflict");
  await expect(conflict).toHaveCount(1);
  await expect(conflict).toHaveText("Requeue day 1 (failed in the admin status; the garden view shows it verified. Either can be a few seconds old; a day no longer failed or diverged is refused (409)):");
  await expect(conflict.locator("+ pre.cmd")).toContainText("/api/gardens/commons/days/1/requeue");
  // Day 2, failed in the view and in no admin record, is offered plainly.
  await expect(card).toContainText("Requeue day 2 (failed):");
});

test("limits: a budget window missing from config, and a malformed setting", async ({ page }) => {
  await serve(page, { status: () => [200, status((s) => {
    s.limits.unset = ["island_next_window_ms"];
    s.limits.budgets.next.windowMs = null;
    s.limits.invalid = ["max_islands", "island_segment_requests_per_island"];
    s.limits.maxIslands = null;
    s.limits.budgets.segment.limit = null;
  })] });
  await connect(page);
  await expect(row(page, "limits", "task requests (next) per island").nth(1)).toHaveText("120 per a window not configured (the coordinator applies its built-in default)");
  await expect(row(page, "limits", "segment requests per island").nth(1)).toContainText("other than a whole number");
  await expect(row(page, "limits", "islands in the table").nth(1)).toContainText("other than a whole number");
});

test("limits: a bad budget window is said whether its limit is set, defaulted, invalid or off", async ({ page }) => {
  await serve(page, { status: () => [200, status((s) => {
    s.limits.unset = ["island_next_per_island"];
    s.limits.invalid = ["island_next_window_ms", "island_segment_requests_per_island", "island_segment_window_ms", "island_requests_window_ms", "island_join_window_ms"];
    s.limits.budgets.next = { limit: null, windowMs: null };
    s.limits.budgets.segment = { limit: null, windowMs: null };
    s.limits.budgets.requests.windowMs = null;
    s.limits.budgets.join = { limit: 20, windowMs: null };
  })] });
  await connect(page);
  const bad = "a window that is set to something other than a whole number";
  await expect(row(page, "limits", "task requests (next) per island").nth(1)).toHaveText(`not configured: the coordinator applies its built-in default; ${bad}`);
  await expect(row(page, "limits", "segment requests per island").nth(1)).toHaveText(`set in config to something other than a whole number; check the coordinator's config; ${bad}`);
  await expect(row(page, "limits", "island route requests per address").nth(1)).toHaveText(`off; ${bad}`);
  await expect(row(page, "limits", "joins per client address").nth(1)).toHaveText(`20 per ${bad}`);
});

test("limits: a budget limit that is not a number in the status is said, not thrown", async ({ page }) => {
  const mock = await serve(page, { status: () => [200, status((s) => { s.limits.budgets.next.limit = { toString: null }; })] });
  await connect(page);
  await expect(row(page, "limits", "task requests (next) per island").nth(1)).toHaveText("not a number in the status");
  expect(mock.errors).toEqual([]);
});

const operatorEvents = () => ({
  since: "2026-10-24T12:34:56.123456Z",
  rateRefusals: { join: 12, next: 34, segment: 56, requests: 78 },
  capacityRefusals: 9,
  prunedIslands: 10,
});
const eventCounts = (page: Page) => page.locator("#operator-events tr td:nth-child(2)");

for (const width of [1280, 375]) {
  test(`operator counters show exact server totals and epoch at ${width} px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const events = operatorEvents();
    events.prunedIslands = Number.MAX_SAFE_INTEGER;
    const mock = await serve(page, { status: () => [200, status((s) => { s.operatorEvents = events; })] });
    await connect(page);
    await expect(eventCounts(page)).toHaveText(["12", "34", "56", "78", "9", "9007199254740991"]);
    await expect(page.locator("#operator-events-since")).toHaveText(`Since counter restart: ${events.since}`);
    await expect(page.locator("#sec-limits")).toContainText("not rates or permanent history");
    await expect(page.locator("#sec-limits")).toContainText("not all HTTP 503 responses");
    await expect(page.locator("#operator-events")).toContainText("Pruned islands (rows removed)");
    await noOverflow(page);
    await page.locator("#sec-limits").screenshot({ path: testInfo.outputPath(`operator-counters-${width}.png`) });

    // The next successful status replaces the entire epoch and its totals, including true zeroes.
    mock.status = () => [200, status((s) => { s.operatorEvents = {
      since: "2026-10-24T13:00:00Z", rateRefusals: { join: 0, next: 0, segment: 0, requests: 0 }, capacityRefusals: 0, prunedIslands: 0,
    }; })];
    await expect(page.locator("#operator-events-since")).toHaveText("Since counter restart: 2026-10-24T13:00:00Z", { timeout: 15_000 });
    await expect(eventCounts(page)).toHaveText(["0", "0", "0", "0", "0", "0"]);
    expect(mock.errors).toEqual([]);
    // No new routes, local counter mutation or persistence are needed.
    expect(mock.seen.every((request) => request.path === "/api/status" || request.path === "/api/discovery/status" || request.path.startsWith("/api/public/gardens/"))).toBe(true);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  });
}

for (const [label, events] of [
  ["missing", undefined], ["null", null], ["array", []], ["string", "invalid"],
  ["missing epoch", { ...operatorEvents(), since: undefined }],
  ["invalid epoch", { ...operatorEvents(), since: "not a date" }],
  ["invalid calendar date", { ...operatorEvents(), since: "2026-02-30T12:00:00Z" }],
  ["hostile epoch", { ...operatorEvents(), since: HOSTILE_A }],
] as const) {
  test(`operator counters are unavailable with ${label} data`, async ({ page }) => {
    const mock = await serve(page, { status: () => [200, status((s) => { s.operatorEvents = events; })] });
    await connect(page);
    await expect(eventCounts(page)).toHaveText(Array(6).fill("unavailable"));
    await expect(page.locator("#operator-events-since")).toContainText("Counter epoch unavailable");
    await expect(page.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
    expect(mock.errors).toEqual([]);
  });
}

test("operator counters reject malformed counts without hiding valid siblings", async ({ page }) => {
  const mock = await serve(page, { status: () => [200, status((s) => { s.operatorEvents = {
    ...operatorEvents(), rateRefusals: { join: -1, next: 1.5, segment: "12", requests: HOSTILE_B },
    capacityRefusals: Number.MAX_SAFE_INTEGER + 1, prunedIslands: 0,
  }; })] });
  await connect(page);
  await expect(eventCounts(page)).toHaveText(["unavailable", "unavailable", "unavailable", "unavailable", "unavailable", "0"]);
  mock.status = () => [200, status((s) => { s.operatorEvents = { since: operatorEvents().since, rateRefusals: null, capacityRefusals: null }; })];
  await expect(eventCounts(page)).toHaveText(Array(6).fill("unavailable"), { timeout: 15_000 });
  await expect(page.locator("script")).toHaveCount(1);
  expect(mock.errors).toEqual([]);
});
