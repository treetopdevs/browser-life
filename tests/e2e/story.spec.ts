// The story page's live jars (apps/lab/src/story/jars.ts), in a real browser with their real workers: nothing runs
// until asked, one jar grows at a time, a jar out of sight waits, a choice starts the world again, a world that ends
// says so, and a failed jar can be grown again. The settings and the words are held by apps/lab/test/story.test.ts.
import { expect, test, type Locator, type Page } from "@playwright/test";

const jar = (page: Page, id: string): Locator => page.locator(`figure.story-jar[data-jar="${id}"]`);
const step = async (fig: Locator): Promise<number> => {
  const m = /^Step ([\d,]+)/.exec((await fig.locator(".jar-line").textContent()) ?? "");
  return m ? Number(m[1].replace(/,/g, "")) : -1;
};
const pageErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
};

test("no jar runs until its button is pressed", async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto("/story/");
  for (const id of ["dropgenes", "roam", "softroam"]) {
    const fig = jar(page, id);
    await expect(fig.locator(".jar-play")).toBeEnabled();
    await expect(fig.locator(".jar-play")).toHaveText("Grow it");
    await expect(fig.locator(".jar-again")).toBeHidden();
    await expect(fig.locator("img")).toBeVisible();
    await expect(fig.locator("canvas")).toBeHidden();
    await expect(fig.locator(".jar-line")).toHaveText("");
    // The first choice is in force, and the line under the buttons says what it does.
    await expect(fig.locator(".jar-choices button").first()).toHaveAttribute("aria-pressed", "true");
    await expect(fig.locator(".jar-says")).not.toHaveText("");
  }
  expect(errors).toEqual([]);
});

test("one jar grows at a time, and the one that was paused can go on", async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto("/story/");
  const roam = jar(page, "roam");
  const soft = jar(page, "softroam");
  await roam.scrollIntoViewIfNeeded();
  await roam.locator(".jar-play").click();
  await expect(roam.locator(".jar-play")).toHaveText("Pause");
  await expect(roam.locator("canvas")).toBeVisible();
  await expect.poll(() => step(roam), { timeout: 30_000 }).toBeGreaterThan(20);
  await expect(roam.locator(".jar-line")).toContainText("matter balanced");

  await soft.scrollIntoViewIfNeeded();
  await soft.locator(".jar-play").click();
  await expect(soft.locator(".jar-play")).toHaveText("Pause");
  await expect(roam.locator(".jar-play")).toHaveText("Grow on");
  await expect(roam.locator(".jar-note")).toHaveText("Paused while another jar grows.");
  await expect.poll(() => step(soft), { timeout: 30_000 }).toBeGreaterThan(20);
  const held = await step(roam);
  await page.waitForTimeout(1500);
  expect(await step(roam)).toBe(held);

  await roam.scrollIntoViewIfNeeded();
  await roam.locator(".jar-play").click();
  await expect(soft.locator(".jar-play")).toHaveText("Grow on");
  await expect.poll(() => step(roam), { timeout: 30_000 }).toBeGreaterThan(held);
  expect(errors).toEqual([]);
});

test("a jar scrolled out of sight waits, and goes on when it is back", async ({ page }) => {
  await page.goto("/story/");
  const roam = jar(page, "roam");
  await roam.scrollIntoViewIfNeeded();
  await roam.locator(".jar-play").click();
  await expect.poll(() => step(roam), { timeout: 30_000 }).toBeGreaterThan(20);
  await page.evaluate(() => window.scrollTo(0, 0));
  // One request may still be on its way; after it lands nothing more is asked for.
  await page.waitForTimeout(1500);
  const away = await step(roam);
  await page.waitForTimeout(2000);
  expect(await step(roam)).toBe(away);
  await expect(roam.locator(".jar-play")).toHaveText("Pause");
  await roam.scrollIntoViewIfNeeded();
  await expect.poll(() => step(roam), { timeout: 30_000 }).toBeGreaterThan(away);
});

test("a choice starts the world again, and a fresh seed is never one we have looked at", async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto("/story/");
  const soft = jar(page, "softroam");
  await soft.scrollIntoViewIfNeeded();
  const fresh = soft.getByRole("button", { name: "A seed nobody has looked at" });
  // Choosing before growing changes the words and starts nothing.
  await fresh.click();
  await expect(fresh).toHaveAttribute("aria-pressed", "true");
  await expect(soft.locator(".jar-says")).toContainText("we have not run");
  await expect(soft.locator(".jar-play")).toHaveText("Grow it");
  await soft.locator(".jar-play").click();
  await expect(soft.locator(".jar-note")).toHaveText(/^Seed \d+, drawn now\. We have not run it\.$/);
  const seed = Number(/Seed (\d+)/.exec((await soft.locator(".jar-note").textContent())!)![1]);
  expect(seed).toBeGreaterThanOrEqual(5);
  expect(seed).toBeLessThanOrEqual(9999);
  await expect.poll(() => step(soft), { timeout: 30_000 }).toBeGreaterThan(40);
  const before = await step(soft);
  await soft.getByRole("button", { name: "Seed 2" }).click();
  await expect(soft.getByRole("button", { name: "Seed 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(fresh).toHaveAttribute("aria-pressed", "false");
  // The world began again: its count is back under where the last one had got to, and then rises.
  await expect.poll(() => step(soft), { timeout: 30_000 }).toBeLessThan(before);
  await expect(soft.locator(".jar-play")).toHaveText("Pause");
  await soft.locator(".jar-again").click();
  await expect.poll(() => step(soft), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("droplet genes with leaking genes ends, says so, and can be grown again", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = pageErrors(page);
  await page.goto("/story/");
  const drop = jar(page, "dropgenes");
  await drop.scrollIntoViewIfNeeded();
  await drop.getByRole("button", { name: "Let the genes leak" }).click();
  await expect(drop.locator(".jar-says")).toContainText("held on 0 of 4 seeds");
  await drop.locator(".jar-play").click();
  // The recorded runs of this setting ended between steps 2,500 and 5,100; seed 5 is the first of them.
  await expect(drop.locator(".jar-play")).toHaveText("Grow it again", { timeout: 150_000 });
  await expect(drop.locator(".jar-note")).toHaveText("This world has ended.");
  await expect(drop.locator(".jar-line")).toContainText("no wall is left");
  await expect(drop.locator(".jar-line")).toContainText("matter balanced");
  await expect(drop.locator(".jar-again")).toBeHidden();
  const ended = await step(drop);
  expect(ended).toBeGreaterThanOrEqual(2500);
  expect(ended).toBeLessThanOrEqual(5100);
  await drop.locator(".jar-play").click();
  await expect(drop.locator(".jar-play")).toHaveText("Pause");
  await expect.poll(() => step(drop), { timeout: 30_000 }).toBeLessThan(ended);
  expect(errors).toEqual([]);
});

test("a replaced worker cannot stop the world that took its place, and a failed jar can be grown again", async ({ page }) => {
  // Keep every worker the page makes, so the test can speak for one that has been replaced.
  await page.addInitScript(() => {
    const made: Worker[] = [];
    (window as unknown as { madeWorkers: Worker[] }).madeWorkers = made;
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        made.push(this);
      }
    };
  });
  await page.goto("/story/");
  const roam = jar(page, "roam");
  await roam.scrollIntoViewIfNeeded();
  await roam.locator(".jar-play").click();
  await expect.poll(() => step(roam), { timeout: 30_000 }).toBeGreaterThan(20);
  await roam.locator(".jar-again").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { madeWorkers: Worker[] }).madeWorkers.length)).toBe(2);
  await expect.poll(() => step(roam), { timeout: 30_000 }).toBeGreaterThan(0);

  // The first worker is retired. A late failure and a late answer from it must both be ignored.
  await page.evaluate(() => {
    const old = (window as unknown as { madeWorkers: Worker[] }).madeWorkers[0];
    old.dispatchEvent(new ErrorEvent("error", { message: "late failure of a replaced worker" }));
    old.dispatchEvent(new MessageEvent("message", { data: { type: "error", gen: 2, message: "late answer of a replaced worker" } }));
  });
  await expect(roam.locator(".jar-play")).toHaveText("Pause");
  await expect(roam.locator(".jar-note")).not.toContainText("could not grow");
  const after = await step(roam);
  await expect.poll(() => step(roam), { timeout: 30_000 }).toBeGreaterThan(after);

  // A failure of the worker on screen stops the jar, says why, and Grow it starts a new world.
  await page.evaluate(() => {
    const made = (window as unknown as { madeWorkers: Worker[] }).madeWorkers;
    made[made.length - 1].dispatchEvent(new ErrorEvent("error", { message: "the worker on screen failed" }));
  });
  await expect(roam.locator(".jar-note")).toHaveText("This jar could not grow here: the worker on screen failed");
  await expect(roam.locator(".jar-play")).toHaveText("Grow it");
  const stopped = await step(roam);
  await page.waitForTimeout(1200);
  expect(await step(roam)).toBe(stopped);
  await roam.locator(".jar-play").click();
  await expect(roam.locator(".jar-play")).toHaveText("Pause");
  await expect.poll(() => page.evaluate(() => (window as unknown as { madeWorkers: Worker[] }).madeWorkers.length)).toBe(3);
  await expect.poll(() => step(roam), { timeout: 30_000 }).toBeGreaterThan(20);
});
