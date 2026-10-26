import { AxeBuilder } from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

test("prototype directory lists all routes with plain status labels", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/playground/");
  await expect(page).toHaveTitle("Prototype library · Cadence Garden");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.getByText("Supply, selection, and inherited traits are engineered", { exact: false })).toBeVisible();

  const cards = page.locator(".card");
  await expect(cards).toHaveCount(15);
  const expected = [
    ["Particles", "/particles/", "Live world", "A running particle environment with adjustable starting conditions."],
    ["Particle picker", "/particles/picker/", "Chooser", "Keep a favorite recipe and compare two nearby descendants."],
    ["Oases", "/particles/oases/", "Live world", "Compare still food patches with moving oases."],
    ["Seasons", "/particles/seasons/", "Live world", "A particle world with changing seasonal conditions."],
    ["Bonds", "/particles/bonds/", "Live world", "Explore a particle world with bond formation and breakage."],
    ["Motifs", "/particles/motifs/", "Live world", "Compare twelve combinations of particle interaction and environment rules."],
    ["Boundaries", "/boundaries/", "Live world", "Compare smooth fields with engineered thresholds and reinforcing walls."],
    ["Hungry shapes", "/hungry-shapes/", "Live world", "Compare growing bodies under abundant, scarce uniform and patchy food."],
    ["Development", "/development/", "Live world", "Watch inherited body programs grow branching shapes and produce descendants."],
    ["Matter", "/matter/", "Live world", "Compare a closed nutrient pool with finite rain and burial."],
    ["Currents", "/currents/", "Live world", "Compare nutrient pumps with still-water controls, plus saved replays."],
    ["Spatial", "/spatial/", "Live world", "Orbit and slice a genuinely three-dimensional particle world."],
    ["Ecosystem", "/ecosystem/", "Live local sandbox", "Costly attack and defense, inherited mutations, refuges and staged rivals. The sandbox starts paused."],
    ["Ecosystem archive", "/ecosystem/archive/", "Saved evidence", "Recorded 20,000-tick observations from three seeds, with original summaries and sampled footage."],
    ["Vision screen", "/vision-screen/", "Stopped diagnostic", "A stopped visual-selection diagnostic. Its judge did not establish a successful result."],
  ];
  for (let i = 0; i < expected.length; i++) {
    const [title, href, status, description] = expected[i];
    const card = cards.nth(i);
    await expect(card.getByRole("link", { name: title, exact: false })).toHaveAttribute("href", href);
    await expect(card.locator(".status")).toHaveText(status);
    await expect(card.locator(".description")).toHaveText(description);
    const response = await request.get(href);
    expect(response.ok(), `${href} should resolve`).toBe(true);
  }
  await expect(page.getByText("did not establish a successful result", { exact: false })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(errors).toEqual([]);
});
