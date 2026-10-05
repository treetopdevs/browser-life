# Handoff prompt: the remaining evolvability-discovery work

Paste everything below the line into a new Claude Code session started in `/Users/nicholas/develop/browser-life`.

---

You are continuing the evolvability-discovery line in browser-life. The workbench is built; what remains is the science that the PRD needs, starting with the renewal experiment. Work through the steps below in order, and stop at each **checkpoint** for the user.

## Read first

All in `.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/` (a git worktree on branch `claude/codex-astra-critique-b22475`):

1. `PRD.md`: what counts as met. The initial release needs S1–S3 plus O1–O9. S4–S11 are gated extensions.
2. `PLAN.md`: the stages, and its **Implementation status** section, which lists what is done and how to run it.
3. `DESIGN.md`: sections 2 (assays), 4 (case contracts), 5 (local execution) and 7 (acceptance, including the imported-evidence class).
4. `COUNCIL.md`: the decisions (D1, D2 and D6 taken; D3, D4, D5 and D7 open) and the **Stage 0 records**, including the assay dependency map.
5. The construction workspace's renewal plan: `/Users/nicholas/develop/browser-life-construction/experiments/construction/RENEWAL-PLAN.md`. It is the specification for Stages 1 and 2, and nothing in the doc set changes its protocol.

Also read the repo `CLAUDE.md` and your memory index (`MEMORY.md`), especially `evolvability-discovery-line`, `peer-sessions-shared-jj-wc`, `landing-from-git-worktree`, `subagents-jj-commits` and `codex-sol-reviews`.

## Current state (2026-10-04)

- **Workbench built:** Stage 3a (core) and Stage 3b (Phoenix discovery plane, CLI worker, browser worker page). Both passed their engineering gates on two physical hosts: this Mac (`mac-m1max`) and the work Mac (`m3pro`, `ssh work-mac`). Operational criteria O1–O9 are met (O7 is not applicable).
- **Where the code is:** uncommitted in the worktree above. Relevant paths:
  - `packages/schema/src/discovery.ts`
  - `packages/metrics/src/capabilities.ts`
  - `packages/runner/src/discovery.ts` and `discovery-transport.ts`
  - `tools/discovery.ts`, `tools/discovery-worker.ts`, `tools/lib/discovery-*.ts`
  - `apps/coordinator/lib/coordinator/discovery.ex` and `discovery/disk.ex`
  - `apps/coordinator/lib/coordinator_web/controllers/discovery_controller.ex`
  - `apps/lab/discovery/` and `apps/lab/src/discovery-*.ts`
  - `experiments/discovery/` (the engineering protocol and the seed registry)
  - the tests listed in PLAN's Implementation status
- **Run results:** under `/Users/nicholas/develop/browser-life/runs/discovery/`: `engineering-v1`, its export, and the plane export. The reduction digest of all three is `c386e0929fff4601…`.
- **Not started:** Stages 1 and 2 (renewal), decision D5, the calibration part of Stage 3a, and every scientific stage. The construction bookmark `codex/construction` is still at the renewal plan's reviewed revision `002b12944b2af5b87c1e89446548565cea531754`.

## Hard rules

- **No peeking.** Do not step any reservoir witness-habitat trajectory, under any seed, before the renewal protocol is frozen. Rule arithmetic without stepping a world is fine.
- **Separate workspaces.** Do not edit other workspaces, except the construction workspace in the steps below that say so. Do not touch the frozen transition hunt, and do not alter running or registered experiments.
- **Peer sessions.** Before editing, check for busy peer sessions on the shared jj working copy. In the construction workspace use jj from inside that directory; its plan warns that git there can resolve the wrong repository. In the worktree use plain single git commands.
- **Reviews.** Get a Codex review at every phase boundary and before every commit, read-only: `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only -C <checkout> - < prompt.md` (never Astra). Save the raw text into the doc set and add a row to COUNCIL's participants table.
- **Commits.** Commit, move `main` or push only when the user says so, each separately. Subagents must never run git or jj writes, including `jj commit`, `describe`, `new`, `bookmark` and `squash`.
- **Money.** The cloud allowance is zero (D4). Do not provision AWS.
- **Seeds and roots.** The renewal seeds are `7_310_001` and `7_311_001`–`7_311_005`. Discovery owns 8,500,001–8,599,999. Check every new range against `experiments/discovery/seed-registry.json` and add it there before freezing. Construction results go under `runs/construction/`, discovery results under `runs/discovery/`.

## Steps

**0. Decide what happens to the workbench code. Checkpoint.**
Ask the user whether to commit the worktree's uncommitted workbench, and on which branch, or to keep working there uncommitted. A final Sol review has already passed (`REVIEW-SOL-STAGE3-FINAL.md`), but re-run the suites first:
- `pnpm typecheck`
- the discovery Vitest files
- `cd apps/coordinator && mix precommit`
- `deno run -A tests/deno/discovery_local.ts`
- `pnpm build:discovery && deno run -A tests/deno/discovery_plane.ts`

**1. Stage 1: renewal tooling, in `/Users/nicholas/develop/browser-life-construction`. Checkpoint before starting.**
Confirm with the user that this session is the D2 owner. Then record the owning session ID and the starting revision in COUNCIL's Stage 0 records, item 1.

Implement work packages A–D of `RENEWAL-PLAN.md` exactly as written: the protocol and case enumeration, the read-only per-step observer, the pure readout and durable runner, and the independent verifier and report. Add the three requests from PLAN Stage 1, without changing any threshold, seed or decision rule:
- transport-band fixtures (match the closed form `transportOutflow` and `transportBands` in `packages/metrics/src/capabilities.ts`, which the workbench already checks against passive runs);
- energy-accounting tests on artificial states;
- per-site free-energy accounting, if the owner wants the energy-dependence readout. It must enter the protocol before the freeze.

Gate: the renewal plan's gates 1 and 2 (focused tests, typecheck, Deno checks, unchanged golden pins, native GPU golden, the full Vitest suite once), a Sol review, then the freeze, which executes zero steps. **Checkpoint:** report the frozen protocol hash before running anything scientific.

**2. Stage 2: the renewal experiment.**
Run the 16 controls and the 24 main cases, then the predetermined replays and the independent audit. Run the confirmation only if a habitat qualifies. Close the study under its own thresholds and negative-result rules; a technical failure is incomplete, not a biological negative. Write the result report in the construction workspace and record the outcome in PLAN (Stage 2 outcome table) and COUNCIL (U3 and U4). **Checkpoint:** report the outcome and its accounting.

**3. Decision D5. Checkpoint, because it is the user's decision.**
Present the two options from COUNCIL with their costs:
- a minimal reviewed extraction into `main` of the renewal observer and the cost-retaining ablation (`polymerTransport: false`), keeping rule-2 work isolated;
- execution pinned to a named construction revision.

Record the decision.

**4. The renewal-observer adapter in the workbench.**
- Plug the reviewed observer into the runner's observer interface through its stable API. Do not build a second renewal implementation: `maintainedSites` stays exploratory.
- Add new `observerVersion` and `readoutVersion` labels.
- Make freeze refuse any observer that is not available.
- Note that the source closure changes when the adapter's imports enter it.
- Add focused tests: a passive deposit that must not read as renewal, a rotating active site, a missing census, and saturated counters.

**5. The calibration part of Stage 3a.**
- **Benchmark:** at least three representative complete cases with the renewal observer. Measure median and upper-percentile seconds and bytes, primary and replay separately (`tools/discovery.ts stats`). Every later budget comes from these numbers.
- **Imports:** bring the renewal artifacts in by exact identity as imported evidence (DESIGN 7). This needs a small extension to the acceptance index: an imported class that carries the renewal plan's own audit and replay coverage and is never labelled as discovery-replayed.
- **Calibration cases:** a separately registered campaign of at most 16 logical cases for light dependence and passive-material false positives. Secondary readouts stay labelled exploratory.
- **Gate:** null controls behave as specified and the imported artifacts validate.
- **Mark the initial release met:** update PLAN's Implementation status and the PRD status to say S1–S3 are met, or say exactly which part is unsupported or invalid. A bounded negative counts as a valid outcome. Then get a Sol review. **Checkpoint.**

**6. Later stages, each behind its own gate and the user's approval.**
- **Stage 4a:** the rule-1 diagnostic map. 432 cases plus confirmation; settle U1 before the freeze, and price its budget from step 5.
- **Stage 4b:** the conditioned-field opportunity test. It needs D5.
- **Stage 5:** selection. Only in a demonstrated renewable regime, sensitivity (S11) first.
- **Stage 6 (optional):** the search comparison.
- **Stage 8:** the predictive bridge.

Submit campaigns through the plane (`tools/discovery.ts submit`, CLI workers and the browser page) with caps the user has set (D4). Do not start any of these without an explicit go-ahead.

## Practical notes

- **Worktree setup:** install with `pnpm install --frozen-lockfile --offline --config.confirmModulesPurge=false`. `runs/` exists only in the main checkout, so pass absolute paths.
- **Work Mac:**
  - Open the connection with `ssh work-mac true`; the user approves it in 1Password, and the ControlMaster connection lasts 8 hours. Check it with `ssh -O check work-mac`.
  - The copy lives in `~/bl-discovery/checkout`. After rsync, run `deno install`, then restore the original `deno.lock` bytes and run every tool with `deno run --frozen`; otherwise the source closure changes.
  - Reach the coordinator through `ssh -O forward -R 4100:127.0.0.1:4100 work-mac`. Open the browser page there with `ssh work-mac "open 'http://localhost:4100/discovery/index.html?host=m3pro#token=…'"`; the user presses Start.
- **Demo coordinator:** run it from the worktree's `apps/coordinator` with `MIX_ENV=dev PORT=4100` and separate data directories in these environment variables: `BL_DATA_DIR`, `BL_DISCOVERY_DATA_DIR`, `BL_DISCOVERY_JOIN_TOKEN` and `BL_ADMIN_TOKEN`. `runtime.exs` finds the validator (deno plus `tools/discovery.ts check-attempt`) automatically.
- **Writing:** when you report, state plainly what is met, what is pending and what is blocked. Never call the PRD complete on local evidence, and never call a capability map evidence of evolvability.
