# browser-life

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

```bash
deno run -A tools/analyze.ts runs/pilot/gradient
```

```bash
deno run -A tools/bootstrap.ts --batches 50 --out runs/bootstrap
```

### Founder-policy comparison

The staged founder-policy study is specified in [`docs/founder-policy-protocol-v1.md`](docs/founder-policy-protocol-v1.md). The `plan` stage checks the pinned selection-audit snapshots and writes the exact cohorts, seeds, configurations, thresholds, and source hashes. It does not run a simulation:

```bash
deno run --no-lock -A tools/founder-policy.ts plan --out experiments/founder-policy/v1/design.json
```

Run `pilot` only from an archived, hash-verified source freeze. It writes one receipt per control assay, resumes an incomplete roster, and emits `gate.json` only after all 256 requests and deterministic replay are checked. The full `run` stage additionally requires a passing pilot gate and a separate, current comparison-release JSON with the complete-roster cost forecast. A failed gate or missing release blocks the comparison. `analyze` writes a JSON ledger and a readable Markdown report, preserving missing data and full-slot bounds.

```bash
deno run --no-lock --unstable-webgpu -A tools/founder-policy.ts pilot --manifest PATH/TO/frozen-design.json --out PATH/TO/pilot-results --max-seconds 600
deno run --no-lock --unstable-webgpu -A tools/founder-policy.ts run --manifest PATH/TO/frozen-design.json --pilot-gate PATH/TO/gate.json --release PATH/TO/comparison-release.json --out PATH/TO/comparison-results --max-seconds 600
deno run --no-lock -A tools/founder-policy.ts analyze --manifest PATH/TO/frozen-design.json --out PATH/TO/comparison-results --report PATH/TO/analysis.json
```

These stages must use the same frozen source tree as the manifest. `run` is a long GPU experiment and needs an explicit cost and runtime release after pilot review; the examples above are command shapes, not a release to execute it.

### Archipelago

```bash
cd apps/coordinator && mix phx.server
```

```bash
curl -X POST localhost:4000/api/experiments -H 'content-type: application/json' -d '{"experiment":"a1","presetId":"gradient","conditions":["treatment","neutral"],"seeds":[1,2,3],"steps":100000,"segmentSteps":5000,"censusEvery":100,"verifyFraction":0.1}'
```

Then open `/island.html` in any WebGPU browser, or run `deno run -A tools/island.ts`. The detailed operations dashboard is http://localhost:4000/index.html. In production it needs an administrator token to load detailed status; the public aggregate status is `/api/public/status`.

Once runs finish, stitch their segments into run bundles and analyze them as above. Only runs whose final segment has been verified are exported. Every downloaded file must match the SHA-256 the coordinator recorded for the accepted upload. Verification replays the physics and observer state, not the observation files, so their content is only as trustworthy as the island that produced them. Pass `--token` when the coordinator has an admin token.

```bash
deno run -A tools/stitch.ts --experiment a1
```

```bash
deno run -A tools/analyze.ts runs/a1/gradient
```
