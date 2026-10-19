import { expect, test } from "@playwright/test";
import { sessionFileError, type SessionFile } from "../../apps/lab/src/session-file.ts";

// Pond keeper v2 (docs/pond-keeper-v2-2026-10-17.md), page level, on the breeder world: step to t=500 by hundreds (each step of 100 is
// one census, so the run is the same every time), wound a pond that holds bodies, play to the first pond cycle (t=5,000), read the
// family tree, its rule and the firsts log, breed that cycle with the rule's own donors, replay-check the history and download the
// session file. The version 3 file is the fixture that tests/deno/pond_keeper_replay.ts replays on native WebGPU; BL_WRITE_FIXTURE=1
// rewrites it:
//   BL_WRITE_FIXTURE=1 npx playwright test tests/e2e/lab-pond-keeper-v2.spec.ts --project=chrome
// A family split needs a candidate to qualify for 5,000 steps of censuses, which this short history does not reach, so none is
// asserted here (the vitest tests carry the rule); what a split would say is read from the page only if one happened.

// The tests' tsconfig carries no Node types: the one thing read from the environment is declared here.
declare const process: { env: Record<string, string | undefined> };

const SCRATCH = "test-results";
const FIXTURE = "tests/e2e/fixtures/pond-keeper-session-v3.json";

test("lab page: a wounded pond, the family tree, the new rungs and the v3 session file", async ({ page }) => {
  // The machine may be busy with other GPU work: every wait below is generous, and so is the whole test.
  test.setTimeout(1_800_000);
  const LONG = 360_000;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab/?world=breeder&seed=1");
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 120_000 });
  await expect(page.locator("#world-heading")).toHaveText("The breeder");

  // The family tree is there from the start, titled with its question, and says there is nothing yet.
  const families = page.locator("#families");
  await expect(page.getByRole("heading", { name: "Who’s kin to whom?" })).toBeVisible();
  await expect(page.locator("#families-empty")).toBeVisible();
  await expect(page.locator("#family-tree li")).toHaveCount(0);

  const play = page.locator("#btn-play");
  const breedBar = page.locator("#breed-bar");
  const chip = page.locator("#chip-step");
  await page.locator("#breeder-on").check();

  // To t=500 by hundreds: a census at each, so a wound at t=500 follows a census of the same cycle that saw the bodies.
  for (let t = 100; t <= 500; t += 100) {
    await page.locator("#btn-step100").click();
    await expect(chip).toHaveText(`t = ${t}`, { timeout: 120_000 });
  }
  await expect(page.locator("#family-tree li").first()).toBeVisible({ timeout: 60_000 });
  const starting = await page.locator("#family-tree li").count();
  expect(starting).toBeGreaterThanOrEqual(1);
  await expect(page.locator("#families-empty")).toBeHidden();

  // Wound the middle pond of the 4 by 4 grid (pond 5, its centre at world (96, 96) of the 256 by 256 jar). The view fits the jar in the
  // canvas, centred, so a point of the jar is placed by the canvas's aspect ratio.
  await page.getByRole("button", { name: "Wound", exact: true }).click();
  const box = (await page.locator("#world").boundingBox())!;
  const aspect = box.width / box.height;
  const view = aspect >= 1 ? { w: 256 * aspect, h: 256 } : { w: 256, h: 256 / aspect };
  const click = (wx: number, wy: number) => [box.x + ((wx + (view.w - 256) / 2) / view.w) * box.width, box.y + ((wy + (view.h - 256) / 2) / view.h) * box.height] as const;
  await page.mouse.click(...click(96, 96));
  await expect(page.locator("#run-hand-item")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Look", exact: true }).click();

  // Play on to the first pond cycle at t=5,000, which waits for the breeder.
  await page.locator("#speed").evaluate((el: HTMLInputElement) => { el.value = "6"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(breedBar).toBeVisible({ timeout: LONG });
  await expect(page.locator("#breed-bar-call")).toContainText("Cycle 1");
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");

  // The tree: starting families with a name, a status, their cells and where they came from; the rule is written beside it.
  const rows = page.locator("#family-tree li");
  expect(await rows.count()).toBeGreaterThanOrEqual(starting);
  await expect(rows.first().locator(".family-name")).not.toBeEmpty();
  await expect(rows.first().locator(".family-stats")).toContainText(/\d+ cells? · .* of the jar · \d+ bod(y|ies) · purity/);
  await expect(rows.first().locator(".family-origin")).toContainText(/founded t=[\d,]+ · (a starting family|of unknown descent|from )/);
  await expect(page.locator("#families-summary")).toContainText(/\d+ named · \d+ living · \d+ gone to film · \d+ extinct/);
  // Watched from the first census, so there is no "watching since" notice and nothing has stopped.
  await expect(page.locator("#families-watch")).toBeHidden();
  await expect(page.locator("#families-stopped")).toBeHidden();
  const rule = families.locator("details.family-rules");
  await rule.locator("summary").click();
  await expect(rule).toContainText("descent, not by genome distance");
  await expect(rule).toContainText("5,000 steps in a row");
  await expect(rule).toContainText("Gone to film");
  console.log(`family tree (${await rows.count()}):\n  ${(await rows.allTextContents()).slice(0, 8).join("\n  ")}`);
  console.log(`family log:\n  ${(await page.locator("#family-log li").allTextContents()).join("\n  ")}`);
  // A log row is laid out as the log of firsts is: the step beside the name, not run together with it in one line of inline spans.
  if (await page.locator("#family-log li").count() > 0) {
    const row = page.locator("#family-log li").first();
    const [stepBox, nameBox] = [await row.locator(".first-step").boundingBox(), await row.locator(".first-name").boundingBox()];
    expect(stepBox!.x + stepBox!.width).toBeLessThanOrEqual(nameBox!.x);
  }

  // Next up: up to three rungs not yet reached, each with a bar and the numbers in words (a long body is said with one decimal).
  const rungs = page.locator("#nextup-list li");
  const left = await rungs.count();
  expect(left).toBeGreaterThanOrEqual(1);
  expect(left).toBeLessThanOrEqual(3);
  for (const text of await rungs.locator(".rung-says").allTextContents()) expect(text).toMatch(/^[\d,]+(\.\d)?%? .*· (seen so far|now)$/s);
  await expect(rungs.locator("progress")).toHaveCount(left);
  console.log(`next up:\n  ${(await rungs.allTextContents()).join("\n  ")}`);

  // The log of firsts. The wound at t=500 took cells from a pond that held bodies through the next 1,000 steps (the horizon is
  // min(1,000, half the 5,000-step period)), so the wound's first is in it, with the wound's radius and the cells its bodies lost.
  // (The run is the same every time. A first that fires depends on the history, so no other is asserted.)
  const entries = await page.locator("#firsts-list li").allTextContents();
  console.log(`firsts log (${entries.length}):\n  ${entries.join("\n  ")}`);
  expect(entries.length).toBeGreaterThan(0);
  const outlived = page.locator("#firsts-list li", { hasText: "First pond to outlive a wound" });
  await expect(outlived).toHaveCount(1);
  await expect(outlived).toContainText(/wounded at t=500 \(radius 10, [\d,]+ cells lost\), \d+ bod(y|ies) now, in pond \d+/);
  await expect(outlived.locator(".first-step")).toHaveText("t=1,500");

  // Cycle 1 on the rule's own donors; then on a little, past the reseeding, and a replay check (it moves the world on by 200 steps).
  await page.locator("#breeder-rule").click();
  await page.locator("#breeder-go").click();
  await page.locator("#guard-breed .row button").first().click();
  await expect(breedBar).toBeHidden({ timeout: LONG });
  for (const t of [5_100, 5_200]) {
    await page.locator("#btn-step100").click();
    await expect(chip).toHaveText(`t = ${t.toLocaleString("en-US")}`, { timeout: 120_000 });
  }
  await page.locator("#btn-verify").click();
  await expect(page.locator("#verification-status")).toHaveText("Identical", { timeout: LONG });
  const after = await page.locator("#firsts-list li").allTextContents();
  expect(after.length).toBeGreaterThanOrEqual(entries.length);

  // The card: the wound, the families, the replay check.
  await page.locator("#btn-card").click();
  const card = page.locator("#session-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "Families", exact: true })).toBeVisible();
  await expect(card.locator(".card-section", { hasText: "Families" })).toContainText(/named/i);
  await expect(card.locator(".card-section", { hasText: "Latest replay check" }).locator(".badge")).toHaveText("matched");
  await expect(page.locator("#btn-session-file")).toBeEnabled({ timeout: 60_000 });

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: LONG }), page.locator("#btn-session-file").click()]);
  expect(download.suggestedFilename()).toMatch(/\.session\.json$/);
  await download.saveAs(`${SCRATCH}/pond-keeper-session-v3.json`);
  if (process.env.BL_WRITE_FIXTURE === "1") await download.saveAs(FIXTURE);
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of (await download.createReadStream()) as AsyncIterable<Uint8Array>) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  await expect(page.locator("#card-file-note")).toContainText(`Saved ${download.suggestedFilename()}`);
  await expect(page.locator("#card-file-note")).toContainText("--picks-from");
  await page.locator("#session-card .card-close").click();
  await expect(card).toBeHidden();

  // A picture of the page: the family tree and its log in one frame, and the panel on its own.
  await families.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCRATCH}/pond-keeper-v2.png` });
  await families.screenshot({ path: `${SCRATCH}/pond-keeper-v2-families.png` });

  const file = JSON.parse(text) as SessionFile;
  expect(sessionFileError(file)).toBeNull();
  expect(file.version).toBe(3);
  expect(file.firsts.rules).toBe("firsts-v2");
  const tree = file.families!;
  expect(tree.rules).toBe("families-v1");
  expect(tree.families.length).toBeGreaterThanOrEqual(starting);
  expect(file.final.step).toBeGreaterThanOrEqual(5_400);
  expect(file.card.facts.replay?.ok).toBe(true);
  expect(file.replay).toContain("--picks-from");
  expect(file.replay).toContain(download.suggestedFilename());
  // The wound at t=500 and the rule's cycle at t=5,000.
  const lesions = file.interventions.filter((iv) => iv.kind === "lesion");
  expect(lesions.length).toBeGreaterThanOrEqual(1);
  expect(lesions[0].step).toBe(500);
  expect(file.interventions.filter((iv) => iv.kind === "pick").map((iv) => iv.step)).toEqual([5_000]);
  expect(file.card.facts.wounds).toBeGreaterThanOrEqual(1);
  expect(file.firsts.entries.map((e) => e.id)).toContain("outlive-wound");
  expect(file.card.facts.families.named).toBe(tree.families.length);
  // Exporting may run the world on to its next census, which can only add to the log.
  expect(file.firsts.entries.length).toBeGreaterThanOrEqual(entries.length);
  console.log(`session file: t=${file.final.step}, ${file.firsts.entries.length} firsts [${file.firsts.entries.map((e) => e.id).join(", ")}], ${tree.families.length} families, ${tree.events.length} family events`);
});
