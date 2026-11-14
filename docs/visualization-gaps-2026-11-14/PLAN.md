# Visualization gaps: plans

2026-11-14. These are the plans **as first proposed**. Review page: `plan.html` in this folder (this file is its source; keep them in step).

**What overrides this file.** `decisions.html` in this folder records every choice made since, and wins where it differs: one page with a picker and no lab link for `food-live` (D7), 3D slices local only (D8), cyclic competition first in `slab-viewer` (D10), and corrections found while building (D14, D19, D20). Each slice also has its own reviewed `PLAN.md` in a subfolder on its branch.

Four plans close every gap found in the survey. They are named by key, not number, so they can be handed to agents without ambiguity.

| Key | Closes | Size | Base |
|---|---|---|---|
| `food-replays` | 18 food result pages that load but play nothing | Small, no code | `origin/main` |
| `food-live` | No page runs a food-schedule world live | Medium | `origin/main` |
| `regime-figures` | Regime-meters page has no figures | Small | `claude/3d-regime-meters` |
| `slab-viewer` | No way to see the 3D slab world at all | Large | `claude/3d-cyclic-rps` |

Recommended order: `food-replays`, `food-live`, `regime-figures`, `slab-viewer`. The first costs minutes and makes existing work visible; the last is the only one that needs new rendering.

## What the survey found (corrects my first answer)

Checked: `origin/main` at `9d91709a`, plus `claude/3d-regime-meters`, `claude/3d-cyclic-rps`, `codex/rps-invasion-control`, `claude/mycelium-r0`, `codex/membrane-view`. Not checked: the other ~35 worktrees and branches, so a simulation that lives only there is not covered.

- **Food-schedule family.** My first answer said these have only static reports. That was wrong. `docs/creative-prototypes/*.html` are 18 replay players, 13 of them paired side by side (play, scrub, jump to tick), each with its own Playwright spec. They show nothing because their replay files were kept out of git: 58 files, about 304 MB (`docs/creative-prototypes/ARTIFACTS.md`). What is truly missing is a page that *runs* these worlds.
- **Uniform-food.** Uses the hungry-shapes model in `uniform` mode, which is World B on `/hungry-shapes/`. The page stops at tick 3,000; the screen ran to 6,000. Folded into `food-live`.
- **Cyclic competition (RPS).** The companion page already runs the lattice reference live in a canvas. The gap is only the GPU slab kernel (128 x 128 x 4).
- **3D slab ecology (rung 1b) and regime meters.** No renderer of any kind. `packages/sim-gpu/src/renderer.ts` on the 3D branches has no slab handling; `experiments/3d-bench/web/index.html` is a benchmark that draws nothing. The regime-meters page is built by `experiments/3d-slab/regime-html.ts` and currently carries no figure.
- **Everything else has a page**, including mycelium (`/mycelium/`, on its own branch).

## Rules for all four plans

- **Frozen files stay untouched.** No edits to the hash-pinned `apps/lab/src/*/model.ts` copies, to anything listed in `experiments/3d-rps/FROZEN` or `gate0-spike.sha256`, or to golden pins. New page code only.
- **Live views are not evidence.** They default to the screen's own seed and horizon, carry an "exploration" label, and write nothing under `docs/creative-prototypes/` or `experiments/`.
- **New lab pages are private**, following `apps/lab/test/hungry-shapes-packaging.test.ts`: Vite input, chunk name, `Dockerfile.site` exclusion, Caddy private matcher, `noindex`, a packaging test, and an e2e spec with an axe check.
- **Controls explain themselves.** No bare dropdowns: each choice says what differs and why it matters, with numbers read from the model where possible.
- **Gates** (Node 24 on PATH): `pnpm typecheck`, `pnpm test`, `BL_E2E_PORT=<free port> npx playwright test <spec>`, then a Codex review (Sol 6.1 High, read-only) before any commit.
- **Where the work happens.** This checkout is on `codex/recovery-accessibility` with staged work and lacks most of the files. Each plan runs in its own fresh worktree from the base named in the table. Commits only from the main session.

---

## `food-replays`: make the 18 existing viewers play

**What you'll see.** Every food result page under `docs/creative-prototypes/` plays its recorded replay: in 13 of the 18, two worlds side by side; shared scrubber, jump buttons, and the 15-second clip. Today they show "evidence unavailable".

**Steps.**
1. Fresh worktree from `origin/main`.
2. Copy the files from `runs/food-line-101-119/` (290 MB, already in this checkout) and `runs/creative-prototypes-85-100/` (67 MB) to the paths in `ARTIFACTS.md`. If a file is missing, fall back to the `git show` command in that document.
3. Verify every SHA-256 against the two tables in `ARTIFACTS.md`. Any mismatch stops the plan.
4. Serve with the lab dev server and open each page at `/docs/creative-prototypes/<name>.html`.
5. Run the food e2e specs (`tests/e2e/*food*.spec.ts`, `food-schedule-769.spec.ts`); they stop skipping once the files exist.

**Deliverable.** `tools/creative-prototypes/restore.sh` (copy, verify, report), so this is one command next time. The restored files stay untracked.

**Gate.** All hashes match; the food e2e specs pass instead of skip.

**Open decision.** None. This is safe to run on a yes.

---

## `food-live`: one page that runs any food schedule

**What you'll see.** A new private page `/food-bands/`. Pick a screen (for example "Split band vs stationary band"); two matched worlds run side by side from the screen's seed, with the food targets drawn as they move: the band sliding east, the two split columns, the alternating side lighting up each pulse, the foothold floor. Same body and family colours as `/hungry-shapes/`, same population history strip and accounting table. The horizon follows the screen: 3,000, 6,000 or 9,000 ticks.

**Screens offered.** All 18 food tool directories map to these 11 screens. Model, horizon and seeds are from a scan of each `tools/<screen>/explore.ts`; step 1 re-reads them, and reads the compared arms, from the same files.

| Screen | Tool directories | Model the screen ran | Horizon | Seeds |
|---|---|---|---|---|
| Uniform food | `uniform-food` | `hungry-shapes` | 6,000 | 1201 |
| Uniform endurance | `uniform-endurance` | `uniform-endurance` | 9,000 | 1201 |
| Moving band | `moving-food, -replication` | `moving-food` | 3,000 | 1201–1203 |
| Stationary band | `stationary-food, -replication` | `stationary-food` | 3,000 | 1201–1203 |
| Band longevity | `food-band-longevity, -replication` | `stationary-food` | 6,000 | 1201–1203 |
| Split band | `split-food, -replication` | `split-food` | 3,000 | 1202, 1203 |
| Alternating band | `alternating-food, -replication` | `alternating-food` | 3,000 | 1202, 1203 |
| Foothold band | `food-band-foothold, -replication` | `food-band-foothold` | 3,000 | 1202, 1203 |
| Food floor | `food-floor-replication` | `food-band-foothold` | 3,000 | 1203 |
| Floor longevity | `food-floor-longevity, -replication` | `food-band-foothold` | 6,000 | 1202, 1203 |
| Schedule 769 | `food-schedule-769` | `food-schedule-769` | 6,000 (gate at 3,000) | 1202 |

**Design.**
- **Which model runs.** The models form a copy chain (hungry-shapes → uniform-endurance → moving-food → stationary → split → alternating → foothold → schedule-769), and the newest says "old modes preserved". Step 2 tests that claim: for every screen, mode and seed, the newest model's state must match the screen's own model at ticks 0, 500 and the screen's own final tick. If it matches everywhere, the page imports only `food-schedule-769/model.ts`. Uniform food is the exception: it always runs on the hungry-shapes model, because uniform endurance changed that arm. If any pair differs, the page loads that screen's own model with a dynamic import. Either way no model file is edited.
- **Known wrinkle.** `uniform-endurance` changed food allocation under the same mode name `uniform` that hungry-shapes uses. The page labels the two as different arms and never mixes them.
- **Drawing.** A new `apps/lab/src/food-bands/render.ts`, written from the drawing code in `hungry-shapes/page.ts` (that file stays as is). Target overlay comes from each model's own geometry helpers (`movingBandGeometry(tick)`, `splitBandGeometry()`, `alternatingBandAtPulse`, `footholdBandAtSlot`, `schedule769PulseTargetTile`).
- **Replay check built in.** When the matching replay file is present (after `food-replays`), the page offers "compare with the recorded run" and shows whether the live census equals the recorded one tick for tick. Absent files hide the control.

**Files.**
- New: `apps/lab/food-bands/index.html`, `apps/lab/src/food-bands/{page.ts,render.ts,screens.ts,style.css}`.
- New tests: `apps/lab/test/food-bands-parity.test.ts`, `food-bands-packaging.test.ts`, `tests/e2e/food-bands.spec.ts`.
- Edited: `apps/lab/vite.config.ts`, `Dockerfile.site`, `deploy/Caddyfile` (private-page checklist), and a link from `/hungry-shapes/`'s experiments header if one exists.

**Steps.**
1. Read each `explore.ts` for arms, seeds, horizon; write `screens.ts` from that.
2. Parity test (above). Record the outcome in the page's provenance note.
3. Render module and page; reuse the comparison clock pattern from `development/`.
4. Private-page checklist, packaging test, e2e spec with axe.
5. Gates, then Codex review.

**Gate.** Parity test passes or the fallback is in place; live census equals the recorded census for at least one restored replay per screen; gates green.

**Open decisions.**
- One page with a screen picker (recommended) or one page per screen.
- Whether to link it from the lab's experiments list or leave it reachable by URL only.

---

## `regime-figures`: put pictures on the regime-meters page

**What you'll see.** `docs/3d-regime-meters-map.html` gains two figures for the closed Stage 0 run: damage spread over time for each job (damaged blocks at steps 30, 100 and 1,000 after the kick, for the S twin, the frozen F pair and the unit-kick U twin), and the calibration grid from rung 1b (`m4-results.tsv`: living fraction by mu, sigma and light, with the "none qualifies" line marked).

**Data that exists** (branch `claude/3d-regime-meters`): `experiments/3d-slab/regime-stage0-run1-damage.tsv` (36 jobs), `regime-stage0-run1-readout.md`, `m4-results.tsv`. No capture images are saved, so there is no world picture to add here; that comes from `slab-viewer`.

**Steps.**
0. Find `runs/regime/regime-results.json`, the builder's input. It is not in this checkout, and the work Mac did not answer today. If it cannot be found, draw both figures straight from the two committed TSVs.
1. Read `regime-html.ts` and the reader's JSON shape; confirm whether the damage table reaches the page as data today.
2. Add an SVG small-multiples chart (one panel per rung, log step axis, three series) and a calibration heat grid, inlined, light and dark.
3. Keep the builder's labelling rules. It refuses a "result" label without a frozen rule, and this candidate closed before one: the figures go in under the pilot/closed label.
4. Rebuild the page; extend `experiments/test/regime-readout.test.ts` to cover the new sections.

**Gate.** Page builds from the saved files with no network; the label still reads pilot/closed; tests green.

**Open decision.** The branch is local and unpushed. The figures can land there now; whether that branch ever reaches `main` is yours.

---

## `slab-viewer`: see the 3D world

**What you'll see.** A private page `/slab/`. The slab is only four cells deep, so it is drawn as it is: four layer tiles side by side (z = 0 to 3) and one larger top-down view that combines them, with a slider to isolate a layer. Two worlds to choose from:
- **Slab ecology (rung 1b):** the main rule set on a 3D torus, coloured by biomass and lineage, same palette as the lab.
- **Cyclic competition:** three types that beat each other in a ring, coloured by type, with empty cells dark. Spirals, if any form, show in the top-down view; the layer tiles show whether fronts are flat or tilted through depth.

**Set expectations.** Neither world passed its gate. Calibration found no ecology setting that qualifies (living fraction around 0.001 in the sampled row), so that view may be nearly empty; the cyclic world stopped at Gate 0. The viewer shows what these worlds do, which may be little.

Play, step, pace, seed, and a census strip (living fraction per layer; type shares for the cyclic world).

**Design.**
- **No volume renderer.** Depth is 4, so tiles plus a projection show everything. Projection options: densest layer wins, or per-column majority type.
- **First rung reads back, second rung draws on GPU.** 128 x 128 x 4 is 65,536 cells. Rung A uses the existing `readCells()` readback every few steps and draws on a 2D canvas: no new shader, and the picture is provably the simulated state. Rung B, only if rung A is too slow at 256 x 256 x 4, adds a render pass that samples the cell buffer directly.
- **Simulators are imported, never edited.** Ecology: `packages/sim-gpu/src/gpu-sim3.ts`. Cyclic: `experiments/3d-rps/gate0-spike/gpu-sim3-rps.ts` and `world.ts` (hash-pinned).
- **Picture check.** A CPU test builds a tiny 8 x 8 x 4 state through `step3d.ts`, runs the colour mapping, and pins the output, so layer order and wrap direction cannot silently flip.

**Files** (on a branch from `claude/3d-cyclic-rps`).
- New: `apps/lab/slab/index.html`, `apps/lab/src/slab/{page.ts,render.ts,worlds.ts,style.css}`, `apps/lab/test/slab-render.test.ts`, `slab-packaging.test.ts`, `tests/e2e/slab.spec.ts`.
- Edited: `apps/lab/vite.config.ts`, `Dockerfile.site`, `deploy/Caddyfile`.

**Steps.**
0. Spike (half a day at most): create `GpuSim3` in Chrome from a lab page, step it, read cells back. The bench page suggests 3D shaders run in the browser; this confirms it for the real kernel. If it fails, stop and report.
1. Colour mapping and layer layout as pure functions, with the pinned test.
2. Page with the ecology world; census strip.
3. Add the cyclic world. There is no registered operating point: Gate 0 ended in GATE-0-STOP. The default is one of the recorded exploration settings (`GATE0-EXPLORATION-2.md`, the 256 x 256 x 4 vacancy-kill runs), labelled as exploration.
4. Private-page checklist, e2e (WebGPU flags), gates, Codex review.
5. Optional rung B, and optional "twin difference" view that shows where a perturbed twin diverges (the regime meter, live).

**Gate.** Spike passes; pinned picture test; e2e shows non-blank canvases and a moving step counter; frame pacing recorded for 128 and 256.

**Open decisions.**
- **Base and landing.** Both 3D branches are local, unpushed and behind `main` (they forked at `3f44c319`). Build on `claude/3d-cyclic-rps` (recommended, it has both simulators) and leave landing for later, or rebase the 3D line onto `main` first (much larger, not recommended just for a viewer).
- Which world to build first if only one: cyclic competition is the more watchable; ecology is the one the 3D line was about.
- The 3D line is closed at rung 1b. This viewer is for looking, not for reopening it.
