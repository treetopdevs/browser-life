You are reviewing, read-only, the Stage 1 implementation of the renewal experiment in the jj workspace /Users/nicholas/develop/browser-life-construction (browser-life, an exact-integer artificial-life simulator). This is the phase-boundary review that must pass before the protocol is frozen. Nothing scientific has run.

HARD RULES FOR YOU
- Do not modify any file. Do not run `tools/construction-renewal.ts freeze|controls|pilot|confirmation*` or `tools/construction-renewal-verify.ts` against any real root, and do not step any world that uses the witness configuration with a nutrient reservoir (any seed). Reading code, reading docs and running the existing unit tests (`pnpm vitest run tools/test/construction-renewal*.test.ts`) or `deno check` is fine if your sandbox allows it; say what you ran.
- Use jj, not git, if you need history (git from this directory can resolve the wrong repository).

THE SPECIFICATION
- experiments/construction/RENEWAL-PLAN.md is the specification. Work packages A–D in section 7 and gates 1–2 in section 8 are in scope. Nothing may change a threshold, a seed, a horizon, the arms, the matrix, the selection order or a decision rule from that plan.
- Three additions were requested by the evolvability-discovery plan (Stage 1), none of which may change the protocol: (1) transport-band fixtures matching the exact table (spread 0, 1, 2, 4, 8: first cardinal 69/37/21/13, one quantum per cardinal up to 136/72/40/24, first diagonal 4356/1156/324/100, large-amount share 4(64s+s^2)/(64+2s)^2), each checked against a passive reference run on an artificial state; (2) energy-accounting tests on artificial states: a founder with B 64 and E 128 at spread 1 exports four quanta of free energy and no biomass; GROW funded by stored E raises B in a step; the integrated inequality 10·ΣGROW ≤ E_start − E_end + 8·ΣRESP + 2·ΣDECOMP + net E import holds on a reacting fixture; (3) per-site free-energy accounting as a secondary, explanatory readout entered into the protocol before the freeze.

FILES TO REVIEW (all new; `jj diff --from 002b12944b2af5b87c1e89446548565cea531754 --name-only` lists them; physics code is unchanged)
- experiments/construction/renewal-v1/protocol.json (declarative contract)
- tools/lib/construction-renewal.ts (protocol validation, case enumeration, initialization)
- tools/lib/construction-renewal-observer.ts (read-only per-step observer)
- tools/lib/construction-renewal-readout.ts (pure endpoint/selection/confirmation decisions)
- tools/lib/construction-renewal-store.ts (run-root layout, frozen-source execution, durable attempts)
- tools/lib/construction-renewal-figure.ts (SVG figure)
- tools/construction-renewal.ts (freeze, controls, pilot, pilot-readout, confirmation-freeze, confirmation, final-readout, report, status)
- tools/construction-renewal-verify.ts (CPU and native GPU replays, independent audit)
- tools/test/construction-renewal.test.ts, construction-renewal-observer.test.ts, construction-renewal-readout.test.ts
- tests/deno/construction_renewal_engineering.ts (end-to-end engineering harness on artificial worlds, including a dry-run freeze)
Relevant existing code: packages/sim-ref/src/step.ts (the CPU rules: transport, react, roles), tools/lib/construction.ts, tools/lib/construction-transport.ts, packages/schema/src/accounting.ts and checkpoint.ts, packages/sim-gpu/src/gpu-sim.ts.

WHAT TO CHECK, IN PRIORITY ORDER
1. Fidelity to the plan: every number and rule in protocol.json and the code equals RENEWAL-PLAN.md (V=128, Qmin=128, R>=0, 1,000-step late window with 11 censuses, control window 2000–3000, seeds 7_310_001 and 7_311_001–005, A=4/16 in every cell including the founder's, spreads 0/1/2, founder placements and sizes, 16 controls then 24 main cases, 40+20 histories, 372,000/572,000 steps, 40,000 verification steps, the four arms incl. the one-byte matched comparator and the ablation's polymerTransport:false, selection order, eligibility, 4-of-5 same-arm confirmation, construction specificity with paid BUILD by builder and ablation, extinction and incomplete handling). Flag any drift, any open numeric choice, and anything the plan requires that is missing.
2. Exactness of the observer: post-transport B (and E) recomputed with w1d/mulShareD at zero displacement must equal RefSim's transport exactly; R_i = B_after − B_after_transport; Q_i from roles after every step; role-saturation bound; reconciliation to global flux; copying pre-step buffers (RefSim swaps buffers); A/C founder-mask accounting via patchTransport; safe-integer accumulation. Look for any case where the observer could silently be wrong (e.g., the pool cap, torus wrapping, roles semantics, step indexing for light exposure).
3. Endpoint logic: maintained(), RENEW, control outcomes, selection and confirmation in the readout; and the independent audit's re-implementation in the verifier (it must not import the readout). Check both against the plan's text, including boundary cases and incomplete records. Check that a technical failure can never be recorded as a biological negative.
4. Provenance and freeze: exclusive root, manifest and FROZEN record binding protocol/plan/inputs/source closure by hash, zero steps executed at freeze, seed-contamination check, jj revision and dirty-source recording, execution of every later operation from the verified frozen source tree (`--config` of the copy, `--no-lock --no-remote --no-npm`), immutability of complete attempts, superseded partial attempts, the confirmation freeze binding the pilot readout digest before any confirmation trajectory.
5. Replays: the CPU replay compares every census (hashes, ledgers, cumulative observer values) and checkpoint digests; the GPU replay compares state hash, global ledger and flux and last-step roles at every census. Are the predesignated cases right?
6. The no-peek rule: confirm that no test or harness steps the witness configuration with a reservoir, under any seed, and that initialization tests do not execute scientific seeds.
7. Anything else that would make the frozen run invalid, irreproducible or misreported.

OUTPUT
Findings ranked P0 (blocks the freeze: wrong science, a silent measurement error, a provenance hole), P1 (must fix before freeze), P2 (should fix), P3 (nit). For each: file:line, the concrete failure scenario, and the fix. Then a one-paragraph verdict on whether the freeze may proceed after the P0/P1 items are fixed. Be concrete and terse; do not restate the plan.
