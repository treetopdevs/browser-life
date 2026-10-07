import { expect, test } from "@playwright/test";

const planted = (page: import("@playwright/test").Page) =>
  expect(page.locator("#simulation-status")).not.toHaveText(/Planting|No world yet|Warming up/, { timeout: 60_000 });

test("the Starting world field explains the chosen world in plain words and opens the catalogue", async ({ page }) => {
  await page.goto("/lab/");
  await planted(page);
  const about = page.locator("#preset-desc");
  await expect(about.locator(".world-asks")).toContainText("What does the chemistry do");
  await expect(about.locator(".traits li")).toHaveCount(3);
  await expect(about.locator(".world-status")).toHaveText("Base world");
  await expect(about).not.toContainText(/packages\/|lightMode/);

  await page.getByRole("button", { name: "Browse all worlds" }).click();
  const dialog = page.locator("#worlds");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Choose a world" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Choose a world" })).toBeFocused();
  // It opens on the family of the chosen world and marks the one on screen.
  await expect(dialog.locator('.worlds-nav button[aria-pressed="true"]')).toContainText("Steady jars");
  await expect(dialog.locator('.world-card[data-id="spots"]')).toHaveClass(/current/);
  await expect(dialog.locator('.world-card[data-id="spots"] .on-screen')).toHaveText("On screen now");
  await expect(dialog.locator('.world-card[data-id="spots"] button')).toHaveText("Chosen");

  await dialog.getByRole("button", { name: /A moving sun/ }).click();
  const followers = dialog.locator('.world-card[data-id="planet-followers"]');
  await expect(followers).toBeVisible();
  await expect(followers.locator(".world-asks")).toContainText("Does moving with the sun beat sleeping");
  await expect(followers.locator(".world-diff")).toHaveText("Like Rotating planet, except: a moving sun, one lap every 16,384 steps; 8 sleepers and 8 sun-followers.");
  await expect(followers.locator(".trait-table")).toContainText("A moving sun, one lap every 16,384 steps");
  await expect(followers.locator(".world-status")).toHaveText("Sandbox");

  await followers.getByRole("button", { name: "Choose this world" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#preset")).toHaveValue("planet-followers");
  // Choosing changes nothing until Plant is pressed: the button arms and names the world still on screen.
  const plant = page.locator("#btn-new");
  await expect(plant).toHaveText("Plant this world");
  await expect(plant).toHaveClass(/primary/);
  await expect(plant).toBeFocused();
  await expect(page.locator("#plant-note")).toContainText("still Spot ecology");
  await expect(about.locator(".world-asks")).toContainText("Does moving with the sun");
});

test("the catalogue closes on Escape or a backdrop click and leaves the lab's shortcuts alone while open", async ({ page }) => {
  await page.goto("/lab/");
  await planted(page);
  const browse = page.getByRole("button", { name: "Browse all worlds" });
  await browse.click();
  const dialog = page.locator("#worlds");
  await expect(dialog).toBeVisible();
  // A nav click shows the family and moves focus to its heading, so the change is read from the top.
  await dialog.getByRole("button", { name: /Islands and ponds/ }).click();
  await expect(dialog.locator(".family-head h3")).toHaveText("Islands and ponds");
  await expect(dialog.locator(".family-head h3")).toBeFocused();
  // A click on plain text in the dialog leaves nothing focused: Space and a view key must still not reach the lab.
  await dialog.locator(".family-head p").first().click();
  await page.keyboard.press("Space");
  await page.keyboard.press("3");
  await expect(page.locator("#btn-play")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('#views [data-mode="composite"]')).toHaveAttribute("aria-pressed", "true");
  await expect(dialog).toBeVisible();
  // Escape closes it and focus returns to the button that opened it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(browse).toBeFocused();
  // So does a click on the backdrop.
  await browse.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).toBeHidden();
  await page.keyboard.press("3");
  await expect(page.locator('#views [data-mode="composite"]')).toHaveAttribute("aria-pressed", "true");
});

test("a link can choose the world and the seed before the first planting", async ({ page }) => {
  await page.goto("/lab/?world=seasons&seed=5");
  await expect(page.locator("#preset")).toHaveValue("seasons");
  await expect(page.locator("#seed")).toHaveValue("5");
  await planted(page);
  await expect(page.locator("#world-heading")).toHaveText("Patches & seasons");
  await expect(page.locator("#run-seed")).toHaveText("5");
  await expect(page.locator("#btn-new")).toHaveText("Plant it again");
});

test("every visit opens on a fresh seed number unless the link names one", async ({ page }) => {
  // The draw is 1 + floor(random * 9999); pin random so the test knows which number to expect.
  await page.addInitScript(() => { Math.random = () => 0.25; });
  // An unknown world or an impossible seed in the link leaves the draw alone.
  for (const url of ["/lab/", "/lab/?world=no-such-world&seed=-3", "/lab/?world=spots&seed=4294967296"]) {
    await page.goto(url);
    await expect(page.locator("#preset")).toHaveValue("spots");
    await expect(page.locator("#seed"), url).toHaveValue("2500");
  }
  // The largest seed the rules allow is taken.
  await page.goto("/lab/?world=spots&seed=4294967295");
  await expect(page.locator("#seed")).toHaveValue("4294967295");
  // The drawn seed is the one planted.
  await page.goto("/lab/");
  await planted(page);
  await expect(page.locator("#run-seed")).toHaveText("2500");
  await expect(page.locator("#btn-new")).toHaveText("Plant it again");
});

test("the Worlds page lists every world with a link into the lab", async ({ page }) => {
  // The lab's select is the list of worlds; the page must show each exactly once outside Start here.
  await page.goto("/lab/");
  const worlds = (await page.locator("#preset option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).sort();
  expect(worlds.length).toBeGreaterThanOrEqual(40);
  await page.goto("/worlds/");
  await expect(page.getByRole("heading", { name: "Every jar, and what it asks." })).toBeVisible();
  const shown = (await page.locator("#worlds-root .family:not(.start-here) .world-card").evaluateAll((cs) => cs.map((c) => (c as HTMLElement).dataset.id))).sort();
  expect(shown).toEqual(worlds);
  await expect(page.locator("#worlds-count")).toHaveText(String(worlds.length));
  const hrefs = await page.locator("#worlds-root .world-card a.button").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")));
  for (const href of hrefs) expect(href).toMatch(/^\/lab\/\?world=[a-z0-9-]+$/);
  await expect(page.locator("#worlds-jump a")).toHaveCount(7);
  await page.locator('#worlds-jump a[href="#sun"]').click();
  await expect(page.locator("#sun .family-head h2")).toHaveText("A moving sun");
  // The page shares the lab's register: no config key reaches the reader outside the folded technical description.
  const plain = await page.locator("#worlds-root .world-asks, #worlds-root .trait-table, #worlds-root .world-diff, #worlds-root .world-look, #worlds-root .world-seen, #worlds-root .family-head").allTextContents();
  expect(plain.join("\n")).not.toMatch(/lightMode|signalGain|mutRate|packages\//);
  // The breeder is also a Start-here pick, so its card appears twice; the family's copy is the one followed.
  await page.locator('#wild .world-card[data-id="breeder"] a.button').click();
  await expect(page).toHaveURL(/\/lab\/\?world=breeder$/);
});
