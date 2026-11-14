# The Gate-0 spike

Scratch code for the pilot of the cyclic-competition line (`runs/rps/rule-draft.md` section 3.0, frozen as
`experiments/3d-rps/RULES.md` before Gate 0 runs; plan `docs/3d-cyclic-rps-plan-2026-10-23.md`, section 8, Part A). It is committed so that
the pilot that chooses the operating point can be reproduced from the repository (decision D16). Gate-0 numbers are pilot numbers, never
results. Nothing in `packages/` imports this directory, and nothing here imports from `runs/`. The directory holds only what Gate 0 uses:
the review's scratch scripts (`proto.ts`, `proto2.ts`, `meter.ts`, the `batch*.sh` and `chain*.sh` drivers, `sheet.py`) and its `out/`
logs and snapshots were not carried over and are never added (a test lists the directory against the recorded SHA-256).

## What it is

The review prototype (`runs/rps/review/proto`, copied here on 2026-10-24) patches the shipped slab `react` shader **as text**, adding the
predation kill and the mask mirror, and drives it from a script. The kernel proper (schema keys, CPU reference, WGSL, goldens) is Part B
and is built only after Gate 0 gives GO for some rung. The spike reads `packages/sim-gpu/src/shaders3d.ts` as it is in the tree and throws
if its patch anchors have moved, so it runs only against the tree it was written for; the Gate-0 record names that revision.

| file | role |
|---|---|
| `shaders3d-rps.ts` | the patch. `RPS.kill` is the compile-time kill-form switch: `"removal"` (the prototype's kill, text unchanged) or `"vacancy"` (rung V: a cell with a dominant face is emptied with probability `rate * ndom / 2^16`, the 2D injury lesion, plan 4.3a) |
| `gpu-sim3-rps.ts` | `GpuSim3` bound to the patched shaders (no state validation: the shipped `validateState` refuses the type and mask bytes of PARAM1 and the mirror in MOT bits 24 to 31, which exist only under the RPS keys of Part B) |
| `world.ts` | the founding of plan 4.4 (`rpsMix`) and the inert stripe world of 3.1 |
| `rungs.ts` | rungs S0, S1, S2 (G0.1), job configs, the settings that live outside `WorldConfig` |
| `plan.ts` | the job tables G0.2 to G0.6, the V check, the horizon rung, and the planner that reads the readout's evaluation to find the next jobs (one rung at a time, in the order S0, S1, S2, V, by default; every handled rung with `--plan-all`); `--machine-share` ownership |
| `jobs.ts` | from a planned job to a `KernelJobSpec` (`lib/kernel-job.ts`), and the mobility-meter job |
| `adapter.ts` | `GpuSim3` as the harness's `KernelSim` |
| `driver.ts` | the staged loop (plan, run this process's share, plan again), apart from the GPU; it stops, before planning more, when a job on disk shows a conservation failure (also one that did not come back on the rerun) or the readout finds a bug indicator or unusable input |
| `gate0.ts` | the command line: `--gate0` (refuses before the freeze of `RULES.md`), `--exploration` (Amendment 1), `--rehearsal`, `--table`, `--hash` |
| `rehearsal.ts` | plumbing rehearsal: both kill builds, the V check, the hand-over, an exact audit of the vacancy rule, the mobility meter |
| `explore.ts` | the explorations of Amendment 1 (after GATE-0-STOP; `--exploration`) and Amendment 2 (persistence at 256 x 256 x 4; `--exploration-2`): their planners, checks and the disk half of their DriverIo |
| `cli.ts` | argument parsing, and the SHA-256 recipe and the sidecar file that records it |
| `lib.ts` | the prototype's helpers (`slabCfg`, `uptime`, ...), `runs/rps/probe/lib.ts` copied so that nothing here imports from `runs/` |

## How it differs from the original

Import paths (`../../../packages/...`, `./lib.ts`), the unused `validateState` import of `gpu-sim3-rps.ts` dropped and `Deno` reached
through `globalThis` in `lib.ts` (so that `pnpm typecheck:rps` passes; `experiments/3d-rps/deno-shim.d.ts` stands in for the `Deno` global
there), and the kill-form switch in `shaders3d-rps.ts`. The
prototype's own drivers (`proto.ts`, `proto2.ts`, `meter.ts`), the review's shell and python scripts and `out/` (its scratch logs and
snapshots, 3.5 MB) were not copied: nothing here runs them, and `world.ts`, `jobs.ts` and `plan.ts` carry what the pilot needs of them.
The removal text is pinned byte for byte against the original by `experiments/test/rps-gate0-spike.test.ts`.

## Running

```
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --rehearsal                  # plumbing, seeds 900 and up, about a minute
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --gate0 --out=<dir> --dry-run  # what the next wave would be
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --gate0 --out=<dir>            # the rungs in the order S0, S1, S2, V; stops at the first GO
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --gate0 --out=<dir> --rung=S0   # one rung (S0 on one Mac, --rung=S1 on the other: D2)
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --gate0 --out=<dir> --plan-all  # every rung at once, whatever the first GO
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --gate0 --out=<dir> --machine-share=1/2   # half the wave
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --table --out=<dir>           # the Gate-0 table, through the readout on the frozen rules
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --table --out=<dir> --draft   # the same on runs/rps/rule-draft.md, labelled DRAFT
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --hash                        # the spike's SHA-256 against ../gate0-spike.sha256
```

`--gate0` runs the registered pilot seeds (Appendix A, 401 to 405) and is not started until the main session says so: it refuses unless
`experiments/3d-rps/RULES.md` exists and has its SHA-256 in `experiments/3d-rps/FROZEN` (`RULES.md` is frozen before Gate 0), except with
`--dry-run`. Rule draft 3.0 takes the rungs in the order S0, S1, S2, V and stops at the first GO, so by default a wave is planned for one
rung at a time: S1 after S0 is excluded, V's own rows after S0 and S1 are, nothing after a GO. `--plan-all` plans every handled rung at
once (S0 and S1 side by side with one command, D2), at the price of the lower rungs' jobs when a higher one gives GO; a process given
`--rung=S1` alone works on S1 at once. See the header of `gate0.ts` for every option and the exit codes.

## Exploration (Amendment 1)

The registered pilot ended GATE-0-STOP (`../GATE0-RECORD.md`). Amendment 1 of `RULES.md` explores the kill at S0's four mobility levels:
rung S0 (removal) and rung V on S0 (vacancy kill), side by side and both in full, each ending with one label of A1.4, never a GO.
`explore.ts` plans it on the same loop (`driver.ts`); the registered pilot's job directory is read (S0's G0.2, and the rate-0 seed-401
cells of the table, which are its scan jobs) and never written. On the work Mac, where the registered jobs are in `runs/rps/gate0`:

```
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --exploration --out=runs/rps/gate0-exp --registered=runs/rps/gate0 --dry-run
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --exploration --out=runs/rps/gate0-exp --registered=runs/rps/gate0
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --exploration --out=runs/rps/gate0-exp --registered=runs/rps/gate0 --machine-share=1/2
deno run -A --no-lock experiments/3d-rps/readout.ts gate0-exploration --jobs runs/rps/gate0-exp --registered runs/rps/gate0
```

The first wave is 79 jobs: the V check's vacancy build (`g0-vcheck-vacancy-S0-sp8-r0-s401`, compared byte for byte with the registered
`g0-scan-S0-sp8-r0-s401`, which is the removal build of the same job), S0's G0.3 at spreads 6, 8, 16 (42) and V's (36); then G0.4 once
if either rung passes row 2, and G0.5 per rung that passes rows 1 to 3. V's own jobs run only behind an identical V check; a failed check
voids V alone (EXPLORATION-V-VOID): its jobs are skipped, S0 runs on to its label and the run ends with exit 3, while every other stage stop
(a conservation or invariant failure, a bug indicator, unusable input) stops everything. Both commands refuse, `--dry-run` included, unless
`RULES.md` is frozen and contains the "## Amendment 1" heading, and the two directories must be separate, neither inside the other once
symlinks are resolved; `gate0.ts` prints the header before it parses its arguments, so a refusal starts with it too. Every output of the readout starts with "EXPLORATION (Amendment 1): the registered pilot ended GATE-0-STOP"; its exit codes are
those of `gate0` (0 when both rungs have a label, 3 on a bug indicator, a failed V check included, 4 while jobs are to run).

## Exploration 2 (Amendment 2)

Amendment 1 read EXPLORATION-NO-HORIZON for both kills (`../GATE0-EXPLORATION.md`). Amendment 2 of `RULES.md` tests persistence at
256 x 256 x 4 with the operating point carried over (`v_cal` 8, `kappa_w` 64): first the horizon (A2.2: S0, removal build, spread 8,
rate 0, seeds 401 to 403, 200,000 run steps), then, once `T_ctl` and `h0` are known (G0.4's own reading), the confirmation of the removal
and the vacancy kill at rate 64 (A2.3: 6 jobs, `h0` run steps). Each kill form ends with one label of A2.4, never a GO. It uses only its
own job directory; job ids start with `g2-` and each `summary.json` records `mode` "exploration-2", `amendment` 2 and the shape.

```
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --exploration-2 --out=runs/rps/gate0-exp2 --dry-run
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --exploration-2 --out=runs/rps/gate0-exp2
deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --exploration-2 --out=runs/rps/gate0-exp2 --machine-share=1/2
deno run -A --no-lock experiments/3d-rps/readout.ts gate0-exploration-2 --jobs runs/rps/gate0-exp2
```

Both refuse, `--dry-run` included, unless `RULES.md` is frozen and contains the "## Amendment 2" heading, and every output starts with
"EXPLORATION (Amendment 2): the registered pilot ended GATE-0-STOP". The readout exits 0 when both forms have a label, 3 on a bug
indicator (a conservation or invariant failure, a job of another shape or settings), 4 while jobs are to run.

## The SHA-256

`experiments/3d-rps/gate0-spike.sha256` records the hash taken on the working tree, over exactly the files that were to be committed
(`git ls-files` cannot see untracked files), with the listing it is the hash of written beside it, one `<sha256 of the file>  <path>`
line per file. The value that goes in the Gate-0 record is the one of the recipe in rule draft 3.0, taken on the committed files after
the last change to this directory and before the first Gate-0 job; for the same file set it is the recorded value:

```
(cd experiments/3d-rps/gate0-spike && git ls-files | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256)
```

Any edit to a file here changes it, this README included; record it again with
`deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --hash --write` (a test fails until you do).
