# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An open-ended artificial-life ecology on WebGPU: closed in matter, open in energy, exact integer physics. Individuals, reproduction and heredity are *inferred* from local rules, never declared (no `Organism` class, no `reproduce()`). Research goal and milestones (M3 bootstrap → M4/M5 ensembles): `docs/plan.md`. Rules in prose plus the arithmetic-bounds argument: `docs/rules.md`.

The repo is a pnpm workspace (TypeScript packages + Vite lab), a Deno toolchain for headless GPU runs, and a Phoenix app (`apps/coordinator`). It is jj-colocated with git (`.jj/`).

## Commands

```bash
pnpm install
pnpm dev                 # lab at http://localhost:5173 (/selftest.html, /island.html)
bin/dev                  # lab + coordinator together (PORT, LAB_PORT override 4000/5173)
pnpm typecheck           # tsc over packages/*/src, apps/lab/src, tests (excludes tests/deno)
pnpm test                # vitest: apps/lab/test, packages/*/test, experiments/test, tools/test
pnpm vitest run packages/sim-ref/test/ref.test.ts -t "<name>"   # single test
deno run -A tests/deno/gpu_golden.ts    # GPU vs CPU reference, bit for bit (native WebGPU)
npx playwright test      # browser golden (tests/e2e), Chrome with WebGPU flags; BL_ALL_ENGINES=1 adds firefox/webkit
cd apps/coordinator && mix test         # or `mix test test/coordinator/queue_test.exs`
cd apps/coordinator && mix precommit    # warnings-as-errors, format, test
pnpm gen:prereg          # regenerate experiments/preregistration.md generated sections
```

`tests/deno/*.ts` are standalone scripts (not `Deno.test`); run each with `deno run -A tests/deno/<name>.ts`. Several need a real GPU; `coordinator_integration.ts` spawns `mix phx.server` against a scratch data dir.

Experiment CLIs (`tools/`, all Deno, native WebGPU): `run.ts` (write run bundles to `runs/<experiment>/<preset>/<condition>/seed-<n>/`), `analyze.ts` (ensemble analysis), `bootstrap.ts` (M3 MAP-Elites search), `retest.ts`, `calibrate.ts`, `island.ts` (headless island), `stitch.ts` (coordinator segments → bundles). Usage is in each file's header comment and in README.md. `runs/` is gitignored and can hold very large outputs.

## Architecture

**Package imports.** `@bl/*` resolve to `packages/*/src/index.ts` via four separate maps that must stay in sync: `tsconfig.json` paths, `vitest.config.ts` aliases, `deno.json` imports, and `apps/lab/vite.config.ts` aliases. There is no build step for packages.

**Two implementations of one rule set.**
- `packages/sim-ref/src/step.ts` is the executable specification (CPU).
- `packages/sim-gpu/src/shaders.ts` (WGSL) must match it bit for bit. `packages/sim-gpu/src/golden.ts` defines golden cases and runs on any WebGPU host (Deno, browser `/selftest.html`, Playwright).
- `packages/sim-ref/test/golden-hashes.test.ts` pins state hashes per `RULE_VERSION` (in `packages/schema/src/config.ts`). Any change to dynamics changes the hashes: an intended rule change bumps `RULE_VERSION` and re-pins deliberately. A change that isn't meant to alter dynamics must leave every pin untouched — new optional `WorldConfig` keys stay absent from `defaultConfig()` so existing configs hash identically.
- All arithmetic is integer (u32 matter, fixed-point controllers, counter-based PRNG keyed on seed/step/cell, stochastic rounding with remainders to the source). Conservation residual is exactly zero. Keep new arithmetic inside the bounds listed in `docs/rules.md` (`MATTER_MAX`, `POOL_MAX`, `mulShr` limits); `validateConfig`/`validateState` enforce them.

**Packages.** `schema` (config, presets, layout, genome, worlds, checkpoint encoding, migration/exchange, M3 founder set) → `sim-ref`, `sim-gpu` → `metrics` (census, tracker, collectives, activity, complexity, stats; runs on readbacks) → `runner` (conditions, `runExperiment`, observers, stitching, island client) and `search` (MAP-Elites, gates). `lineage` (schema, sim-ref) is the lineage inspector's genotype core: keys, ancestry, mutation replay, the controller probe, and the mutation-edge store the lab keeps. `runner` code runs unchanged in browsers and Deno.

**Checkpoints and replay.** A checkpoint artifact carries physics state and observer state together, under one digest. Segmented runs must equal a continuous run byte for byte (`tests/deno/segments.ts`, `tests/deno/stitch.ts`); this determinism is what makes distributed verification possible.

**Archipelago.** `apps/coordinator` (Phoenix, JSON API under `/api`, static status page `priv/static/index.html`) hands islands segment tasks. `Coordinator.Queue` does scheduling, `Coordinator.Segment` owns segment state transitions, and `Coordinator.Store` is content-addressed storage for checkpoints (`.blck`) and bundle files. A fraction of segments is re-run by a second island and compared by state hash. Islands are `apps/lab/island.html` (browser) or `tools/island.ts` (Deno), both via `packages/runner/src/island.ts`. `apps/coordinator/AGENTS.md` has Phoenix/Elixir/OTP conventions to follow there; everything between its `usage-rules` markers is generated by `mix usage_rules.sync` (config in `mix.exs`), so rerun that after dependency changes rather than editing the section. `mix usage_rules.search_docs "<term>" -p <pkg>` searches hexdocs for the coordinator's deps.

**Lab.** `apps/lab/src/sim.worker.ts` owns the WebGPU device, frame loop, rendering and OPFS storage. `apps/lab/src/execution.ts` owns census cadence, observer integrity, checkpoint settlement and replay traversal. State-changing messages run through `exclusive()`, which waits for in-flight frame execution; generation identity invalidates stale readbacks.

**Pre-registration.** `experiments/endpoints.ts` is the source of truth for primary endpoints, held-out observables and activity thresholds, and `tools/analyze.ts` executes it. The generated sections of `experiments/preregistration.md` (between `GENERATED` markers) come from `pnpm gen:prereg`, and `experiments/test/prereg-sync.test.ts` fails when they are stale. Edit `endpoints.ts` and regenerate; never hand-edit inside the markers. The doc is frozen (2026-09-27): its SHA-256 is recorded in `experiments/FROZEN`, `pnpm gen:prereg` now refuses to rewrite the generated sections, and every change goes in a dated amendment section.

**Analysis scale.** Run bundles can be hundreds of MB per run (for example `lineages.tsv`). Analysis tools stream per census rather than loading whole tables; keep new analysis code streaming.

## Codex reviews

Reviews by Codex use **Sol 6.1 at High effort**, not Astra (standing instruction from 2026-10-03, replaces the earlier `gpt-6-astra` policy). Run them read-only at phase boundaries and always before committing:

```bash
codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only -C <checkout> - < prompt.md > review.txt
```

Use `< /dev/null` when the prompt is an argument (otherwise codex waits on stdin) and `-o <file>` for the final message. Historical "Astra review" comments in the code are provenance for past reviews; leave them. Delegated agents and workspaces follow the same rule.
