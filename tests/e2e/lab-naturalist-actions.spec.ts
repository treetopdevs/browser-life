import { expect, test } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { sessionFileError, type SessionFile } from "../../apps/lab/src/session-file.ts";

// Supplied suggestion fixtures, NOT evidence that these high-side bells naturally occur or their predictions hold.
// The real seed-1 low-living-cells bell still runs. Only the lazy proposer export is wrapped in the test browser:
// it passes that note through a real wound/drain rule while preserving the original note key. The production panel,
// click handler, worker, GPU physics, ledger and session export remain real. There are no product test hooks.
for (const action of ["lesion", "drain"] as const) {
  test(`page: supplied ${action} suggestion at 375px applies once through the real worker`, async ({ page }) => {
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 375, height: 900 });
    let fixtureRequests = 0;
    await page.route("**/src/naturalist-suggest.ts", async route => {
      fixtureRequests++;
      await route.fulfill({ contentType: "application/javascript", body: `
        export * from "/src/naturalist-suggest.ts?original-for-action-fixture";
        import { suggestFor as original } from "/src/naturalist-suggest.ts?original-for-action-fixture";
        import { noteKey } from "/src/naturalist.ts";
        export function suggestFor(ring, world, header) {
          return { ...original({ ...ring, signal: ${JSON.stringify(action === "lesion" ? "lineages" : "livingCells")}, side: "high" }, world, header), key: noteKey(world.gen, world.runId, ring) };
        }
      ` });
    });
    await page.goto("/lab/?world=gradient-m3&seed=1");
    await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 150_000 });
    await expect(page.locator("#naturalist")).toHaveAttribute("data-state", "listening", { timeout: 60_000 });
    await page.locator("#speed").evaluate((el: HTMLInputElement) => { el.value = "9"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.locator("#btn-play").click();
    await expect.poll(async () => Number((await page.locator("#naturalist-read").textContent())?.match(/t=([\d,]+)/)?.[1].replace(/,/g, "") ?? 0), { timeout: 800_000, intervals: [1000] }).toBeGreaterThanOrEqual(15_000);
    await page.locator("#btn-play").click();
    const note = page.locator('#naturalist-notes li[data-signal="livingCells"][data-side="low"]');
    const suggestion = note.locator(".naturalist-suggestion");
    await expect(suggestion).toHaveAttribute("data-action", action);
    expect(fixtureRequests).toBe(1);
    // Label the supplied fixture in captured images too; this DOM annotation exists only in this test browser.
    await suggestion.evaluate((el, action) => {
      const label = document.createElement("p");
      label.className = "hint";
      label.textContent = `TEST FIXTURE: supplied ${action} rule on the real low-living-cells note. This is not a naturally observed ${action} recommendation or a prediction result.`;
      el.querySelector(".naturalist-suggestion-head")!.after(label);
    }, action);
    await expect(suggestion.locator(".naturalist-prediction")).toContainText("Not yet measured");
    await expect(page.locator("#k-fed")).toHaveText("none");
    await expect(page.locator("#run-hand-item")).toBeHidden();
    await suggestion.getByText("Run it offline", { exact: true }).click();
    await expect(suggestion.locator(".naturalist-commands")).toHaveAttribute("open", "");
    await expect(suggestion.locator(".naturalist-command").first()).toContainText(action === "lesion" ? "--lesion 14900:128,128,127" : "--feed 14900:128,128,127,-32");
    const tryIt = suggestion.locator("button[data-try]");
    await expect(tryIt).toHaveCount(1);
    await expect(tryIt).toContainText(action === "lesion" ? /wound/i : /drain/i);
    for (const night of [false, true]) {
      if (night) {
        await page.locator("#theme-toggle").click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        // Audit settled colours, not an intermediate button foreground during the 160ms theme transition.
        await page.evaluate(async () => {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
        });
      }
      // Long commands must wrap inside the panel, not rely on clipping or a wider document.
      const layout = await suggestion.evaluate(el => ({ documentFits: document.documentElement.scrollWidth <= innerWidth, fits: el.scrollWidth <= el.clientWidth, commands: Array.from(el.querySelectorAll<HTMLElement>("pre")).map(pre => ({ fits: pre.scrollWidth <= pre.clientWidth, size: parseFloat(getComputedStyle(pre).fontSize) })) }));
      expect(layout.documentFits).toBe(true);
      expect(layout.fits).toBe(true);
      expect(layout.commands.length).toBe(2);
      for (const command of layout.commands) { expect(command.fits).toBe(true); expect(command.size).toBeGreaterThanOrEqual(11); }
      const button = await tryIt.boundingBox();
      expect(button).not.toBeNull();
      expect(button!.x).toBeGreaterThanOrEqual(0);
      expect(button!.x + button!.width).toBeLessThanOrEqual(375);
      const axe = await new AxeBuilder({ page }).include("#naturalist").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
      await suggestion.locator(".naturalist-suggestion-head").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/naturalist-${action}-fixture-375-${night ? "night" : "day"}.png` });
    }
    // Merely opening/reading a supplied suggestion does not edit the world.
    await expect(page.locator("#run-hand-item")).toBeHidden();
    const biomassShare = async () => Number((await page.locator("#pools").getAttribute("aria-label"))?.match(/biomass ([\d.]+)%/)?.[1]);
    const biomassBefore = await biomassShare();
    await tryIt.click();
    const offer = note.locator(".naturalist-offer");
    await expect(offer).toBeFocused();
    await expect(offer).toHaveAttribute("role", "status");
    await expect(offer).toContainText(/^Tried here at step [\d,]+/);
    await expect(page.locator("#run-hand")).toHaveText("1 change, unsaved");
    await expect(page.locator("#naturalist")).toHaveAttribute("data-state", "touched");
    await expect(page.locator("#naturalist-notes button[data-try]")).toHaveCount(0);
    if (action === "drain") await expect(page.locator("#k-fed")).toHaveText(/^-\d[\d,]* in 1 feed$/);
    else {
      await expect(page.locator("#k-fed")).toHaveText("none");
      await expect(page.locator("#ledger-badge")).toHaveText("sealed");
      await expect.poll(biomassShare).toBeLessThan(biomassBefore);
    }
    await page.locator("#btn-card").click();
    await expect(page.locator("#btn-session-file")).toBeEnabled({ timeout: 60_000 });
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#btn-session-file").click()]);
    let text = "";
    const decoder = new TextDecoder();
    for await (const chunk of (await download.createReadStream()) as AsyncIterable<Uint8Array>) text += decoder.decode(chunk, { stream: true });
    text += decoder.decode();
    const file = JSON.parse(text) as SessionFile;
    expect(sessionFileError(file)).toBeNull();
    expect(file.interventions).toHaveLength(1);
    const intervention = file.interventions[0];
    expect(intervention).toMatchObject({ kind: action === "lesion" ? "lesion" : "feed", x: 128, y: 128, r: 127 });
    expect(intervention.step).toBeGreaterThanOrEqual(15_000);
    if (intervention.kind === "feed") { expect(intervention.amount).toBe(-32); expect(intervention.matter).toBeLessThan(0); }
  });
}
