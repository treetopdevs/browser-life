# Mycelium bootstrap: design note (14 Nov 2026), written before any kernel code

Status: EXPLORATION, not a test. No pre-registration, no confirmatory claim. Worktree `browser-life-mycelium-bootstrap`, branch `claude/mycelium-conduit-bootstrap`, from origin/main 11ff7e1d. Nothing here is built or run; every number that is not quoted from a record is a plan or a derivation, and derivations are marked. Uncommitted, waiting for the user's yes.

**What may and may not change.** `tools/mycelium/world.ts`, `gpu.ts`, `RULES.md` change (so their hashes stay different from the R2 to R4 freezes, as for the conduit line). No file under `packages/*`, `docs/mycelium-r2-*`, `r2b-*`, `r3-*`, `r4-*` or `docs/mycelium-conduit-2026-11-14` is edited. Every new config key is optional, absent from `defaultConfig()` and never inserted by `createWorld`, so the pinned digest `9a5461c07ef6fcde` and the existing parity cases stay green and unedited (new cases are appended; section 12 says how "unedited" is checked). All new arithmetic is integer; both ledgers close with residual exactly 0 on every step.

## 1. Where the line stands, and what is still missing

- R3: trail that is a pure cost is purged under inheritance. R4 (TOLL-ONLY): a toll discount keeps trail (15 of 16 inherit runs, against 0 of 16 keyless) but only as a minimum payment: 99.6 percent of particles request exactly one unit, the field is a carpet, ALIGN/OCC/ACUTE/SENS all sit inside the follower anchor's margin.
- Conduit screen V1 (SCREEN.md, label PURGED at every strength): late trail per particle is 0.00 in 3 of 4 inherit seeds at every strength; in all 16 inherit conduit runs the 90th percentile of trail per occupied cell and of conductance `eff` is 0. **The conduit essentially never operated: almost no trail was laid** (seed 8102 kept a little; the other three inherit seeds none). The Skeptic check says so: the screen tested bootstrapping trail from none, not whether a connected trail pays.
- Where there was trail (physarum and blind anchors, 30 to 113 per occupied cell, `eff` p90 19 to 58), switching the conduit off moved intake by under 0.5 percent and raised births and deaths together by 2 to 10 percent: the conduit damped turnover and did not pay. That is refreshed, dense trail under a frozen follower, 200-step branches.
- So "kept and used" needs three things at once: trail that is kept, a conduit that pays on it, and a reason to lay it. No earlier arm had all three. This note builds three optional rule families, one per missing piece, plus the controls that stop a subsidy being read as use.

**Prior, stated before any run.** The likeliest outcomes are NO-PAY or DAMPS-ONLY on existing trail (the anchors already say so), SUBSIDY-ONLY for the free layer (R4's pattern) and ENCLOSURE-ONLY for the owner rule. A clean negative is the expected result, and the thresholds (3 percent floor) sit above the 0.5 percent the anchors moved, which makes NO-PAY easy to reach; that is the honest prior, not a defect to tune away.

## 2. Decisions taken, in the order they matter

1. **All three variants are included**, as optional keys, each at the same standard: `prelaid` (P), `free-first-layer` (F), `owner-conduit` (O). No judge showed one unsound. The three judges' combined designs all defer owner-conduit entirely and two defer the F kernel; the task instruction overrides that deferral, so it is **overridden, not agreed**. The deferral's reasons are kept as gates on screens, extras and go-aheads (below), not as omissions. The work list (section 13) puts each variant in its own slice (a, b, c) inside each of three serial build steps, ordered P, F, O, with a stop offered between slices, so the user can drop slice c at no cost to a and b.
2. **Gating (revised after the advisor).** A hard stop on prelaid NO-PAY would leave F and O with no label, and a decaying road's NO-PAY does not generalise (judge B). So: the cheap series S0 and T always run; each variant's **core** arms run unconditionally; only dose arms, extras and the durable series are gated (section 8 has the table and the cut order).
3. **Windows by rule, not by choice.** Judge A wanted the second window primary (founder die-off dominates the first); judge C showed the default-decay road is gone by then. Resolution: the primary window PW is computed per strength from sizing measurements (section 7, rules R1 to R3), with a measured founder-settle step `t0` and a measured road-alive step. A strength whose PW is shorter than 150 steps is UNREADABLE, not NO-PAY.
4. **Strengths are `(g, q)` pairs.** A low cap `q` with `g` 255 holds conduction flat while the trail thins (plateau strengths, T series only: they maximise lifetime). Evolution series (D, F, B, O) use rising strengths (`q` 255), because a benefit that saturates at 1 to 3 units is R4's minimum-payer trap.
5. **The "does it pay on existing trail" outcome** is the PAY predicate of section 9, read on births, deaths, population and intake together, over conduit-off twins or branches of at least 2,000 steps (T: 3,000-step twins; D, F, B, O: 2,000-step branches at two checkpoints). The physarum and blind anchors and the T series, which do not depend on evolved trail, carry the "pays" verdict; evolving-world branches are survivor-conditioned supports (judge B).
6. **Seeds**: 8 per cell everywhere, held slots for a second 8, k-of-8 thresholds (section 10), one leaf module and an audit that proves zero collisions (section 11).

## 3. New config keys (all optional, absent from `defaultConfig()`, never written by `createWorld`)

| key | type, range | requires / excludes | variant |
|---|---|---|---|
| `trailInit` | integer 1..255 | none | P |
| `trailInitPattern` | `"carpet"` (also the meaning of absent), `"rows"`, `"cols"`, `"lattice"`, `"patches"` | only with `trailInit` | P |
| `trailInitPitch` | integer 2..64, absent means 8 | only with a pattern other than carpet | P |
| `trailFreeLayer` | integer 1..255 (`F`) | none; combinable with `trailMoveDiscount` | F |
| `trailConduitGhost` | integer 1..min(W,H)-1 (`s`, a shift in both axes) | only with `trailConduit` | F, control |
| `trailOwner` | `"id"` or `"gid"` | none | O |
| `ownerDefend` | integer 1..255 (`theta`) | only with `trailOwner` | O |
| `ownerConduit` | integer 0..255 (`g`) | only with `trailOwner`; `diffA` <= 128; excludes `trailConduit` | O |
| `ownerConduitCap` | integer 1..255, absent means 255 | only with `ownerConduit` | O |
| `ownerGhost` | integer 1..min(W,H)-1 | only with `ownerConduit` | O, control |

Ten keys. All "requires" and "excludes" rules live in `validateConfig` (judge A defect 3: not in an observer, and not in `INT_KEYS`, which lists always-present keys). Optional totals `freeUnits` and `paidUnits` exist only when `trailFreeLayer` is present (section 5); optional state planes `Z`, `Q` only when `trailOwner` is present (section 6). With every key absent, `encode` output, `stateDigest`, config header and shader behaviour are those of today.

## 4. Variant P: pre-laid trail (rule runs once, in `createWorld`)

### 4.0 What it answers and what it cannot (stated first)

P asks the half the conduit screen could not: **does connected trail pay when it is already there?** It cannot say anything about selection to lay it (the road is gone before lineages turn over) and it is a transient: trail decays by 1 percent per step (`pDecay` 655/65,536), half-life 69 steps (0.99^69 = 0.5). From `P0 = v` the road holds `x >= q` for about `ln(v/q)/0.01005` steps: v 32, q 1 about 345; v 32, q 2 about 276; v 16, q 2 about 207; v 48, q 1 about 385 (derivations, to be read off in S0.2). The durable series D slows decay to `pDecay` 66 (existing key, no kernel change; half-life about 690 steps, `P` from 32 to 2 in about 2,750 steps) in a different matter cycle, so every durable arm has its own durable keyless and no-road controls, never default-decay ones. A rule that re-lays a road is not proposed here; F is the refresh (section 5).

**NO-PAY on this series closes only the "existing connected trail, at strengths that fit inside `nutrient0` 48, in a decaying road" half of V1.** It does not close V1, and it does not speak to refreshed trail beyond what the anchors already show (judge B defect 5).

### 4.1 Rule

Geometry is a pure function of the cell, no PRNG, no draw slot: `x = i % W`, `y = (i / W) | 0`, `h = pitch >> 1`.

- carpet: every cell. rows: `y % pitch == 0` (horizontal lines, along x). cols: `x % pitch == 0` (vertical lines). lattice: rows or cols. patches: `x % pitch < h && y % pitch < h`.
- Exported pure `laidCell(c, x, y)` so tests and observers share the geometry.

After the founder loop and `s.n = ...` (world.ts:353) and **before** `s.matter0 = matterTotal(s)` (world.ts:354):

```
for each cell i with laid(i):  t = min(trailInit, A[i]);  A[i] -= t;  P[i] += t      // P[i] is 0 here
```

- Matter: A moves to P inside one cell, so `A + P` per cell stays `nutrient0` and `matterTotal` equals the unlaid world's exactly. The initial-matter bound (`validateConfig`, world.ts:269) is built from `nutrient0` and `founders`, unchanged. `P <= nutrient0`, so `min(P,P,q) * g <= 255 * 255` and the conduit bound is untouched.
- Energy: `energyTotal` falls by `eA * sum(t)` (A carries `eA` energy per unit, P none), and `s.energy0 = energyTotal(s)` is taken after the move, so `sum E + eA * sum A = energy0 + lightIn - heat` holds from step 0 with residual 0. It is an energy **tax**, not a subsidy, and both twins carry it.
- No counter, `totals`, `nextId`, `FORMAT` or encode word changes: P is already serialised and the keys travel in the JSON header. `validateState` needs no new rule (the state is legal).
- Edge cases, all tests: `nutrient0` 4 with `trailInit` 16 lays 4 and leaves A at 0 on every laid cell (legal; judge A's break attempt); `trailInit` 255 caps at A.
- Validation: `trailInit` integer in [1,255]; `trailInitPattern` one of the five and only with `trailInit`; `trailInitPitch` integer in [2,64] and only with a non-carpet pattern. Laid cells sit with A removed, so large `v` makes a food desert at the start (rule R2 in section 7).

### 4.2 CPU and GPU surface

`world.ts`: three optional config fields after `trailConduitCap` (world.ts:124), type `TrailInitPattern` next to `LightPattern` (world.ts:24), checks in `validateConfig` beside the conduit checks (world.ts:259-267), the laying loop, `laidCell`. **`gpu.ts`: no change expected** (`GpuMycelium.create` calls `createWorld` then `upload`, which writes A, C, P; no shader const reads these keys, so the WGSL text and every existing case cannot move). That expectation is checked, not assumed: step 2a adds a **step-0 digest case** (GPU `read()` straight after `create` equals the CPU `createWorld` digest) and the usual digest at every segment, because `createWorld` is the only place the laid state exists (judge A defect 1). `decode` rebuilds the state via `createEmpty` and restores the matter and energy anchors directly from the header (world.ts:728-729, 741-747): a test decodes a laid checkpoint and re-validates it (judge A defect 2), and `conduit-screen.ts`-style branches (strip keys, `sameConfig` JSON compare) work unchanged because the laid state is state, not config.

### 4.3 Matched controls

Every conduit-on run has an off twin: same world seed, same prelaid keys, everything the same except `trailConduit`/`trailConduitCap` absent. Both start byte-identical (only the config header differs).

| confound | control |
|---|---|
| the trail itself (tax, sensing: P changes what founders sense) | the off twin carries all of it; unlaid keyless `base0` rows are descriptive only, never a contrast |
| conduit as a faster diffusion constant | **diffA-matched twin of `rows-G` in T** (judge B defect 2): no conduit, `diffA` raised to the mean over all directed edges and over PW of the realised `Dd` of the on-twin (value measured in S0.2 and frozen; the strength and the window it is averaged over are named in the report, and the realised mean `Dd` of the diffA twin against the on-twin over PW is reported, void beyond 15 percent) |
| aligned versus not | `rows` against `cols` in gradient light (G), same pitch, same laid-cell count, same trail mass. **`cols` is orthogonal, not null** (judge C): eaters still drain A along y, so a column conducts real sink-to-source flow. It tests alignment with the light gradient; it is not a mechanism-free null |
| conduction everywhere | `carpet-G` is the **ceiling** (every edge conducts): if the ceiling does not pay at a strength, no laid pattern at that strength can (not strictly, but it is the stated reading). `carpet-U` has uniform A, so any gain is only local depletion smoothing: **a null arm, never read as mechanism** (judge B defect 3) |
| network against blob | `lattice` against `patches`, G |
| frozen followers | `rows-G` physarum on/off (judge C): do laid rows pay for followers at all, which evolving controllers cannot show |
| run-to-run chaos | **butterfly twin**: identical to an off run, but one unit moved from A to C at the lowest-index cell with `A > 0` (cell 0 is a laid cell in every pattern and can have `A` 0) after `createWorld` (matter-neutral; `matter0`, `energy0` retaken). The pair difference is the noise floor for every on-minus-off statistic |
| displaced-read ghost | **not used on periodic roads.** A shift that is a multiple of the pitch maps the pattern onto itself (shift 64 on pitch 8 or 16 in a 128 world), so ghost equals real; a half-pitch shift gives a shifted copy that conducts along equally aligned rows. With uniformly spread eaters that is statistically the real arm. The ghost is a null only for aperiodic trail (F, O). Every ghost run reports `corr(P, shifted P)` (F) or the conductance-map correlation of section 6.1 (O); above 0.5 the control is void for that run and every vote needing it is unresolved, not passed |

## 5. Variant F: free first layer (a subsidy, read above the layer)

### 5.0 The idea and the honest worry

V1 never operated because depositing costs `depositCost` (2) energy per unit and a first layer in bare ground earns nothing (the conduit needs trail on both ends of an edge). F waives the energy price of a depositor's first units on a cell whose trail is below a ceiling `F`. Matter still moves (M to P), so depositing is free in energy only. The worry, stated first: **this is a subsidy and R4 showed a subsidy buys a kept trail nobody uses.** Every retention number is therefore read **above the free layer** and against FREE-ONLY, the free layer without a conduit.

### 5.1 Rule (phase 4/5, integer, order-free, free room shared per cell)

Judge B showed the proposal's free band is not `F`: every depositor reads the same start-of-step `P0`, so `n` depositors on `P0 = F-1` each got free units and `P` overshot. Fixed by sharing the room:

```
dreq_i = (maxDeposit * relu(DEPOSIT)) >> 7          // already computed, <= 253
S[c]    = sum of dreq_i over particles in cell c      // pre-phase, from the same outputs as the requests
room[c] = P0[c] >= F ? 0 : F - P0[c]                  // start-of-step trail, 0..F
fr_i    = S[c] <= room[c] ? dreq_i : floor(dreq_i * room[c] / S[c])      // divu
// phase 5, particle i (after the upkeep check, as today):
dep0 = min(dreq_i, m);  free = min(fr_i, dep0);  paid = dep0 - free
if (paid * depositCost > en) paid = divu(en, depositCost)
dep = free + paid;  en -= paid * depositCost;  heat += paid * depositCost      // free units pay nothing
m -= dep;  P[ci] += dep;  freeUnits += free;  paidUnits += paid
```

- With `F` absent, or `room` 0, this is today's arithmetic. A particle that dies before depositing leaves its share unused (not redistributed).
- **Total free units on a cell are at most `room[c]`**, so free units never push `P` above `F`; only paid units overshoot. This is the fix the proposal reported as a caveat.
- Bounds: `dreq <= 253`, `room <= 255`, so `dreq * room < 2^16`; `S <= 253 * 2^16 < 2^24`; no raw `P` is multiplied (`P0 >= F` gives room 0 before any subtract); `paid * depositCost <= 253 * 4096 < 2^20`.
- **Ledger (stated exactly).** The waived energy `free * depositCost` is not spent: it is not added to `heat` and not removed from `E`, so it stays in the depositor's `E`. Both sides of `sum E + eA * sum A = energy0 + lightIn - heat` move by the same amount (heat lower, `sum E` higher). Nothing is created. Matter: M to P, unchanged. Residual 0 on both ledgers.
- **Exact counters** (judge B defect 2: not an observer estimate): `totals.freeUnits`, `totals.paidUnits`, created in `createWorld`/`createEmpty` **only when the key is present**, so they enter the JSON header (and the digest) only for F worlds. GPU: four new 64-bit words pairs, specified before building (review P1): the existing stat mapping is contiguous and a ninth stat pair would land on words 32-33, which hold cumulative `lightIn`, so the new pairs get their own offsets in `ctl` words that are unused at 11ff7e1d (`C.words` is 64, highest word used `tot + 13`; step 2b prints the used map from gpu.ts:29, :143 and :595 and asserts the four pairs, per-step stat `freeUnits`/`paidUnits` and cumulative `totFree`/`totPaid`, overlap nothing). Their clear, per-step accumulate, cumulative add, `upload` and `read` paths are added beside the seven existing counters, gated on the key; `COUNTERS` extended only when the key is present. `firstDiff` already iterates `Object.keys(a.totals)`, so the parity harness compares them with no edit.
- Compatible with the toll (`trailMoveDiscount`): F has its own planes (below), so the proposal's exclusion is dropped (judge C: it removed the one substrate where inherit holds trail, and would have made the O comparison arms and F's anchors incomparable).

### 5.2 Mass-matched confound, called out (judge C)

Deposit removes mass before the next step's upkeep (`shrFrac(m, massUpkeepShift)`, 1/64 energy per mass unit per step at the default shift 6) and before excretion. Shedding mass has a pre-existing energy return, and the free layer removes the 2-energy barrier to it, so selection may favour depositing for the shedding alone: a subsidy that looks like use. FREE-ONLY (same subsidy, no conduit) is the matched control, so every F claim is a contrast against it, plus the nofree branch (section 8). It is not a separate arm.

### 5.3 GPU surface (no edit to `send()`)

- New cell planes only when the key is present: `F_DS` at `10N`, `F_ROOM` at `11N` (`F.words` 12N); the existing literal and offsets are untouched, so a keyless config has identical layout.
- New kernels `k_fl_clear` (zero `F_DS`, dispatched right after `k_clear`; `k_clear` untouched) and `k_fl_room` (per cell, right after `k_think`: `F_ROOM[c]` from start-of-step `P`). `P` is only written in `k_live` and `k_light`, so the snapshot is race-free by dispatch order; a test where `P` changes within one step (a clump on one cell, then the next step) pins it (judge A defect 3).
- Edits to existing WGSL, all gated by baked consts `FL_SET`, `FL`: `k_think` gets one `atomicAdd` of `dreq` into `F_DS`; `live_one` gets the free/paid block and the counter adds. These change the WGSL text of every case, so the full parity list and the pin are the guard (judge A defect 4: it adds a new branch in `k_live`, so a clipped-`en` case is required: `depositCost` 4096 so `en` binds).
- **Ghost** (`trailConduitGhost` s): a separate `send_g` and `k_send_ag` (new text; `send()` at gpu.ts:536 is not edited, judge A defect 1), dispatched instead of `k_send_a` by host code when the key is present. Same matter arithmetic, only the P index differs: `Dd` reads `P` at the cells displaced by `(+s, +s)` on the torus, both end cells, so the rate is still symmetric per edge. A torus translation permutes cells, so mean conduction is preserved exactly. The CPU `diffuse` uses an exported `shiftCell`.
- Dispatch guard stays `c.diffA > 0 || c.trailConduit !== undefined`.

### 5.4 Controls and the free-first questions

| arm (inherit unless stated) | config vs treatment | separates |
|---|---|---|
| base | keyless | unsubsidised reference (V1: 0 trail) |
| FREE-ONLY(F) | F, no conduit | the subsidy alone; anything kept here is a subsidy artefact (R4 TOLL-ONLY). Treated must beat THIS |
| COND-ONLY | conduit, no F | replicates V1's PURGED on fresh seeds |
| GHOST(F,g) | F, g, `trailConduitGhost` 64 | same subsidy and mean conduction, benefit decoupled from the particle's own trail |
| DIFF | F, no conduit, `diffA` matched to the treated arm's mean conduction over all edges (value frozen at the F pilot) | uniform diffusion with the subsidy (replaces V1's three-value bracket by one matched value) |
| branches (section 8) | noconduit, ghost, nofree, nullA, nullB | start-up versus steady state; windfall versus conduit |

Retention is read above the layer: `TMabove` = sum over cells of `max(0, P - F)` per particle; `TMfree` = sum of `min(P, F)` per particle; both also reported for cells with `n <= 2` only (judge C: clumping inflates `TMabove`). Total TM is reported but never calls retention.

## 6. Variant O: owner-conduit (a conduit only the owner's lineage uses, optionally defended)

### 6.0 Idea and the honest catch

The V1 conduit was public: strangers on connected trail ride free. O stores per cell who laid the trail and how much of it is theirs, then makes two separable things depend on the owner: **(E)** a cell with enough owned trail refuses nutrient to particles of another lineage; **(C)** the conduit conducts only across edges whose two cells have the same owner, scaled by the owned amount. Judges' catches kept in plain view: E is a land claim and a minimum-payment attractor (depositing `theta` units buys exclusive eating), so E and C are separate keys and no label may rest on C-off already holding trail through E alone; same-owner conduction in uniform light only moves A between the owner's own cells, so the real payoff may be E; and under `"gid"` about a quarter of children are mutants who lose their parent's territory (judge C).

### 6.1 Rule

Tag: `ownerTag(v) = v + 1` (exact, u32: `v` <= `ID_MAX` 0xfffffffe, so the tag is 1..0xffffffff and 0 means none), `v` = particle id (`"id"`, individual ownership) or genotype id `gid` (`"gid"`, clone ownership; `gid` already exists and is inherited unchanged when a child's genome equals the parent's). **Not a hash** (review P1): a 24-bit hash collides inside the legal id range (ids 1 and 2,604,073 both map to 10,368,889 under `imul(v, 0x9E3779B1) >>> 8`, checked), which would merge unrelated owners.

State (only with `trailOwner`): `Z[cell]` u32 owner tag (0 = none), `Q[cell]` u32 owned trail, a label on a sub-amount of `P`; plus per-step scratch `W1[cell]`, `W2[cell]`. Invariants in `validateState`: `Q <= P`, `Z == 0` iff `Q == 0`, `Z <= 0xffffffff` (exact tag). Matter and energy live in `P` as before.

- **Phase 5 deposit and claim.** `dep` here is the **actual** deposit after the energy clip, stored per particle in a scratch slot `T_DEP` that `live_one` writes (0 for a particle that dies before depositing; the CPU keeps the same value in a pending-claim list); `k_claim` reads `T_DEP`, never the requested deposit (review P7). A particle takes part in a claim only if `dep > 0` (review P2: a zero deposit must never produce `Z != 0` with `Q == 0`). With `z = Z[ci]` at start of step (`Z` is not written until after the phase-5 loop): `z == t`: `Q[ci] += dep`; `z == 0` and `dep > 0`: claim candidate; `z != 0 && z != t`: foreign deposit adds to `P` only. The winner is the largest `dep`, then the largest tag, found in **two passes with no packing** (review P1: a packed `dep << 24 | t` is a signed int in JS and is negative at `dep >= 128`, so CPU `max` and GPU `atomicMax<u32>` disagree): pass 1 `W1[ci] = max(dep)` (u32 `atomicMax`), pass 2 over candidates with `dep == W1[ci]`: `W2[ci] = max(t)`. Then candidates whose tag equals `W2[ci]` do `Q[ci] += dep` (same-clan members all count; order-free); then every cell with `W1 != 0` and `Z == 0` takes `Z = W2`. Scratch is `W1`, `W2` (two planes). Parity cases use deposits 1, 127, 128 and 253.
- **Phase 8 decay**, same cell loop and the **same draw** as the `P` decay: `qd = min(Q, mulFrac(Q, pDecay, 16, thatDraw)); Q -= qd; if (Q == 0) Z = 0`. `Q <= P` survives because `mulFrac(q,k,16,r) = floor((q*k + 65535 - (r & 0xffff))/65536)` (packages/schema/src/int.ts:52) is non-decreasing in `q` and rises by at most 1 per unit, so `q - f(q)` is non-decreasing; pinned by a property test over random cells before it is relied on.
- **E (eating gate).** `ownerDefend` theta: in phase 4, `if (Z[ci] != 0 && Z[ci] != t && Q[ci] >= theta) r = 0`. **`r` is zeroed before both stores** (judge A defect 1, a real ledger bug in the proposal): the CPU stores `req[i] = r` then adds to `R` (world.ts:516-517), and the GPU stores `tmp[T_REQ + i] = r` then `atomicAdd(F_R)` (gpu.ts:228-229). Gating only the `R` add leaves `req = r` while `R` excludes it, so `k_grant` sees `R <= A`, grants the excluded particle `r`, `taken` exceeds A and A underflows. A test builds exactly that cell (defended, one stranger requesting more than its share) on both engines.
- **C (owner conduit).** `ownerConduit` g, `ownerConduitCap` q: per directed edge `k -> nb`, `Dd = Z[k] != 0 && Z[k] == Z[nb] ? min(De + ((min(Q[k], Q[nb], q) * g) >> 4), 128) : De`; same `diffOut`, same draw slot, same symmetry argument as V1 (`min` taken before the multiply, `x*g <= 65,025`, `4*Dd <= 512`). The diffusion skip guard becomes "skip only if `diffA == 0` and neither conduit key is present". `g` 0 gives `Dd = De` everywhere.
- **Ghost** `ownerGhost` s: `Z`, `Q` read at the cells displaced by `(+s,+s)` for the edge: the **scrambled-owner control** (owner placement and amount both displaced; E stays real, so the ghost isolates C's alignment). Validity (review P12): the check is on the **edge conductance maps**, `corr(eff_real, eff_displaced)` over directed edges (a constant field is reported as void, not as zero correlation); above 0.5 the ghost is void for that run, and a void ghost makes every vote that needs it unresolved.
- **Ledger.** `Z`, `Q`, `W1`, `W2` hold labels and scratch only: `matterTotal`/`energyTotal` do not read them. E sets `r` to 0, which is exactly a particle that asked for nothing. C is a pure A redistribution with symmetric per-edge sends (`out <= q`, V1's proof). No `totals` field. Bounds added to RULES.md: tag <= 0xffffffff (exact `v + 1`); no packed compare (two-pass `max`); `Dd <= 128`; compares only on `theta`.
- **Passive plane test:** `trailOwner` alone (no defend, no conduit) leaves A, C, P and every particle field byte-identical to the keyless run over the same steps; only header and `Z`/`Q` differ. That arm is the true baseline that also records owner statistics.
- **Dead owners.** No takeover rule (a cell's owner changes only when `Q` reaches 0). Judge B called the dead-owner fence a guaranteed collapse under `"id"`; the response is not a new rule but a readout (`deadFence`), a sanity predicate (e) and a label (TERRITORY-COLLAPSE), and `"id"` is run as the harsh control it is, not the proposal. A takeover rule needs the live-tag set per step, a new design.

### 6.2 GPU surface (layout appended, `send()` untouched, `k_clear` untouched)

- **Layout.** The proposal moved `D`, `R`, `TK` to make the scratch contiguous with `k_clear` (judge A defect 2). Not done: `Z`, `Q`, `W1`, `W2` are appended after the existing planes (at `10N` (+`2N` if F is present), `+N`, `+2N`, `+3N`), so the keyless literal `{A:0, C:N, P:2N, D:3N, R:4N, TK:5N, SENT:6N, words:10N}` and `k_clear`'s `3N` bound are unchanged and no `CLRN` const exists. `view.field` exposes only A, C, P (gpu.ts:734-740), so the guard tests a **pure exported layout helper** `fieldLayout(cfg)` in gpu.ts that the allocator itself uses: for a keyless config it must equal that literal (no inspection-API change).
- New kernels, dispatched only when the key is present: `k_own_clear` (zero `W1`, `W2`, after `k_clear`), `k_claim` (per particle, after `k_live`) and `k_own` (per cell), and `k_send_ao`/`send_o` for A (the C path and V1's path untouched). `k_think`, `live_one` and `k_light` get const-gated edits (E gate before the `T_REQ` store; owner add or `atomicMax` after the `P` add; `Q` decay with the same `draw(fb, 0u)` inside the existing `pv > 0` branch). `upload`, `read` and `view` copy `Z`, `Q` when present; `encode`/`decode` append `2N` words (`FORMAT` stays 1; keyless bytes identical).
- `firstDiff` (tests/deno/mycelium_gpu.ts:19) compares `Z` and `Q` when defined (judge A defect 3); for the existing cases they are undefined so its output is identical. Cost, stated plainly (judge A defect 4, B defect 4): about 16 parity cases, three new kernels, a new checkpoint layout; it is the largest kernel cost of the three, and the label is likely ENCLOSURE-ONLY. That is why slice c is last in every step.

### 6.3 Controls

| control | config delta | separates |
|---|---|---|
| P: passive | `trailOwner` only | baseline with owner statistics; equals keyless on A, C, P, particles (tested) |
| E: claim-only | `ownerDefend` theta, no conduit | the enclosure subsidy |
| C: conduit-only | `ownerConduit` g, no defend | owner-gated conduction with free-rider leakage |
| EC | theta and g | the proposal |
| EC-ghost | EC plus `ownerGhost` 64 | scrambled owner at matched mean conduction, E real |
| **C-pub (matched)** | EC with `ownerConduit` replaced by public `trailConduit` g', q' (E stays on: `trailConduit` is allowed beside `trailOwner`; only `ownerConduit` excludes it), same mean conduction over all edges as EC | the public conduit (required control): does owner-gating add anything. Matching rule frozen at S0.4: compute on passive-owner states the mean over all directed edges of `eff_owner`; pick g' from {1,2,3,4,6,8,12,16,24,32,48,64,96,128,192,255} (q' 255) minimising |ratio-1|; ratio within 10 percent or the control is reported void. Matching on passive states is only the starting point: **the realised ratio is measured on the EC run's late window and the C-pub run's** (mean `eff` over all directed edges) and the control is void if it is outside 10 percent. C-pub is also a **branch** from the EC checkpoint (config replaced, E kept), so it is a same-state contrast |
| tag mode | `"id"` against `"gid"` | what kin adds; **heredity contrast only within `"id"`**: blocked under `"gid"` makes every child a new gid (individual ownership) while inherit is clan ownership, so inherit-minus-blocked under `"gid"` confounds heredity with ownership regime (judge B defect 2). Blocked arms run under `"id"` |
| low mutation | EC with `mutRate` 4096 | whether a quarter of mutant children losing territory is what hurts (judge C) |
| toll substrate | `moveCost` 12, `trailMoveDiscount` 64, toll | existing trail under inheritance (R4); every EC effect is read against the toll passive arm. Same substrate as F's toll stratum, so F and O are comparable |
| noise | `nullA`, `nullB` branches (same state, different PRNG seeds, section 8) | noise floor |

## 7. Sizing step S0 (before any main run), with the rules fixed now

Dev slots only (the S block, section 11); nothing from S0 enters a table. All rules are written before any S0 run, so sizing cannot choose after seeing outcomes. Every moved value is recorded in the report.

- **S0.1 settle.** Unlaid keyless `base0`, U and G, 4 seeds, 1,000 steps, per-step reads for steps 1 to 400. **R1:** `t0` = the smallest multiple of 50 at which the median over seeds of |n(t) - n(t-100)| / n(t-100), on 50-step block means, is under 5 percent (the founders' random die-off is over). Also records the share of particles contended (under 5 percent in U flags U as food-saturated; G then carries the weight).
- **S0.2 road lifetime (keyless prelaid, no conduit).** Patterns rows, cols, lattice, patches, carpet, `v` in {16, 24, 32, 48}, G, 2 seeds, 1,000 steps, reads every 50: the median over laid edges of `x_e = min(P_k, P_nb)`, the share of laid cells with `A >= 8` at step 10, and the desert share (occupied cells with A = 0). **R2:** for each pattern `p`, `v_p` is the largest of {16, 24, 32, 48} with at least half the laid cells at `A >= 8` at step 10; one `v` is used for every pattern, `v = min over p of v_p` (the carpet binds: it has no unlaid neighbour to refill it, and a `v` sized on rows alone could make the carpet an all-desert world); if no value passes for some pattern, `v` = 16 and the desert share is printed next to every PAY verdict. Pitch 8 for rows, cols and lattice; patches pitch 16 (8 x 8 blocks, gap 8).
- **R3 plateau strengths and PW.** T strengths are `g` 255 with `q` in {1, 2, 3}: plateau `ext = (q*255) >> 4` = 15, 31, 47, so `Dd` = 55, 71, 87 (17, 35, 53 percent of the 88 headroom, all inside the 10 to 60 percent band and never at the 128 cap by arithmetic). `t_alive(q)` = the last read at which the median laid-edge `x_e` (S0.2, median over seeds) is at least `q`. **PW(q) = (t0, min(t_alive(q), 1,000)].** If PW(q) is under 150 steps the strength is UNREADABLE (it is reported, not read as NO-PAY). Judge C's table shows `g` 32 with `q` 255 is dead by step 100; that is why the plateau form is used for T.
- **R4 rising strength `g_R` and the diffA match.** `g_R = round(493 / v)` clamped 1..255 with `q` 255 (so `eff` at the initial road is about 35 percent of the headroom: `v` 32 gives `g_R` 15). It is the strength D, B and the T "R" arm use; checked once against the median realised `eff` on laid edges at `t0` inside [9, 53], else moved once and recorded. The diffA-matched twin's `diffA` = round of the mean over all directed edges and over PW of the `Dd` the conduit would give on a keyless prelaid world (measured at S0.2, frozen; diffA <= 128). Treatment feedback can move the realised value, so the report prints realised-on against realised-twin mean `Dd` over PW and the twin is void beyond 15 percent.
- **S0.3 F pilot.** FREE-ONLY at F in {4, 16}, inherit and blocked, 2 seeds, 20,000 steps, then treated T(16, `g_F`-mid) against FREE-ONLY(16), 2 seeds, 20,000 steps. Reads: p10/p50/p90 trail per occupied cell, share of depositors standing on `P0 < F`, exact free and paid units per particle-step, median `x_med = min(P_k, P_nb)` over edges between occupied cells, `TMabove`, csat. **R5:** `g_F-mid = round(480 / x_med)` clamped 1..255 (target `x*g` in [141, 845]), lo = mid/2, hi = min(2*mid, 255); moved once if the median `eff` falls outside [9, 53]. If FREE-ONLY(16) has p50 trail per occupied cell at least 4F (a carpet), the ceiling is halved once to 8. **The selected ceiling is called `F*` (16, or 8 after that rule) and replaces every literal 16 in sections 8, 9.4 and 10.2** (arm names `FREE-16`, `T-16-mid`, `T-4-mid` read as `FREE-F*`, `T-F*-mid`, and the low dose arm is `F*/4`); this is fixed before the F core starts. If FREE-ONLY already has `TMabove` of at least 0.1 per particle, that F is reported with the oversubscription caveat, not dropped. F = 4 is run as a dose arm and flagged in advance as likely under noise (judge C break: `x_med` 2 to 3 gives `ext` about 6, a 7 percent nudge to `Dd`). **Pilot gate (judge B defect 6):** if treated `TMabove` is not above FREE-ONLY's in at least 1 of the 2 dev seeds, the F dose arms and extras are not run; the core still runs.
- **S0.4 O pilot.** Passive-owner worlds (`trailOwner` only), toll substrate and no-toll, tags `"gid"` and `"id"`, 4 seeds, 20,000 steps. Reads: age p10/p50/p90 and births per particle-step (the task's 300 to 1,400 lifetime figure does not obviously match SCREEN.md's births, so it is measured first); `Q` per occupied cell p10/p50/p90/p99 and the share with `Z != 0`; for theta in {1,2,4,8,16,32,64,128,255} the share of occupied cells and of particles defended against a stranger; share of directed edges with `Z[k] == Z[nb] != 0` and the distribution of `min(Q,Q,q)`; `kinShare`; the passive-equals-keyless check on one run; and the C-pub matching grid. **R6:** theta lo/mid/hi = the smallest theta for which the median-over-seeds toll-substrate `"gid"` defended-particle share is at most 50, 25, 10 percent (fewer than three distinct values: use those that exist and say so); no-toll uses theta 1 and mid. `g_mid` so the median owned-edge `Dd - De` is 10 to 60 percent of the headroom, lo = mid/4, hi = min(4*mid, 255). Branch length is 2,000 steps or the age p90 rounded up to 100, whichever is larger. **Stop rule:** if in the toll substrate the passive `"gid"` run has under 50 percent of occupied cells owned, the toll world has no existing trail to defend and O is not run; report.
- **Fallbacks (review P21; all integer, all deterministic).** Every `round` is round-half-up on an integer ratio. `lo = max(1, mid >> 1)`, `hi = min(255, 2*mid)` (O: `lo = max(1, mid >> 2)`, `hi = min(255, 4*mid)`), duplicates collapse and the report says which arms merged. If no multiple of 50 meets R1 by 400, `t0` = 400 and the settle failure is reported. If `x_med` is 0 or no edge joins occupied cells, `Fg-mid` = 1 and the pilot is reported NO-BITE-LIKELY. If a strength adjustment still leaves median `eff` outside [9, 53], that strength is reported UNREADABLE. If R6 finds fewer than three theta values, the arms that exist run and the labelled strength is the median of those found.
- **R7 timing smoke (judge: the V1 rate does not cover per-step reads or the owner overhead).** Three 5,000-step runs (keyless, F core arm, O core arm) and one 400-step per-step-read run on the real machine: seconds per step, seconds per read, owner and free overhead. The runner prints the projected wall time of every series and **refuses to start the main screen if the projection exceeds 3.0 hours**; the cut order of section 8 is then applied and the cuts are written into the report.

## 8. Series, arms, run counts, gates, budget

Unless stated: 128 x 128, default config plus the arm delta, world seed = slot + heredity offset (section 11), arms of one heredity share a world seed per slot (paired). Late window is the second half of the run; early is (10k, 20k] for 100,000-step runs. Strength names: `P1/P2/P3` = plateau `(255, 1/2/3)`; `R` = rising `(g_R, 255)`; `Fg-lo/mid/hi` = sized F strengths; `Og-*` = sized O strengths. Light U uniform, G gradient.

### Series T (prelaid, default decay, 3,000 steps, inherit slots plus one physarum arm; 8 slots; **unconditional**)

| arm | light | pattern | runs per slot |
|---|---|---|---|
| T-carpet-U | U | carpet | on P2, off, butterfly of off = 3 (null arm, not mechanism) |
| T-carpet-G | G | carpet | on P2, off, bf = 3 (the ceiling) |
| T-rows-G | G | rows | on P1, P2, P3, R; off; bf; diffA-matched = 7 |
| T-cols-G | G | cols | on P2, off, bf = 3 (orthogonal) |
| T-lat-G, T-pat-G | G | lattice, patches | on P2, off each = 4 |
| T-rows-U | U | rows | on P2, off = 2 |
| T-phys-rows-G | G | rows, physarum (offset 400) | on P2, off = 2 |
| base0-U, base0-G | U, G | none | keyless unlaid, descriptive = 2 |

26 runs per slot, **208 runs**. Reads: every step for steps 1 to 400, every 50 after; windows W1 (0,300], W2 (300,1000], W3 (1000,3000] reported, PW (section 7) is the primary. Pairs: on against its off twin; noise floor from the arm's butterfly twin.

### Series D (prelaid, durable `pDecay` 66, 50,000 steps; 8 inherit + 8 blocked slots; gated: runs if the T primary strength P2 is labelled TRANSIENT or V(PAY-D0) = Y)

| arm | heredity | runs per slot |
|---|---|---|
| D-rows-G | inherit | on P2, on R, off, butterfly of off (window noise for D1/D2, review P15), diffA-matched = 5 |
| D-cols-G | inherit | on R, off = 2 |
| D-base-G | inherit | no road, no conduit (durable keyless, paired contrast for SELECT) = 1 |
| D-rows-G, D-base-G | blocked | rows on R, rows off, base = 3 |

Inherit 8 slots x 8 = 64, blocked 8 x 3 = 24: **88 runs**. Windows D1 (t0, 2,000], D2 (2,000, 10,000], D3 (10,000, 50,000]. Branches (2,000 steps; on-runs of rows and cols, at 5,000 and 50,000): noconduit, nullA, nullB.

### Series D0 (the unconditional 2,000-step read on a laid road; durable `pDecay` 66, 5,000 steps; inherit; the D slots; **unconditional**)

T's verdict is read on PW, at most a few hundred steps, and D is gated on T, so without D0 nothing prelaid would carry the 2,000-step read when T fails. D0 runs, for 8 slots, `rows-G` with the P2 strength (on; durable), its off twin, and a butterfly twin of off: **24 runs** (1.2 RE). It reads PAY(on vs off) over **(t0, t0 + 2,000]** (the durable road is alive for about 2,750 steps from `v` 32, so the window is inside it for `t0` up to 750) with the noise floor from the butterfly twins. Its vote V(PAY-D0) is printed beside every T label; **NO-PAY and DAMPS-ONLY are final only if V(PAY-D0) = N** (otherwise they are reported "short-window only", and a Y on D0 also triggers D). D0 is the first 5,000 steps of the D arms `D-rows-G on` and `off` on the same worlds; D, if it runs later, supersedes it.

### Series F (free first layer; 100,000 steps; strengths sized in S0.3)

Core, **unconditional** (inherit 8 slots; blocked 8 slots):

| arm | heredity | config |
|---|---|---|
| base | inherit, blocked | keyless |
| FREE-16 | inherit, blocked | `trailFreeLayer` 16 |
| COND | inherit | conduit `Fg-mid`, no F |
| T-16-mid | inherit, blocked | F 16 + conduit `Fg-mid` |
| GHOST | inherit | T-16-mid + `trailConduitGhost` 64 |
| DIFF | inherit | F 16, no conduit, matched `diffA` |

Inherit 6 arms x 8 = 48, blocked 3 x 8 = 24: **72 runs**. Main-run branch checkpoints for F: 50,000 and 100,000 (the late window is the second half). Anchors (40,000 steps, branches at 20,000 and 40,000, **unconditional**): physarum and blind with T-16-mid, 8 slots each = **16 runs**. Branch runs: T-16-mid and GHOST inherit, blocked T-16-mid, anchors.

Extras, **gated on the S0.3 pilot** (treated `TMabove` above FREE-ONLY), **and forced regardless of the pilot if the F core reads V(K) = Y** (the dose predicate (e) needs T-4 and `Fg-lo`/`Fg-hi`; no F label other than the provisional NO-BITE, SUBSIDY-ONLY, PURGED-ABOVE-LAYER and INCONCLUSIVE is issued before they exist): inherit FREE-4, T-4-mid, T-16-lo, T-16-hi (4 x 8 = 32); blocked GHOST (8); toll stratum (moveCost 12, toll 64): toll-base, toll-C, toll-FC (3 x 8 = 24 inherit): **64 runs**.

### Series B (the bold screen: durable road plus free layer plus rising conduit; 50,000 steps; on the D slots; gated: runs if D labels PAYS-AND-PERSISTS, PAYS-AND-SELECTED or PAY-PARTIAL, or the F core reads V(K) = Y; **B's comparators are D arms on D's slots, so if D was gated off, B's gate runs `D-rows-G` on, off and `D-base-G` (inherit and blocked, 8 slots: 48 runs, about 24 RE) and counts them under B**)

B-on (rows-G road `v`, `pDecay` 66, F 16, conduit R) and B-noC (same without conduit), inherit and blocked, 16 slots each: **32 runs**. Its comparators already exist: D-rows-G on (road and conduit, no F), D-rows-G off (road only), D-base-G. B's label-bearing contrast is B-on against B-noC (same conditions). The wider factorial {road, no road} x {F, no F} x {conduit on, off} borrows D and F arms that differ in decay, light, strength, slots and horizon, so those cross-series comparisons are **descriptive only** and enter no label (review P10); the ghost cell is dropped from B because the road is periodic (section 4.3). Reads: `K` above the layer in the late window (25,000, 50,000] (the initial road is gone by then), ALIGN, `occx`, movement guard.

### Series O (owner-conduit; 100,000 steps; strengths sized in S0.4)

Core, **unconditional** (toll substrate, inherit, 8 slots; `"gid"`): T-P, T-E, T-C, T-EC, T-EC-ghost, T-C-pub (matched public), plus the **keyless baselines on O's own slots** T-base (toll, no owner key) and N-base (default keyless, no toll) = 8 x 8 = **64 runs**. (`T-P` equals `T-base` on A, C, P and particles by the passive-plane test, so T-base is redundant in principle; it is run because the task asks for a keyless baseline on the same slots and because the equivalence is then checked at 100,000 steps, not only in the parity cases.) Anchors (30,000 steps, branches at 20,000 and 30,000): physarum-EC and blind-EC, 8 slots each = **16 runs**.

Extras, **gated on the O core not being TERRITORY-COLLAPSE or PURGED and on the S0.4 stop rule, and forced regardless if the O core reads V(K) = Y** (the dose predicate (f) needs them; no O label beyond TERRITORY-COLLAPSE, PURGED and INCONCLUSIVE is issued before they exist): the dose arms T-EC-thLo, T-EC-thHi, T-EC-gLo, T-EC-gHi (4 x 8 = 32, strengths from R6), T-EC-lowmut (8), T-EC-id (8), blocked-id T-P and T-EC (16), no-toll N-P, **N-E** and N-EC (24; N-E is required by BOOTSTRAPS in 10.3, review P24) = **88 runs**. Branches (2,000 steps, at 60,000 and 100,000; anchors at 20,000 and 30,000): on, C-off (`ownerConduit` 0), E-off, both-off (planes stay, passive), ghost, C-pub (E kept), `nullA` and `nullB` (the O noise floor, as in section 9.1; the earlier single `off-replicate` is replaced), plus a 5,000-step relaxation of on, C-off and both-off from the late checkpoint.

### Branch protocol (D, F, B, O; the 2,000-step "does it pay on existing trail" read)

At each of two checkpoints a run is read back and each variant is continued 2,000 steps from the **identical state** on a fresh `GpuMycelium` whose config is replaced (`sameConfig` is JSON text, as the V1 screen did): `on` (unchanged); F and D: `noconduit`, `ghost` (aperiodic worlds only), `nofree` (F stripped, conduit kept: total dependence on F over 2,000 steps, which changes future deposits, trail, conduction, shedding and survival together, so it does **not** isolate the energy windfall; review P11), `nullA`, `nullB` (config unchanged, world seed replaced by `(seed ^ 0x5a5a5a5a) >>> 0` and `(seed ^ 0x3c3c3c3c) >>> 0`, a different PRNG stream from the same state; the `>>> 0` keeps the value inside `validateConfig`'s `seed` range 0..0xffffffff, which a signed XOR result would leave). Reads every 25 steps (the denominator `sum n` is a trapezoid on that grid, the same grid on both sides of every pair); births and deaths are exact totals deltas; intake is the exact telescoped identity at window boundaries (section 9.1). Windows (1,500], (500,1,000], (1,000,2,000]; a pair is judged on the whole 2,000 and the last 1,000. **Each run is one vote** (judge B defect 3: the checkpoints come from one run, so "2 of 3" counted checkpoints is not independence): a run passes a branch predicate only if it passes at both checkpoints.

### Run counts and wall time

| series | runs | length | gate | run-equivalents (RE = one 100,000-step run) |
|---|---|---|---|---|
| S0 | about 75 | 400 to 20,000 | always | 8 |
| T | 208 | 3,000 | always | 10 (nominal 6; per-step reads for 400 steps) |
| D0 | 24 | 5,000 | always | 1.2 |
| D | 88 | 50,000 | P2 TRANSIENT or V(PAY-D0) = Y | 47 (with branches) |
| F core | 72 + 16 anchors = 88 | 100,000 / 40,000 | always | 88 (with branches) |
| F extras | 64 | 100,000 | S0.3 pilot | 74 |
| B | 32 (+48 comparator runs if D did not run) | 50,000 | D pays or F core V(K) = Y | 18 (+24) |
| O core | 64 + 16 anchors = 80 | 100,000 / 30,000 | always | 92 (with branches, 1.15 owner overhead) |
| O extras | 88 | 100,000 | O core readable, or forced by V(K) = Y | 118 |
| **total** | **747** (+48 B comparator runs if D did not run; includes the N-E arm) | | | **454** |

At the V1 screen's measured 188 runs per hour (100 runs of 100,000 steps in 32 minutes, 2 processes x 3 jobs, about 110 s per run), 454 RE is about 2.4 hours; the unconditional core (S0, T, D0, F core, O core, 475 runs, 199 RE) is about 1.05 hours; one extension of every INCONCLUSIVE cell to 16 slots adds up to about 25 percent (about 2.9 hours worst case, with the 48 B comparator runs about 3.0: the 3.0-hour gate then cuts as below). That rate does **not** include per-step reads, the owner overhead (budgeted +15 percent, unmeasured) or branch read costs; R7 measures them and the 3.0-hour gate applies. If a gated series does not run, its RE are simply absent: a T of NO-PAY with V(PAY-D0) = N drops D and B (57 RE; B alone is 18).

**Gate precedence (review P25).** A stop rule or cut that removes evidence a label requires does not silently shorten the label: the affected label is reported **INCOMPLETE (not run: <what>)**, never a negative. So the S0.4 stop rule that skips O makes O INCOMPLETE; a cut of forced dose arms makes that label INCOMPLETE, and "unconditional" means unconditional apart from this stated stop rule. Extensions to 16 slots run only if the R7 projection still fits 3.0 hours; the extension budget is not a bound of 25 percent (each extended cell needs its treatment, comparator, anchor and branch runs and can nearly double it), so each extension is projected before it starts, else the cell stays INCONCLUSIVE-UNEXTENDED.

**Cut order if the R7 projection exceeds 3.0 hours** (first cut first): extension runs, O extras, B, F extras, the O anchors' second checkpoint, the F anchors' second checkpoint. Never cut: S0, T, the F core inherit arms, the O core inherit arms. Every cut is written into the report.

## 9. Readouts and predicates (thresholds fixed now)

Reused unchanged: R2b's scalar and heavy census (n, TM, deposit measure `d`, AGE), R4's `r4Census` (ALIGN, `acute`, `alignBlind`, SENS, OCC and `occShift`, `speed`), `observe-conduit.ts` (`csat`, `csatCap`, `eff` percentiles, `imp`, connectivity, `occx`, lesions `sensLevel`/`sensNut`), `conduit-screen.ts`'s `runSide`/`branchRates` definitions. `csatCap` is reported but is **not** a saturation failure for plateau (T) strengths, where sitting at the cap is the design; `csat` (`Dd` = 128 share, at most 0.5) is the saturation flag everywhere.

### 9.1 Pair statistics

Per run and window: births `B`, deaths `Dth` (exact `totals` deltas), mean population `Nbar`, intake `I`, and rates per particle-step `b = B/sum n`, `d = Dth/sum n`, `i = I/sum n`. **Intake is exact:** A enters only by light (`lightIn/eA` units) and leaves only by eating; diffusion is a pure move; deaths and excretion go to C; so `I = sum A(start) + (lightIn(end) - lightIn(start))/eA - sum A(end)`, an integer. The runner asserts, for the T per-step reads, that the sum of per-step intakes equals the telescoped value (exit 2 on mismatch). `rel_x = (x_on - x_comp) / x_comp`.

**Noise.** T: `nf_x(arm, window)` = the maximum over the 8 seeds of |rel_x| between a butterfly twin and its off run (a butterfly twin for every arm that is read: carpet-U, carpet-G, rows-G, cols-G). F, O, D: `nf_x` = the maximum of |on - nullA|, |nullA - nullB| and |on - nullB| relative (judge B's weak-floor and single-difference defects). **`thr_i = max(3 percent, 2 * nf_i)`** for the intake gain. The safeguards (population, deaths, births) use a **fixed 3 percent margin and are never enlarged by noise** (review P14: noise must not widen the harm a PAY can hide); if `nf_x` for a safeguard exceeds 10 percent that safeguard is unresolved. A window (T) or checkpoint (branches) with `thr_i` above 10 percent or an unresolved safeguard is **unresolved** (counts as not passing, never as failing, and is reported). Below, `thr_N`, `thr_d`, `thr_b` mean this fixed 3 percent and `thr` in DAMP likewise.

- **PAY(on vs X, window)**: `rel_i >= thr_i` and `rel_N >= -thr_N` and `rel_d <= thr_d` and `rel_b >= -thr_b`: intake rose, population not lower, deaths not higher, births not lower (births alone, or intake with births down, is not payment). **PAY-STRONG** adds `rel_N >= thr_N`.
- **DAMP**: `rel_(b+d) <= -thr` and PAY-I (`rel_i >= thr_i`) fails: less turnover, no gain (the V1 anchors' pattern; for `X` = conduit-off this is "switching the conduit off raised turnover").
- **HARM**: `rel_N <= -thr_N`.

### 9.2 T-specific

- **GRAD** (judge B defect 1: the margin is `thr`, not a bare 2 points): in G, the per-seed difference `rel_i(rows) - rel_i(cols)` is at least `max(3 percent, 2*nf_i(rows), 2*nf_i(cols))`, and PAY holds for rows.
- **NET**: lattice minus patches, the same margin rule.
- **MECH**: `xflux`, the expected extra flux across the mid-column: sum over the `H` edges at `x = W/2` of `eff_e * (A[k] - A[nb]) / 1024`, `k` east of the line, from the snapshot (a rotation-averaged proxy, like `imp`). Holds when the median over seeds of the PW mean is positive and above cols' (the ghost's role for a periodic road).
- **ROAD**: share of particles on laid cells minus the laid-area share, on minus off, at least 0.05 in PW. ROAD without GRAD is a static sponge.
- **Readability guard** (judge B defect 4): PW is read only if `min n >= 100` on both twins over PW in at least 6 of 8 seeds; otherwise UNREADABLE for that strength (extinct arms are reported with their windows excluded, never dropped silently).

### 9.3 D-specific

- **PERSIST**: at step 5,000 the median laid-edge `x_e` is at least 2 and at least 25 percent of laid edges have `x_e >= 2` (the road is alive; at `pDecay` 66 the initial road is gone by about 2,750 steps, so persistence at 5,000 means organic maintenance).
- **SELECT** (judge B defect 6: a no-road durable world is the paired contrast, because both on and off carry the same decaying road): late deposit measure `d(on) >= 1.2 * d(D-base-G)` and `>= 1.2 * d(off)` per slot, and `K` (late trail per particle at least 0.1, R2b's convention) in on but not in off or D-base-G (on K in at least 6 of 8, the others at most 2), **and** blocked shows no such lift (`d(on)/d(off)` under 1.2 in blocked); otherwise it is survival, not selection.

### 9.4 F-specific (per treated strength, per inherit slot unless stated)

- **K (kept above the layer)**: late `TMabove` at least 0.1 per particle **and** the paired FREE-ONLY run's `TMabove` at most half of it. **S (subsidy-only)**: late TM total at least 0.1 per particle but not K. **NB (no bite)**: TM total under 0.1 for both the treated and FREE-ONLY runs. **L (lost)**: the rest.
- **(a) pays on existing trail**, per run: PAY(on vs noconduit) **and** PAY(on vs ghost) at both checkpoints, on the whole 2,000 steps and the last 1,000.
- **(a-damp)**: DAMP(on vs noconduit) at both checkpoints and (a) fails.
- **(b) import**: layers' mean `imp` positive and above non-layers' (both groups at least 20 particles in at least half the late heavy censuses).
- **(c) behaviour**: **H** (i) `(occx - occxShift)` above the paired blocked run's by 0.25, or (ii) `sensLevel`/`sensNut` at least 0.005 and twice the paired blocked run's, or (iii) `acute` above blocked's by half the physarum anchor's median `acute`, (iv) exact paid units per particle-step at least 0.05 **and** at least 2x FREE-ONLY's is reported as investment evidence only and **never satisfies H** (review P18: a constant depositor with unrelated movement would pass). **G** (movement guard): `speed >= 0.05` and at least half the paired blocked run's. (c) = H and G.
- **(d) unsaturated**: `csat <= 0.5`. **(e) dose** (strength level): median late `TMabove` is non-decreasing from T-4 to T-16 and from `Fg-lo` to `Fg-mid`, and `Fg-hi` is at least 0.8 of `Fg-mid`. **(f) controls**: GHOST and DIFF each keep (`TMabove >= 0.1`) in at most 2 of 8.
- **(g) F-led** (per run; renamed from windfall-led, review P11): `rel_b(on vs nofree) >= thr_b` and at least `rel_b(on vs noconduit)`: the births gain depends more on F than on the conduit. It is total F dependence, not an isolated energy effect; a controlled immediate-energy comparison is not built here, so the label name SUBSIDY-CARRIED stands for "F-led" and is not read as a pure windfall.
- **Anchor verdict** (separate from the label; frozen followers, trail already present, no survivor conditioning): **YES** if (a) holds in at least 6 of 8 physarum **and** 6 of 8 blind slots; **NO-DAMPS** if (a-damp) holds in both; otherwise **MIXED** with the numbers. The anchors, not the evolving runs, carry the "pays" verdict (judge B defect 5): K is checked before the conduit question, so evolving-world (a) is conditioned on survivors that kept trail.

### 9.5 O-specific

(c) is evaluated against a blocked-`"id"` partner only for the arms that exist under `"id"` (T-EC-id vs blocked-id T-EC); the labelled `"gid"` arm has no matched blocked partner, so its (c) is read within `"id"` and printed as such (review P8: inherit-`gid` against blocked-`id` would confound heredity with ownership regime). Reused (b), (c), (d) with owned edges (`x_e = min(Q_k, Q_nb, q)`, `eff_e` from `ownerRate`) and `occx` over owned edges. New streaming readouts (`observe-owner.ts`): class shares of particles and cells (OWN, FOREIGN-DEFENDED, OPEN); `leak` (share of intake on owned edges obtained by non-owners; **not** zero by construction: E refuses strangers only where `Q >= theta`, so a same-owner cell with `Q` 1 and theta 2 can still feed a stranger. Only "foreign grants on a defended cell are zero" is asserted and tested; leak elsewhere is measured); `ownerImp`; `kinShare` (births whose child `gid` equals the parent's); `deadFence` (share of defended cells whose tag matches no live particle); cohort hazard (death rate and children per class over 700 steps; survivor conditioning stated); `Qdist`; `claimTies`.
- **K** (kept): late trail per particle at least 0.1, and in the toll substrate also at least half of the matched passive arm's.
- **(e) territory sanity**: `n` late at least 50 percent of the passive arm's at the same slot, and OWN plus OPEN at least 50 percent of particles.
- **PAYALL** (judge B defect 1: E alone is a minimum-payment attractor): PAY(EC vs C-off) **and** PAY(EC vs E-off) **and** PAY(EC vs both-off) **and** PAY(EC vs ghost), at both checkpoints (one vote per run). PAY(EC vs C-pub) is reported and enters the label only as the qualifier OWNER-SPECIFIC.
- **(f) dose**: median late trail per particle (K's quantity) is non-decreasing from thLo to mid (theta direction taken as stricter defence, higher theta) and from gLo to mid, and thHi and gHi are within 20 percent of mid (the O dose arms exist, section 8); **(g) controls**: C-pub at matched conduction keeps in at most floor(0.25 n) of n. **A void or unmatched C-pub makes (g) fail** (review P5: a missing control can never satisfy its own predicate); the label then cannot reach KEPT-AND-USED and is KEPT-BY-PRESENCE-ONLY naming (g).

## 10. Vote rule and labels (fixed in advance, evaluated top to bottom, first match wins, the last line of each list is a catch-all)

**Vote rule V** for a question asked of `n` seeds (8; 16 after extension): **Y** if at least `ceil(0.75 n)` seeds pass (6 of 8), **N** if at least `ceil(0.75 n)` fail (6 of 8; unresolved checkpoints and unreadable seeds count as not passing, never as failing), otherwise **I**. Y and N cannot both hold. Any headline predicate that reads I triggers one extension to the held slots (16 seeds, all runs re-read with n = 16); if it still reads I the label is INCONCLUSIVE. No label rests on a single seed or a single checkpoint. **Thresholds scale with `n`** (review P6): every "6 of 8" below means `ceil(0.75 n)`, "at most 2" means `floor(0.25 n)`, "4 of 8" means `ceil(0.5 n)`, "2 of 8" for a control `floor(0.25 n)`, "3 to 5" the I band. **Joint votes** (review P17): where a label lists several predicates each with a count, V is applied to the per-seed **conjunction** (K and every listed predicate on the same seed), not to the separate counts, because separate six-of-eight sets can share no seed.

### 10.1 T labels (rows-G unless stated; the order below)

Labels are given for the **primary strength P2**, the only one with every control (carpet-G ceiling, cols-G, diffA-matched twin, butterfly twins, physarum arm). P1, P3 and R are **dose rows**: their PAY and DAMP votes and `rel_x` are reported, and UNREADABLE is evaluated for each, but they carry no label of their own. D reads the **durable P2** twin (same `(g, q)` as the T label, review P22) first, so a negative D result cannot be the changed conductance curve; R is a dose row. S0.2 is repeated at `pDecay` 66 to size durable readability with the selected `v`.

1. **UNREADABLE**: PW under 150 steps, or the readability guard fails in more than 2 of 8 seeds.
2. **NO-PAY**: V(PAY rows-G, PW) = N, V(PAY carpet-G, PW) = N, and V(DAMP rows-G) is not Y. (Closes only the half stated in 4.0, and is final only if V(PAY-D0) = N, section 8.)
3. **DAMPS-ONLY**: as NO-PAY but V(DAMP rows-G) = Y (the anchors' pattern on a decaying road).
4. **CEILING-ONLY**: V(PAY rows-G) = N and V(PAY carpet-G) = Y: conduction pays only when every edge conducts; a laid network at this strength is not enough.
5. **INCONCLUSIVE**: V(PAY rows-G) = I (or rows N and carpet I).
6. **UNIFORM-PUMP**: V(PAY rows-G) = Y and (V(GRAD) = N or V(PAY diffA-matched vs off) = Y): a faster diffusion constant, not a network. **If V(GRAD) or V(PAY diffA-matched) reads I (or the twin is void), the label is INCONCLUSIVE** (review P16: an unresolved control is never evidence for a mechanism).
7. **PAY-NO-FLUX**: PAY, GRAD Y, V(PAY diffA-matched) = N, but MECH fails: intake rose with no transport seen; a possible divergence artefact, not support for D.
8. **TRANSIENT**: the catch-all of the pay branch: PAY, GRAD = Y, MECH, V(PAY diffA-matched) = N. Pays while the road lasts; the W3 reading (road gone) is reported as aftereffect (a persisting population difference is a carry-over, not trail).

D refines a TRANSIENT strength (given D was run; **first match; the live-road window D1 is read before persistence**): **INCONCLUSIVE-D** (V(PAY, D1) = I or V(PERSIST) = I); **STARTUP-ONLY** (V(PAY, D1) = N, whatever PERSIST says: the durable road is alive in D1, so T's effect was a start-up state, not the road); **ROAD-FADES** (V(PAY, D1) = Y and V(PERSIST) = N: it pays while alive and nobody maintains the road; stays TRANSIENT as the final label); **PAYS-AND-SELECTED** (PERSIST Y, PAY Y in D1 and D2, GRAD Y in D1, SELECT Y); **PAYS-AND-PERSISTS** (the same with SELECT not Y: a public good nobody is selected to maintain); **PAY-PARTIAL** (catch-all: any other D combination).

### 10.2 F labels (inherit, K counted over 8 slots; **labelled at the mid strength `T-16-mid` only**: blocked pairs for (c), GHOST and DIFF exist only there; the other strengths are dose rows with K counts and PAY votes, no label)

1. **NO-BITE**: NB in at least 6 of 8 (the free layer did not even bring trail).
2. **SUBSIDY-ONLY**: S in at least 6 of 8 (trail kept, nothing above the layer or FREE-ONLY keeps as much: R4's TOLL-ONLY analogue, the expected outcome).
3. **PURGED-ABOVE-LAYER**: V(K) = N (K in at most 2 of 8).
4. **INCONCLUSIVE**: V(K) = I (K in 3 to 5 of 8).
   With V(K) = Y:
5. **SUBSIDY-CARRIED**: windfall-led (g) in at least 4 of 8.
6. **KEPT-DAMPS**: (a-damp) in at least 6 and (a) in fewer than 6.
7. **KEPT-AND-PAYS**: the per-seed conjunction of (a), (b), (c), (d) passes in at least 6 of 8 (joint vote), (e), (f) hold **and the anchor verdict is YES** (MIXED or NO-DAMPS drops to the next line, review P16).
8. **KEPT-STATIC-SPONGE**: not KEPT-AND-PAYS; joint (a), (b), (d) in at least 6, (e), (f), and (H and not G) in at least 6.
9. **KEPT-BY-PRESENCE-ONLY**: every other case, naming the failing predicate.

The anchor verdict (YES, NO-DAMPS, MIXED) is always printed beside the label and is the only reading that answers "pays on existing trail" free of survivor conditioning.

### 10.3 O labels (toll substrate, inherit; **labelled at the mid strength `T-EC` only**: the blocked-id pairs, ghost and C-pub exist only there; the dose arms are rows with K counts and PAY votes, no label)

1. **TERRITORY-COLLAPSE**: (e) fails in at least 6 of 8.
2. **PURGED**: V(K) = N. 3. **INCONCLUSIVE**: V(K) = I.
   With V(K) = Y:
4. **ENCLOSURE-ONLY**: T-E also K in at least 6 and V(PAY(EC vs C-off)) = N (exclusion is the whole effect: a land claim).
5. **KEPT-UNPAID**: V(PAYALL) = N with HARM or DAMP: trail kept as under the toll and nothing returned (the TOLL-ONLY analogue).
6. **OWNER-STATIC-SPONGE**: PAYALL Y, (d), (e), (f), (g) Y and n(H and not G) at least 6.
7. **KEPT-AND-USED**: PAYALL Y, joint (b), (c), (d) in at least `ceil(0.75 n)`, (e), (f), (g); the qualifier OWNER-SPECIFIC if PAY(EC vs C-pub) is Y.
8. **CONDUIT-PAYS-NOT-USED**: PAYALL Y, (b), (d), (e), (f), (g) Y and (c) not Y: the owner conduit repays its owner on existing trail and nothing follows it.
9. **KEPT-BY-PRESENCE-ONLY**: every other case, naming the failing predicate.

Report-only, never changing a label: tag mode `"id"` against `"gid"`, the dose arms, `kinShare`, the low-mutation arm. **Anchors**: ANCHOR-PAYS (PAY(EC vs both-off) and PAY(EC vs C-off) in at least 6 of 8), ANCHOR-DAMPS, ANCHOR-HARMS, ANCHOR-FLAT. **No-toll substrate**: BOOTSTRAPS if N-EC has K in at least 6 of 8 with N-E also read, otherwise FLOOR (expected).

### 10.4 What would justify a pre-registered rung

Exactly one of: P-line **PAYS-AND-SELECTED** (T and D), F **KEPT-AND-PAYS** with the anchor verdict YES, O **KEPT-AND-USED** (OWNER-SPECIFIC preferred). Even then the next step is a rung written in R4's shape (physarum follower anchor, blind negative, margin fixed from dev runs, a ghost control, fresh slots, the unedited kernel), with every threshold above replaced by a calibrated margin. TRANSIENT, SUBSIDY-ONLY, ENCLOSURE-ONLY, CONDUIT-PAYS-NOT-USED, KEPT-STATIC-SPONGE and KEPT-BY-PRESENCE-ONLY are reported as negatives on "use", not near misses. The 3 percent floor, 0.25, factor 2, 0.5, 20 particles and 150 steps are round numbers set before any run.

## 11. Seeds and the audit (one leaf module, one proof)

All three proposals claimed the same slots (8201-8208, dev 8211-8214) and none ran an audit (judges B and C). One leaf module, `tools/mycelium/bootstrap-seeds.ts` (no imports), owns every slot; no other file contains a slot literal (a unit test checks it). The audit's logic is a pure function `auditTable(table, registered)` in a module vitest can load (`bootstrap-seeds.ts` or a sibling with no `jsr:` or `gpu.ts` import: `conduit-screen.ts` pulls `jsr:@std/cli` and `gpu.ts`, so vitest cannot import it). The Deno runner imports `conduit-screen.ts` and the registered sets and passes them in; the vitest test covers the function with fixed sets and reads the conduit and trail-use run-logs through `fs`.

**Rule (not memory).** The table is a contiguous block from `BOOT_BASE`: S (dev) 8 slots, T 16, D 16 (B reuses D's slots), F 16, O 16, SMOKE 4, in that order, each series 8 screen slots plus 8 held. World seed = slot + heredity offset (inherit 0, blocked 200, physarum 400, blind 600, as in the conduit screen). `bootstrap-screen.ts --propose` prints the first `BOOT_BASE` in the candidate list 8209, 7209, 6209, ... (steps of -1,000) whose whole table passes `--audit`; the runner re-runs the audit at start (exit 2 on any problem, exit 1 for `--audit` alone). **The numbers in the example below are the expected output of that rule, found by hand against the registered sets I read, and are not authoritative: I did not run the audit.**

`--audit` proves zero collisions of every world seed the screens can use (slot x heredity, plus the derived null-branch seeds `(seed ^ 0x5a5a5a5a) >>> 0` and `(seed ^ 0x3c3c3c3c) >>> 0`) with: R2b worlds (`R2B_WORLD_SEEDS`), R2 seeds, R3 worlds, R4 worlds and the reserved `NOT_R3_SLOTS` 8001-8099, **the conduit screen's own worlds** (`ALL_SLOTS` x `HEREDITY_OFFSET` imported from `conduit-screen.ts`, which only runs under `import.meta.main`: 8101-8108, 8301-8308, 8501-8508, 8701-8708), every `worldSeed` in every `docs/mycelium-*/run-log.jsonl` **except the bootstrap log** (review P23: once runs start, the bootstrap log holds this table's own seeds and would fail its own restart; its entries are instead reconciled against the reservation table: every logged seed must be a table row) (the conduit log carries its logged smoke runs, which used slots 8101 to 8104), the trail-use screen's 8001-8004 and 108001-108004, and the shaping scratch range 200,011-240,013. It also checks: unique across (series, heredity, slot) except the declared B-on-D-slots sharing; every slot block spans less than 200 (so offset images never overlap); every world seed is below `FRESH_MIN` 9001 (so `run.ts` would not refuse it); derived seeds neither registered nor equal to a world seed. **What it cannot cover:** runs that were never logged (another worktree's smoke runs) cannot be audited; SMOKE slots are reserved, never in a table, and logged by the new runner.

Expected table (provisional): S 8209-8216, T 8217-8232, D (and B) 8233-8248, F 8249-8264, O 8265-8280, SMOKE 8281-8284; images 8209-8284, 8409-8484, 8609-8684, 8809-8884. Screen slots are the first 8 of each block, held the second 8.

## 12. Parity and tests

**Baseline and "unedited".** The task and SCREEN.md say 69 cases; a grep for `name:` finds 55 because cases come from helper functions and spreads (`...r2bCases()`, `...trailCases()`, `...conduitCases()` at lines 299-301) plus resume variants and guards. The count is therefore read from the runner's last line (`all 69 cases match bit for bit`), not from grep. Before step 2: run `deno run -A --no-lock tests/deno/mycelium_gpu.ts`, keep the exit code and the PASS rows (names and digests) as a baseline file. After each of steps 2a, 2b, 2c: (i) every baseline row, matched **by case name**, has an identical digest (new cases are not required to come last: `...bootstrapCases()` after `...conduitCases()` shifts later list positions, so list position is not the identity); (ii) `git diff --numstat tests/deno/mycelium_gpu.ts` shows 0 deleted lines; (iii) new cases enter only as `...bootstrapCases()` after `...conduitCases()` and as new entries after the last resume variant; the existing `firstDiff` gains only an `if (a.Z)` branch, and the harness gains one explicit, additive **`core: true` compare mode** (A, C, P and particle arrays only) used by the passive-owner case; both harness changes are allowed and listed here, nothing else in the file may change. The pin `9a5461c07ef6fcde` is asserted in `mycelium.test.ts` and `mycelium-conduit.test.ts` and stays.

**New GPU cases (each needs equal `stateDigest` at every segment, `validateState` on each readback, `must` births above zero, a `vs` case proving the key is not vacuous where it applies):**
- P (~11): **step-0 digest** (read straight after `create`) and every segment; carpet 16 with conduit 128 against the keyless twin (`same:false`); rows+conduit gradient; cols+conduit gradient; lattice pitch 6; patches pitch 8; `pDecay` 66 rows; `trailInit` 255 with `nutrient0` 48; `nutrient0` 4 with `trailInit` 16; blocked; physarum; prelaid with toll; one `runResume`.
- F (~14): F in {1, 4, 255} alone; F with conduit; F with ghost; ghost without F; F with heredity inherit, blocked, frozen; F with toll; gradient light; 256 x 256; a clipped-`en` case (`depositCost` 4096); a case with `P` far above F (compare-before-subtract); a clump of 100 particles on one cell (the shared room and the within-step `P` change, judge A defect 3); exact counters equal at every segment; resume across `encode`/`decode`; `vs`: F=1 against absent differs; `trailConduit` 0 with F equals F alone on the state arrays.
- O (~16): passive equals keyless (`core: true` compare mode: A, C, P and particles); claim tie (two clans, equal `dep`, larger tag wins); claim with several same-clan depositors; foreign deposit does not dislodge; `Q` decay with the same draw; the **E-gate case** (zero `r` before both stores, judge A defect 1); E at theta boundary (`Q` = theta - 1, theta); C at `g` in {0, 1, 255}, `q` in {1, 255}; `"id"` and `"gid"`; ghost; resume; 256 x 256; a layout guard (`fieldLayout` of a keyless config equals the frozen literal).

**New vitest** (`tools/test/mycelium-prelaid.test.ts`, `mycelium-free-layer.test.ts`, `mycelium-owner.test.ts`, `mycelium-bootstrap-seeds.test.ts`, observer tests): keys absent from `defaultConfig()` and from a created world's config; pin reproduced; both ledgers every step for each key on a 48 x 48 world; validation rejections; the decode-and-revalidate test of a laid checkpoint; laid-cell counts per pattern at 48 x 48 pitch 8 (rows 288, cols 288, lattice 540, patches 576, my arithmetic, fixed in the test); F one-step energy accounting (`heat_without - heat_with = freeUnits * depositCost` and the same for `sum E`, on a state built so `en` does not bind); free units on a cell never exceed `room`; ghost reads the displaced trail; the `Q <= P` property test; zero foreign grant on a defended cell (the only zero-by-construction claim); the telescoped-intake identity; the audit (collisions rejected, derived seeds checked).

## 13. Work list: three serial build steps, each with slices a (P), b (F), c (O)

A stop for review is offered after each slice. Slice c can be dropped without touching a or b. Gates every step: `pnpm typecheck`, `pnpm test`, the pin, and (from step 2) the full parity list with the exit code kept. Prefix `node 24 on PATH`; every deno command takes `--no-lock`.

**Step 1: `world.ts` + `RULES.md` + vitest.**
- 1a: P keys, `validateConfig`, `laidCell`, the `createWorld` loop; RULES.md "Pre-laid trail" section; `mycelium-prelaid.test.ts`.
- 1b: F keys, `Totals` optional fields, pre-phase `S`/`room`, phase 5 free/paid block, `diffuse` ghost with exported `shiftCell`; RULES.md section and bounds; `mycelium-free-layer.test.ts`.
- 1c: O keys, `Z`/`Q` in `MyceliumState`, `validateState`, `encode`/`decode`/`createEmpty`, the phase 4 gate (before both stores), phase 5 claim, phase 8 decay, owner rate in `diffuse`; RULES.md section and bounds; `mycelium-owner.test.ts`.

**Step 2: `gpu.ts` + parity cases.**
- 2a: no `gpu.ts` change expected; the P cases and the step-0 digest check; confirm the expectation.
- 2b: F layout planes, `k_fl_clear`, `k_fl_room`, `k_think`/`live_one` gated edits, counters, `send_g`/`k_send_ag`, `upload`/`read`; F cases.
- 2c: O planes appended, `k_own_clear`, `k_claim`, `k_own`, `send_o`/`k_send_ao`, gated edits, `upload`/`read`/`view`; `firstDiff` Z/Q; O cases; guard for the keyless layout.

**Step 3: observers, runner, unit tests, then S0.**
- 3a: `observe-bootstrap.ts` (`roadShare`, `xflux`, windowed intake, telescoping assert, TM above/below the layer, exact free/paid rates), `bootstrap-seeds.ts`, `bootstrap-screen.ts` series S and T with `--audit`, `--propose`, twins, butterflies, resume and claim files, `--table`, `--label`; tests. Run S0.1, S0.2, R7 timing, then T.
- 3b: series F (pilot, core, anchors, branches), `--label` for F. 3c: `observe-owner.ts`, series O and D/B drivers, labels. The runner takes `--series`; gates are evaluated from the finished tables and printed, never silently skipped.
- Report in `docs/mycelium-bootstrap-2026-11-14/` (RESULT.md plus the run log), every label per section 10, every cut and moved strength recorded.

## 14. Risks and what is deliberately not claimed

1. **Transient too short**: seen as `x_e` under `q` before PW; UNREADABLE, never NO-PAY.
2. **Food deserts**: laid cells have no A at the start; rule R2 and the desert share printed beside every PAY.
3. **Saturation (R4 repeat)**: `csat` above 0.5 fails (d); rising strengths in evolution series.
4. **Subsidy read as use**: FREE-ONLY, nofree branch, `TMabove`, exact paid units.
5. **Survivor conditioning**: every in-state contrast conditions on keeping trail; anchors and T carry "pays".
6. **Gradient light thins the dark half**: `min n` and n by x third reported; extinct aligned and orthogonal arms are dropped together, not read.
7. **Ghost on periodic or correlated trail**: void by the correlation report.
8. **Telescoping or ledger leak**: runner exit 2 or 1, logged; no silent rows.
9. **Territory collapse and mutant disinheritance** in O: readouts and the TERRITORY-COLLAPSE label, low-mutation arm.
10. **Cost of the per-step reads and the owner overhead**: measured in R7 before the main screen.
11. **What a pass is**: with 8 slots, no pre-registration and thresholds that are round numbers, a pass is a screen result; the next step is a rung, not a claim.

## 15. Judge-item table

Judge A = the first critique (scored the three 9, 6.5, 4); judge B = the validity lens (7, 6, 5); judge C = the premise lens (6, 5, 4).

| item | where | status |
|---|---|---|
| A prelaid: step-0 digest parity check | 4.2, 12 | done |
| A prelaid: laid checkpoint decodes and re-validates | 4.2, 12 | done |
| A prelaid: key rules in `validateConfig`, not `INT_KEYS` | 3, 4.1 | done |
| A prelaid: decay arithmetic stated up front | 4.0 | done |
| A free: ghost must not edit `send()` | 5.3 | done (`send_g`) |
| A free: `trailFreeLayer` excluded the toll | 5.1, 5.3 | done (own planes, exclusion dropped) |
| A free: `k_think` race | 5.3, 12 | done (`k_fl_room` snapshot, within-step test) |
| A free: clipped-`en` parity case | 12 | done |
| A free: keep the nofree branch | 8 | done |
| A owner: zero `r` before both stores | 6.1, 12 | done |
| A owner: layout change | 6.2 | done differently: append-only, no `CLRN`, guard case |
| A owner: `firstDiff` compares Z, Q | 6.2, 12 | done |
| A owner: cost | 6.2 | acknowledged, slice c last |
| A owner: E is a land claim; two features before a signal | 6.0, 6.3 | acknowledged: E and C separable, E-only arm |
| A combined: free kernel and owner deferred, `TMabove` and 1,000-step branches behind a go-ahead | 2 | **not followed**: all three included (task override); the 1,000-step branches became 2,000 |
| B prelaid: GRAD margin at least `thr` | 9.2 | done |
| B prelaid: diffA-matched twin in T | 4.3, 8 | done |
| B prelaid: carpet-U near-vacuous | 4.3 | done (null arm) |
| B prelaid: founder transient, `min n`, primary window | 2.3, 7, 9.2 | done by rule R1/R3, not "W2 primary" |
| B prelaid: NO-PAY wording | 4.0, 10.1 | done |
| B prelaid: D-base paired contrast | 8, 9.3 | done |
| B free: free band is not F | 5.1 | done (shared room) |
| B free: `paidRate` estimate | 5.1, 9.4 | done (exact counters) |
| B free: three checkpoints are one run | 8 | done (one vote per run) |
| B free: nullA/nullB rule | 9.1 | done (maximum of three) |
| B free: K before the conduit question | 9.4, 10.2 | done (anchors carry "pays") |
| B free: step 0 shows `TMabove` above FREE-ONLY first | 7 (S0.3) | done as a pilot gate |
| B owner: E is a minimum-payment attractor | 9.5 | done (PAYALL) |
| B owner: blocked comparator semantics | 6.3 | done (blocked under `"id"`) |
| B owner: noise floor weak | 9.1 | done |
| B owner: largest kernel surface | 6.2 | acknowledged |
| B owner: dead-owner fences, no takeover | 6.1 | **not done**: no takeover rule (needs live-tag set per step, a new design); readout, sanity predicate and label instead |
| B seeds collide | 11 | done |
| B: no label on one seed or one checkpoint | 10 | done |
| C prelaid: `cols` is not a null; displaced ghost | 4.3 | done differently: `cols` called orthogonal; the displaced ghost is void on periodic roads (shift multiple of pitch maps onto itself) |
| C prelaid: physarum rows-G anchor | 8 | done |
| C prelaid: 3 percent floor against 0.5 percent anchors | 1 | done (prior stated) |
| C prelaid: default-decay road dead by step 100 at g 32 | 7 | done (plateau `(g,q)`) |
| C free: not neutral, mass shedding | 5.2 | done (FREE-ONLY and nofree control, called out; no extra arm) |
| C free: F is a soft cap, report `n <= 2` | 5.1, 5.4 | done (shared room removes the overshoot; `n <= 2` still reported) |
| C free: blocks the toll | 5.3 | done |
| C free: F = 4 under noise | 7 | done (flagged as a dose arm) |
| C owner: thin benefit; mutants lose territory | 6.0, 6.3 | done (low-mutation arm, `kinShare`) |
| C owner: build only on KEPT-STATIC-SPONGE | 2 | **not followed** (task override) |
| C boldest screen | 8 (series B) | done, gated |
| A combined: keep the free layer exclusive with the toll | 5.1 | **not followed**: exclusion dropped (own planes), because it removes the one substrate where inherit holds trail (R4) and makes F and O incomparable |
| C free: `massUpkeepShift` bracket as a mass-matched control | 5.2 | **not done**: called out and covered by FREE-ONLY and the nofree branch; a bracket changes the matter cycle and adds a confounded arm |
| C factorial: the ghost cell in the road x free x conduit factorial | 8 (series B) | **not done**: the road is periodic, so a ghost is void (4.3); the ghost cell is covered in aperiodic F |
| arms cut from the proposals | 8 | F = 32 dose level; the three-value diffA bracket (one matched value); the old owner dose grid (theta lo/mid/hi and g lo/mid/hi became four arms around mid); the third checkpoint (two checkpoints, one vote per run); the `cols-U` anchor; `base` heredity arms for blind and physarum on O/F (branches carry the contrast) |

## 16. Review (Sol 6.1 High, read-only, 14 Nov 2026)

Raw output: `review-design.txt`. Thirty findings (6 P1, 22 P2, 2 P3). Each was applied in this file; the section references give where.

| # | finding | action |
|---|---|---|
| 1 P1 | packed `dep << 24 \| t` is signed in JS, CPU and GPU claim disagree at dep >= 128 | packing removed: two-pass `max` (6.1); parity deposits 1, 127, 128, 253 |
| 2 P1 | zero deposit can claim a cell, giving `Z != 0`, `Q == 0` | claim needs actual `dep > 0` (6.1) |
| 3 P1 | 24-bit tag hash collides in the legal id range (ids 1 and 2,604,073, checked) | tag is exact `v + 1`, u32; bounds and `W1`, `W2` planes updated (6.1, 6.2) |
| 4 P1 | extending the stat mapping overlaps `lightIn` words 32-33 | four new pairs at stated free offsets, with overlap assertion and all clear, accumulate, upload, read paths (5.1) |
| 5 P1 | void C-pub satisfied (g) | void or unmatched C-pub fails (g) (9.5) |
| 6 P1 | eight-seed thresholds survive an extension to 16 | thresholds scale with n (10) |
| 7 P2 | claim pass lacks the actual deposit | `T_DEP` scratch, CPU pending list (6.1) |
| 8 P2 | O (c) comparator changes ownership regime | (c) read within `"id"` only (9.5) |
| 9 P2 | C-pub not an otherwise identical intervention | E kept, `trailConduit` allowed beside `trailOwner`, realised matching, C-pub branch (6.3, 8) |
| 10 P2 | B factorial not matched | cross-series comparisons descriptive only (8) |
| 11 P2 | `nofree` does not isolate the windfall | renamed total F dependence; (g) renamed F-led (5.1 labels, 9.4) |
| 12 P2 | ghost check on the wrong field for O | edge-conductance correlation, constant field void (6.1, 4.3) |
| 13 P2 | diffA match changes definition | one definition, realised mismatch reported, void beyond 15 percent (4.3, 7) |
| 14 P2 | noise widens the safeguards | safeguards fixed at 3 percent, unresolved if noisy (9.1) |
| 15 P2 | missing branch and noise inputs | F checkpoints 50,000 and 100,000; O gets nullA, nullB; D gets a butterfly of off (8) |
| 16 P2 | unresolved controls became evidence | INCONCLUSIVE on I, anchor must be YES (10.1, 10.2) |
| 17 P2 | marginal votes can share no seed | joint per-seed conjunction (10) |
| 18 P2 | paid units alone satisfied behaviour | reported only, never satisfies H (9.4) |
| 19 P2 | "leak is zero" false | only foreign grants on defended cells are zero (9.5, 12) |
| 20 P2 | F pilot can pick a ceiling absent from the arms | `F*` symbol everywhere (7) |
| 21 P2 | sizing not executable in failure cases | fallbacks paragraph (7) |
| 22 P2 | durable test changed the strength | D reads durable P2 first, S0.2 repeated at `pDecay` 66 (8, 10.1) |
| 23 P2 | seed audit rejects its own restart | bootstrap log excluded from the history check, reconciled against the table (11) |
| 24 P2 | N-E required, not scheduled | added to O extras, counts 80 to 88 (8) |
| 25 P2 | gates and cuts contradict mandatory evidence | gate precedence, INCOMPLETE outcome, extension projected before it starts (8) |
| 26 P2 | extension budget not a worst case | the 25 percent claim withdrawn (8) |
| 27 P2 | parity instructions incompatible | match by case name, harness changes listed (12) |
| 28 P2 | layout guard asserts an object the API lacks | pure `fieldLayout(cfg)` helper (6.2, 12) |
| 29 P3 | decode provenance misstated | corrected (4.2) |
| 30 P3 | "no trail was laid" overstated | reworded (1) |

Run counts changed by the review: D 72 to 88 (durable P2 arm and butterfly), O extras 80 to 88 (N-E), total 723 to 747, 438 to 454 RE. Not re-checked by a second review; the wall-time figure is still a derivation from the V1 rate.
