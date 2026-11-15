# Mycelium world: rules, rung R0

Rule id `mycelium-r0`. This is the prose specification of `tools/mycelium/world.ts`, the CPU reference. The WGSL port (rung R1, `tools/mycelium/gpu.ts`) matches it bit for bit. Context and the plan of rungs: `docs/neural-mycelia-2026-11-13/report.html` (X1).

This is a separate rule set, not a mode of the research kernel, and its `RULE_VERSION` and golden pins are untouched. From the kernel it reuses the integer helpers and counter-based PRNG (`@bl/schema` `int.ts`), the 160-byte controller layout and the controller arithmetic (`controllerForward` in `@bl/sim-ref`).

## What exists

**The field** is a torus of `width × height` cells, each with three u32 amounts:

- **A**: dissolved nutrient. It carries chemical energy, `eA` per unit.
- **C**: dissolved waste.
- **P**: trail, the polymer particles lay down.

**Particles** have:

- a unique id, a parent id and a genotype id;
- a fixed-point position (one cell is 256 units);
- matter `M` (always at least 1 while alive);
- energy `E` (at most `energyMax`);
- an age;
- 160 int8 weights in the kernel's controller layout: 10 inputs, 8 hidden units, 8 outputs.

Slot order equals id order.

**Closed in matter, open in energy.** The matter total ΣA + ΣC + ΣP + ΣM never changes. Energy, ΣE + eA·ΣA, changes each step by exactly `lightIn − heat`. Light is the only input, and heat is the only output.

## One step

Every phase reads the state as the previous phase left it. Phases 2–5 are order-free per particle: their only shared writes are additions into field cells, which commute. Phase 7 is the only phase that depends on order, and it uses a prefix sum over slot order.

1. **Bin.** Each particle's cell is `(y >> 8) · width + (x >> 8)`. The crowding count `D[cell]` is the number of particles in the cell.
2. **Sense** (start-of-step field). The ten inputs, each saturated to 0..127 or clamped to ±127, are:
   - nutrient, waste and trail here (`>> sensorShift`);
   - the trail gradient east − west and south − north;
   - the nutrient gradient east − west and south − north.

   Each gradient saturates both neighbours first, then subtracts: `sat(P_east >> sensorShift) − sat(P_west >> sensorShift)`, clamped to ±127. With `sensorShift` 0, east 200 and west 150 give 0, not 50. The remaining inputs are:
   - `E >> energyShift`;
   - `M >> massShift`;
   - `16 · D`.
3. **Think.** Run `controllerForward`. The outputs read are 0 MX, 1 MY, 2 EAT, 3 DEPOSIT and 4 SPLIT. Outputs 5–7 are reserved.
4. **Eat.** Each particle requests `r = min((maxEat · relu(EAT)) >> 7, bodyMax − M)`, and requests are summed per cell as `R`.
   - If `R ≤ A`, each particle gets `r`.
   - Otherwise (a contended cell) each gets `floor(r · A / R)`. The rounding remainder stays in the field.
   - The cell loses the sum of grants. A particle gains `g` matter and `g · eA` energy, and energy above `energyMax` becomes heat.
5. **Live.** For each particle, in order:
   1. Pay `cost = upkeep + ((|MX| + |MY|) · moveCost >> 7) + shrFrac(M, massUpkeepShift)` as heat, where `shrFrac(q, k) = mulFrac(q, 2^(16−k), 16, rnd)` is q / 2^k with stochastic rounding (the particle stream, slot 90). If `E < cost`, the particle dies: its matter goes to C in its cell and its energy becomes heat.
   2. Deposit `dep = min((maxDeposit · relu(DEPOSIT)) >> 7, M)` matter as trail P, reduced to what the energy pays at `depositCost` per unit. That energy becomes heat.
   3. Excrete `shrFrac(M, excreteShift)` to C (slot 91). If M reaches 0, the particle dies and its energy becomes heat.
   4. Move by `trunc(MX · speed / 128)` and `trunc(MY · speed / 128)` position units, wrapping around the torus.
   5. Want to split if `SPLIT > 0`, `E ≥ splitEnergy` and `M ≥ splitMatter`.

   All field writes in this phase are to the cell the particle started the step in.
6. **Compact.** Survivors keep their slot order.
7. **Births.** Wanting survivors are ranked in slot order. A rank of `maxParticles − survivors` or more is refused and counted. Each accepted child:
   - takes id `nextId + rank`;
   - takes `M >> 1` and `E >> 1` from its parent, which keeps the remainders;
   - is placed within ±128 units of the parent on each axis, from the parent's draws;
   - gets a controller set by the heredity arm (below).

   A child whose controller differs from its parent's gets the next genotype id, in birth order. A mutation that leaves every weight unchanged (through clamping, cancelling deltas or `mutCount` 0) is not counted and keeps the parent's genotype id. A birth is also refused when it would need a particle id or genotype id above `0xfffffffe`.
8. **Field.**
   - Light converts `min(C, L)` waste into nutrient in each cell, and `lightIn` grows by `eA` per unit. `L` is `light` everywhere (uniform), or `light · (column + 1) / width` with stochastic rounding (gradient): the floor, plus one when `draw(field, 1) mod width < light · (column + 1) mod width`. Every column gets its share on average, so the west is dim, not dark.
   - Trail decays to waste by `mulFrac(P, pDecay, 16, rnd)`, with stochastic rounding from the field stream.
   - A and C diffuse with the kernel's `diffOut`. A cell splits its amount `q` into four quarter-portions that sum to `q` exactly: `q >> 2`, plus one for `q & 3` of the directions chosen by a rotation from the draw. Toward each neighbour it sends `mulFrac(portion, 4 · d, 10, rnd)`, about `q · d / 1024`, with `d ≤ 256`, so a cell never sends more than it holds and even a single unit can move. The draws come from a separate stream, `cellBase(seed XOR 0x64696666, step, cell)`, with the species index keeping A and C apart. Directions are 0 east, 1 west, 2 south and 3 north; what arrives from the east neighbour is its westward send.

## Heredity arms

- **inherit**: the child copies the parent's weights. With probability `mutRate / 65536`, `mutCount` weights each change by a nonzero delta in ±`mutStep`, clamped to ±127.
- **frozen**: an exact copy with no mutation. It is the control for selection among founders only.
- **blocked**: fresh random weights. This is the heredity-blocked twin.

## Physarum null (rung R2; on the GPU and with a matched deposit since R2b)

An optional config key `controller: "neural" | "physarum"` selects what phase 3 (Think) runs. Absent means `"neural"`. `defaultConfig()` never sets it and `createWorld` never inserts it, so the `encode` header of every existing config, and every pinned digest, is unchanged. `validateConfig` accepts only those two values, and `"physarum"` requires `heredity: "frozen"` (the genome is carried and never read, and no mutation draw is made). Phases 1, 2 and 4-8 are unchanged, so the founders, the light and the arithmetic of eating, upkeep, moving, depositing and splitting are the same. The realised behaviour is not matched: the null deposits one unit in every particle at every step, always eats at full output and always splits when it can, so its trail mass, population and clustering differ from the neural arms by construction (PROTOCOL.md section 2).

With `pb` the particle's stream for this step, `gx = xin[3]` and `gy = xin[4]` (the trail gradients, already in ±127) and `m = max(|gx|, |gy|)`:

- `EAT = 127`, `DEPOSIT = 32` (so `(maxDeposit · 32) >> 7`, one unit per step at the default `maxDeposit` 4), `SPLIT = 127`. Outputs 5-7 are 0.
- If `m > 0`: `bx = trunc(gx · 64 / m)`, `by = trunc(gy · 64 / m)` (up the gradient at half speed). Otherwise `bx = draw(pb, 62) mod 129 − 64`, `by = draw(pb, 63) mod 129 − 64` (no trail here: wander).
- `MX = clamp(bx + draw(pb, 60) mod 33 − 16, ±127)`, `MY = clamp(by + draw(pb, 61) mod 33 − 16, ±127)`.

The constants 64, 16, 32 and 127 are fixed by the R2 protocol (`docs/mycelium-r2-2026-11-13/PROTOCOL.md`) and not tuned. Products: `|gx| · 64 ≤ 8128`. R2b ported the null to `tools/mycelium/gpu.ts` (the same `k_think` stage, with the genome neither read nor needed); `tests/deno/mycelium_gpu.ts` compares it with the CPU bit for bit, resume included.

**Matched deposit (R2b, optional `physarumDeposit`).** An integer `v` in 0..768, in 1/256 matter per particle-step, valid only with `controller: "physarum"`, absent from `defaultConfig()` and never inserted by `createWorld`. Present, each particle draws once at slot 64 and `DEPOSIT = 32 · u` with `u = (v >> 8) + [draw(pb, 64) mod 256 < (v & 255)]`, so `(maxDeposit · DEPOSIT) >> 7` is `u` units at the default `maxDeposit` 4 (0 to 3), and the expected deposit is `v / 256`. Absent, `DEPOSIT = 32` and nothing is drawn, so the R2 null and every earlier digest are unchanged. `v = 256` gives the same dynamics as the absent key (only the config header differs).

**Sensor blinding (R2b positive control, optional `blindTrailGradient`).** A boolean, absent from `defaultConfig()`. `true` sets inputs 3 and 4 (the trail gradients) to 0 in the sense phase of every particle, in the heritable network and in the physarum rule alike (a blind physarum particle always wanders); the other eight inputs are unchanged and the controller keeps evolving.

`probe(state)` (exported from `world.ts`) returns every live particle's NN_O outputs for the next step without changing the state. `step` and `probe` call the same bin and sense-and-think functions.

## Trail use (exploratory, optional `trailMoveDiscount`)

Two optional config keys give trail a physical use. Both are absent from `defaultConfig()` and never inserted by `createWorld`, so every existing config, header and digest is unchanged. Design, free-rider reasoning and the screen: `docs/mycelium-trail-use-2026-11-13/`.

- `trailMoveDiscount` `td`: integer 0..256. Absent means no discount.
- `trailDiscountMode`: `"public"` or `"toll"`, valid only with `trailMoveDiscount`; absent means `"public"`.

In phase 5, the movement term of the cost changes from `((|MX| + |MY|) · moveCost) >> 7` to `(raw · (256 − f)) >> 15`, with `raw = (|MX| + |MY|) · moveCost` and `f = min(min(P0, 256) · td, 256)`, where `P0` is the trail in the particle's own cell at the START of the step (the value sensing reads, taken before any deposit of this step). Mode `"toll"` sets `f = 0` for a particle whose deposit request `(maxDeposit · relu(DEPOSIT)) >> 7` is 0 (the request, not the realised deposit, which the energy left after the cost can cap at 0). `f = 0` gives `raw >> 7` exactly, so `td = 0` has the dynamics of the absent key. Rounding is a floor and draws nothing.

The saving is energy the particle simply does not pay: the term is booked to heat as paid, so `ΣE + eA·ΣA` still changes by exactly `lightIn − heat`. Matter is untouched and no counter, `totals` field or header field is added. On the GPU `k_think` computes `f` into a scratch plane (`k_live` adds trail in the same dispatch, so reading it there would race); the CPU computes it between phases 3 and 4.

Bounds: `min(P0, 256) · td ≤ 2^16` (saturating `P0` first, since a cell can hold 2^31); `raw ≤ 254 · 2^12 < 2^20`; `raw · (256 − f) < 2^28`.

## Trail conduit (exploratory, optional `trailConduit`)

Two optional config keys let trail carry nutrient. Both are absent from `defaultConfig()` and never inserted by `createWorld`, so every existing config, header and digest (including the pinned `9a5461c07ef6fcde`) is unchanged. Design, selection argument and screen: `docs/mycelium-conduit-2026-11-14/`. The rule was added after the R2 to R4 freezes; those rungs stay reproducible at their commits (R2b `edc25af9`, R3 `eef9c043`, R4 `88bd3002`), so the kernel hashes recorded in their freezes no longer match the working tree.

- `trailConduit` `g`: integer 0..255. Absent means no conduit. Requires `diffA <= 128`.
- `trailConduitCap` `q`: integer 1..255, valid only with `trailConduit`; absent means 255.

In phase 8, in the species-A diffusion only (species C is untouched), the send from cell `k` toward neighbour `nb(d)` uses a per-edge rate in place of `diffA`:

```
x   = min(P[k], P[nb], q)            // end-of-step trail: after this step's deposits and decay
ext = (x * g) >> 4                   // floor, no draw
Dd  = min(diffA + ext, 128)
sent[4k+d] = diffOut(A[k], d, Dd, base, 0)   // same portion split, same draw slot as the keyless rule
```

`Dd` depends only on the unordered pair of cells, so conductance is the same from both ends. An edge conducts above the base rate only if both end cells hold trail. `g = 0`, or no trail, gives `Dd = diffA` on every edge: the same sends and draws as the keyless rule, so the state bytes equal the keyless run's (only the config header differs). The cap of 128 (not 256) keeps the checkerboard mode of the diffusion from oscillating (eigenvalue `1 - 8 Dd / 1024` is 0 at 128, -1 at 256). With the key present and `diffA = 0` the base is zero but trail-linked edges still conduct, so the diffusion step is not skipped: the CPU guard is `diffA == 0 and no trailConduit`, the GPU dispatch is guarded the same way.

Matter and energy: A only moves between cells through `sent` and `gather`, so `ΣA + ΣC + ΣP + ΣM` is constant and `ΣE + eA·ΣA` still changes by exactly `lightIn − heat`. No counter, `totals` field, state array or checkpoint header field is added; the only checkpoint change is the two keys in the config header when present, so `FORMAT` stays 1 and every old checkpoint decodes unchanged. Each cell's four sends sum to at most its amount (`4·Dd <= 512`, each send at most its portion), so nothing underflows.

Bounds: `x <= q <= 255` and `g <= 255` give `x·g <= 65,025 < 2^16`; `Dd <= 128`, `4·Dd <= 512 < 2^22` (inside the diffusion bound). A cell can hold 2^31 trail, so the min is taken before the multiply; the multiply never sees a raw P.

On the GPU `send()` takes a flag (on for species A when keyed, off for C). `k_light` (decay) runs before `k_send_a`, and the diffusion dispatches do not write P, so `k_send_a` reads a settled P with no race. No new buffer, dispatch or draw slot. The CPU exports `conduitRate(De, g, q, pk, pn)`, which observers use; `probeLesion(s, zeroInputs)` is an observer-only variant of `probe` that sets the listed inputs to 0 after sensing (`step` never passes any).

## Bootstrap keys (exploratory; docs/mycelium-bootstrap-2026-11-14/)

Ten optional config keys in three families, added after the R2 to R4 and conduit freezes (so the kernel hashes recorded there no longer match the working tree). All are absent from `defaultConfig()` and never inserted by `createWorld`; with every key absent, `encode` output, `stateDigest` (the pinned `9a5461c07ef6fcde`), the config header and the dynamics are those of the conduit line. Every "requires" and "excludes" rule below lives in `validateConfig`. No key adds a draw slot. Both ledgers close with residual exactly 0 on every step. The CPU port is `tools/mycelium/world.ts`; the WGSL port is in `tools/mycelium/gpu.ts` (kernels `k_fl_clear`, `k_own_clear`, `k_claim_a`/`b`/`c`, `k_send_ax`) and is checked bit for bit against the CPU by the appended `bootstrap` cases of `tests/deno/mycelium_gpu.ts` (all of them match at the last gate).

### Pre-laid trail (P): `trailInit`, `trailInitPattern`, `trailInitPitch`

- `trailInit` `v`: integer 1..255. Absent means nothing is laid.
- `trailInitPattern`: `"carpet"` (also what absent means), `"rows"`, `"cols"`, `"lattice"`, `"patches"`; only with `trailInit`.
- `trailInitPitch`: integer 2..64, absent means 8; only with `trailInit` and a pattern other than carpet (carpet or absent pattern with a pitch is rejected).

Geometry is a pure function of the cell, `x = i % W`, `y = (i / W) | 0`, `h = pitch >> 1`, no draw: carpet every cell; rows `y % pitch == 0`; cols `x % pitch == 0`; lattice rows or cols; patches `x % pitch < h && y % pitch < h`. `laidCell(c, x, y)` is exported.

`createWorld`, after the founders and before `matter0` and `energy0` are taken: on each laid cell `t = min(trailInit, A[i]); A[i] -= t; P[i] += t`. Matter: A moves to P inside one cell, so `A + P` per cell and `matterTotal` equal the unlaid world's. Energy: `energyTotal` falls by `eA · Σt` and `energy0` is taken after the move, so `ΣE + eA·ΣA = energy0 + lightIn − heat` holds from step 0. It is an energy tax, not a subsidy. No counter, state array, `FORMAT` or encode word changes; P is already serialised and the keys travel in the header. Bounds: `P <= nutrient0 <= 2^31/N`, so the conduit product `min(P,P,q) · g <= 255 · 255` is untouched.

### Free first layer (F): `trailFreeLayer`, `trailConduitGhost`

- `trailFreeLayer` `F`: integer 1..255. Absent means every deposit costs `depositCost` per unit as before.
- `trailConduitGhost` `s`: integer 1..min(W, H) − 1; only with `trailConduit`.

Start-of-step quantities (phase 5 adds deposits afterwards, so the snapshot is order-free; the GPU computes `S` in `k_think` and `room` in a kernel right after it):

```
dreq_i  = (maxDeposit * relu(DEPOSIT)) >> 7             // <= 253, the same request the toll and the deposit use
S[c]    = sum of dreq_i over every particle starting in cell c        // all particles, including ones that die before depositing
room[c] = P0[c] >= F ? 0 : F - P0[c]                    // compare before subtract; 0..F
fr_i    = S[c] <= room[c] ? dreq_i : divu(dreq_i * room[c], S[c])     // floor
```

Phase 5, after the upkeep check, in place of the keyless deposit lines:

```
dep0 = min(dreq_i, m)                  // m = matter after eating
free = min(fr_i, dep0)
paid = dep0 - free
if (paid * depositCost > en) paid = divu(en, depositCost)     // only paid units are clipped by the energy left
dep  = free + paid
en  -= paid * depositCost;  heat += paid * depositCost        // free units pay and heat nothing
m   -= dep;  P[ci] += dep;  freeSum += free;  paidSum += paid
```

Total free units on a cell never exceed `room[c]` (the shares floor), so free units never push P above F; paid units may. A particle that dies before depositing leaves its share unused, not redistributed. With `F` absent, or `room` 0, the arithmetic is the keyless arithmetic. Ledger: the waived `free · depositCost` is neither added to `heat` nor removed from `E`; both sides of the energy identity move by the same amount and nothing is created. Matter is M to P as before. Counters: `totals.freeUnits` and `totals.paidUnits` (cumulative exact integers, at most 2^50) exist only when the key is present (created in `createWorld` and `createEmpty`, in the header and the digest only for F worlds); `StepStats` carries the per-step `freeUnits`, `paidUnits` only then. Bounds: `dreq · room <= 253 · 255 < 2^16`; `S <= 253 · 2^16 < 2^24`; no raw P is multiplied; `paid · depositCost <= 253 · 2^12 < 2^20`. Compatible with `trailMoveDiscount` (the toll reads the request, not the realised deposit).

Ghost: when `trailConduitGhost` is `s`, the conduit rate of the edge `k -> nb` reads P at `shiftCell(k, s)` and `shiftCell(nb, s)` in place of `k` and `nb`, where `shiftCell(i, s, W, H) = ((y + s) % H) · W + ((x + s) % W)` (a torus translation, exported). Same matter arithmetic, same draws; a translation permutes cells, so the mean conduction is unchanged and the rate is still symmetric per edge. It is a null only for aperiodic trail: on a periodic road a shift that is a multiple of the pitch maps the road onto itself.

### Owner conduit (O): `trailOwner`, `ownerDefend`, `ownerConduit`, `ownerConduitCap`, `ownerGhost`

- `trailOwner`: `"id"` (individual) or `"gid"` (clone, genotype id). Absent means none of the O rules and no planes.
- `ownerDefend` `theta`: integer 1..255, only with `trailOwner`.
- `ownerConduit` `g`: integer 0..255, only with `trailOwner`, requires `diffA <= 128`, excludes `trailConduit` (the public conduit may be used beside `trailOwner` and `ownerDefend`, not beside `ownerConduit`).
- `ownerConduitCap` `q`: integer 1..255, only with `ownerConduit`; absent means 255.
- `ownerGhost` `s`: integer 1..min(W, H) − 1, only with `ownerConduit`.

State (only with `trailOwner`): `Z[cell]` u32 owner tag (0 = none) and `Q[cell]` u32 owned trail, a label on part of P. Invariants (`validateState`): `Q <= P`; `Z == 0` iff `Q == 0`; `Z - 1 < nextId` (`"id"`) or `< nextGid` (`"gid"`), i.e. the tag names an id that was issued. The tag of a particle is `ownerTag(v) = v + 1` (exact u32, 1..0xffffffff, with `v` the id or gid read at the start of the step): not a hash, so tags never collide (a 24-bit hash did, inside the legal id range). `Z`, `Q` and the claim scratch are labels: `matterTotal` and `energyTotal` do not read them.

Phase 4 (eating gate), start-of-step `Z`, `Q`: `if (Z[ci] != 0 && Z[ci] != t && Q[ci] >= theta) r = 0`. **`r` is zeroed before it is stored in `req` and added to `R`**: the cell's R then excludes it and `req` is 0, which is exactly a particle that asked for nothing. Gating only the sum would let `k_grant` hand out `r` from an `R <= A` that excluded the particle and A would underflow (a test builds that cell).

Phase 5 (deposit and claim), after the deposit lines (`dep` is the actual deposit, after any energy clip; a particle that dies before depositing deposits 0), with `z = Z[ci]` at the start of the step (`Z` is not written until after the loop): `dep == 0`: nothing. `z == t`: `Q[ci] += dep`. `z == 0`: the particle is a claim candidate. `z != 0 && z != t`: the deposit adds to P only. After the loop (`resolveClaims`, exported): pass 1 `W1[ci] = max(dep)` over candidates; pass 2 `W2[ci] = max(tag)` over candidates with `dep == W1[ci]`; every candidate whose tag equals `W2[ci]` does `Q[ci] += dep` (same-clan depositors all count, whatever their own deposit); every cell with a candidate takes `Z[ci] = W2[ci]`. Two passes of `max`, never a packed `dep << 24 | tag` (signed in JS at `dep >= 128`, so CPU and GPU would disagree). A zero deposit never claims, so `Z != 0` implies `Q > 0`.

Phase 8 (decay), inside the existing `P > 0 && pDecay > 0` branch and with the same draw as P: `Q -= min(Q, mulFrac(Q, pDecay, 16, draw))`, and `Z = 0` when `Q` reaches 0. `Q <= P` survives because `mulFrac(q, k, 16, r)` is non-decreasing in `q` and rises by at most 1 per unit of `q` (`k < 2^16`), so `q − f(q)` is non-decreasing; a property test checks it over random cells.

Phase 8 (owner conduit), species A only, end-of-step `Z`, `Q` (after decay): per directed edge `k -> nb`
```
Dd = (Z[k] != 0 && Z[k] == Z[nb]) ? min(De + ((min(Q[k], Q[nb], q) * g) >> 4), 128) : De
```
with the same `diffOut`, draw slot and symmetry argument as the public conduit (`ownerRate(De, g, q, zk, zn, qk, qn)`, exported). The min is taken before the multiply. `g = 0` gives `Dd = De` everywhere. The diffusion skip becomes: skip only if `diffA == 0` and neither conduit key is present.

`ownerGhost` `s`: `Z` and `Q` are read at `shiftCell(k, s)` and `shiftCell(nb, s)` for the edge (owner placement and amount both displaced; the eating gate stays real). The validity check (correlation of the real and displaced edge-conductance maps) is an observer's job, not the kernel's.

Dead owners: no takeover rule; a cell's owner changes only when its `Q` reaches 0. Passive plane: `trailOwner` alone (no defend, no conduit) leaves A, C, P, every particle field and every total byte-identical to the keyless run; only the header and `Z`, `Q` differ.

Checkpoint: with `trailOwner`, `encode` appends `Z` then `Q` (N u32 words each, little endian) after the genome bytes (`FORMAT` stays 1; keyless bytes are identical) and `decode` reads them when the header config has the key.

Bounds: tag `<= 0xffffffff`; `min(Q, Q, q) · g <= 255 · 255 < 2^16`; `Dd <= 128`, `4 · Dd <= 512`; the compares (`Q >= theta`, tag equality, `dep` and tag `max`) multiply nothing.

## Randomness

All draws use `draw(cellBase(seed', step, key), slot)` from `int.ts`:

- **Particle streams** use `seed' = seed XOR 0x6d796331` and key = particle id. Founders use step `0xffffffff`.
- **The field stream** uses `seed' = seed` and key = cell.
- **Slots:** 0 DX, 1 DY, 2 mutate?, 3+j mutation slot, 40+j mutation delta, 60 and 61 physarum turn (x, y), 62 and 63 physarum wander (x, y), 64 physarum deposit rounding (R2b, only with `physarumDeposit`), 90 upkeep rounding, 91 excretion rounding, 100+b weight byte.

## Bounds

`validateConfig` enforces every range below, and `validateState` checks counts, positions and both ledger identities.

- **Total matter ≤ 2^31.** This bounds every field cell and every sum of cells, so u32 never wraps.
- **The contended grant `r · A`.** `r ≤ 253` (since `maxEat ≤ 255`), and contention means `A < R ≤ 253 · n`. With `maxParticles ≤ 2^16`, `r · A < 253² · 2^16 < 2^32`. **Raising the particle cap above 65,536 needs a different division.**
- **Diffusion** uses `mulFrac(portion, 4d, 10)` with `4d ≤ 1024 < 2^22`, and its result never exceeds the portion. **Turnover** uses `mulFrac(M, 2^(16−k), 16)` with `1 ≤ k ≤ 16` and `M ≤ 2^16`. The gradient light product `light · (column + 1) ≤ 2^12 · 2^9`.
- **Trail conduit** (optional): `min(P[k], P[nb], q) · g <= 255 · 255 < 2^16` and `Dd <= 128`, so `4·Dd <= 512`; see "Trail conduit".
- **Bootstrap keys** (optional): see "Bootstrap keys" for the free-layer products (`dreq · room < 2^16`, `S < 2^24`, `paid · depositCost < 2^20`), the owner tag (exact `v + 1 <= 0xffffffff`) and the owner conduit product (`< 2^16`).
- **Trail decay** uses `mulFrac` with `pDecay < 2^16`.
- **Products in phase 5.** `|MX| + |MY| ≤ 254` and `moveCost ≤ 2^12`. Also `dep · depositCost ≤ 255 · 2^12`, `g · eA ≤ 253 · 255`, and `E ≤ 2^24`.
- **Positions** are below `512 · 256 = 2^17`.
- **Lifetime ledger.** `energy0` and the cumulative `lightIn` and `heat` must each stay at or below 2^50, so every ledger sum is an exact double. `validateState` rejects a checkpoint beyond that, and `step` stops with an error when a run would cross it. At the default world's roughly 10^5 energy per step, that is about 10^10 steps.
- **Per-step counters** (`lightIn`, `heat`) can exceed 2^32 on big worlds. The CPU keeps them as exact doubles, below 2^53. The GPU (R1) reduces them per workgroup into 64-bit pairs; see "R1 (GPU)".

## R1 (GPU)

`tools/mycelium/gpu.ts` is the WGSL port of this rule set. The rules do not change: `tests/deno/mycelium_gpu.ts` runs CPU and GPU side by side and requires equal `stateDigest` (the digest of the whole checkpoint encoding) at every checkpoint, for the three arms, the physarum null (key absent and `physarumDeposit` 0, 100, 256, 300, 768), `blindTrailGradient` on each arm, both light patterns, a 256 × 256 world, a 512 × 512 world at the 65,536 cap with refusals, a mid-run readback → `encode` → `decode` → upload resume, and a step whose `lightIn` and `heat` each pass 2^32, a workgroup whose heat sum is exactly 2^32 (the workgroup carry), particle-id and genotype-id exhaustion (the cut falls inside a step, in every heredity arm), hot cells with 65,536 requesters (the `r · A` bound), steps across 2^32, and the 2^50 ledger bound (landing on it, and passing it). A resume check runs both ping-pong sides after the object has stepped past the checkpoint, so the upload must overwrite live state. A name filter that matches no case fails the script. There is no floating point in the step.

**Layout.** Everything is a u32 or i32 with WGSL wrapping semantics. Five storage buffers: `ctl` (scalars `n`, `nextId`, `nextGid`, `step` (low word) and `stepHi`, an error word, the genotype-id cut, per-step counters, cumulative totals), `fld` (A, C, P, then the per-step cell scratch D, R, taken, then the diffusion scratch), two particle buffers (eight u32 planes plus 40 genome words per slot, ping-ponged each step) and `tmp` (per-step particle scratch). Every kernel is dispatched for `maxParticles` (or all cells) threads and returns when `i ≥ n`, with `n` read from `ctl`, so `step(k)` queues k steps with no CPU writes between them. The config is baked into the shader as consts.

**Dispatch order, one step.**

1. `k_clear` zeroes D, R and taken; `k_begin` zeroes the per-step counters and resets the genotype-id cut.
2. `k_bin` stores each particle's cell and adds to D.
3. `k_think` senses the untouched start-of-step A, C, P and the complete D, runs the controller (only outputs 0–4), stores the outputs and the eat request `r`, and adds `r` into R.
4. `k_grant` reads the complete R and the still-untouched A, computes each grant (`r` if `R ≤ A`, else `⌊r · A / R⌋`) and adds it into taken. `k_apply_eat` then counts contended cells (`R > A`, on start-of-step A) and does `A −= taken`. This is the per-cell contended sum; no particle sees another's grant.
5. `k_live` is phase 5, per particle, writing M, E, position and age in its own slot and flags `alive` and `wants`. C and P receive atomic additions, which commute.
6. `k_scan_aw`, `k_top_aw`: exclusive prefix sums over slot order of `alive` and `wants`. A 256-thread block scan writes block totals; one workgroup scans the (at most 256) block totals. Slot `i`'s prefix is its in-block value plus its block offset.
7. `k_compact` (phases 6 and 7 together): a survivor goes to slot `prefix_alive(i)` of the other particle buffer. A wanting survivor with `rank = prefix_wants(i)` below the step's birth limit `min(wants, maxParticles − survivors, 0xffffffff − nextId)` also writes its child at `survivors + rank` (id `nextId + rank`, position from the parent's draws, controller by arm) and halves the parent's M and E in the new buffer. Every thread reads the old buffer and writes the new one, so no thread sees another's write. Refusal is monotone (once a rank is refused every later one is), so the accepted births are exactly the first `min(maxParticles − survivors, 0xffffffff − nextId)` wanting survivors, as on the CPU, before the genotype-id cut of step 8. Children are built speculatively up to that limit; the mutation counter is not touched here. The child's mutation is applied in order to a private copy of the parent's 40 genome words, then compared with the parent's words, which gives `novel` (the CPU's byte comparison). Each child writes its `novel` flag at index `rank`.
8. `k_scan_n`, `k_top_n` scan the `novel` flags by rank; `k_assign_gid` gives each novel child `nextGid + prefix_novel(rank)`. Other children keep the parent's genotype id, written by `k_compact`. With `room = 0xffffffff − nextGid` genotype ids left, the child that takes the last one (`prefix_novel = room − 1`) records the cut `rank + 1`; the final births are `min(births, cut)`, and 0 when `room` is 0. `k_trim` then gives back M and E to every parent whose speculative child lies beyond the cut.
9. `k_light` (light and trail decay), then diffusion per species as two dispatches: `k_send_*` writes the four `diffOut` sends of every cell to a scratch plane, `k_gather_*` sets `f = f − Σ own sends + Σ neighbours' sends toward it`. This is the CPU's own two-pass structure, so no in-place hazard. Species A runs, then C. A diffusion of 0 skips both dispatches, as on the CPU.
10. `k_finish` (one thread): final births, refusals, new `n`, `nextId`, `nextGid += min(novel children, room)`, `mutations` (the accepted novel children, inherit arm only), the step-counter and ledger error bits, adds the step counters into the cumulative totals, `step + 1` with carry into `stepHi`.

Dispatches in one compute pass are ordered, so each reads everything the previous one wrote.

**What is order-dependent and how.** Only births, as on the CPU, via the scans above. Everything else is a sum of commuting u32 additions (`atomicAdd` into D, R, taken, C, P) or per-cell / per-particle.

**Counters past 2^32.** `lightIn` can reach `light · eA · cells ≈ 2.7 × 10^11` and `heat` tens of billions in one step (the test measures 2.7 × 10^11 and 2.3 × 10^10). Each thread adds its own addend (below 2^32) into a workgroup `(lo, hi)` pair (`old = atomicAdd(lo, v); if (old + v < old) atomicAdd(hi, 1)`), and thread 0 adds that pair into the global per-step pair the same way. The wrap test is exact for every single atomic add, so lo + 2^32 · hi is the exact sum whatever the order. `k_finish` adds the per-step pairs into the cumulative pairs with a carry. The other five counters (births, deaths, refused, contended, mutations) stay below 2^32 within a step (at most `max(cells, maxParticles)`) and are accumulated the same way. `read()` returns each total as `hi · 2^32 + lo`, an exact double.

**Bounds that differ from R0.**

- **Particle ids.** Ported exactly. The CPU refuses a birth that would need an id above `ID_MAX = 0xfffffffe`, one birth at a time; the GPU limits the births of a step to `0xffffffff − nextId` in the same way as the free-slot limit, so the two agree whatever `nextId` is.
- **Genotype ids.** Ported exactly. The CPU refuses a birth when `nextGid + (novel children accepted before it) > ID_MAX`, tested before the child's novelty is known and with a count that stops growing once a birth is refused. So the refusal is monotone like the other two: every birth from the one after the `room`-th novel child is refused, novel or not (the frozen arm refuses everything once `nextGid = ID_MAX + 1`). The accepted births are therefore a prefix, found from the novel-flag scan as in step 8, and `k_trim` restores the cut parents. The cost is one extra dispatch per step.
- **Step counter.** Ported. The step is a `(lo, hi)` pair of u32 words; the PRNG keys on `lo`, which is the CPU's step mod 2^32 (`cellBase` XORs the step in as an int32, which wraps the same way). `read()` returns `hi · 2^32 + lo`. It is exact to 2^53, as the CPU's double is; the step that would pass 2^53 sets an error bit and `read()` throws, and `upload` throws for a step outside `[0, 2^53]`.
- **Ledger bound.** The CPU throws inside `step` when `lightIn` or `heat` would pass 2^50. The GPU sets an error bit in `k_finish`, after adding the step into the cumulative pair, and `read()` throws. Detection is exact (landing on 2^50 is accepted by both, one over is flagged by both).
- **Errors surface at readback.** Only the ledger bound and the 2^53 step bound remain, and both are places where the CPU throws or stops being exact. `step()` returns once work is submitted. `read()` is the first place to see an error bit, and `validateState` on the result is the ledger check. Steps queued after a flagged step keep running on the GPU until the next `read()`, so there is no usable intermediate state after an error: the run is over, as the CPU's throw also ends it. A caller that batches `step(n)` must treat a throw from `read()` as the end of the run. Stopping the kernels once an error bit is set would need a non-uniform early return before barriers, which WGSL rejects, so it is not done.
- **Config is fixed per object.** `upload(state)` requires the same config (it is baked into the shader); resume across configs builds a new `GpuMycelium`.
- **Division.** The contended grant `⌊r · A / R⌋` is a single u32 division with `r · A < 2^32` (the R0 bound), so the cap stays 65,536 on the GPU too. Sums into R and taken are below `253 · 2^16`.
- **Memory.** The largest world (512 × 512, 65,536 particles) uses about 10.5 MB of field, 2 × 12.6 MB of particle buffers and 3.4 MB of scratch. At most five storage buffers per stage are bound, within the WebGPU default limit of eight.

## Defaults are engineered choices

`defaultConfig()` was tuned by hand on a 128 × 128 world. Raising `upkeep` from 2 to 6 and lowering `light` from 2 to 1 took the population from pinned at the 8,192 cap down to a level set by energy.

On 13 Nov 2026 each arm ran on seeds 1–3 for 3,000 steps, with ledger residual 0 on every step and no refused births. The ranges at step 3,000 across the three seeds:

| Arm | Particles | Families |
|---|---|---|
| inherit | 4,413–4,953 | 1,929–2,399 |
| blocked | 4,981–5,013 | (every particle its own) |
| frozen | 4,104–4,178 | 144–195 |
| inherit, gradient light (seeds 1–2) | 1,586–1,618 | 742–814 |

These are smoke checks that the world runs. They are not comparisons between arms, which belong to rung R2 with fixed readouts and a noise floor.

These values are choices that make the world run. They are not findings about it.

## Checkpoints

`encode` writes a JSON header (format 1, config, step, counters and ledger anchors), then A, C and P, the eight u32 particle arrays and the live weights (and, only with `trailOwner`, the owner planes Z and Q; see "Bootstrap keys"). `decode` validates the result. `stateDigest` is two FNV-1a lanes over those bytes.

A run resumed from a checkpoint equals the continuous run byte for byte. `tools/test/mycelium.test.ts` checks this at several cut points.

## Not in R0

The genotype pool (R3), bonds (R4), learning during life (R5), signal emission, lesion brushes and lineage files are all later rungs.
