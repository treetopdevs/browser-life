import { expect, test } from "@playwright/test";
import { sessionFileError, type SessionFile } from "../../apps/lab/src/session-file.ts";

// Pond keeper v3 (docs/pond-keeper-v3-2026-10-22.md, section 5), page level: the Weather control on the breeder, a world planted with
// wounds and shells, the fourth chart and the "Cells wearing a shell" row, the Wound tool's line, a wounded pond, the first pond cycle
// bred on the rule's donors, the replay check and the session file. No fixture is written: nothing here changes the session format.
// What the page says about the breeder panel's tied-at-zero line at the first cycle is logged and not asserted: it depends on the seed
// and the hand wound, and the vitest tests carry the rule.

const SCRATCH = "test-results";
/** "1.7% of living cells (372 of 21,769)": the share first, then the cells it is a share of. A share one decimal would print as 0.0 reads "<0.1%". */
const SHARE = /^(<)?(\d+(?:\.\d)?)% of living cells \(([\d,]+) of ([\d,]+)\)$/;

test("lab page: weather for the breeder, a shelled pond, the shell readout and the session file", async ({ page }) => {
  // The machine may be busy with other GPU work: every wait below is generous, and so is the whole test.
  test.setTimeout(1_800_000);
  const LONG = 360_000;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab/?world=breeder&seed=1");
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 120_000 });
  await expect(page.locator("#world-heading")).toHaveText("The breeder");

  const weather = page.locator("#weather");
  const radio = (name: RegExp) => weather.getByRole("radio", { name });
  const shellBox = page.locator("#sp-shell-box");
  const kShell = page.locator("#k-shell");
  const kNote = page.locator("#k-shell-note");
  const toolSays = page.locator("#tool-says");

  // On the breeder: the Weather control shows Calm chosen, and neither the fourth chart nor the shell row.
  await expect(weather).toBeVisible();
  await expect(weather.locator("legend")).toHaveText("Weather for the breeder");
  await expect(weather).toContainText("to change it, plant again");
  await expect(weather).toContainText("Keep the seed number");
  await expect(weather.getByRole("radio")).toHaveCount(3);
  await expect(radio(/^Calm/)).toBeChecked();
  await expect(page.locator("#weather-does")).toContainText("No wounds of its own");
  await expect(shellBox).toBeHidden();
  await expect(page.locator("#k-shell-dt")).toBeHidden();
  await expect(kShell).toBeHidden();
  await expect(page.locator("#history-lines")).not.toHaveClass(/four/);

  // The control is the breeder's alone: another world hides it, and the breeder brings it back with Calm chosen.
  await page.locator("#preset").selectOption("soup");
  await expect(weather).toBeHidden();
  await page.locator("#preset").selectOption("breeder");
  await expect(weather).toBeVisible();
  await expect(radio(/^Calm/)).toBeChecked();

  // The Wound tool, before the shell world is planted: a plain brush line, with no word about weather.
  await page.getByRole("button", { name: "Wound", exact: true }).click();
  await expect(toolSays).toContainText("clear a patch");
  await expect(toolSays).not.toContainText("not weather");

  // Choosing "Wounds and shells" shows the detail block (computed from the config) and says nothing is planted yet.
  await radio(/^Wounds, no shells/).check();
  await expect(page.locator("#preset")).toHaveValue("breeder-wounded");
  await expect(page.locator("#weather-does")).toContainText("about once per 3,250 steps");
  await radio(/^Wounds and shells/).check();
  await expect(page.locator("#preset")).toHaveValue("breeder-wounded-shell");
  await expect(page.locator("#weather-does")).toContainText("A cell holding at least 2 membrane survives a hit and spends 2 of its membrane");
  await expect(page.locator("#weather-matters")).toContainText("Cells wearing a shell: a chart in How it’s going and a row in Who’s living here?");
  await expect(page.locator("#plant-note")).toContainText("Not planted yet");
  await expect(page.locator("#plant-note")).toContainText("The breeder, seed 1");
  await expect(page.locator("#world-heading")).toHaveText("The breeder");
  await expect(page.locator("#btn-new")).toHaveText("Plant this world");
  // The select moves the radio too: the control is a view of the preset id, not a second state.
  await page.locator("#preset").selectOption("breeder-wounded");
  await expect(radio(/^Wounds, no shells/)).toBeChecked();
  await radio(/^Wounds and shells/).check();
  await expect(radio(/^Wounds and shells/)).toBeChecked();

  // Plant it. The chart and the row appear, the row reads "none yet" before any step (membrane is exactly zero at planting), and the
  // Wound tool, still held, now says its brush is a cut (the "loaded" handler re-runs the tool's line; no click needed).
  await page.locator("#btn-new").click();
  const replaceGuard = page.locator("#guard-new").getByRole("button", { name: /without saving/i });
  if (await replaceGuard.waitFor({ state: "visible", timeout: 3_000 }).then(() => true, () => false)) await replaceGuard.click();
  await expect(page.locator("#world-heading")).toHaveText("The breeder (wounded, shells)", { timeout: 120_000 });
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 120_000 });
  await expect(radio(/^Wounds and shells/)).toBeChecked();
  await expect(shellBox).toBeVisible();
  await expect(page.locator("#history-lines")).toHaveClass(/four/);
  await expect(page.locator("#k-shell-dt")).toBeVisible();
  await expect(kShell).toBeVisible();
  await expect(kShell).toHaveText("none yet", { timeout: 60_000 });
  await expect(kNote).toBeVisible();
  await expect(kNote).toContainText("No living cell holds 2 membrane right now");
  await expect(kNote).toContainText("a wound now would take whatever it hits");
  await expect(page.locator("#chip-step")).toHaveText("t = 0");
  await expect(toolSays).toContainText("This tool is a cut, not weather");
  await expect(toolSays).toContainText("Only the world's own wounds can be weathered");
  await page.getByRole("button", { name: "Look", exact: true }).click();
  await expect(toolSays).not.toContainText("not weather");

  const play = page.locator("#btn-play");
  const breedBar = page.locator("#breed-bar");
  const chip = page.locator("#chip-step");
  await page.locator("#breeder-on").check();

  // To t=500 by hundreds (a census at each). The reference had cells holding the shell's worth by step 2, so the row reads a number
  // at the first census after a step; it is polled, not pinned to a step, and its form is checked when it first reads one.
  let seen: string | null = null;
  for (let t = 100; t <= 500; t += 100) {
    await page.locator("#btn-step100").click();
    await expect(chip).toHaveText(`t = ${t}`, { timeout: 120_000 });
    await expect(kShell).toHaveText(/\S/, { timeout: 60_000 });
    const text = (await kShell.textContent()) ?? "";
    if (seen === null && SHARE.test(text)) seen = text;
  }
  expect(seen, "the shell row read a number by t=500").not.toBeNull();
  const [, below, share, wearing, living] = SHARE.exec(seen!)!;
  const [k, m] = [Number(wearing.replaceAll(",", "")), Number(living.replaceAll(",", ""))];
  expect(k).toBeGreaterThanOrEqual(1);
  expect(k).toBeLessThanOrEqual(m);
  // The share is the first figure, rounded to one decimal ("<0.1%" when a nonzero share would round to 0.0).
  if (below) expect((100 * k) / m).toBeLessThan(0.05);
  else expect(Math.abs(Number(share) - (100 * k) / m)).toBeLessThanOrEqual(0.051);
  console.log(`shell row at its first number: ${seen}; now: ${await kShell.textContent()}`);
  // A number, so the line about a wound taking whatever it hits is gone while it stands.
  if (SHARE.test((await kShell.textContent()) ?? "")) await expect(kNote).toBeHidden();
  await expect(shellBox).toBeVisible();

  // Wound the middle pond of the 4 by 4 grid (pond 5, its centre at world (96, 96) of the 256 by 256 jar). The view fits the jar in the
  // canvas, centred, so a point of the jar is placed by the canvas's aspect ratio. The hand wound is a cut: it is logged as a lesion.
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
  // The panel's own line at this cycle: the tied-at-zero sentence may or may not be in it (logged, not asserted).
  const call = (await page.locator("#breeder-call").textContent()) ?? "";
  const tied = call.includes("the rule picks the heaviest ponds instead");
  console.log(`breeder call at cycle 1 (tied-at-zero sentence ${tied ? "present" : "absent"}): ${call}`);
  if (tied) {
    expect(call).toContain("so the rule’s score cannot tell them apart");
    expect(call).toContain("Another choice under “The rule breeds for” may separate them.");
    expect(call).not.toMatch(/pressure|scores above 0/);
    // The aside is in the body weight, not the status line's bold.
    await expect(page.locator("#breeder-call .breeder-tied")).toHaveCSS("font-weight", "400");
  }
  console.log(`shell row at cycle 1: ${await kShell.textContent()}`);
  await expect(kShell).toHaveText(/^(none yet|(<)?\d+(?:\.\d)?% of living cells \([\d,]+ of [\d,]+\))$/);

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

  // The card, and the session file: the replay check matched, and the file is one a replay can rebuild (the config is the preset's).
  await page.locator("#btn-card").click();
  const card = page.locator("#session-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".card-section", { hasText: "Latest replay check" }).locator(".badge")).toHaveText("matched");
  await expect(page.locator("#btn-session-file")).toBeEnabled({ timeout: 60_000 });

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: LONG }), page.locator("#btn-session-file").click()]);
  expect(download.suggestedFilename()).toMatch(/\.session\.json$/);
  await download.saveAs(`${SCRATCH}/pond-keeper-session-v3-shell.json`);
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of (await download.createReadStream()) as AsyncIterable<Uint8Array>) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  await expect(page.locator("#card-file-note")).toContainText(`Saved ${download.suggestedFilename()}`);
  await page.locator("#session-card .card-close").click();
  await expect(card).toBeHidden();

  const file = JSON.parse(text) as SessionFile;
  expect(sessionFileError(file)).toBeNull();
  expect(file.version).toBe(3);
  expect(file.presetId).toBe("breeder-wounded-shell");
  expect(file.cfg.injuryShell).toBe(2);
  expect(file.replay).toContain("--preset breeder-wounded-shell");
  expect(file.replay).toContain("--picks-from");
  expect(file.final.step).toBeGreaterThanOrEqual(5_400);
  expect(file.card.facts.replay?.ok).toBe(true);
  // The hand wound at t=500 and the rule's cycle at t=5,000.
  const lesions = file.interventions.filter((iv) => iv.kind === "lesion");
  expect(lesions.length).toBeGreaterThanOrEqual(1);
  expect(lesions[0].step).toBe(500);
  expect(file.interventions.filter((iv) => iv.kind === "pick").map((iv) => iv.step)).toEqual([5_000]);
  // Display only: the shell count is a field of no part of the file.
  expect(Object.keys(file)).not.toContain("shell");
  console.log(`session file: preset ${file.presetId}, t=${file.final.step}, ${file.interventions.length} interventions, ${file.firsts.entries.length} firsts`);
});
