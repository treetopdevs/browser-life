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
| `gate0.ts` | the command line: `--gate0` (refuses before the freeze of `RULES.md`), `--rehearsal`, `--table`, `--hash` |
| `rehearsal.ts` | plumbing rehearsal: both kill builds, the V check, the hand-over, an exact audit of the vacancy rule, the mobility meter |
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
