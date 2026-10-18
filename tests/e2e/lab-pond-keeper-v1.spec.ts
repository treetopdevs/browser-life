import { expect, test } from "@playwright/test";
import { sessionFileError, type SessionFile } from "../../apps/lab/src/session-file.ts";

// Pond keeper v1 (docs/pond-keeper-v1-2026-10-17.md), page level, on the breeder world: set the pressure dial, keep a
// lineage, breed a cycle by hand and two more on the page's own (1 cycle, then 5 cycles stopped after the first), turn
// Breeder mode off and let one more cycle run on the rule alone under the dial, read Next up and the session card,
// replay-check the history and download the session file. The file so holds a pressured boundary with no pick, which
// the headless replay must rank by the dial's score itself. The version 2 file is the
// fixture that tests/deno/pond_keeper_replay.ts replays on native WebGPU (the frozen version 1 fixture is written by
// no spec any more); BL_WRITE_FIXTURE=1 rewrites it:
//   BL_WRITE_FIXTURE=1 npx playwright test tests/e2e/lab-pond-keeper-v1.spec.ts --project=chrome

// The tests' tsconfig carries no Node types: the one thing read from the environment is declared here.
declare const process: { env: Record<string, string | undefined> };

const SCRATCH = "test-results";
const FIXTURE = "tests/e2e/fixtures/pond-keeper-session-v2.json";

test("lab page: the dial, auto-breed and a kept lineage steer the breeder, Next up shows progress and the v2 session file downloads", async ({ page }) => {
  // The machine may be busy with other GPU work: every wait below is generous, and so is the whole test.
  test.setTimeout(1_800_000);
  const LONG = 360_000;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab/?world=breeder&seed=1");
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 120_000 });
  await expect(page.locator("#world-heading")).toHaveText("The breeder");

  const breedBar = page.locator("#breed-bar");
  const play = page.locator("#btn-play");
  const dial = page.locator("#pressure-dial");
  const speed = (v: number) => page.locator("#speed").evaluate((el: HTMLInputElement, value) => { el.value = String(value); el.dispatchEvent(new Event("input", { bubbles: true })); }, v);

  // The dial is there from the start, apart from the ranking, planted as the world says; auto-breed waits for Breeder mode and says so.
  await expect(page.getByText("The rule breeds for", { exact: true })).toBeVisible();
  await expect(page.getByText("Rank the ponds by")).toBeHidden();
  await expect(dial).toBeEnabled({ timeout: 60_000 });
  await expect(dial).toHaveValue("drive+seed+body");
  await expect(dial.locator("option:checked")).toHaveText("As planted: Moving mass, seed packet, body size together");
  await expect(page.locator("#pressure-state")).toContainText("Still as planted");
  await expect(page.locator("#auto-1")).toBeDisabled();
  await expect(page.locator("#auto-status")).toContainText("Turn on");
  await expect(page.locator("#keep-none")).toBeVisible();
  await expect(page.locator("#nextup-list li")).toHaveCount(3);

  await page.locator("#breeder-on").check();
  await expect(page.locator("#auto-1")).toBeEnabled();
  await expect(page.locator("#auto-stop")).toBeDisabled();

  // The pressure: body size, a score the world was not planted with. Choosing it only says what it would do; Set logs it, once.
  const setDial = page.locator("#pressure-set");
  await expect(setDial).toBeDisabled();
  await dial.selectOption("body");
  await expect(page.locator("#pressure-says")).toHaveText("Ranks ponds by body size: the best-ranked ponds become the donors.");
  await expect(page.locator("#pressure-state")).toContainText("Still as planted");
  await expect(setDial).toBeEnabled();
  await setDial.click();
  await expect(page.locator("#pressure-state")).toContainText("Set 1 time", { timeout: 60_000 });
  await expect(setDial).toBeDisabled();
  await expect(page.locator("#pressure-state .badge")).toHaveClass(/note/);
  await expect(dial).toHaveValue("body");

  await speed(6);
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");

  // Keep a lineage from the list once the first census has named some.
  const keepOne = page.locator("#top-lin button.keep").first();
  await expect(keepOne).toBeVisible({ timeout: LONG });
  await keepOne.click();
  await expect(page.locator("#keep-key")).toHaveText(/^\d+:\d+$/, { timeout: 60_000 });
  await expect(page.locator("#keep-none")).toBeHidden();
  await expect(page.locator("#top-lin button.keep[aria-pressed='true']")).toHaveCount(1);
  await expect(page.locator("#keep-where")).toContainText("Waiting for the next cycle");

  // Cycle 1 at t=5,000 waits. The rule's choice is ranked by the dial, and Keep says where the lineage lives.
  await expect(breedBar).toBeVisible({ timeout: LONG });
  await expect(page.locator("#breed-bar-call")).toContainText("Cycle 1");
  await expect(page.locator("#breeder-call")).toContainText("ranks them by body size");
  await expect(page.locator("#keep-where")).toContainText(/Lives in pond \d+|Gone from the jar|too thin to donate/);

  // Moving the dial while the cycle waits re-ranks the rule's choice and keeps the cycle (same step, same bar).
  await dial.selectOption("mass");
  await setDial.click();
  await expect(page.locator("#pressure-state")).toContainText("Set 2 times", { timeout: 60_000 });
  await expect(page.locator("#breeder-call")).toContainText("ranks them by bound mass");
  await expect(page.locator("#breed-bar-call")).toContainText("Cycle 1");
  await page.locator("#breeder-rule").click();
  const picked = await page.locator("#breeder-list li").count();
  expect(picked).toBeGreaterThanOrEqual(1);
  await page.locator("#breeder-go").click();
  await page.locator("#guard-breed .row button").first().click();
  await expect(breedBar).toBeHidden({ timeout: LONG });

  // Cycle 2 on the page's own: one cycle, under the dial and the kept lineage, with no question asked.
  await page.locator("#auto-1").click();
  await expect(page.locator("#auto-stop")).toBeEnabled();
  await expect(page.locator("#auto-1")).toBeDisabled();
  await expect(page.locator("#auto-status")).toContainText(/Auto-breeding|Done: 1 cycle/);
  await expect(page.locator("#auto-status")).toContainText("Done: 1 cycle", { timeout: LONG });
  await expect(page.locator("#auto-stop")).toBeDisabled();
  await expect(page.locator("#chip-step")).toHaveText(/t = 1\d,\d{3}/, { timeout: 120_000 });

  // Cycle 3 at t=15,000 waits (the world was left running). Slow the world right down, then let auto-breed answer it and stop it
  // before the next one, so the history holds exactly three picks.
  await expect(breedBar).toBeVisible({ timeout: LONG });
  await expect(page.locator("#breed-bar-call")).toContainText("Cycle 3");
  await speed(0);
  await page.locator("#auto-5").click();
  await expect(page.locator("#auto-status")).toContainText(/cycle 1 of 5|Auto-breeding/);
  await expect(breedBar).toBeHidden({ timeout: LONG });
  await page.locator("#auto-stop").click();
  await expect(page.locator("#auto-status")).toContainText("Stopped: you pressed Stop after 1 cycle");
  await expect(page.locator("#auto-stop")).toBeDisabled();
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#chip-step")).toHaveText(/t = 1[5-9],\d{3}/, { timeout: 60_000 });
  await expect(page.locator("#pressure-state")).toContainText("Set 2 times");

  // Breeder mode off, with the dial's bound mass in force: cycle 4 at t=20,000 runs on the rule alone, without stopping, and no
  // pick is logged for it. The file then holds a pressured boundary the headless replay must rank by the dial itself.
  await expect(breedBar).toBeHidden();
  await page.locator("#breeder-on").uncheck();
  await expect(page.locator("#auto-1")).toBeDisabled();
  await speed(5);
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#pond-status")).toContainText("cycle 4 · breed", { timeout: LONG });
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(breedBar).toBeHidden();

  // Next up: up to three rungs not yet reached, each with a bar and the numbers in words, said as best-so-far or now. This world
  // climbs the ladder quickly, so how many are left (at least one, at most three) is the history's business, not this test's.
  const rungs = page.locator("#nextup-list li");
  const left = await rungs.count();
  expect(left).toBeGreaterThanOrEqual(1);
  expect(left).toBeLessThanOrEqual(3);
  for (const text of await rungs.locator(".rung-says").allTextContents()) expect(text).toMatch(/^[\d,]+%? .*· (seen so far|now)$/s);
  await expect(rungs.locator("progress")).toHaveCount(left);
  console.log(`next up:\n  ${(await rungs.allTextContents()).join("\n  ")}`);

  // The replay check holds the pressured, auto-bred and kept history to its checkpoint; it moves the world on by 200 steps.
  await page.locator("#btn-verify").click();
  await expect(page.locator("#verification-status")).toHaveText("Identical", { timeout: LONG });

  // The log has entries. Which firsts a history reaches is the world's business, not this test's.
  const entries = await page.locator("#firsts-list li").allTextContents();
  console.log(`firsts log (${entries.length}):\n  ${entries.join("\n  ")}`);
  expect(entries.length).toBeGreaterThan(0);

  // The card: the pressure planted and the dial's setting, cycles by hand and by the rule, the replay check.
  await page.locator("#btn-card").click();
  const card = page.locator("#session-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".card-section", { hasText: "What was bred" })).toContainText("Dial");
  await expect(card.locator(".card-section", { hasText: "What was bred" })).toContainText(/Set 2 times; latest: bound mass/);
  await expect(card.locator(".card-section", { hasText: "What was bred" })).toContainText("Moving mass, seed packet, body size");
  await expect(card).toContainText(/\d+ cycles: \d+ with your donors, \d+ the rule’s own, \d+ ran without stopping for you/);
  await expect(card.locator(".card-section", { hasText: "Latest replay check" }).locator(".badge")).toHaveText("matched");
  await expect(page.locator("#btn-session-file")).toBeEnabled({ timeout: 60_000 });

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: LONG }), page.locator("#btn-session-file").click()]);
  expect(download.suggestedFilename()).toMatch(/\.session\.json$/);
  await download.saveAs(`${SCRATCH}/pond-keeper-session-v2.json`);
  if (process.env.BL_WRITE_FIXTURE === "1") await download.saveAs(FIXTURE);
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of (await download.createReadStream()) as AsyncIterable<Uint8Array>) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  await expect(page.locator("#card-file-note")).toContainText(`Saved ${download.suggestedFilename()}`);
  await expect(page.locator("#card-file-note")).toContainText("--picks-from");
  await page.locator("#session-card .card-close").click();
  await expect(card).toBeHidden();

  // A picture of the page: the dial, auto-breed, the kept lineage and Next up in one frame, and Next up on its own.
  await page.locator("#breeder").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCRATCH}/pond-keeper-v1.png` });
  await page.locator("#nextup").screenshot({ path: `${SCRATCH}/pond-keeper-v1-nextup.png` });

  const file = JSON.parse(text) as SessionFile;
  expect(sessionFileError(file)).toBeNull();
  expect(file.version).toBe(2);
  expect(file.firsts.rules).toBe("firsts-v1");
  expect(file.final.step).toBeGreaterThanOrEqual(20_000);
  expect(file.card.facts.replay?.ok).toBe(true);
  expect(file.replay).toContain("--picks-from");
  expect(file.replay).toContain(download.suggestedFilename());
  expect(file.interventions.filter((iv) => iv.kind === "pressure").length).toBeGreaterThanOrEqual(1);
  // Three picks, at cycles 1 to 3; cycle 4 (t=20,000) ran on the rule under the dial, with no pick.
  expect(file.interventions.filter((iv) => iv.kind === "pick").map((iv) => iv.step)).toEqual([5_000, 10_000, 15_000]);
  expect(file.card.facts.pressures.changes).toBeGreaterThanOrEqual(1);
  expect(file.card.facts.picks.total).toBe(3);
  expect(file.card.facts.cycles).toBeGreaterThanOrEqual(4);
  // Exporting may run the world on to its next census, which can only add to the log.
  expect(file.firsts.entries.length).toBeGreaterThanOrEqual(entries.length);
});
