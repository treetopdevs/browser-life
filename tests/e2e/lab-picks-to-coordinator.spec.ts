import { expect, test } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noLockDenoBin } from "../deno/lib/no_lock_deno.ts";
import { sessionFileError, type SessionFile } from "../../apps/lab/src/session-file.ts";

// Picked breeder runs on islands (docs/archipelago-breed-2026-10-18.md, amendment 4), page level: hand-pick a cycle of the
// Breeder world in the lab, download the session file, submit it with tools/submit-picks.ts to a throwaway local coordinator
// (its own port and data directory) and read the experiment, with its pick-log digest, in the coordinator's status page at
// 1280 and 375 px. The islands that run it are Deno (tests/deno/coordinator_integration.ts, tests/deno/picked_segments.ts).
// The coordinator comes from `mix phx.server` (dev: tokenless loopback administration), so Elixir and Deno must be on PATH.

const SCRATCH = "test-results";
const COORD_PORT = Number(process.env.BL_E2E_COORD_PORT || 6391);

test("lab page to coordinator: a hand-picked breeder cycle becomes a picked experiment on a local coordinator", async ({ page, browser }) => {
  test.setTimeout(1_800_000);
  const LONG = 360_000;
  mkdirSync(SCRATCH, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab/?world=breeder&seed=1");
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 120_000 });
  await expect(page.locator("#world-heading")).toHaveText("The breeder");

  const breedBar = page.locator("#breed-bar");
  const play = page.locator("#btn-play");
  await page.locator("#breeder-on").check();
  await page.locator("#speed").evaluate((el: HTMLInputElement) => { el.value = "6"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");

  // Cycle 1 at t=5,000 waits: choose two ponds by hand (the rule would choose four others), then Breed.
  await expect(breedBar).toBeVisible({ timeout: LONG });
  await expect(page.locator("#breed-bar-call")).toContainText("Cycle 1");
  await page.locator("#breeder-clear").click();
  const box = (await page.locator("#world").boundingBox())!;
  // The jar is 256 by 256 world cells (a 4 by 4 grid of ponds, pond = row * 4 + column), fitted and centred in the canvas.
  const aspect = box.width / box.height;
  const view = aspect >= 1 ? { w: 256 * aspect, h: 256 } : { w: 256, h: 256 / aspect };
  const pond = (tx: number, ty: number) => [box.x + ((64 * tx + 32 + (view.w - 256) / 2) / view.w) * box.width, box.y + ((64 * ty + 32 + (view.h - 256) / 2) / view.h) * box.height] as const;
  for (const [tx, ty] of [[3, 0], [1, 2]]) await page.mouse.click(...pond(tx, ty));
  expect(await page.locator("#breeder-list li").count()).toBe(2);
  await page.screenshot({ path: `${SCRATCH}/picks-lab-pick.png` });
  await page.locator("#breeder-go").click();
  await page.locator("#guard-breed .row button").first().click();
  await expect(breedBar).toBeHidden({ timeout: LONG });

  // Cycle 2 at t=10,000 on the rule's own donors; the world is then paused for the file.
  await expect(breedBar).toBeVisible({ timeout: LONG });
  await expect(page.locator("#breed-bar-call")).toContainText("Cycle 2");
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await page.locator("#breeder-rule").click();
  await page.locator("#breeder-go").click();
  await page.locator("#guard-breed .row button").first().click();
  await expect(breedBar).toBeHidden({ timeout: LONG });

  await page.locator("#btn-verify").click();
  await expect(page.locator("#verification-status")).toHaveText("Identical", { timeout: LONG });
  await page.locator("#btn-card").click();
  await expect(page.locator("#btn-session-file")).toBeEnabled({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: LONG }), page.locator("#btn-session-file").click()]);
  const dir = mkdtempSync(join(tmpdir(), "bl-picks-e2e-"));
  const file = join(dir, "lab.session.json");
  await download.saveAs(file);
  await page.screenshot({ path: `${SCRATCH}/picks-lab-export.png` });
  const session = JSON.parse(readFileSync(file, "utf8")) as SessionFile;
  expect(sessionFileError(session)).toBeNull();
  const picks = (session.interventions as { kind: string; cycle?: number; donors?: number[] }[]).filter((e) => e.kind === "pick");
  expect(picks.map((p) => p.cycle)).toEqual([1, 2]);
  expect(picks[0].donors!.slice().sort()).toEqual([3, 9]);

  // A throwaway coordinator, then the one documented command.
  const data = join(dir, "data");
  mkdirSync(data);
  const denoPath = spawnSync("which", ["deno"], { encoding: "utf8" }).stdout.trim();
  const denoBin = await noLockDenoBin(join(dir, "bin"), denoPath);
  const server: ChildProcess = spawn("mix", ["phx.server"], { cwd: "apps/coordinator", env: { ...process.env, PATH: `${denoBin}:${process.env.PATH}`, MIX_ENV: "dev", PORT: String(COORD_PORT), BL_DATA_DIR: data }, stdio: "ignore" });
  const base = `http://127.0.0.1:${COORD_PORT}`;
  try {
    let up = false;
    for (let i = 0; i < 400 && !up; i++) {
      up = await fetch(`${base}/api/status`).then((r) => r.ok, () => false);
      if (!up) await new Promise((r) => setTimeout(r, 300));
    }
    expect(up).toBe(true);

    const submit = spawnSync("deno", ["run", "--no-lock", "-A", "tools/submit-picks.ts", "--coordinator", base, "--picks-from", file, "--experiment", "lab-picked", "--steps", "10000", "--segment-steps", "5000", "--deep", String(session.settings.deepEvery), "--verify-fraction", "1"], { encoding: "utf8" });
    expect(submit.status, submit.stdout + submit.stderr).toBe(0);
    const digest = /pick log ([0-9a-f]{64}): 2 picks/.exec(submit.stdout)?.[1];
    expect(digest, submit.stdout).toBeDefined();
    expect(submit.stdout).toContain("submitted lab-picked/breeder/treatment/seed-1: 2 segments");

    const exp = (await (await fetch(`${base}/api/experiments/lab-picked`)).json()) as { spec: Record<string, unknown>; segments: unknown[] };
    expect(exp.spec.pickLog).toBe(digest);
    expect(exp.spec.pickImplicit).toBe(true);
    expect(exp.segments).toHaveLength(2);
    const stored = await (await fetch(`${base}/api/pick-logs/${digest}`)).text();
    expect(stored.split("\n").filter(Boolean)).toHaveLength(2);

    for (const [width, height, name] of [[1280, 900, "1280"], [375, 800, "375"]] as const) {
      const ctx = await browser.newContext({ viewport: { width, height } });
      const status = await ctx.newPage();
      await status.goto(`${base}/index.html`);
      const row = status.locator("#experiments tr", { hasText: "lab-picked" });
      await expect(row).toContainText(`picked ${digest!.slice(0, 8)}`, { timeout: 30_000 });
      await expect(row).toContainText("picks-v1");
      await status.locator("#sec-experiments").screenshot({ path: `${SCRATCH}/picks-status-${name}.png` });
      await ctx.close();
    }
  } finally {
    // The coordinator writes into `data`: wait for it to exit (SIGKILL after 10 s, give up after 5 s more) before removing it.
    // The data directory is removed only once the exit was seen; otherwise it is left and the test fails.
    if (!(await stopServer(server))) throw new Error(`the coordinator (pid ${server.pid}) did not exit; left ${dir} in place`);
    rmSync(dir, { recursive: true, force: true });
  }
});

async function stopServer(server: ChildProcess): Promise<boolean> {
  if (server.exitCode !== null || server.signalCode !== null) return true;
  if (server.pid === undefined) return true; // never started: nothing holds the directory
  const exited = new Promise<boolean>((resolve) => server.once("exit", () => resolve(true)));
  const within = (ms: number) => Promise.race([exited, new Promise<boolean>((r) => setTimeout(() => r(false), ms).unref())]);
  server.kill("SIGTERM");
  if (await within(10_000)) return true;
  server.kill("SIGKILL");
  return within(5_000);
}
