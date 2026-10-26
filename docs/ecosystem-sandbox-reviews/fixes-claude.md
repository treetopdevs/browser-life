No remaining correctness blockers.

I read the source only and ran nothing. These are the points I checked by hand:

- **Movement and acting:** a moved cell keeps its `born` value, so it stays vulnerable. The `acted` set stops it acting twice. Newborns, including offspring placed by predation, are skipped in their birth tick.
- **Schedule test:** the fixed-draw test lines up with the code. The first draw (0.99) is consumed by the order shuffle, which leaves `order` unchanged. The next draws (0.13, 0, 0.4) give the victim's move 17→1 and the predator's target at 1.
- **History:** `census()` has no side effects. `sample()` runs only on 10-tick boundaries and replaces a duplicate-tick entry. The 320-tick test gives 33 samples. The 3100-tick test gives 311 samples, so 11 dropped, as asserted.
- **Chart:** the x-axis is built from ticks. The live point replaces any history entry with the same tick, so there are no duplicates. Tick 0 is guarded by `Math.max(1, …)`.
- **Introductions:** the 24 targets are drawn from a 9×9 window, which is safe for the minimum grid size of 16. `peaks` and `depleted` are reset on introduction, so the old recovery baseline can't produce a false "recovered" notice.
- **Controls:** after replant, `main.ts` reapplies any unchecked options and records them as manual notices. The e2e expectations match that (no "Manual introduction" after replant, staged Hunter at tick 300). At 120 ticks/s, 300 ticks fit well inside the 20 s timeout.

Two things I couldn't confirm from the supplied source:

- **Seed input range:** reset relies on the seed input's `min`/`max` for `checkValidity()`. If the HTML lacks them, an out-of-range seed would hit the constructor's `throw` and surface as an uncaught error. Check that `apps/lab/ecosystem/index.html` sets `min="0" max="4294967295" step="1"`.
- **Test thresholds:** I couldn't confirm that `population > 0` at 600 ticks for seed 1101, size 32. That depends on the dynamics, so only a test run settles it.
