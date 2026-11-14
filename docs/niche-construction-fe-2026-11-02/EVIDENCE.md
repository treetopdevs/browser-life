# I06b evidence: free-energy-matched comparators, second rung (2026-11-02)

Machine-readable: `evidence.json` (sealed, seal 42ba2c6b3e935f32...), `manifest.json`, `calibration.json`, `protocol.lock.json`. Logs: `calibrate.log`, `write.log`, `checks.log`, `rung1-replay.log`. Freeze commit e7a48c06, pushed to `origin/claude/i06-free-energy-matched` before `--write` (the generator refuses otherwise). Exploratory, CPU only, mutation off.

## Result

**unsupported-measurement for all three candidates (clusters 0, 4, 9). Not a negative.** The ordinary-placement positive control found no detectable wall at any tested dose, so by the pre-stated rule no fresh builder block was simulated (fresh seeds 8601501-516 never read). This is the stated reason "none exists": the only legal geometry (a W1 ring) is not detectable at any dose in this assay, and the other geometry (W2) is not placeable under ordinary placement. This says nothing about walls the placement rule forbids.

- Placement: W2 (polymer floor under the receiver) is unavailable (0 common placeable cells); W1 (ring) is the only legal geometry.
- W1 dose ladder (8 wall seeds, four gating contrasts incl. inoc2, R = 4): 60, 120, 240 never reach 7 of 8 on all contrasts (best weakest-contrast median +1.5 at 240, above every ceiling); 600 and 1200 are worse than the comparators (weakest-contrast medians -172 and -194.5; at 1200 the limiting contrast is poly, -389 twice-median, while the builder contrast is -190). Ceilings (2 x builder polymer): 200, 204, 169.
- Noise floor delta (summed R = 4): 1152, 1031, 1169. Divided by R that is 288, 258, 292 against rung 1's 341, 291, 404 (floor lowered 15.5%, 11.4%, 27.7%): not enough, and the wall effect is far below even the new floor (G-NOISE needs the weakest median at least 2 x delta).
- Comparators: fU, fS, fB match the field arm's free energy exactly (9,394 for cluster 0 seed 8601001, against receiver-alone's 19,864 at equal total 25,624) with exact zero ledger residuals; they hold less total energy (constructionGap +10,470, +10,470, +10,380). `inoc2` negative in 24 of 24 dev blocks and equal to `inoc` in all 24 (its max is always set by the free-energy-rich receiver-alone controls d1E or d1B, so fU, fS and fB never enter the gating contrast on real fields). Plainly: the gating `inoc2` is still dominated by the controls that hold more free energy, so on these fields the new comparators change no gate outcome; only the reported `inocMatched` is free-energy-clean, and only the fixtures show the matched comparators changing a contrast. matched-only contrast `inocMatched` was zero or negative in 21 and positive in 3 (reported, not gating).
- far-field-energy fixture (8 seeds): naive 8/8 benefit; rung-1 inoculum contrast 8/8 positive (fooled); free-energy-matched `inoc2` 0/8 (caught); full gate rejects (poly 0/8). The claim is about the inoculum contrast only. Hand-wall W2 (allowP, frozen scale, diagnostic) passes the full gate: supported (7/8 on builder, poly, inoc2; 8/8 space), so the gate can say supported for a floor of 1200 polymer, which ordinary placement forbids.

## Correction recorded after review (2026-11-02)

The sealed `limits` text in `evidence.json` (and `LIMITS_FE` in the frozen `evidenceFe.ts`) says the positive control "shows the assay can detect a polymer structure of that dose". That holds only if a control passes; in this run none did (every qualification false, every minimum detectable dose null). The sealed bytes are left as frozen; the lab page restates that sentence conditionally and states the failure (`limitsFeHtml`), and this section is the record. Rules, protocol and seals are unchanged.

## What this does and does not say

The assay at this scale cannot see a polymer structure of builder-like dose, so it cannot test whether a builder's field helps a receiver; it says nothing against niche construction. Next rung candidates (not run): a placement-legal control with real effect at small dose (e.g. protective polymer on cells the receiver may occupy via a different transfer rule), or a lower-variance readout than receiver biomass at T2.

## Commands and results

```
pnpm typecheck                                   pass
pnpm vitest run --maxWorkers=2 packages/runner/test/niche-*.test.ts tools/test/niche-*.test.ts apps/lab/test/niche-*.test.ts
                                                 14 files, 125 passed, 5 skipped (before write); fe artifact tests pass after write
node tools/niche/niche.ts --rung fe --bench     1.54 ms/step, 4,280 steps/block
node tools/niche/niche.ts --rung fe --calibrate 8 min (run twice; byte-identical apart from the added inocMatched field)
node tools/niche/niche.ts --rung fe --freeze    lock b1768a05...
git commit + git push -u origin claude/i06-free-energy-matched   e7a48c06
node tools/niche/niche.ts --rung fe --write     53 s, verdict unsupported-measurement
node tools/niche/niche.ts --rung fe --check / --replay-check     ok / ok (53 s)
node tools/niche/niche.ts --check / --replay-check               ok / ok (87 s)   (rung 1, after manifest re-pin)
pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts      pass
git diff --exit-code origin/main -- packages/schema packages/sim-ref packages/sim-gpu vendor experiments/preregistration.md experiments/FROZEN docs/rules.md   empty
git diff --name-only origin/main -- docs/niche-construction-2026-11-01   manifest.json only
BL_E2E_PORT=5351 npx playwright test tests/e2e/niche-fe.spec.ts --project=chrome   2 passed (1280, 375); PNGs read
```
Page: `apps/lab/niche/index.html` section "Second rung: free-energy-matched" (`/niche/`), screenshots in `test-results/niche-fe-*/`. At 375 px the tables scroll sideways inside their regions; the page itself has no horizontal overflow.
