# Mycelium conduit: design note (14 Nov 2026), written before any kernel code

Status: EXPLORATORY rule variants, optional config keys, no pre-registration. Worktree `browser-life-mycelium-trail`, branch `claude/mycelium-trail-use`, from 88bd3002. Nothing here touches a frozen rung.

**Editing the kernel is allowed here.** `tools/mycelium/world.ts`, `gpu.ts` and `RULES.md` change, so their hashes no longer match the R2 to R4 freezes. Those rungs stay reproducible at their commits (R2b `edc25af9`, R3 `eef9c043`, R4 `88bd3002`; STATUS.md already records that the R2 code hash no longer matches). No file under `packages/*` or `docs/mycelium-r2-*`, `r2b-*`, `r3-*`, `r4-*` is edited. Every new key is optional, absent from `defaultConfig()` and never inserted by `createWorld`, so the pinned digest `9a5461c07ef6fcde` (`tools/test/mycelium.test.ts:95`, `mycelium-trail-use.test.ts:35`) and every existing config header stay byte-identical.

## 1. What we learned and what is still missing

- R3: trail that is a pure cost is purged under inheritance, with a dose response.
- Trail-use screen and R4: a toll discount (cheaper movement for depositors standing on trail) keeps trail (15 of 16 inherit runs, against 0 of 16 keyless), but the controllers only pay the minimum (about 99.6 percent request exactly one unit), the field is a carpet (about 99 trail per particle, discount complete almost everywhere) and ALIGN, OCC, ACUTE, SENS are all equivalent to zero against a matched physarum follower (R4 RESULT.md). The public discount mostly failed to keep trail (screen: 1 of 4 inherit seeds at default `moveCost`, 3 of 4 only at the strongest strength with `moveCost` 12).
- Lesson: the benefit must depend on USING a connected trail, not on paying a minimum. A benefit that saturates at the deposit-request gate makes the minimum payer optimal and leaves no gradient to follow. (In R4 the discount was complete at 4 units of trail in a cell, `256/td` with td 64; the gate was a deposit request of one unit per step; the resulting field was a carpet of about 99 per particle, so the discount was complete almost everywhere and nothing varied to follow.)

## 2. The three proposals, compared

| | P1 trail conduit | P2 trail-gated diffusion | P3 hungry reach |
|---|---|---|---|
| Mechanism | A diffuses faster across edges whose two cells both hold trail | the same | a hungry particle on trail eats from a trail-bearing neighbour |
| Gate | `min(P[k], P[nb])`, continuous | same, with an explicit cap | `P >= T` on two cells, a threshold |
| Delivery | into the cell pool (everyone in the cell shares) | same | into the particle (private to the hungry one in the contended cell) |
| New state/dispatch | none | none | 4 dispatches, 1 plane |
| Cost | about 35 lines | same | about 115 lines |
| Main flaw | bounds slip: `Pm*cg < 2^18` is false at 1024 x 256 (equals 2^18); `Dd` up to 256 gives checkerboard oscillation | cap 128 (good) but `g*q>>3` form | inert unless a cell is contended; T is a free constant that can recreate either R3 (too high) or R4 (too low) |

P1 and P2 are the same rule with different constants. They are merged into **V1** with P2's cap (128, no oscillation) and P1's key semantics. P3 becomes **V2**.

**Chosen.** Build V1 first (primary, public network). V2 is the single contrasting variant, and it is built only if V1's screen gives a specific signal (section 9, "V2 trigger"). Both are specified here to the same standard so the review covers both. The contrast axis is the *delivery*: V1 puts nutrient into the cell pool and everyone standing there shares it, V2 puts it into the particle that is hungry and is on connected trail, and V2's `toll` mode is the only privatising lever on the table. I considered an owner plane (conductance only for the depositor's own trail) and rejected it for this round: it needs a new plane, a new bound and a new parity surface, and it is only worth building if V1 shows free riding is what stops retention.

## 3. V1: trail conduit (diffusion across trail-linked cell pairs)

### Keys

- `trailConduit` `g`: integer 0..255. Absent means no conduit.
- `trailConduitCap` `q`: integer 1..255, valid only with `trailConduit`; absent means 255.
- Validation: with `trailConduit` present, `diffA` must be at most 128 (`validateConfig` pushes a problem otherwise). `diffA` of 0 is allowed (see "Skip guards").

### The rule

Phase 8, in the A-diffusion step only (species A, `sp = 0`). Species C is untouched. Today a cell `k` sends toward neighbour `nb(d)` (d: 0 east, 1 west, 2 south, 3 north)

```
sent[4k+d] = diffOut(A[k], d, De, base, 0) = mulFrac(portion_d, 4*De, 10, draw(base, 1 + 3d + 0))
```

With the key present the per-edge rate replaces `De`:

```
x   = min(P[k], P[nb], q)            // P as it stands at diffusion time; the min is taken before any multiply
ext = (x * g) >> 4                   // floor, no draw
Dd  = min(De + ext, 128)             // De = diffA
sent[4k+d] = diffOut(A[k], d, Dd, base, 0)     // same portion split, same draw slot, no new slot
```

- `portion_d`, the rotation and the draw slot are `diffOut`'s own; `diffOut` already takes `De` per call, so the CPU calls it per direction with `Dd` and nothing in `packages/*` changes. The gather pass is untouched.
- **Which P.** The *end-of-step* trail: after this step's deposits (phase 5) and this step's decay (phase 8, the loop before `diffuse`). This differs from the discount rule's start-of-step `P0`, and it matches what the next step's sensing reads. On the GPU `k_light` (decay) is an earlier dispatch than `k_send_a`, and nothing in the diffusion dispatches writes P.
- **Symmetry.** `Dd` depends only on the unordered pair {k, nb}, so the conductance is the same from both ends. In expectation (up to the rotation of the remainder units and stochastic rounding) the flux k to nb is `A[k]*Dd/1024`, so the net flux across the edge is `Dd*(A[k]-A[nb])/1024`: a conductance, not a pump.
- **Connection by physics.** An edge conducts above the base rate only if *both* end cells hold trail. Isolated trail, or a one-cell gap, conducts at `De`.
- `g = 0` or `x = 0` everywhere gives `Dd = De` on every edge, i.e. the keyless arithmetic: same sends, same draws. The state bytes equal the keyless run's (only the config header differs, as for `physarumDeposit` 256).
- **Why 128.** At `Dd` 256 a cell sends all of its portion on every edge, the checkerboard mode has eigenvalue `1 - 8*Dd/1024 = -1` (undamped oscillation) and a checkerboard pattern of A would swap places every step. At `Dd` 128 the eigenvalue is 0 (fully damped, no oscillation). The existing `diffA <= 256` range allows 256 for the keyless rule and stays as is; the key lowers it to 128 only when present.

Worked numbers at the default `diffA` 40 (headroom 88): `Dd` reaches 128 when `ext = 88`, i.e. `x*g >= 1408`. At g = 2 that is x = 704 (never, with q at most 255); at g = 8, x = 176; at g = 32, x = 44. So g = 2 reaches at most `Dd` 40 + 31 = 71, g = 8 reaches 128 at x = 176, g = 32 saturates at x = 44.

### Skip guards (both implementations)

CPU `diffuse()` returns when `De === 0`; the GPU dispatch is guarded by `c.diffA > 0` (`gpu.ts:708`). With the key and `diffA` 0 the base is zero but trail-linked edges can still conduct, so both guards change to "skip only if `diffA === 0` and no `trailConduit`": CPU `if (De === 0 && !conduit) return`, GPU `if (c.diffA > 0 || c.trailConduit !== undefined)`. Without the key the guards behave as today. `diffA` 0 with the key (nutrient moves only along trail) is a departure and appears in the screen only as an optional arm.

### Ledger, exactness and bounds

- Matter: A moves only through `sent`/`gather`. Each cell's total out is the sum of its four sends; each send is exactly one neighbour's inflow, so `sum(-out + inflow) = 0`. `out <= q` because the four portions sum to `q` and each send is at most its portion (`mulFrac(portion, 4Dd, 10, rnd) <= portion` for `4Dd <= 1024`; here `4Dd <= 512`), so `f[k] - out + inflow` never underflows. P, C, M, E are untouched: `sum A + C + P + M` is constant.
- Energy: a pure A move changes neither `E` nor `eA*sum A`, creates no heat and no `lightIn`; so `sum E + eA*sum A` still changes by exactly `lightIn - heat`.
- No counter, `totals` field, `StepStats` field, encode header field or `validateState` rule changes. The only checkpoint change is the two keys in the config header when present.
- Bounds, to add to RULES.md: `x <= q <= 255` and `g <= 255` so `x*g <= 65,025 < 2^16`; `ext <= 4,064`; `Dd <= 128`, `4*Dd <= 512 < 2^22` (inside the existing diffusion bound). Reading P: a cell can hold up to 2^31, so `min(P[k], P[nb], q)` is taken first and the multiply is never on a raw P.
- Rounding remainders: the unsent remainder of `portion` stays in the source cell through `f - out + inflow`, as today.

### Phase placement and code

CPU (`world.ts`): `diffuse(A, ...)` gets optional `P`, `g`, `q`; it computes the east/west/south/north indices in the send loop (the gather loop already does) and calls `diffOut(f[k], d, conduitRate(De, g, q, P[k], P[nb]), base, sp)`. `conduitRate(De, g, q, pk, pn)` is exported so a unit test and the observers call the same function. About 25 lines plus `validateConfig`.

GPU (`gpu.ts`): `send()` gets a flag; for A it computes the four neighbour indices (the same formulas as `gather`), `pm = min(min(ld P[k], ld P[nb]), CQ)`, `dd = min(De + ((pm * CG) >> 4u), 128u)` and uses `dd * 4u` in place of `De * 4u`. The consts `CG_SET`, `CG`, `CQ` are baked in like `TD`. `k_send_c` passes the flag off, so the C path is arithmetically the keyless path (the shader text changes, so every existing parity case and the pin are rerun to prove it). No new buffer, dispatch or draw slot. About 20 lines.

### GPU parity plan

Order independence: `k_send_a` reads A, P[k], P[nb] and writes only `F_SENT`; `k_gather_a` reads `F_SENT` and writes A. No dispatch of the diffusion stage writes P, so there is no race and no atomic-order sensitivity. New cases in `tests/deno/mycelium_gpu.ts`, each requiring equal `stateDigest` at every checkpoint: `g` in {0, 1, 8, 255} with `q` in {1, 255}; `diffA` in {0, 1, 40, 128}; heredity arms inherit, blocked, frozen and the physarum null; uniform and gradient light; 256 x 256; 512 x 512 at the 65,536 cap; a mid-run readback, `encode`, `decode`, upload resume; a case with a cell whose P is far above `q` (checks the min-before-multiply); `g = 0` against the absent key (equal digest of the state arrays apart from the header). CPU tests in `tools/test/mycelium-conduit.test.ts`: conservation and both ledger identities every step, `g = 0` equals absent (state arrays), `conduitRate` symmetry and monotonicity in `x`, validation ranges (including `diffA > 128` rejected), a corridor test (A injected at one end of a trail line reaches the other end faster than across bare ground), the pinned digest unchanged.

## 4. V2: hungry reach (conditional)

Built only if the V1 trigger in section 9 fires. Optional keys: `trailReachMin` `T` (1..65535, enables V2), `trailReachRate` `q2` (1..253, absent means 64) and `trailReachMode` `"public" | "toll"` (absent means public, valid only with `trailReachMin`).

New phase 4b between phase 4 (after `A[k] -= taken[k]`) and phase 5. Everything it reads is stable: P is the start-of-step trail (phase 5 adds trail later, phase 8 decays it), A is the post-eat nutrient, `req[i]` and `grant[i]` come from phase 4.

Per particle `i` in cell `c`: `rem = req[i] - grant[i]` (nonzero only when `c` was contended, `R > A`). Eligible iff `rem > 0` and `P[c] >= T` (toll: also the deposit request `(maxDeposit*relu(DEPOSIT))>>7 > 0`). Neighbours `nb(d)`, d in east, west, south, north; a neighbour qualifies iff `P[nb] >= T` and `A[nb] > 0` (A post-eat). Target: the qualifying neighbour with the largest A, ties to the lowest d. Request `r2 = min(rem, q2)`; `R2[t] += r2`. After all requests: `g2 = r2` if `R2[t] <= A[t]`, else `floor(r2*A[t]/R2[t])`; `taken2[t] += g2`; then `A[t] -= taken2[t]` per cell. Then `grant[i] += g2`; phase 5 is unchanged (`m = M + grant`, energy `grant*eA`, energy above `energyMax` to heat). No PRNG, floor only.

- Exactness: the transfer is the same cell-to-particle move as phase 4, `taken2[t] <= A[t]` by the same argument, so matter and energy are exact and the ledger formula is unchanged. `g2 <= rem <= req <= bodyMax - M`, so the room bound already holds. Bound: contended means `A[t] < R2[t] <= 253 * n`, `r2 <= 253`, `n <= 2^16`, so `r2*A[t] < 253^2 * 2^16 < 2^32` (the existing bound).
- **Counters.** `totals.contended` (in the encoded header) counts phase 4 cells only; second-round contention is NOT counted, so no counter or header field is added. With the key absent nothing changes.
- GPU: four dispatches, only when keyed, after `k_apply_eat` and before `k_live`: `k_cclear` zeroes `F_R` and `F_TK` (they are dead after `k_apply_eat`, but `k_clear` only zeroes them at the next step, so a clear is required here, not assumed); `k_cpick` (per particle: eligibility, argmax, store a new `T_TGT` plane, `atomicAdd` to `F_R[t]`); `k_cgrant` (per particle: `g2` from `F_R[t]` and A, which is untouched until the next dispatch; `atomicAdd` `F_TK[t]`; `T_GRANT[i] += g2`); `k_capply` (per cell, `A -= F_TK`). The only new storage is one `maxParticles` u32 plane in `tmp`. Parity cases: public and toll, `T-1` against `T`, a tie, a wrapped edge, a hot target with 65,536 requesters, resume.
- What it contrasts with V1: the benefit goes to the hungry particle that stands on connected trail and is next to food-bearing trail, not to the cell pool. A free rider on the same trail also gets it in public mode. The toll mode is the privatising arm: a minimum payer reaches `T` only where trail has built up, which needs many payers or a long stay. It is also the arm most likely to repeat R4's finding (toll yields minimum payers), so it is run as a contrast, not as the hoped-for fix.
- Cost: about 45 lines in `world.ts`, 70 in `gpu.ts`, 8 parity cases, one observer. Per-step cost only when keyed.

## 5. The selection argument, written in advance

This section is fixed before any run. It names what each kind of particle gets, who loses, and what would count against it.

**What V1 does physically.** A is produced from C by light at most `L` per cell per step. The conduit does not create A, it redistributes it: it lets eaters draw on the standing stock and production of a connected catchment instead of their own cell's refill at the base rate `De`. In a uniform world with uniform eaters there is nothing to redistribute, so the advantage is **relative and vanishes if trail is everywhere** (a uniform `Dd` is only a faster diffusion constant). It appears where eating is patchy (kin clumps deplete locally) or where production is uneven (gradient light, food in the bright east carried to a dim west). That is why the screen has uniform-diffusion controls (keyless, `diffA` 56, 80 and 104, bracketing realised conduction) and a gradient-light stratum. The controls bracket rather than match: the realised `Dd - De` varies over edges, so a null at 56 to 104 says only that uniform diffusion in that range does not keep trail, and the conclusion is limited to it.

**Net importers and exporters.** Diffusion equalises. A particle standing in a depleted cell on connected trail is a net importer (its cell has less A than its trail neighbours). A forager that moves ahead of its own depleted wake into undepleted ground is a net *exporter* once its new cell joins the network: its cell's A flows out toward the depleted core. So extending the network toward fresh ground costs the extender, and the benefit goes to those behind it. This is the opposite of the incentive to lay at the front.

**What a minimum-toll payer gets.** In R4 the payer laid the one-unit-per-step request that qualifies for the discount, the field then carpeted, and the discount was complete at 4 units of trail, so thicker trail bought nothing. Under V1 the benefit keeps rising with trail until the effective cap, which is `x = ceil(88*16/g)` at the default `diffA` (1408/g: above `q` for g = 2, 176 for g = 8, 44 for g = 32; `q` only caps it earlier when smaller), so more than the minimum pays something there: `ext = x*g/16`. Three levels are distinct: request eligibility (R4's gate, absent here), field saturation (the R4 carpet) and V1's effective cap. But `x` is the *minimum over both ends* of an edge, so thick trail on one cell and bare ground next door conducts nothing. A payer of one unit per step into a sparse field gets about the base diffusion plus a small `ext`; a payer inside a kin clump whose neighbours also lay gets the clump's `x`. A *network user* is a particle that stays on, or keeps returning to, a connected thick run at a depleted spot. Presence on the network is what is rewarded, so a non-depositor on someone else's network gets the same import: free riding is real and public.

**What limits free riding (hypothesis, not a finding).** Trail decays by 1 percent per step, so a clump that stops laying loses conduction in a few hundred steps; children are born within half a cell of the parent, so kin concentrate on their own trail; a layer deposits in the cell it eats from, raising its own cell's conductance, a partly private return. Between-group selection (clumps with a maintained network out-reproduce bare clumps) is the only protection against within-clump free riding. The outcome is open, which is why this is a screen.

**Priors, stated plainly.** The nearest precedent is the public discount, which mostly failed to keep trail, and it was also public. V1 differs in being continuous in trail amount and spatial, but it shares the free-rider exposure. We expect the likeliest outcome is PURGED or KEPT-BY-PRESENCE-ONLY (section 7), and say so before running.

**Comparator.** Blocked redraws controllers at every birth, so no controller trait is inherited, but survival still selects the live population, and holding trail is not guaranteed (the trail-use screen, SCREEN.md, documents this). It is a survival-selected, heredity-blocked comparator, not a no-selection null. The test of retention is inherit with conduit against inherit keyless (R4: 0 of 16 kept). For *use* readouts, inherit against blocked shows what heredity adds; equality with blocked does not establish absence of use, so the contrast also uses the physarum anchor (for the trail-gradient readouts) and a planted controller (for input 2 and 5/6 lesions).

**What would count against use.** Retention only by presence (kept, but a conduit-off branch changes nothing, or layers import no more than non-layers, or inherit shows no more occupancy/lesion dependence than blocked). A stationary sponge (the movement guard). Saturation again (more than half of occupied-cell edges at the 128 cap).

## 6. The screen

Label: EXPLORATION, not a test. About 4 seeds per cell, no noise floor, no multiplicity control.

**Runner.** New `tools/mycelium/conduit-screen.ts`, modelled on `trail-screen.ts`: GPU, one process, ledgers (both identities) checked on the full state every 100 steps, R2b's scalar (every 100) and heavy (every 500) censuses, R4's `r4Census`, new `conduitCensus`, written to `runs/mycelium-conduit/<out>/runs/<id>.json`.

**Seeds.** New world seeds 300001-300004 (inherit), 400001-400004 (blocked, +100,000), 500001-500004 (physarum, +200,000), 600001-600004 (blind, +300,000). All are above every registered seed (R2b at most 55,016; R3 60,001 to 126,016; R4 at most 178,020; the trail-use screen 8001-8004 and 108001-108004; shaping scratch 200,011 to 240,013), and the runner calls `embargoReason`/`r3EmbargoReason`/`r4EmbargoReason` and refuses any overlap. They are checked again by the runner, not only here.

**Sizing step 0 (before any conduit run).** Four keyless 20,000-step runs per heredity arm, to read the distribution of trail per occupied cell (p10, p50, p90) and the late trail per particle (keyless blocked probably near 1 per cell, the toll world near 30 per cell: nobody here has measured the conduit worlds). The strengths in the table are provisional; if p50 of `x` times `g` over 16 would sit at the cap or below 5 percent of the 88 headroom for the whole range, `g` is moved and the change is recorded in the screen report. The point is for the median occupied-cell `eff` to sit inside 10 to 60 percent of the headroom.

**Arms** (100,000 steps, 128 x 128, default config except where stated; late window (50k, 100k], early (10k, 20k]):

| arm id | stratum | config | heredity arms |
|---|---|---|---|
| base | uniform light | keyless | inherit, blocked, physarum (`physarumDeposit` 256), blind (physarum plus `blindTrailGradient`) |
| diffA56, diffA80, diffA104 | uniform | keyless with that `diffA` (uniform-diffusion bracket; centred on the median realised `Dd` of c8 after step 0, values may move and the change is recorded) | inherit |
| toll-ref | uniform | `moveCost` 12, `trailMoveDiscount` 64, mode toll, with its own `moveCost` 12 keyless baseline `mc12-base` (optional) | inherit, blocked |
| c2 | uniform | `trailConduit` 2 | inherit, blocked |
| c8 | uniform | `trailConduit` 8 | inherit, blocked, physarum, blind |
| c32 | uniform | `trailConduit` 32 | inherit, blocked |
| g-base, g-c8 | gradient light | keyless; `trailConduit` 8 | inherit, blocked |

The physarum and blind anchors run on `base` and `c8` only (the follower is the positive control for the use readouts, blind is the negative). Counting: base 16, diffA bracket 12, c2 8, c8 16, c32 8, gradient 16, toll-ref pair 16 (optional): 76 runs without the optional pair, 92 with.

**Readouts.**

R4's trail-use readouts, from `observe-r4.ts` (`r4Census`, pure functions of a state): ALIGN (`align`), `alignBlind`, ACUTE (`acute`), SENS (`sensAll`), OCC (`occ`) against `occShift`, `speed`, `req0/req1/req2p`. Raw ALIGN has a negative wake baseline (a moving depositor's gradient points back along its path; about -0.1 to -0.15 for every arm), so only contrasts are read: `acute`, `alignBlind`, and `occ` against `occShift`, each inherit against blocked and against the physarum anchor. R4's `sat` is tied to `trailMoveDiscount` and is 0 here, so it is replaced by the conduit saturation below. ALIGN null does not exclude level use (input 2), residence or nutrient-gradient use; hence the extra lesions below.

New, in `tools/mycelium/observe-conduit.ts` (streaming, per heavy census, nothing stored in the kernel). One definition of effective conductance is used everywhere: for the directed edge e from cell k to neighbour nb, `x_e = min(P[k], P[nb], q)` and `eff_e = Dd_e - De` with `Dd_e` the capped value of the rule (so `eff_e <= 128 - De`); the observers call the exported `conduitRate`. Cell reductions: `E_k` = the mean of `eff_e` over the four edges out of cell k; a cell's `xcell` = the maximum `x_e` over its four edges.

1. **Conduit saturation**: over directed edges out of occupied cells, `csat` = share with `Dd_e = 128`, and `csatCap` = share with `x_e = q` or `eff_e = 128 - De` (the configured cap: `x_e` at `q`, or `Dd` at the 128 limit; at g = 2, q = 255 the conductance plateaus at `Dd` 71, which `csatCap` sees and `csat` does not); and p10/p50/p90 of `eff_e`. More than 0.5 on either flags the saturated carpet.
2. **Net extra import `imp`**, a rotation-averaged proxy and not an exact flow: `I_k = sum over the four nb of eff_e * (A[nb] - A[k]) / 1024` (the expected extra net flux, averaging over the quarter-portion rotation and the stochastic rounding of `diffOut`, from the snapshot A). A checkpoint is post-diffusion, so "A moved by the conduit this step with the same draws" is not recoverable. Reported as the mean over particles, split into **layers** (deposit request > 0 from `probe`) and **non-layers**; also split by `xcell >= 32` or not. Empty groups: a group with fewer than 20 particles at a census yields no value for that census; a run-level comparison needs both groups present in at least half of the late-window heavy censuses, otherwise that seed counts as not passing predicate (b).
3. **Conduit-off branch (causal)**: from each run's late-window checkpoint, run 200 steps on a second `GpuMycelium` whose config lacks the conduit keys (the state's `config` is replaced with the stripped config, because `upload` requires an identical config and `sameConfig` compares JSON text) and 200 steps on the continuing object. Compare, per particle-step (divided by the sum over the 200 steps of `n`): births, deaths, and aggregate eat intake, recovered exactly as `sum(A at start) + (change in lightIn) / eA - sum(A at end)` (diffusion conserves A; light converts waste to A at `eA` energy per unit; per-particle body-matter gain is not used because deposits, excretion and deaths also change it). The comparison is identical in the first step and survivor-conditioned afterwards.
4. **Connectivity**: nodes are cells with `P >= 16`, edges join 4-neighbours; the share of trail cells with at least one trail neighbour, and the size of the largest component.
5. **Use lesions, in situ**: an observer-only lesion API, `senseAndThink(s, cell, D, zeroInputs)` in `world.ts` and an exported `probeLesion(s, zeroInputs)`, where `zeroInputs` is a list of input indices set to 0 after the sensors are built, on the same code path as `probe` (default empty, so `step` and `probe` are unchanged). `sensLevel` zeroes input 2; `sensNut` zeroes inputs 5 and 6; each reports the mean summed change in the five used outputs, divided by 5*254 (as `sensAll`). Positive controls: the physarum rule reads only inputs 3 and 4, so its `sensLevel` and `sensNut` are 0 by construction and it is a control for the trail-gradient lesions only. For inputs 2 and 5/6 a **planted controller** (hand-built weights that make MX depend on input 2, and another on input 5) is run through `probeLesion` in a unit test, which must show a non-zero change; that fixes the sensitivity floor of the readout.
6. **Residence `occx`**: the ratio (mean over particles of `E_k` at the particle's cell) / (mean over all cells of `E_k`), and `occxShift` the same with every particle displaced by half the torus in both axes; both are 1 when the denominator is 0 or there is no particle (as `occupancyRatio`).

**Retention and dose.** Report kept counts (kept as defined in section 7) per arm, trail per particle, deposit rate, the dose across `g`, and the late trail per cell distribution.

## 7. Outcomes, fixed in advance (k of 4 seeds, inherit with conduit, per strength)

Per-seed predicates, each evaluated on that seed's run (late window for rates and censuses, the late checkpoint for the branch). `kept` = late-window trail per particle at least 0.1 (R2b called under 0.01 lost).

- **K (kept)**: the seed is kept.
- **(a) branch**: the on-branch birth rate (births per particle-step over the 200 steps) is positive, and turning the conduit off lowers it by at least 5 percent of the on-branch rate. Empty cases: a branch in which the population goes extinct, or with a zero on-branch birth rate, fails (a); an undefined `csat`, connectivity share or lesion mean (no occupied cell, no particle, no eligible edge) is reported as null and the seed fails any predicate that needs it.
- **(b) signed import**: layers' late-window mean `imp` is positive and exceeds non-layers' (both groups present, see readout 2).
- **(c) behaviour**, built from two parts. **H (behavioural contrast)**: at least one of (i) `(occx - occxShift)` of the inherit run minus that of its paired blocked run exceeds 0.25; (ii) inherit's `sensLevel` or `sensNut` is at least 0.005 and at least twice the paired blocked run's (a blocked value of 0 counts as satisfied only by the 0.005 floor); (iii) inherit's `acute` minus the paired blocked run's exceeds half of the physarum anchor's `acute` (anchor: the median `acute` of the physarum runs at the `base` arm, since the follower's `acute` does not depend on conduit; this is the same quantity at every strength). **G (movement guard)**: the inherit run's `speed` is at least 0.05 and at least half of the paired blocked run's `speed`. **(c) = H and G.** Pairing is by seed index (300001 with 400001, and so on), using late-window means of the heavy censuses.
- **(d) unsaturated**: `csat` and `csatCap` (readout 1) at most 0.5 (a run with `csat` undefined, see the empty-case rule, does not pass).

Strength-level conditions: **(e) dose**: with `m(g)` the median over the 4 seeds of late trail per particle, `m(c8) >= m(c2)` and `m(c32) >= 0.8 * m(c8)` (the 0.8 allows the saturated end to fall back by up to 20 percent); **(f) control**: the uniform-diffusion bracket keeps trail (K) in at most 1 of 4 seeds at each of its values.

Labels, mutually exclusive and exhaustive for a strength:

- **PURGED**: K in at most 1 of 4 seeds.
- **INCONCLUSIVE**: K in exactly 2 of 4 seeds (extend to 8 seeds before any label).
- With K in at least 3 of 4, let `n(a)`, `n(b)`, `n(d)`, `n(c)` count the seeds passing each predicate (with K), and `n(H and not G)` the seeds with the contrast but failing the movement guard. **KEPT-AND-USED** if `n(a) >= 3`, `n(b) >= 3`, `n(c) >= 3`, `n(d) >= 3`, (e) and (f). **KEPT-STATIC-SPONGE** if not KEPT-AND-USED, `n(a) >= 3`, `n(b) >= 3`, `n(d) >= 3`, (e), (f), and `n(H and not G) >= 3`. **KEPT-BY-PRESENCE-ONLY** in every other case (a failed (e) or (f), or fewer than 3 seeds passing a predicate), stated with the failing predicate.

**Only KEPT-AND-USED justifies a pre-registered rung.** A rung would take R4's shape (physarum follower anchor, blind negative, margin of 15 percent of the anchor, a ghost control that reads conductance from a position-decorrelated trail field at matched mean conduction), with the thresholds above replaced by margins fixed from dev runs. KEPT-STATIC-SPONGE and KEPT-BY-PRESENCE-ONLY are reported as negatives on "use", not near misses.

The numeric thresholds (5 percent, 0.25, factor 2, 0.5, 20 particles) are round numbers set before any run, to be replaced by calibrated margins in the rung.

## 8. Risks and what we deliberately do not claim

1. Saturation repeat (the R4 failure): `csat` and the sizing step guard it.
2. The effect may be too small against `depositCost` 2 plus the matter; the conduit-off branch sizes it before any retention claim.
3. Redistribution, not production: gain only where eating or light is uneven; the gradient stratum and the `diffA` bracket separate this.
4. Free riding wins (non-layers import for free). The only protections are decay and kin; if V1 is PURGED the next step is owner-weighted conduction, not tuning.
5. Equalisation can punish extension into rich ground (net exporters), so bridging may be a bad bet.
6. A non-moving trail-carpet "sponge" can satisfy retention without following anything; the movement guard in (c) and the KEPT-STATIC-SPONGE label cover it.
7. Survivor conditioning: every in-state contrast conditions on keeping trail.
8. Seeds are 4 per cell; no inference. The branch uses one checkpoint per run.

## 9. V2 trigger

Build V2 only if the V1 screen gives KEPT-BY-PRESENCE-ONLY or KEPT-STATIC-SPONGE with predicate (a) passing in at least 3 of 4 seeds (the conduit helps, but nothing follows it) in at least one strength. If V1 is PURGED, V2 is not built either (a public good that is purged at the pool level is not rescued by moving the delivery); the line goes to an owner plane or stops. If V1 is KEPT-AND-USED, the next step is the rung, not V2.

## 10. Work list

1. `world.ts`: keys, `validateConfig`, `conduitRate`, `diffuse`, the `zeroInputs` lesion path; `gpu.ts`: consts, `send`, guards; `RULES.md` section and bounds; tests in `tools/test/mycelium-conduit.test.ts` (including the planted-controller lesion test) and parity cases in `tests/deno/mycelium_gpu.ts`. Rerun every existing parity case and the pin.
2. `observe-conduit.ts` and `conduit-screen.ts`, verified on a short run (ledgers, observer values on a known snapshot).
3. Sizing step 0 with the observers, then the screen.
4. Report under `docs/mycelium-conduit-2026-11-14/`, label per section 7.
