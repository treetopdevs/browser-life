# Mycelium world, rung R2: does heredity matter? (pre-registered protocol)

Drafted 2026-11-13, revised after a Codex review (Sol 6.1 High, read-only) the same day. Status: **frozen by Freeze 1**, recorded in `FROZEN` beside this file (this document does not embed its own hash; `FROZEN` holds it). No pass-1, dev or confirmation run has been made (smoke runs on seeds below 9001 exist and are never analysed). Spec of the world: `tools/mycelium/RULES.md`; CPU reference: `tools/mycelium/world.ts`. Context: `docs/neural-mycelia-2026-11-13/report.html` (X1 controls and stop rule; X2 and R3 wait on this gate).

## 1. Question

Does the inherit arm (children copy the parent's controller with mutation) produce a world measurably different from (a) the heredity-blocked twin and (b) a Physarum null, beyond the replicate noise floor, on readouts fixed before any confirmation run?

"Different" means a difference in the four gating readouts of section 4, in the sense of section 8. Nothing else is tested. "Different" does not mean "better" or "beyond": the ordering of inherit against the two contrasts is reported (section 8) and conditions no verdict.

## 2. Arms

All arms use `defaultConfig()` (128 x 128, `maxParticles` 8192, 1024 founders, `light` 1, `lightPattern` uniform, `upkeep` 6, mutation 1/4 per birth, 2 weights, step 16) with only the keys below changed. Same seed means the same founders (positions, matter, energy, weights), so arms are paired by seed.

| Arm | Config delta | Gate role |
|---|---|---|
| inherit | `heredity: "inherit"` (the default) | reference |
| blocked | `heredity: "blocked"` | contrast (a) |
| frozen | `heredity: "frozen"` | reported only, never in a decision |
| physarum | `controller: "physarum"`, `heredity: "frozen"` | contrast (b) |

**Physarum null.** New optional `MyceliumConfig` key `controller?: "neural" | "physarum"`.
- It is ABSENT from `defaultConfig()`, and `createWorld` must not insert it, so the `encode` JSON header of every existing config is byte-identical and every existing pin and the pinned digest in `tools/test/mycelium.test.ts` stay untouched. Absent means "neural".
- `validateConfig` accepts only those two values, and requires `heredity === "frozen"` when physarum (the genome is carried but never read, and no mutation draw is made).
- **What is and is not matched.** Founders, light and the arithmetic of eating, upkeep, moving, depositing and splitting are the same; only phase 3 (Think) changes, and phases 2 and 4-8 are unchanged. The **realised behaviour is not matched**, and this protocol does not claim an equal energy budget: the null deposits one unit in every particle at every step, always eats at full output and always splits when able. In the 8000-step smoke run it held about 218k units of trail against about 6k (inherit) and 17k (blocked), and its population was about 2.2k against 5.4k and 4.9k; its trail sits in about 2,350 isolated hot cells, so R1 was 0 at theta 4 and R2 was about 6 against 1.9 (inherit) and 1.0 (blocked). It is a different kind of world by construction. (The X1 report in `docs/neural-mycelia-2026-11-13/report.html` says "same energy budget"; this section supersedes that phrase: same energy input and accounting rules, not the same realised budget.) The physarum contrast will therefore separate from inherit on R1 (where inherit is not near 0), R2 and probably R4 for reasons unrelated to heredity, and a `NOT-SEPARATED-FROM-PHYSARUM` verdict is correspondingly unlikely. The binding contrast is blocked. Section 8 states what that means for a PASS, and the calibration report prints the dev contrasts so the weakness is visible before confirmation.

Phase 3 for physarum replaces `controllerForward`. Let `gx = xin[3]`, `gy = xin[4]` (the trail gradients, already in ±127), `pb = pbase(seed, step, id)`, `m = max(|gx|, |gy|)`, `trunc` = `divi`:
- `EAT = 127`, `DEPOSIT = 32`, `SPLIT = 127`. This means eat at full output; deposit `(maxDeposit * 32) >> 7 = 1` unit per step, at the usual `depositCost`; split whenever `E >= splitEnergy` and `M >= splitMatter`.
- If `m > 0`: `bx = trunc(gx * 64 / m)`, `by = trunc(gy * 64 / m)` (up the gradient at half speed). Otherwise `bx = (draw(pb, 62) % 129) - 64`, `by = (draw(pb, 63) % 129) - 64` (no trail here: wander).
- Small random turn: `MX = clampi(bx + (draw(pb, 60) % 33) - 16, -127, 127)`, `MY = clampi(by + (draw(pb, 61) % 33) - 16, -127, 127)`.
- Draw slots 60-63 are unused by the existing rules. Outputs 5-7 are 0.

These constants (64, 16, 32, 127) are fixed here and not tuned. If the null trips the population guard (section 7) the whole comparison is MEASUREMENT-LIMITED, and any redesign of the null is a dated amendment followed by a new freeze. There is no fallback ladder.

## 3. World, run length, cadence

- World: `defaultConfig()` as is (128 x 128; no size change). All arms, dev and confirmation, run on the **CPU reference** (`world.ts`). Physarum is not ported to WGSL, so R2 does not depend on R1 parity. `gpu.ts` must throw on `controller: "physarum"` rather than ignore it.
- Length: **20,000 steps** per run. Cost: dev is 5 pass-1 runs plus 30 pass-2 runs, 35 in all, and confirmation is 20 runs, 55 in all. A neural-arm run takes about 90 s and a physarum run about 50 s (smoke runs of 2,000 steps took 8.8 s and 5.1 s with one run alone, about 4.4 and 2.6 ms per step; an 8,000-step smoke with two runs at once took about 39 s), so the serial total is roughly 80 minutes: pass 1 about 8, pass 2 about 42, confirmation about 27. Parallelism is allowed for pass 1 and dev because runs are independent; confirmation is serial (section 10). The smoke runs were populated (4-5k particles) at step 3,000, and that the population is stationary by step 10,000 is an assumption, not a finding: in the smoke run inherit was still drifting (n from 5,063 to 5,390 and R2 from 1.87 to 1.67 between steps 6,000 and 8,000). The dev and confirmation reports therefore show, for every arm-seed, `n` at 10,000 and at 20,000 and the **drift** of n, ΣP, R1 and R2 across W (section 4). Drift is reported and gates nothing: every readout is the mean over W, and drifting arms may drift at different rates, so a result is a statement about the 10,000-20,000 window, not about a steady state. 10,000 steps are discarded as burn-in and 10,000 are measured, enough for an autocorrelation out to 2,500 steps (section 4, R3). The horizon is a pre-registered choice. A FAIL means "not separable at this horizon in this world", not "heredity cannot matter".
- Ledgers: matter and energy residual checked after **every** step as in `run.ts`. Any nonzero residual invalidates the run, is written to the seed log as an `invalid` entry, and stops the protocol (section 10).
- Census (all streaming; a run keeps scalar series and running sums, never whole tables):
  - every 10 steps: `n` (live particles), cumulative `totals.births`, `totals.refused`, and ΣP;
  - every 100 steps: the field readouts R1 and R2 below, plus the descriptive items in section 4.
- Measurement window `W` = steps (10,000, 20,000]. The population guard window is the same `W` (section 7).

## 4. Readouts (gating)

Each is a deterministic function of a run (IEEE double arithmetic in fixed loop order, no `Math.sin`/`cos`, no sort-dependent ties). A run's value `v(r, arm, seed)` is the mean of the per-census values over `W` (R1, R2) or the single value defined below (R3, R4).

- **R1 trail connectivity.** Mask = cells with `P >= theta`. Components are 4-connected on the torus. `R1 = (sum of P over cells lying in components of at least 25 cells) / (sum of P over all cells)`, and 0 if ΣP = 0. `theta` is set once in calibration pass 1 (section 6) and frozen: the nearest-rank 75th percentile of `P` over cells with `P > 0`, from a streaming integer histogram of `P` (bins 0..255, values above clamped into 255) accumulated over every `W` census of the five inherit dev runs, with a minimum of 2. It is an absolute integer and the same for every arm. R1 is a share, so `|D| <= 1`; it is also near 0 when the trail is thin (the smoke run's inherit and blocked trail was about 0.4 per cell and R1 was spiky and near 0 after step 4,000), which section 6 handles by a pre-stated degeneracy drop.
- **R2 patchiness (clustering).** From the per-cell counts `D` at the census: `R2 = ((sum D^2 / n) - 1) / (n / cells)`, Lloyd's patchiness (mean crowding over mean density). A random scatter gives about 1, clustering gives more than 1. This does **not** make R2 independent of population size: for a fixed clump size it scales with 1 / density (200 singly occupied cells of 16,384 give 0, and the same cells each holding two give about 41). Undefined if `n = 0`; that already trips the guard. `n`, ΣP and the mean crowding (`sum D^2 / n - 1`) are printed beside every readout in every report.
- **R3 oscillation strength.** Series `x_i = n` at the 10-step samples in `W` (1,000 samples). Remove the least-squares linear trend. Autocorrelation `rho(l) = sum_i x_i x_{i+l} / sum_i x_i^2` for lags l = 1..250 (up to 2,500 steps). Let `l0` be the first lag with `rho < 0`. If none exists, `R3 = 0`. Otherwise `R3 = max(0, max rho(l) over l in [l0, 250])` (the strongest positive recurrence after the first dip), and the lag of that maximum, times 10, is the period `T`; if the maximum is not positive, `R3 = 0` and there is no `T`. A constant or purely linear series has no variance after detrending (`rho` is 0/0) and is defined as `R3 = 0`. R3 is therefore never negative, but it is discontinuous (a series without a dip reads 0, white noise about 0.1) and likely noise-dominated; its probable fate is to be dropped by the positive controls. `T` is descriptive only. ΣP gets the same treatment, descriptive only.
- **R4 turnover.** `R4 = 1000 * (births(20,000) - births(10,000)) / (10,000 * mean n over the 10-step samples in W)`: births per particle per 1,000 steps.

**Descriptive only, never in a decision** (reported for all four arms): live genotype count and its ratio to `n` (it differs by definition between arms), mean `M`, `E` and age of live particles, ΣP, mean crowding, `T`, refusals, the **drift** (relative difference of the mean over the second half of W against the first half, divided by the mean over W) of `n`, ΣP, R1 and R2, and the **behaviour signature**. The signature is, over live particles at each `W` census, the fraction with `DEPOSIT > 0`, the fraction with `EAT > 0`, and the mean `|MX|+|MY|`, computed by an exported `probe(state)` that runs the sense and think phases without changing the state. Its value for physarum is set by design, which is why it is not a gate. `step()` calls the same sense-and-think function as `probe` (digests do not move).

## 5. Seeds

- **Dev seeds 101-105.** Used for calibration only (section 6). Smoke runs (short, never analysed, never gating) may use any seed below 9001, including the dev seeds and seeds 1-3; the protocol does not rest on dev seeds being unseen, only on fresh seeds being unseen.
- **Fresh seeds 9001-9005.** Used for confirmation only. They are embargoed: `tools/mycelium/run.ts` refuses any seed of 9001 or more, `r2.ts` runs them only in the confirm phase, and the seed log (section 10) records every logged run. Other programs that take a seed and can run a world (the lab page `apps/lab/src/mycelium/page.ts`, `tests/deno/mycelium_gpu.ts`, and any script that imports `world.ts` or `gpu.ts`) are outside the guard. The embargo is a discipline guard, not a security boundary: it stops accidents (an unlogged look through `run.ts`, a per-run print in the middle of a batch, a log that another checkout does not see, because the log lives beside this file and travels with the commit) but cannot stop someone who writes their own script. No run with a seed of 9001 or more has been executed before the freeze.

## 6. Calibration (dev seeds 101-105 only)

Two passes, both on seeds 101-105 only; nothing from the fresh seeds is read.
- **Pass 1:** the five inherit runs, 20,000 steps each, accumulating the `P` histogram that fixes `theta` (R1). Its readout values are discarded.
- **Pass 2:** with `theta` fixed, re-run everything for 20,000 steps: inherit, blocked, frozen, physarum and the two positive controls below (controls are the inherit arm with one physical change). That is 30 runs. Runs are deterministic, so pass 2 inherit equals pass 1 and the re-run only costs time.

1. **Population guard on dev.** Any trip on inherit, blocked or physarum (section 7) ends calibration with MEASUREMENT-LIMITED. The tool writes the verdict and stops. A repair is an amendment (a dated section with the reason) and a re-run, never a silent tweak.
2. **theta** (from pass 1) is recorded in `CALIBRATION.json`; pass 2 and the confirmation read it from there.
3. **Noise floors, per contrast.** For each readout `r`, `SD(r, arm)` is the sample standard deviation (n-1) of the five dev values within an arm. `NF_B(r) = 2 * max(SD(r, inherit), SD(r, blocked))` is the floor for the blocked contrast and `NF_P(r) = 2 * max(SD(r, inherit), SD(r, physarum))` the floor for the physarum contrast, so an erratic physarum arm cannot inflate the blocked contrast. Drops, applied in this order, each recorded with its reason:
   - the readout is dropped if `NF_B(r) = 0` or `NF_P(r) = 0`;
   - the readout is dropped if it is bounded and `NF_B(r)` is at or above its largest possible effect (only R1 is bounded, by 1), because no effect could ever exceed the floor;
   - **R1 is dropped as degenerate** if its mean over the five dev seeds is below 0.05 in both inherit and blocked (the two arms of the binding contrast; physarum's R1 may be 0 by construction and does not count).
   A bounded readout whose `NF_P` is at or above its largest possible effect stays (it still serves the blocked contrast) and is recorded as unreachable against physarum. The 2-SD bar is a conservative heuristic for unpaired means, not a significance test: pairing by founders can reduce or inflate the variance of the differences, and no p-value is claimed.
4. **Positive controls** (one physical change each, applied to the inherit arm, nothing about heredity):
   - PC-light: `light: 2` (doubled).
   - PC-decay: `pDecay: 2620` (trail decays 4 times faster).

   For each control `c` and readout `r`, the paired per-seed differences are `d_s = v(r, PC_c, s) - v(r, inherit, s)` over the five dev seeds, tested with the effect test of section 8 against `NF_B(r)`. The readout is **sensitive to `c`** if the test separates. A readout is **kept** if it is sensitive to at least one control, and **dropped before confirmation** otherwise. These controls are gross perturbations, so `kept` means "sees a gross physical change", not "could see a heredity-sized effect": it screens out readouts that are insensitive or degenerate, and probably screens R3 only. The light-2 control may touch the population cap (`refused > 0`), which distorts R3 and R4; that is flagged in the report, not excluded. If a control run trips the guard (section 7) on any seed, that control is unusable and is ignored. If both controls are unusable, no readout can be shown sensitive and the verdict is MEASUREMENT-LIMITED.
5. **Dev contrasts (informational, no decision).** The confirmation test is applied to inherit - blocked and inherit - physarum on the dev seeds for every live readout and printed in the calibration report, so a physarum contrast that is already far outside the floor, or a blocked contrast that is already null, is visible. Nothing in the protocol reads these numbers.
6. The tool writes `CALIBRATION.json`: theta, the code hash and protocol hash it was made under, every SD and per-contrast NF, the drop reasons, every control effect with its seed-wise signs, the dev contrasts, and the kept set `S` (a subset of R1-R4). If `|S| < 2`, the verdict is MEASUREMENT-LIMITED and confirmation is not run.

## 7. Population guard

An arm-seed **trips** if `n < 200` at any 10-step sample in `W` (the whole measurement window, not only its end). The guard applies to inherit, blocked and physarum (frozen is reported only). A trip anywhere, dev or fresh, makes the whole comparison invalid: MEASUREMENT-LIMITED. No alive-versus-extinct verdict is ever drawn. Runs that touch the cap (`refused > 0` in `W`) are flagged in the report but are valid.

## 8. Confirmation (fresh seeds 9001-9005)

Run inherit, blocked, physarum and frozen on all five seeds (20 runs), after both freezes (section 10). Compute `v(r, arm, s)` for every kept `r`.

**Effect test** (one function, used by the controls in section 6 and by confirmation). Given paired differences `d_s` over the five seeds and a floor `NF`, with `D = mean_s d_s`: seed `s` **supports** the effect if `sign(d_s) = sign(D)` and `|d_s| > NF / 2` (NF is 2 SD, so this is one SD; a zero difference never supports). The test **separates** if both hold:
1. `|D| > NF`; and
2. at least 4 of the 5 seeds support.

The per-seed floor stops one extreme seed (or one bistable or transient fresh seed) from carrying the mean: `d = [0.001, 0.001, 0.001, 0.001, 0.8]` against `NF = 0.1` has `D = 0.16` and all five signs agreeing but only one supporting seed, so it does not separate. A bare 4-of-5 sign rule would be weak (a fair coin gives 4 or more of 5 on one given side with probability about 19%, and on either side about 37%), which is why the magnitude conditions carry the decision. Two readouts driven by one seed are not two confirmations.

**Effect statistic.** For contrast `X` in {blocked, physarum}: `d_s = v(r, inherit, s) - v(r, X, s)`, tested against that contrast's floor (`NF_B(r)` or `NF_P(r)`). Readout `r` **separates inherit from X** if the effect test separates. Let `Sep_B` be the kept readouts that separate inherit from blocked, `Sep_P` those that separate inherit from physarum, and `K = 2`.

**Ordering (reported, conditions nothing).** For each readout in `Sep_B ∩ Sep_P`, inherit is **beyond** if `D_B` and `D_P` have the same sign (inherit lies on the same side of both contrasts, so it is the extreme of the three) and **between** if the signs differ. Because the physarum null is extreme by construction, "between" is expected on some readouts (smoke: R2 was 1.0 blocked, 1.9 inherit, 6.1 physarum). Requiring "beyond" would make PASS unreachable by construction, so it is not required; a PASS says inherit differs from both, and the report prints the ordering so a reader can see that it is not a claim of "beyond".

**Verdicts**, evaluated in this order, so exactly one applies:

1. **MEASUREMENT-LIMITED**: the guard tripped anywhere (section 7), or fewer than 2 readouts were kept (section 6).
2. **FAIL**: `Sep_B` is empty. No kept readout separates inherit from blocked.
3. **PASS**: `|Sep_B ∩ Sep_P| >= K`.
4. **NOT-SEPARATED-FROM-PHYSARUM** (the X1 report's "stop if the Physarum null produces the same network shapes"): `Sep_B` is not empty and `Sep_B ∩ Sep_P` is empty. Inherit differs from blocked, but on no readout does it separate from both: wherever it separates from blocked, it fails the effect test against the trail-follower. This label does not say the trail-follower reproduces the structure; it says the test did not separate them (`Sep_P` may still contain other readouts, and the physarum difference may be in the opposite direction or fail only on the per-seed support).
5. **PARTIAL**: `|Sep_B ∩ Sep_P| = 1`. Not a pass, reported with that readout. (This case is not among the named outcomes; it is added so the rule set has no gap.)

**Reachability, stated before the data.** Because physarum is extreme on R1, R2 and probably R4 by construction (section 2), the physarum contrast will rarely bind, and a PASS will in practice be decided by the blocked contrast on at least two readouts that also differ from a trail-follower that is itself unlike inherit. A PASS is thus weaker evidence than its name suggests (section 12). The two readouts of `K = 2` are also not independent: R1, R2 and R4 all depend on population size and trail mass, so two separations may be one abundance difference counted twice. The confirmation report prints the inherit / other ratios of `n`, ΣP and crowding for every contrast and flags any that differ by more than 25%; the flag changes no verdict.

Frozen is shown next to the others in the report (values, differences from inherit against `NF_B`) and changes no verdict.

## 9. Output

`runs/mycelium-r2/{dev,confirm}/<arm>/seed-<n>/series.json` (scalar series, census values, final `stateDigest`, ledger-check count, the run's config, the code hash it ran under) and `runs/mycelium-r2/{dev,confirm}/report.md` with: CALIBRATION table, per-seed values with `n` and ΣP beside them, `D`, per-contrast `NF`, supporting-seed counts, the verdict, the ordering, the drift table and the descriptive items. `runs/` is gitignored. The analysis is a pure function of the `series.json` files, `FROZEN` and `CALIBRATION.json` (re-running it gives the same verdict). It also recomputes every run's readouts and guard from the run's own stored series and refuses a file whose cached values differ; this checks the averaging, the oscillation statistic and the guard, not the per-census R1 and R2 values themselves, which are as the observer wrote them.

## 10. Freezing, provenance and amendments

**What is hashed.** `code_hash` is the SHA-256 of a manifest of file contents: one `<sha256>  <repo-relative path>` line per file (the format of `shasum -a 256`), sorted by path in plain string order. It covers every `tools/mycelium/*.ts` file and `tools/mycelium/RULES.md`, every `.ts` file under `packages/schema/src` and `packages/sim-ref/src` (world.ts imports `cellBase`, `draw`, `mulFrac`, `divi` and the others from them), and `deno.json` (which maps `@bl/*`). It does not use git, `HEAD`, the commit state or the checkout's location, so committing the files unchanged leaves it unchanged and any change to a covered file changes it. Not covered: the Deno version (recorded as a comment in `FROZEN`), and `jsr:@std/cli@1`, a major-version range resolved from Deno's cache and used only for argument parsing. Every local module that `r2.ts`, `r2-analyze.ts`, `r2-freeze.ts` and `run.ts` import is in the manifest (checked with `deno info`). `tools/mycelium/r2-freeze.ts` computes it and prints the `FROZEN` lines; the same code is what `r2.ts` and `r2-analyze.ts` use to verify them.

**FROZEN format** (`docs/mycelium-r2-2026-11-13/FROZEN`): `key: <64 hex>` lines for `protocol_sha256`, `code_hash` and (after Freeze 2) `calibration_sha256`, each at most once, the per-file `<sha256>  <path>` manifest lines, and `#` comment lines (the Freeze 1 header with the time from `date`, the base commit, the Deno version) which are ignored. A repeated key or path is an error, not an override.

1. **Freeze 1** (after review, after implementation, before any pass-1 or dev run). Write `protocol_sha256`, `code_hash`, the manifest and the time (from `date`) with `deno run -A --no-lock tools/mycelium/r2-freeze.ts`. `r2.ts` refuses pass1, dev and confirm runs, and `r2-analyze.ts` refuses every command, unless the protocol hash, the code hash and every manifest line match the files on disk. The vitest and Deno test results and the empty-diff check on the research kernel (section 11) are recorded in the commit message and the report, not in `FROZEN`.
2. **Freeze 2** (after calibration, before any fresh-seed run). **Append** exactly one line, `calibration_sha256: <hash of CALIBRATION.json>` (`r2-freeze.ts --freeze2` prints it), and a `#` comment. Freeze 2 never rewrites a Freeze 1 line and never re-records the code hash: the calibration and the confirmation run under the same code as Freeze 1. `r2-analyze.ts calibrate` refuses to rewrite `CALIBRATION.json` once `calibration_sha256` exists, and `confirm` always reads that file (there is no option to name another).

**Provenance chain.** Every `series.json` records the code hash it ran under. `calibrate` refuses unless every pass-1 and dev run carries `FROZEN`'s `code_hash`; `CALIBRATION.json` records that hash and the protocol hash; `confirm` refuses unless `CALIBRATION.json` and every confirmation run carry it, and unless `CALIBRATION.json` is the file `FROZEN` hashes. A readout, world or analysis change after the dev runs is therefore impossible without invalidating them: it needs an amendment and a re-run.

**Amendments.** A change after Freeze 1 goes in a dated `## Amendment YYYY-MM-DD` section appended below, stating what changed, why, and that it was decided before seeing fresh-seed results. It then starts a new epoch: rename `FROZEN` to `FROZEN.<date>.superseded`, write a new Freeze 1 under the amended protocol and code, and **re-run pass 1 and dev** (the analysis refuses the old run files, whose code hash is the old one), then Freeze 2 again. The report says so. A change after fresh-seed results exist cannot be an amendment: those results are reported as exploratory and a new protocol R2b is needed.

**The seed log** (`docs/mycelium-r2-2026-11-13/seed-log.jsonl`, one JSON object per line: phase, arm, seed, steps, state, time) records every pass1, dev and confirm run as `started` and then `finished`, or `invalid` when a ledger residual stops it. It lives beside this file, not in the gitignored `runs/`, so it travels with the commit; commit it with the results. `r2.ts` refuses every logged run if the log holds a fresh-seed entry outside the confirm phase or any `invalid` entry (the protocol stops, and only a dated amendment restarts it).

**Confirmation is batch-only and resumable.** `r2.ts --phase confirm --all` is the only way to run fresh seeds: it takes no `--arm` or `--seed`, runs the 20 runs serially in a fixed order, and prints nothing about a result beyond the digest (no readouts, no population), so nothing is seen mid-batch. A confirm (arm, seed) with a `finished` entry is never run again. A `started` entry with no `finished` entry and no `series.json` is a crash (power loss, kill) before anything was written or shown; running the same command again resumes it, which is safe because a run is deterministic and none of it was displayed. A `series.json` without a `finished` entry is not re-run and needs a decision by hand, recorded in the report. Verdicts and reports come only from `r2-analyze.ts confirm` after the batch is complete.

## 11. Implementation notes (no research-kernel change)

- The code lives in `tools/mycelium/` (world.ts: `controller` key, physarum phase 3, `probe`; gpu.ts: throw on physarum; observe.ts: readouts and the streaming observer; r2-protocol.ts: arms, gates, effect test, calibration and verdicts as pure functions; r2-freeze.ts, r2.ts, r2-analyze.ts: wrappers) and in tests. `git diff` of `packages/sim-ref`, `packages/sim-gpu`, `packages/schema` must be empty; `RULE_VERSION` and every golden pin untouched.
- Tests (vitest, `tools/test/mycelium*.test.ts`): the physarum arm conserves matter and energy exactly, is deterministic, and replays byte-equal from a checkpoint; the pinned digest and all existing tests pass unchanged; `defaultConfig()` has no `controller` key; each readout has a hand-computed fixture; the guard trips on a constructed small population and on an early-W collapse; the effect test, per-contrast floors, drops, labels and the gates (fresh seeds only in confirm, no repeat, resume, leak and invalid entries) are tested as pure functions; a run's cached readouts are checked against its stored series. `deno run -A --no-lock tests/deno/mycelium_gpu.ts` still passes. `pnpm typecheck` and `pnpm test` pass. `tools/test` is not covered by `pnpm typecheck` (tsconfig does not include it); the three `tools/test/mycelium*.test.ts` files were type-checked with a temporary tsconfig extending the root one (with `noUnusedLocals`), which was clean.
- Review: Codex (Sol 6.1 High, read-only) reviewed the protocol and code before Freeze 1; its findings are resolved above. The revised protocol was frozen without a second Sol pass. Commits only from the main session.

## 12. What a PASS would and would not show

A PASS shows that, in this engineered world at 20,000 steps, copying controllers with mutation changes the measurable structure of the world (trail connectivity, clustering, population recurrence, turnover) relative to both fresh random controllers and a fixed trail-follower, by more than seed-to-seed variation on at least two readouts, with each separation supported by at least four of the five seeds individually.

It does **not** show:
- adaptation, or that any behaviour was selected (the behaviour signature is descriptive);
- individuality, organisms, or that a particle lineage is a unit of anything;
- open-ended evolution, novelty growth, or anything about longer horizons;
- that inherit goes beyond the contrasts: it differs from both, and the ordering table says whether it lies beyond or between them;
- that the difference is caused by heredity rather than by the blocked twin's controllers being a poor random sample: blocked is a control for "inheritance on or off", and its population and cap status are reported;
- that the physarum contrast was a fair test: the null differs from the neural arms in realised behaviour, trail mass and population by construction (section 2), so separating from it is expected;
- that the two readouts are independent confirmations, or independent of population size and trail mass (R1, R2 and R4 depend on them, `n` and ΣP are reported beside every readout, and the abundance table flags large ratios);
- that the measured window is a steady state (section 3).

A FAIL or NOT-SEPARATED-FROM-PHYSARUM is equally limited: five seeds and a 2-SD bar can only see large effects, and absence of separation is not evidence of absence.

## 13. Known weaknesses (accepted, pre-stated)

- Five seeds per arm: low power by design. The bar is conservative and the verdict says so; the 2-SD floor is a heuristic and not a significance test.
- `theta` and the physarum constants are single choices; they are chosen to be arm-neutral, not optimised. Because `theta` is an absolute integer from the inherit arm and the trail is thin, R1 may be dropped as degenerate, leaving R2, R3 and R4, of which R3 is likely noise and R2 and R4 are tied to abundance.
- The positive controls prove the readouts can see a doubling of light or a 4x trail-decay change, not that they can see a heredity-sized change; `kept` is nearly automatic for R1, R2 and R4.
- The Physarum null has no memory of heading (it is memoryless, gradient plus noise), is a simple member of the family, and its realised behaviour differs from inherit's by construction (section 2). Beating it is a weak claim about "hard-coded trail-following", not about every Physarum model.
- With `sensorShift` 0 the trail gradient saturates (each neighbour at 127), so in dense trail the null sees gradient 0 and wanders. The neural arms have the same sensor limit.
- The embargo, the log and the provenance chain are accident guards, not a defence against a deliberate actor with file access.
- The run-time estimates in section 3 come from 2,000- and 8,000-step smoke runs and are not re-measured at full length.
