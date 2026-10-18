import { expect, test } from "@playwright/test";
import { sessionFileError, type SessionFile } from "../../apps/lab/src/session-file.ts";

// Pond keeper v0 (docs/pond-keeper-v0-2026-10-17.md), page level: breed a pond world by hand, watch the log of
// firsts fill, read the session card and download the session file. The version 1 fixture that
// tests/deno/pond_keeper_replay.ts replays (tests/e2e/fixtures/pond-keeper-session.json) was written by this spec once
// and is frozen: this spec no longer writes it. The version 2 fixture comes from tests/e2e/lab-pond-keeper-v1.spec.ts.

const SCRATCH = "test-results";

test("lab page: the log of firsts fills while breeding, the card opens and the session file downloads", async ({ page }) => {
  // The machine may be busy with other GPU work: every wait below is generous, and so is the whole test.
  test.setTimeout(900_000);
  const LONG = 360_000;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab/?world=ponds-small&seed=1");
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 120_000 });
  await expect(page.locator("#world-heading")).toHaveText(/Pond cycle \(4 ponds\)/);

  // The panel is there from the start, titled with its question, and says there is nothing yet.
  await expect(page.getByRole("heading", { name: "What happened first?" })).toBeVisible();
  await expect(page.locator("#firsts-empty")).toBeVisible();
  await expect(page.locator("#btn-card")).not.toHaveClass(/lit/);

  const breedBar = page.locator("#breed-bar");
  const play = page.locator("#btn-play");
  await page.locator("#breeder-on").check();
  await page.locator("#speed").evaluate((el: HTMLInputElement) => { el.value = "6"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");

  const breed = async () => {
    await page.locator("#breeder-go").click();
    await page.locator("#guard-breed .row button").first().click();
    await expect(breedBar).toBeHidden({ timeout: LONG });
  };
  const field = async () => (await page.locator("#world").boundingBox())!;

  // Cycle 1 at t=1000: the world stops and waits. Choose the donors by hand: all four ponds, which the rule's single
  // donor cannot equal. The pause for the wound comes after Breed, so Play goes off first.
  await expect(breedBar).toBeVisible({ timeout: LONG });
  await expect(page.locator("#breed-bar-call")).toContainText("Cycle 1");
  await page.locator("#breeder-clear").click();
  const box = await field();
  const d = 0.1 * Math.min(box.width, box.height);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (const [dx, dy] of [[-d, -d], [d, -d], [-d, d], [d, d]]) await page.mouse.click(cx + dx, cy + dy);
  expect(await page.locator("#breeder-list li").count()).toBeGreaterThanOrEqual(2);

  // While the cycle waits the card opens, but the file cannot be made: the button says why, beside it.
  await page.locator("#btn-card").click();
  const card = page.locator("#session-card");
  await expect(card).toBeVisible();
  await expect(page.locator("#btn-session-file")).toBeDisabled();
  await expect(page.locator("#card-file-note")).toContainText("The file waits for the pond cycle: breed first.");
  await page.locator("#session-card .card-close").click();
  await expect(card).toBeHidden();
  await expect(page.locator("#btn-card")).toBeFocused();

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await breed();

  // A wound after the cycle, on the paused world.
  await page.getByRole("button", { name: "Wound", exact: true }).click();
  await page.mouse.click(cx, cy);
  await expect(page.locator("#run-hand-item")).toBeVisible({ timeout: 60_000 });

  // Cycle 2 at t=2000, with the rule's own donors; then cycle 3 at t=3000 waits.
  await play.click();
  await expect(breedBar).toBeVisible({ timeout: LONG });
  await expect(page.locator("#breed-bar-call")).toContainText("Cycle 2");
  await page.locator("#breeder-rule").click();
  await breed();
  await expect(breedBar).toBeVisible({ timeout: LONG });
  await expect(page.locator("#breed-bar-call")).toContainText("Cycle 3");
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await page.locator("#breeder-rule").click();
  await breed();
  await expect(page.locator("#chip-step")).toHaveText(/t = 3,\d{3}/, { timeout: 60_000 });

  // The replay check feeds the card's last section; it moves the world on by 200 steps.
  await page.locator("#btn-verify").click();
  await expect(page.locator("#verification-status")).toHaveText("Identical", { timeout: LONG });

  // The log has entries. Which firsts a history reaches is the world's business, not this test's.
  const entries = await page.locator("#firsts-list li").allTextContents();
  console.log(`firsts log (${entries.length}):\n  ${entries.join("\n  ")}`);
  expect(entries.length).toBeGreaterThan(0);
  await expect(page.locator("#firsts-list li .first-step").first()).toHaveText(/^t=[\d,]+$/);

  // The card: its sections, the pressure in words, the cycles taken by hand and by the rule.
  await page.locator("#btn-card").click();
  await expect(card).toBeVisible();
  for (const heading of ["What was bred", "How far", "What died", "Firsts", "By hand", "Latest replay check"])
    await expect(card.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(card.locator(".card-section", { hasText: "Latest replay check" }).locator(".badge")).toHaveText("matched");
  await expect(card).toContainText(/bound mass/i);
  await expect(card).toContainText(/\d+ cycles: \d+ with your donors, \d+ the rule’s own/);
  await expect(card).toContainText("not proof that your picks caused it");
  await expect(page.locator("#btn-session-file")).toBeEnabled({ timeout: 60_000 });

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: LONG }), page.locator("#btn-session-file").click()]);
  expect(download.suggestedFilename()).toMatch(/\.session\.json$/);
  await download.saveAs(`${SCRATCH}/pond-keeper-session.json`);
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of (await download.createReadStream()) as AsyncIterable<Uint8Array>) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  await expect(page.locator("#card-file-note")).toContainText(`Saved ${download.suggestedFilename()}`);
  await expect(page.locator("#card-file-note")).toContainText("--picks-from");
  await page.screenshot({ path: `${SCRATCH}/pond-keeper.png` });
  await page.locator("#session-card .card-close").click();
  await page.locator("#firsts").screenshot({ path: `${SCRATCH}/pond-keeper-log.png` });

  const file = JSON.parse(text) as SessionFile;
  expect(sessionFileError(file)).toBeNull();
  expect(file.final.step).toBeGreaterThanOrEqual(3200);
  expect(file.card.facts.replay?.ok).toBe(true);
  expect(file.replay).toContain("--picks-from");
  expect(file.replay).toContain(download.suggestedFilename());
  expect(file.interventions.filter((iv) => iv.kind === "pick").length).toBeGreaterThanOrEqual(3);
  expect(file.interventions.filter((iv) => iv.kind === "lesion").length).toBeGreaterThanOrEqual(1);
  expect(file.card.facts.picks.total).toBeGreaterThanOrEqual(3);
  expect(file.card.facts.picks.byHand).toBeGreaterThanOrEqual(1);
  expect(file.card.facts.wounds).toBeGreaterThanOrEqual(1);
  // Exporting may run the world on to its next census, which can only add to the log.
  expect(file.firsts.entries.length).toBeGreaterThanOrEqual(entries.length);
});
