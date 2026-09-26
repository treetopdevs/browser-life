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
tools/              headless CLIs on Deno's native WebGPU (run, analyze, island, bootstrap)
experiments/        pre-registration (draft)
```

## Run it

```bash
pnpm install
```

```bash
pnpm dev
```

The lab opens at http://localhost:5173. `/selftest.html` checks the CPU reference against this browser's GPU bit for bit. `/island.html` contributes the GPU to a coordinator.

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

### Archipelago

```bash
cd apps/coordinator && mix phx.server
```

```bash
curl -X POST localhost:4000/api/experiments -H 'content-type: application/json' -d '{"experiment":"a1","presetId":"gradient","conditions":["treatment","neutral"],"seeds":[1,2,3],"steps":100000,"segmentSteps":5000,"censusEvery":100,"verifyFraction":0.1}'
```

Then open `/island.html` in any WebGPU browser, or run `deno run -A tools/island.ts`. The status page is http://localhost:4000/index.html.
