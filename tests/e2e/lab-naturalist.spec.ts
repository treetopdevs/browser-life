import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { AxeBuilder } from "@axe-core/playwright";
import type { FromWorker, NaturalistMsg, ToWorker } from "../../apps/lab/src/protocol.ts";

// Field notes, the naturalist in the lab (docs/naturalist-field-notes-v0-2026-10-18.md). The arithmetic and the model are
// unit-tested in apps/lab/test/naturalist.test.ts; here the lab's own GPU world is held to the bundle it should reproduce, and the
// page is read the way a visitor sees it.

interface FixtureCensus { step: number; rows: { count: number; cells: number; sha256: string }; [field: string]: unknown }
const fixture = JSON.parse(readFileSync(new URL("../../apps/lab/test/fixtures/naturalist-gradient-m3-treatment-seed-1.json", import.meta.url), "utf8")) as { fields: string[]; censuses: FixtureCensus[] };
const record = JSON.parse(readFileSync(new URL("../../experiments/naturalist/bell-v1-null.json", import.meta.url), "utf8")) as { runs: { id: string; firstRing11: { startStep: number; endStep: number; minAbsZ: number; value: number; median: number } | null }[] };
const seed1 = record.runs.find((r) => r.id === "replay-m4/gradient-m3/treatment/seed-1")!.firstRing11!;

const planted = (page: Page) => expect(page.locator("#simulation-status")).not.toHaveText(/Planting|No world yet|Warming up/, { timeout: 150_000 });
/** Requests for the published baselines, by path. */
function watchBaselines(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/naturalist/")) seen.push(u.pathname);
  });
  return seen;
}

test("worker: gradient-m3 seed 1 reproduces series.jsonl census for census", async ({ page }) => {
  test.setTimeout(900_000);
  await page.route("**/lab-naturalist-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-naturalist-test");
  const got = await page.evaluate(async (n) => {
    const WorkerConstructor = (await import(/* @vite-ignore */ "/src/sim.worker.ts?worker")).default;
    const worker: Worker = new WorkerConstructor();
    const messages: FromWorker[] = [];
    worker.onmessage = (ev: MessageEvent<FromWorker>) => { messages.push(ev.data); };
    const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
    const wait = async (ok: () => boolean, what: string) => {
      const deadline = performance.now() + 800_000;
      while (performance.now() < deadline) {
        const error = messages.find((m) => m.type === "error");
        if (error?.type === "error") throw new Error(error.message);
        if (ok()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`timed out waiting for ${what}`);
    };
    try {
      const canvas = document.createElement("canvas").transferControlToOffscreen();
      send({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      await wait(() => messages.some((m) => m.type === "ready"), "ready");
      send({ type: "load", presetId: "gradient-m3", seed: 1 });
      await wait(() => messages.some((m) => m.type === "loaded"), "loaded");
      const loaded = messages.find((m) => m.type === "loaded") as Extract<FromWorker, { type: "loaded" }>;
      send({ type: "step", count: n * 100 });
      const nat = () => messages.filter((m): m is NaturalistMsg => m.type === "naturalist");
      await wait(() => nat().length >= n, `${n} censuses`);
      const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
      const out = [];
      for (const m of nat().slice(0, n)) {
        let cells = 0;
        for (const [, c] of m.rows) cells += c;
        const text = m.rows.map(([k, c]) => `${k}\t${c}\n`).join("");
        out.push({ world: m.world, runId: m.runId, step: m.step, touched: m.touched, dropped: m.dropped, rec: m.rec, rows: { count: m.rows.length, cells, sha256: hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))) } });
      }
      return { loadedWorld: loaded.world, runId: loaded.manifest.runId, censuses: out };
    } finally {
      worker.terminate();
    }
  }, fixture.censuses.length);
  expect(got.censuses).toHaveLength(fixture.censuses.length);
  got.censuses.forEach((c, i) => {
    const want = fixture.censuses[i];
    expect(c.world).toBe(got.loadedWorld);
    expect(c.runId).toBe(got.runId);
    expect([c.touched, c.dropped]).toEqual([null, 0]);
    // Every field bit for bit (Object.is through toBe), then the lineage rows by count, cells and digest.
    for (const f of fixture.fields) expect((c.rec as unknown as Record<string, unknown>)[f], `census ${c.step} ${f}`).toBe(want[f]);
    expect(c.rows, `census ${c.step} lineage rows`).toEqual(want.rows);
  });
});

test("worker: a wound, and a jump that replays it, are said to the naturalist at once", async ({ page }) => {
  test.setTimeout(600_000);
  await page.route("**/lab-naturalist-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-naturalist-test");
  const got = await page.evaluate(async () => {
    const WorkerConstructor = (await import(/* @vite-ignore */ "/src/sim.worker.ts?worker")).default;
    const worker: Worker = new WorkerConstructor();
    const messages: FromWorker[] = [];
    worker.onmessage = (ev: MessageEvent<FromWorker>) => { messages.push(ev.data); };
    const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
    const wait = async <T,>(find: () => T | undefined, what: string): Promise<T> => {
      const deadline = performance.now() + 500_000;
      while (performance.now() < deadline) {
        const error = messages.find((m) => m.type === "error");
        if (error?.type === "error") throw new Error(error.message);
        const x = find();
        if (x !== undefined) return x;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`timed out waiting for ${what}`);
    };
    const nat = () => messages.filter((m): m is NaturalistMsg => m.type === "naturalist");
    const touched = () => messages.filter((m): m is Extract<FromWorker, { type: "naturalistTouched" }> => m.type === "naturalistTouched");
    const loaded = () => messages.filter((m): m is Extract<FromWorker, { type: "loaded" }> => m.type === "loaded");
    try {
      const canvas = document.createElement("canvas").transferControlToOffscreen();
      send({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      const ready = await wait(() => messages.find((m): m is Extract<FromWorker, { type: "ready" }> => m.type === "ready"), "ready");
      send({ type: "load", presetId: "gradient-m3", seed: 1 });
      const first = await wait(() => loaded()[0], "loaded");
      send({ type: "step", count: 1000 });
      await wait(() => nat().find((m) => m.step === 1000), "the census at step 1,000");
      if (ready.storage !== null) {
        // No checkpoints in this browser: the live wound is still checked, the jump cannot be.
        send({ type: "lesion", x: 10, y: 10, r: 4 });
        const live = await wait(() => touched()[0], "naturalistTouched");
        send({ type: "step", count: 100 });
        const after = await wait(() => nat().find((m) => m.step === 1100), "the census at step 1,100");
        return { storage: ready.storage, first: { world: first.world, runId: first.manifest.runId }, live, after: { step: after.step, touched: after.touched, world: after.world }, jump: null };
      }
      send({ type: "save" });
      await wait(() => messages.find((m) => m.type === "notice" && /Saved /.test(m.message)), "the save");
      send({ type: "lesion", x: 10, y: 10, r: 4 });
      const live = await wait(() => touched()[0], "naturalistTouched");
      send({ type: "step", count: 100 });
      const after = await wait(() => nat().find((m) => m.step === 1100), "the census at step 1,100");
      // Back to step 1,050: the checkpoint at 1,000 was saved before the wound, so the jump's replay applies it again.
      send({ type: "jump", step: 1050, key: null });
      const second = await wait(() => loaded()[1], "the jump's loaded");
      const replayed = await wait(() => touched().find((m) => m.runId === second.manifest.runId), "naturalistTouched after the jump");
      const order = messages.indexOf(second) < messages.indexOf(replayed);
      return { storage: null, first: { world: first.world, runId: first.manifest.runId }, live, after: { step: after.step, touched: after.touched, world: after.world }, jump: { world: second.world, runId: second.manifest.runId, step: second.step, replayed, order } };
    } finally {
      worker.terminate();
    }
  });
  expect(got.live).toEqual({ type: "naturalistTouched", world: got.first.world, runId: got.first.runId, step: 1000 });
  expect(got.after).toEqual({ step: 1100, touched: 1000, world: got.first.world });
  if (got.storage !== null) test.info().annotations.push({ type: "skipped part", description: `no checkpoints here (${got.storage}): the jump was not checked` });
  else {
    expect(got.jump).not.toBeNull();
    expect(got.jump!.step).toBe(1000);
    expect(got.jump!.runId).not.toBe(got.first.runId);
    expect(got.jump!.replayed).toEqual({ type: "naturalistTouched", world: got.jump!.world, runId: got.jump!.runId, step: 1000 });
    expect(got.jump!.order).toBe(true);
  }
});

test("worker: a hand edit named for a replaced world is refused and changes nothing", async ({ page }) => {
  test.setTimeout(600_000);
  await page.route("**/lab-naturalist-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-naturalist-test");
  const got = await page.evaluate(async () => {
    const WorkerConstructor = (await import(/* @vite-ignore */ "/src/sim.worker.ts?worker")).default;
    const worker: Worker = new WorkerConstructor();
    const messages: FromWorker[] = [];
    worker.onmessage = (ev: MessageEvent<FromWorker>) => { messages.push(ev.data); };
    const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
    const wait = async <T,>(find: () => T | undefined, what: string): Promise<T> => {
      const deadline = performance.now() + 500_000;
      while (performance.now() < deadline) {
        const error = messages.find((m) => m.type === "error");
        if (error?.type === "error") throw new Error(error.message);
        const x = find();
        if (x !== undefined) return x;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`timed out waiting for ${what}`);
    };
    const loaded = () => messages.filter((m): m is Extract<FromWorker, { type: "loaded" }> => m.type === "loaded");
    const refused = () => messages.filter((m): m is Extract<FromWorker, { type: "refused" }> => m.type === "refused");
    const touched = () => messages.filter((m): m is Extract<FromWorker, { type: "naturalistTouched" }> => m.type === "naturalistTouched");
    try {
      const canvas = document.createElement("canvas").transferControlToOffscreen();
      send({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      await wait(() => messages.find((m) => m.type === "ready"), "ready");
      send({ type: "load", presetId: "gradient-m3", seed: 1 });
      const first = await wait(() => loaded()[0], "loaded");
      // A replant queued before a Try for the first world: the Try's edits reach the worker after the replacement.
      send({ type: "load", presetId: "gradient-m3", seed: 1 });
      send({ type: "feed", x: 128, y: 128, r: 127, amount: 32, world: first.world });
      send({ type: "lesion", x: 128, y: 128, r: 127, world: first.world });
      const second = await wait(() => loaded()[1], "the replant's loaded");
      const no = await wait(() => (refused().length >= 2 ? refused() : undefined), "two refusals");
      const before = touched().length;
      // Named for the world on screen, the same edit is applied and logged.
      send({ type: "feed", x: 10, y: 10, r: 4, amount: 4, world: second.world });
      const yes = await wait(() => touched()[0], "naturalistTouched");
      return { first: first.world, second: second.world, no: no.map((m) => ({ request: m.request, message: m.message })), before, yes, order: messages.indexOf(second) < messages.indexOf(no[0]) };
    } finally {
      worker.terminate();
    }
  });
  expect(got.second).not.toBe(got.first);
  expect(got.order).toBe(true);
  expect(got.no).toEqual([
    { request: "feed", message: "That suggestion was made for a world that has since been replaced, so nothing was applied" },
    { request: "lesion", message: "That suggestion was made for a world that has since been replaced, so nothing was applied" },
  ]);
  expect(got.before).toBe(0);
  expect(got.yes.world).toBe(got.second);
});

test("page: gradient-m3 seed 1 rings on living cells with the bell's receipt", async ({ page }) => {
  test.setTimeout(900_000);
  const fetched = watchBaselines(page);
  await page.goto("/lab/?world=gradient-m3&seed=1");
  await planted(page);
  const panel = page.locator("#naturalist");
  await expect(panel).toHaveAttribute("data-state", "listening", { timeout: 60_000 });
  await expect(page.locator("#naturalist-status")).toHaveText("Listening. Nothing counts before step 10,000, so the first note can come at step 14,900.");
  await expect(panel).toContainText("Code, not a model.");
  await expect(page.locator("#naturalist-standing")).toContainText("On 70 fresh neutral runs it had never seen, this rule rang on 0");

  // As fast as the lab goes, to t >= 15,000, then pause.
  await page.locator("#speed").evaluate((el: HTMLInputElement) => { el.value = "9"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.locator("#btn-play").click();
  await expect.poll(async () => Number((await page.locator("#naturalist-read").textContent())?.match(/t=([\d,]+)/)?.[1].replace(/,/g, "") ?? 0), { timeout: 800_000, intervals: [1000] }).toBeGreaterThanOrEqual(15_000);
  await page.locator("#btn-play").click();

  await expect(panel).toHaveAttribute("data-state", "rings");
  const note = page.locator('#naturalist-notes li[data-signal="livingCells"][data-side="low"]');
  await expect(note).toHaveCount(1);
  await expect(note.locator(".naturalist-note-label")).toHaveText("Living cells");
  const n = (x: number) => x.toLocaleString("en-US");
  await expect(note.locator(".naturalist-sentence")).toHaveText(
    `Fewer living cells: ${n(seed1.value)} at step ${n(seed1.startStep)}, against a neutral median there of ${n(seed1.median)}. At least four spreads below it for 50 censuses in a row, from step ${n(seed1.startStep)} to step ${n(seed1.endStep)}; the weakest of them was ${seed1.minAbsZ.toFixed(2)} spreads below the median.`,
  );
  await expect(note.locator(".naturalist-receipt")).toContainText(`livingCells low · steps ${n(seed1.startStep)} to ${n(seed1.endStep)} · value ${n(seed1.value)} against median ${n(seed1.median)}`);
  await expect(note.locator(".naturalist-note-head .badge")).toHaveText(["Measured", "Unclear"]);
  await expect(page.locator("#naturalist-standing")).toContainText("9 of them first on living cells low in the first window it counts, from step 10,000 to step 14,900");
  await expect(panel).not.toContainText(/\bevents?\b|discover/i);

  // The proposer's suggestion beside the note (docs/naturalist-lab-suggestions-v0-2026-10-18.md): words and commands, and a
  // Try it here button that nothing presses but a person.
  const suggestion = note.locator(".naturalist-suggestion");
  await expect(suggestion).toHaveAttribute("data-action", "feed", { timeout: 60_000 });
  await expect(suggestion.locator(".naturalist-suggestion-facts")).toHaveText("Feed at step 14,900, the receipt's last census: 32 quanta of nutrient added to every cell of a disc centred at (128, 128), radius 127, about 77% of the world's cells.");
  await expect(suggestion.locator(".naturalist-prediction")).toContainText("Not yet measured");
  await expect(suggestion.locator(".naturalist-prediction")).toContainText("over steps 30,000 to 34,900 the fork's Living cells stays at least one spread");
  await expect(suggestion).toContainText("that is the bench's question (docs/naturalist-bench-v0-2026-10-18.md), and the bench has not run. This suggestion carries no score.");
  await expect(suggestion).toContainText("The naturalist stops reading at the next census, so it will not say here whether the prediction held.");
  await suggestion.locator("summary", { hasText: "Run it offline" }).click();
  await expect(suggestion.locator(".naturalist-command").first()).toContainText("--feed 14900:128,128,127,32 --out naturalist-lab/gradient-m3-treatment-seed-1-t14900/fork-feed");
  const tryIt = note.getByRole("button", { name: "Try it here: feed 32 quanta per cell, radius 127, at (128, 128)" });
  await expect(tryIt).toBeVisible();
  await expect(page.locator("#k-fed")).toHaveText("none");
  await expect(page.locator("#run-hand-item")).toBeHidden();

  // The panel with a note and its suggestion in it, in both colour schemes: no axe violations (public-a11y.spec.ts checks the empty panel).
  await panel.locator("summary", { hasText: "What this cannot tell you" }).click();
  const theme = page.locator("html");
  for (const night of [false, true]) {
    if (night) {
      await page.locator(".theme-toggle").first().click();
      await expect(theme).toHaveAttribute("data-theme", "dark");
    }
    const axe = await new AxeBuilder({ page }).include("#naturalist").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map((v) => `${night ? "night" : "day"} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
  expect(fetched.filter((p) => p.endsWith("envelope-gradient-m3-v1.json"))).toHaveLength(1);
  expect(fetched.filter((p) => p.endsWith("envelope-gradient-m3-v1.bin"))).toHaveLength(1);
  // Nothing was applied while the panel was read and drawn.
  await expect(page.locator("#k-fed")).toHaveText("none");

  // One click: exactly one feed, logged as a change by hand; reading stops and the panel says so.
  await tryIt.click();
  // The button is replaced by what happened; focus moves to the offer (a live region), not to the page's body.
  await expect(note.locator(".naturalist-offer")).toBeFocused();
  await expect(note.locator(".naturalist-offer")).toHaveAttribute("role", "status");
  await expect(page.locator("#k-fed")).toHaveText(/^\+[\d,]+ in 1 feed$/, { timeout: 60_000 });
  await expect(page.locator("#run-hand")).toHaveText("1 change, unsaved");
  await expect(panel).toHaveAttribute("data-state", "touched");
  await expect(page.locator("#naturalist-status")).toHaveText(/^Stopped reading: the world was changed by hand at step [\d,]+\.$/);
  await expect(page.locator("#naturalist-notes button[data-try]")).toHaveCount(0);
  await expect(note.locator(".naturalist-offer")).toContainText(/^Tried here at step [\d,]+(, not step 14,900)?: one feed logged as a change by hand\. The naturalist stopped reading/);
  await expect(note).toContainText("Filed before the world was changed by hand at step");
  await expect(page.locator("#k-fed")).toHaveText(/ in 1 feed$/);

  // Replanting clears the notes: Even light (searched founders) has its own baseline, fetched once, and nothing of the old world.
  await page.locator("#preset").selectOption("spots-m3");
  await page.locator("#btn-new").click();
  const discard = page.locator("#guard-new").getByRole("button", { name: "Plant without saving" });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await expect(page.locator("#world-heading")).toHaveText("Even light (searched founders)", { timeout: 150_000 });
  await expect(panel).toHaveAttribute("data-state", "listening", { timeout: 60_000 });
  await expect(page.locator("#naturalist-notes li")).toHaveCount(0);
  await expect(page.locator("#naturalist-standing")).toContainText("the bell has never scored one");
  expect(fetched.filter((p) => p.endsWith("envelope-spots-m3-v0.bin"))).toHaveLength(1);
});

test("page: a world outside the envelope says it has no baseline and fetches nothing", async ({ page }) => {
  const fetched = watchBaselines(page);
  await page.goto("/lab/?world=spots&seed=1");
  await planted(page);
  const panel = page.locator("#naturalist");
  await expect(panel).toHaveAttribute("data-state", "no-baseline");
  await expect(page.locator("#naturalist-status")).toHaveText("The naturalist has no baseline for this world yet.");
  await expect(page.locator("#naturalist-detail")).toHaveText("So far it has baselines only for Bright to dim (searched founders) and Even light (searched founders).");
  await page.locator("#btn-play").click();
  await expect.poll(async () => Number((await page.locator("#chip-step").textContent())?.replace(/\D/g, "")), { timeout: 120_000 }).toBeGreaterThan(400);
  await page.locator("#btn-play").click();
  await expect(panel).toHaveAttribute("data-state", "no-baseline");
  await expect(page.locator("#naturalist-notes li")).toHaveCount(0);
  await panel.locator("summary", { hasText: "What this cannot tell you" }).click();
  await expect(page.locator("#naturalist-cannot")).toContainText("It is code, not a model");
  expect(fetched).toEqual([]);
});
