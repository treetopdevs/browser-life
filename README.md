# Cadence Garden (browser-life)

An open-ended artificial-life ecology that runs in the browser on WebGPU. It is closed in matter, open in energy, and uses exact integer physics. Individuals, reproduction, heredity and ecological roles are *inferred* from local rules, never declared. See [`docs/plan.md`](docs/plan.md) for the research goal and [`docs/rules.md`](docs/rules.md) for the rules and the arithmetic-bounds argument.

## Layout

```
packages/schema     config, layout, genomes, worlds, checkpoints, integer helpers
packages/sim-ref    CPU reference = the specification of the rules
packages/sim-gpu    WGSL kernels, GpuSim host, renderer, golden self-test
packages/metrics    census, tracking, collectives, activity, ecology, complexity, stats
packages/runner     experiment conditions, run bundles, island client
packages/search     M3 bootstrap: batch evaluation + MAP-Elites
apps/lab            interactive lab (Vite), self-test page, island page
apps/coordinator    Phoenix coordinator for the archipelago (segments + replay verification)
tools/              headless CLIs on Deno's native WebGPU (run, analyze, island, stitch, bootstrap)
experiments/        pre-registration (draft)
```

## Run it

```bash
pnpm install
```

```bash
pnpm dev
```

The public introduction opens at http://localhost:5173/. The interactive lab is at `/lab/`; `/how-it-works/`, `/research/`, `/about/`, `/privacy/`, `/participate/`, and `/status/` are supporting pages. `/selftest.html` checks the CPU reference against this browser's GPU bit for bit. `/island.html` is the opt-in GPU volunteer runner.

The Vite development and preview servers forward `/api/*` to the local coordinator at `PORT` (4000 by default). A public deployment should serve the built `apps/lab/dist` at the HTTPS domain root and forward `/api/*` to the Phoenix coordinator on the same origin. See [`docs/public-site-plan.md`](docs/public-site-plan.md) for route decisions, privacy boundaries, and the release checks. A build is not a deployment.

To run the lab and the coordinator together, use `bin/dev`. Ctrl-C stops both. `PORT` and `LAB_PORT` override the default ports, 4000 and 5173.

To run a small shared garden on this machine, use `bin/garden-dev`. It starts a dev coordinator on a scratch directory, the lab, a garden on `spots` (one day a minute) and two headless islands, and prints the `/garden/` page's address. Ctrl-C stops everything and removes the scratch directory. `apps/coordinator/README.md`, "Run a garden locally", has the settings, letters, export and `tests/deno/garden_e2e.ts`, which runs a garden end to end, usually in under a minute (up to three minutes more near the top of an hour), and `tests/deno/garden_dev_smoke.ts`, which checks the launcher itself.

## Test

```bash
pnpm test
```

```bash
deno run -A tests/deno/gpu_golden.ts
```

```bash
npx playwright test
```

```bash
cd apps/coordinator && mix test
```

The GPU golden test must pass on every device that contributes data. Pinned rule hashes live in `packages/sim-ref/test/golden-hashes.test.ts`: any intended rule change bumps `RULE_VERSION` and re-pins them.

## Experiments

```bash
deno run -A tools/run.ts --experiment pilot --preset gradient --conditions treatment,neutral,no-mutation,replenished --seeds 1-4 --steps 100000
```

A run can be wounded or fed on a schedule, as the lab does by hand (`--lesion STEP:X,Y,R`, `--feed STEP:X,Y,R,AMOUNT` with a negative amount to drain, both repeatable, and `--interventions FILE` for a JSON array of the same). The bundle then holds `interventions.jsonl`, a record of what was applied, and a feed is booked in the conservation baseline. A lab run manifest replays too, lesions and feeds included, and the run is compared with the lab's own checkpoint at the same step:

```bash
deno run -A tools/run.ts --experiment wounded --preset spots --steps 5000 --lesion 1000:120,120,12 --feed 3000:60,60,6,16
deno run -A tools/run.ts --experiment replay --preset spots --seeds <the lab world's seed> --steps 5000 --picks-from <runId>.run.json
```

A scheduled run is distributed too: give the experiment spec an `"interventions"` array of the same entries (`{"step":1000,"kind":"lesion","x":120,"y":120,"r":12}`, `{"step":3000,"kind":"feed","x":60,"y":60,"r":6,"amount":16}`, steps non-decreasing, a feed's amount non-zero within ±4096; a feed's `matter`, the lab's replay assertion, is refused there, since the second island's replay is the archipelago's check and a matter the world does not reproduce would throw on every island). The coordinator checks it as the runner would (a centre inside the preset's world, no feed in a pond preset, nothing after the last step), carries it whole in every segment's task, and hands those segments, run or verify, only to islands that advertise `interventions-v1`; each segment applies the entries of its own window and uploads its `interventions.jsonl`, which the verifying island regenerates and `tools/stitch.ts` joins into the bundle above. One thing no creation can check is a feed that would take the world past its matter bound at that step: an island that meets one reports the segment failed with the runner's reason (`POST /api/segments/:id/fail`), the run's later segments are blocked as after a divergence, no island is offered it again, and the failure shows in the status and the experiment listing, so the experiment stops there instead of cycling.

A bred pond world is distributed too: an experiment may name the breeder's conditions (`pond-breed-<score>`, `pond-mass-<score>`, `pond-drift-<score>`; `docs/sandbox-wild.md`) on any pond preset, or use the `breeder` preset itself, and the coordinator hands those segments, run or verify, only to islands that advertise `breed-v1` in addition to `ponds-v1` (never instead of it). Only the rule's own donor picks travel: picked and pressured runs stay with the lab and `tools/run.ts`. The donors the rule chose are verified as physics (their cells are in the checkpoint a second island must reproduce), and the record of them, `ponds.tsv`'s `donor` and score columns, is compared against the verifier's; `tools/stitch.ts` will not export a bred run whose record the verifier regenerated differently. A coordinator spec takes no overrides, so selection shows only where the preset makes ponds score: on `breeder` (mutation × 10) it does, while `ponds-small` or `ponds` under `pond-breed-*` at stock mutation may never score, and is then its mass control (`docs/archipelago-breed-2026-10-18.md`).

```bash
deno run -A tools/analyze.ts runs/pilot/gradient
```

```bash
deno run -A tools/bootstrap.ts --batches 50 --out runs/bootstrap
```

To inspect one lineage of a finished bundle, with its exact ancestry rebuilt from `mutations.tsv` (no replay; design in `docs/lineage-inspector.md`):

```bash
deno run -A tools/lineage.ts --dir runs/pilot/gradient/treatment/seed-1 --twin runs/pilot/gradient/neutral/seed-1 --out dossier.json
```

The same tool takes a scaffold pond as its subject, with exact donor-packet descent from `ponds.tsv`:

```bash
deno run -A tools/lineage.ts pond --dir runs/scaffold/main/scaf/i0 --twin runs/scaffold/main/rand/i0 --out pond.json
```

Either dossier renders as a static panel, an HTML fragment ready to publish as an artifact:

```bash
deno run -A tools/report-html.ts lineage dossier.json --out dossier.html
```

### Archipelago

```bash
cd apps/coordinator && mix phx.server
```

```bash
curl -X POST localhost:4000/api/experiments -H 'content-type: application/json' -d '{"experiment":"a1","presetId":"gradient","conditions":["treatment","neutral"],"seeds":[1,2,3],"steps":100000,"segmentSteps":5000,"censusEvery":100,"verifyFraction":0.1}'
```

Then open `/island.html` in any WebGPU browser, or run `deno run -A tools/island.ts`. The detailed operations dashboard is http://localhost:4000/index.html. In production it needs an administrator token to load detailed status; the public aggregate status is `/api/public/status`.

Once runs finish, stitch their segments into run bundles and analyze them as above. Only runs whose final segment has been verified are exported. Every downloaded file must match the SHA-256 the coordinator recorded for the accepted upload. Verification replays the physics and observer state, not the observation files, so their content is only as trustworthy as the island that produced them. Pass `--token` when the coordinator has an admin token. A garden (`apps/coordinator/README.md`, "The garden") exports its verified prefix, the days from day 0 that are all verified, and a longer prefix replaces a shorter one in place. Each day carries the letters as of its assignment, so each day's log is checked against its own list, a list that rewrites an earlier day is refused, and the stitched schedule is what the days applied, which must match the garden's current list (`docs/garden-stitch-rule-2026-10-17.md`; `tests/deno/garden_export.ts` checks the export without a GPU).

```bash
deno run -A tools/stitch.ts --experiment a1
```

```bash
deno run -A tools/analyze.ts runs/a1/gradient
```
