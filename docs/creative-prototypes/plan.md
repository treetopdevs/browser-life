# Creative prototype backlog — 25 October 2026

## Aim
Build watchable, interactive life-like worlds. Engineered behavior is welcome and explicitly labeled. This is a creative track, separate from the conserved-matter research kernel. The pasted ten-candidate brainstorm is inspiration, not evidence: its probabilities and claims of guaranteed persistence are not acceptance criteria.

## First slice: particle playground (Candidate 7)
Latest shared base: origin/main 904a05a1. A new CPU 2D particle world at `/particles/` gives us a visibly different substrate without importing the unmerged 3D research stack. Keep the first version small and runnable on an ordinary browser. No deployment or scientific rule changes.

Implement seeded particles with positions, velocities, inherited attraction/repulsion traits, energy, finite lifespans, feeding from renewable patches, splitting at an energy threshold, and small inherited mutations. Include at least three deliberately engineered interaction presets (flocks, pursuit, colonies) so visitors can compare distinct motion rather than wait for a rare discovery. Use bounded speed, population and local interactions; explain what caps and external food do. Births divide parent energy; predation, if included, must have explicit transfer rules. No silent resurrection. If extinct, stop and offer reset.

Controls: preset, seed, pause/resume, single step, reset, mutation toggle; visible population, births/deaths, generations and trait variation; seeded JSON observation download with settings and rules version. Use family colors and trails or bonds only when those represent real state. Reduced motion starts paused; hidden pages suspend; rendering speed never changes timestep physics. Retain bounded recent history.

Prototype acceptance: deterministic replay for same seed/settings, finite bounded state, actual reproduction and inherited mutations, energy accounting around births and feeding, no self interactions or multiple updates of newborns, correct toroidal distances, reset/pause/step/export behavior, responsive keyboard-accessible controls. Run each preset for at least 3 seeds and 3,000 ticks; record extinctions, turnover and spatial activity without calling movement evolution. Visually inspect screenshots and short clips of at least two different presets. Revise only with recorded reasons and rerun affected checks.

## Workflow and next decisions
1. Adversarial plan review with Claude Sonnet 5.5 high; fallback only if unavailable to agy Argon 4 high.
2. Implement core and UI in independent agent-owned files, integrate, run model and browser checks plus typecheck/build.
3. Adversarial implementation review, fix substantive findings, rerun relevant checks, repository-required Codex High review before commit.
4. Commit, open a PR against main, attach PR, inspect checks and fix failures. Do not merge/deploy without further instruction.
5. Maintain `decisions.html` with backlog status, choices, review outcomes, evidence and next slices. Later slices: reusable comparison/picker (10), environmental variation (3), motif combinations (2), then morphology/encoding (1/5) based on what is worth watching. Reuse existing Candidate 8/9 work; do not repeat failed diagnostics.

Working prototypes of the existing seven app surfaces are already on main; this batch expands the creative world portfolio, while deployment readiness stays with its existing worktree. The 3D port and WebGPU scaling are later decisions after the 2D prototype proves watchable.

## Plan-review resolutions
- `/particles/` is a Vite input with noindex, no canonical and diagnostic-route test coverage. Exclude it from the production image and block its public path, matching the existing held-back garden policy. This is reversible packaging protection, not a deployment.
- Use a seeded integer PRNG, separate mutation randomness, stable particle ordering and float64 physics. Replay means same settings and runtime; no cross-browser bitwise claim. A separate toy `RULES.version` owns the format; JSON is an observation, not resumable checkpoint.
- Feeding comes only from renewable patches. Pursuit is asymmetric motion, not predation. Track renewal, feeding, metabolic and death losses. Birth splits existing energy, with newborns appended after the adult step.
- Population cap 240 (blocked births counted), bounded speed and interaction radius defined in model RULES, recent history at most 300 samples. At this deliberately small scale deterministic all-pairs forces are acceptable; optimize only if measured frame cost requires it.
- Fixed tick physics; at most a small frame budget and no hidden-tab catchup. Hidden pages stay paused on return. Mutation-setting changes reset the recipe.
- Pilot seeds 1201,1202,1203 × three presets ×3,000 ticks. Save census histories and totals. Spatial activity means average per-tick speed and occupied spatial bins, not adaptation. Revise presets if all three seeds go extinct or show no motion; saturation is reported and triggers inspection rather than being concealed. No guarantee that every preset survives.
