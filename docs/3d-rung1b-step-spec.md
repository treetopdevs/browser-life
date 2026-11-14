# Rung 1b: the executable spec of one slab step (2026-10-23)

This is the single document that M1 (`packages/sim-ref/src/step3d.ts`, `RefSim3`) and M2 (`packages/sim-gpu/src/shaders3d.ts`,
`gpu-sim3.ts`, `GpuSim3`) implement **independently** and must agree on **bit for bit**. It adds no rule to
`docs/3d-rung1b-plan-2026-10-23.md` (the plan, §2 to §4) or `docs/3d-rung1b-m0-plan.md`; it pins what those leave open and records every
choice in §13. Where the two disagree, this file decides and the plan gets an amendment.

Code references are to this tree (M0 at `d5f1283d`): `step.ts` is `packages/sim-ref/src/step.ts`, `shaders.ts` is
`packages/sim-gpu/src/shaders.ts`, `gpu-sim.ts` is `packages/sim-gpu/src/gpu-sim.ts`. "As 2D" always names the `step.ts` lines and the
`shaders.ts` function that hold the rule being reused. No code is given here: formulas are in prose and arithmetic notation.

Hard rules: every RULE_VERSION 1 golden pin and every 2D hash stays byte-identical; nothing in 2D `step.ts`, `shaders.ts` or `gpu-sim.ts`
changes (only the M0 slab guards exist there); all slab arithmetic is u32/i32 integer with the semantics of `int.ts` and WGSL; the
conservation residual is exactly 0.

## Changes during M1

M1 (`packages/sim-ref/src/step3d.ts`, `RefSim3`) found nothing in this spec to correct: every rule below is implemented as written, and the tests in
`packages/sim-ref/test/step3d.test.ts` and `step3d-ops.test.ts` pin the hand examples of section 15. Notes for the integrator (M2) on names and shapes, not rules:

- The exported helpers are `OUTSIDE` (`-1`), `share3(q, wx, wy, wz, d1)` (the divisor is an argument), `portion6(q, d, rot)`, `diffRot6(baseS)`, `diffOut6(q, d, De, baseS, sp)`,
  `controllerForward3(wb, x, h, o)`, `mutateInPlace3(genome, n, i, cfg, which, deltaRnd)`. `nb3` and `lightSurface(x, y, step)` are methods of `RefSim3`.
- `RefSim3` makes each pass public (`affinity`, `flow`, `transport`, `lightColumn`, `react`) and exposes `affinityField`, `displacement` (the packed `disp` words) and `lightField`
  (`Lbuf`) so the golden cases can compare intermediate fields; `step()` calls them in the order of section 3.
- The CPU lottery keeps the 2D genome-copy skip (section 7.2) with a zero-initialised scratch genome, as 2D; it is unobservable in `stateHash`.
- Section 9.2: a missing z neighbour reads `cap24` of the cell's own raw post-transport `S`; this equals the value after the cell's own pool cap, because both are `2^24 - 1` once `S >= 2^24`.
- `RefSim3` reads `cfg.motility !== false`; `motility` is a required boolean in `WorldConfig`, so this equals 2D's truthiness test.

## 0. Conventions

- Integer ops are those of `packages/schema/src/int.ts`: `addu/subu/mulu` wrap mod 2^32, `divu(a, 0) = a`, `divi` truncates toward zero
  (so does WGSL `/` and `%` on i32), `clampi`. Every product below has its bound in §12 so nothing wraps in a valid state; where a
  wrap would be possible the text says "split form".
- `floor(a/b)` on non-negative integers is `divu`. `>>` on a signed value is the arithmetic (floor) shift, on an unsigned value logical.
- `W = tileW`, `H = tileH`, `D = tileD`, `WH = W*H`, `N = W*H*D = cellCount(cfg)`. Slab: `tilesX = tilesY = 1`, `kernelRadius = 3`, `D % 4 = 0`,
  `4 <= D <= 32`, `W % 8 = H % 8 = 0`, `N <= 2^24` (all enforced by `validateConfig`).
- **Index and axes.** `i = z*WH + y*W + x`. `x` grows east, `y` grows south, **`z` grows downward: layer 0 is the surface (light enters
  here), layer `D - 1` is the floor.** "Direction +z" means towards the floor. A positive displacement, motility byte, gradient, or `MZ`
  means towards larger index on that axis. x and y wrap within the single tile; z does not wrap.
- **Outside.** A z coordinate outside `[0, D)` is *outside*. CPU `nb3` returns `-1` for an outside neighbour; WGSL `nb3` returns the constant
  `OUTSIDE = 0xffffffffu`. Index `0xffffffff` can never be a valid cell (`N <= 2^24`). Every pass below states what it does with outside;
  no pass may read a buffer at an outside index. x and y neighbours are `(x + dx + W) % W` and `(y + dy + H) % H` (one tile, so 2D's
  `tx/ty` arithmetic in `nb` is dropped).
- **State layout** (`world3.ts`, M0): channel-major, `cells[ch*N + i]` with `CH.A..CH.MOT = 0..6`; `genome[g*N + i]` with
  `GENOME_CHANNELS3 = 49` words (`G.LIN_HI=0, LIN_LO=1, PARAM0=2, PARAM1=3, W0=4`, 45 weight words, 177 int8 weights packed little-endian
  by byte, bytes 177..179 are zero padding). `PARAM0 = mu | sigma << 16`; `PARAM1 = motGain` only (bytes 1..3 are zero in a slab).
  `MOT` packs three biased bytes `(mx+128) | (my+128) << 8 | (mz+128) << 16` (`packMot3`, `MOT_ZERO3 = 0x808080`).
- A cell is *living* iff `(LIN_HI | LIN_LO) != 0`.
- RNG: `cellBase(seed, step, i)` and `draw(base, k)` of `int.ts` (`shaders.ts` `cell_base`, `draw`), `k` taken from `RND3` (`layout3d.ts`):
  `LOTTERY 0`; `DIFF + 3*d + sp` for `d = 0..5`, `sp = 0 (A), 1 (C), 2 (S)` at slots 1..18; `DIFF_ROT 19`; slots 20..39 as 2D
  (`PHOTO 20 ... GENE_FLIP 39`; `INJURY`, `GENE`, `GENE_FLIP` are never drawn in a slab). `step` is the state's step **before** the
  increment; `i` is the slab linear index.

## 1. What is shared and what is new

Reused **verbatim** (same TS function on the CPU, same WGSL function on the GPU):

| primitive | CPU | WGSL |
|---|---|---|
| `lowbias32`, `cellBase`, `draw`, `mulFrac`, `mulShr`, `addu/subu/mulu/divu/divi/clampi` | `int.ts` | `shaders.ts` `lowbias32`, `cell_base`, `draw`, `mul_frac`, `mul_shr` (COMMON, 202-228) |
| `growth(u, mu, sigma)` | `step.ts:756-765` | affinity shader `growth` (349-360) |
| `w1d(d, o, hw)` | `step.ts:782-787` | transport shader `w1d` (468-473), with `HW`; the slab shader keeps it as is |
| `mulShareD(q, w, d2)` | `step.ts:789-791` | transport shader `share` (474-476), with the divisor as a parameter instead of the constant `D2` |
| `cat(B, K)` | `step.ts:797-805` | react shader `cat` (662-669) |
| `mutationThreshold(newB, mutCap, mutRate)` | `step.ts:752-754` | react shader inline at the mutation site (`MUT_CAP`) |
| `motilityTerm(byte, gain)` | `world.ts:87` | flow shader inline (`((byte - 128) * gain) / 256`) |
| `sat`, `cap24` | `step.ts:539-540` | react shader `sat`, `cap24` (670-671) |
| ledger/flux/heat/light/roles bookkeeping | `step.ts:476-495, 692-701` | react shader `hadd`, `wg_add`, `add_hi`, `add64`, the workgroup epilogue (649-686, 932-948) |
| `tick` pass | `RefSim.step` increments `state.step` | `tickShader` (951) |
| season triangle of `light()` | `step.ts:177-181` | `light_at` season block (267-272) |

New for the slab (names fixed so the golden cases and tests can import them):

| new | CPU (`step3d.ts`) | WGSL (`shaders3d.ts`) | defined in |
|---|---|---|---|
| `nb3`, `OUTSIDE` | `nb3(x,y,z,dx,dy,dz)` | `nb3` | §0 |
| 3D Sobel | `sobel3` | inline in the flow shader | §6 |
| 3-axis nested share | `share3` | `share3` | §7.1 |
| 27-source gather | in `transport3` | transport shader main | §7 |
| six-direction diffusion out | `diffOut6` | `diff_out6` | §7.3 |
| shaded light column | `lightColumn` (the light pass) | `lightShader3` | §8 |
| surface light | `lightSurface(x, y, step)` | `light_surface` | §8 |
| 11 -> 8 -> 9 forward | `controllerForward3` | react shader inline loops | §9.3 |
| slab mutation | `mutateInPlace3` | react shader `mutate` | §9.6 |
| prelude | constants of `RefSim3` | `prelude3(c)`; 2D's `prelude` is not edited | §2 |

2D files are not edited. `RefSim3` and `GpuSim3` expose the same surface as `RefSim`/`GpuSim` (`step()`, `run()`, `state`, `affinityField`,
`roles`; `create`, `upload`, `run`, `readState`, `readSnapshot`, `readStats`, `readRoles`, `readCells`, `readGenomeChannels`, `drainLedger`,
`probe`, `currentGenome`, `destroy`), except that 2D's `lesion`, `feed` and `setLight` are not defined for a slab in v1. The `profile` hook is
kept and times six passes: affinity, flow, transport, light, react, tick.

## 2. Constants derived from the config

All are compile-time constants in the WGSL prelude (the `prelude(c)` pattern of `shaders.ts:51-200`, extended with the slab names) and plain
fields in `RefSim3`. `c` is the config.

| name | value |
|---|---|
| `N, W, H, D, WH` | §0 |
| `HW` | `32 + c.spread` |
| `D1` | `2*HW` (at most 128; replaces 2D's `D2 = 4*HW^2`) |
| `DMAX` | `64 - c.spread` (per axis) |
| `MASS_DIV` | `8 * c.massUnit` |
| `KSUM, KN, taps` | `buildKernel3(3)`: `KN = 92`, `KSUM = 9624`; taps `(dx,dy,dz,w)` in the order of `kernel3d.ts` (z outermost, then y, then x) |
| `POOL_MAX3` | `2^27` |
| `MCAP` | `16383` |
| `NN_BYTES3, NN_WORDS3` | `177, 45`; `W1_OFF3 = 0`, `B1_OFF3 = 88`, `W2_OFF3 = 96`, `B2_OFF3 = 168` |
| `MUT_CAP` | `mutRate == 0 ? 0 : floor((2^32 - 1) / mutRate)` |
| `LIGHT_K` | `c.lightK` |
| `REF` (neutral only) | the 49 words of `encodeGenome3(generalistGenome3(defaultMu, defaultSigma), 0, 0)`; on the GPU `REF_W` is its 45 weight words and `REF_PARAM1` is its `PARAM1` word (the `shaders.ts:191-193` pattern) |

Not compiled in (excluded by `validateSlab`): takeover, injury, shape rings, genes, adhesion, wander and day period, ring namespace. The
corresponding branches do not exist in the slab shaders.

## 3. Buffers and one step's schedule

CPU: `RefSim3` keeps `state.cells` (7N), `cellsB` (7N scratch), `state.genome` (49N), `genomeB` (49N scratch, zero-initialised), `U` (Int32, N),
`disp` (Uint32, N), `Lbuf` (Uint32, N), `roles` (2N). The buffer swap after transport is the 2D one (`step.ts:466-473`): `state.cells` becomes
`out`, `state.genome` becomes `gout`, the old arrays become the scratch; react then writes into the scratch `cells` and swaps again (`step.ts:696-699`).

The `RefSim3` constructor, like `RefSim`'s (`step.ts:111-113`), refuses a non-slab config and runs `validateState` (the slab path of M0: pool caps 2^27, 49-word genome, reserved
bytes zero) before it accepts a state; `GpuSim3.create` and `upload` do the same (§10).

One step is, in this order, each pass reading only what the previous passes finished:

1. **affinity**: reads `cells`, `genome` (pre-transport); writes `U`.
2. **flow**: reads `cells`, `genome`, `U`; writes `disp`.
3. **transport**: reads `cells`, `genome`, `disp`; writes `cells'` (all 7 channels), `genome'` (see §7.2).
4. **light** (new): reads `cells'` (`B`, `P` after transport); writes `Lbuf`.
5. **react**: reads `cells'`, `genome'`, `U`, `Lbuf`; writes `cells''` (all 7 channels), mutates `genome'` in place, writes `roles`, the
   ledger, the events.
6. **tick**: `state.step += 1`; the ledger-overflow check of `step.ts:192-193`.

`MAX_STEP` check at the top of `step()` as 2D (`step.ts:186`).

## 4. Pass 1: affinity (as `step.ts:218-261`, `shaders.ts` `affinityShader`, no shape branch)

For every cell `(x, y, z)`:

- `mass(j) = min(B[j] + P[j], 16383)` (`step.ts:203-207`; `B + P` cannot wrap because total matter is at most 2^26).
- `conv = sum over the 92 taps (dx,dy,dz,w) of w * M(x+dx, y+dy, z+dz)` where `M` of a tap whose z is outside is **0**, and x, y wrap. The sum is
  exact integer arithmetic, so tap order does not matter.
- `uq = divu(conv, 9624)` (the **full** weight sum, also at walls: a wall cell sees what it would see next to empty water).
- `u = min(divu(mulu(uq, 1024), massUnit), 4095)`.
- `mu, sigma`: if `cfg.neutral` or the cell is not living: `defaultMu`, `defaultSigma`; otherwise `PARAM0 & 0xffff` and `PARAM0 >>> 16`
  of the cell's own genome. Then `mu = min(mu, 4095)`, `sigma = clamp(sigma, 1, 1023)`.
- `U[i] = growth(u, mu, sigma)` (an i32 in `[-256, 256]`).

Differences from 2D: 92 taps in 3D, the z-outside rule, the unrolled 2D loop becomes a 3D one, nothing else.

**GPU shape (the timed one, rung 1a re-rule).** `@workgroup_size(8, 8, 4)`, block 1 (one cell per thread), one workgroup-shared declaration:
`var<workgroup> sm: array<u32, 1960>` = `(8+6) * (8+6) * (4+6)` words = 7,840 bytes (checked: 14*14*10 = 1960). Constants `SWX = 14, SWY = 14,
SWZ = 10, SMN = 1960`. Dispatch `(W/8, H/8, D/4)`; the workgroup at `wid` covers `ox = 8*wid.x`, `oy = 8*wid.y`, `oz = 4*wid.z`. Halo
load, exactly the loop of `experiments/3d-bench/shader3d.ts:108-117` with one change (zero fill instead of z wrap):
`for k = li; k < SMN; k += 256`: `tx = k % 14`, `ty = (k / 14) % 14`, `tz = k / 196`; `gx = (ox + tx + W - 3) % W`, `gy = (oy + ty + H - 3) % H`;
`gz = i32(oz + tz) - 3`; if `gz < 0 || gz >= D` then `sm[k] = 0`, else `j = (gz*H + gy)*W + gx` and `sm[k] = min(cells[CH_B + j] + cells[CH_P + j], 16383)`.
Then `workgroupBarrier()`. Thread base `b = ((lid.z + 3)*14 + (lid.y + 3))*14 + (lid.x + 3)`. Each of the 92 taps is a fully unrolled
`conv += w * sm[b + (dz*14 + dy)*14 + dx]` with compile-time offsets (the bench's unrolled-tap loop with `Bk = 1`). The workgroup grid covers the world
exactly (`W % 8 = H % 8 = 0`, `D % 4 = 0`), so no bounds guard is needed; one is allowed. Any wider tile re-opens the Deno single-declaration
question (plan §6, M2).

## 5. The z walls, pass by pass

| pass | what happens where a z neighbour or target is outside |
|---|---|
| affinity | tap mass 0; the sum is still divided by the full 9624 |
| flow | the stencil tap reads the same `(x+a, y+b)` column at the cell's own layer (clamp, §6) |
| transport | no such source (lot 0, never wins); no such target (its share stays with the source) |
| diffusion | no such direction (not sent, no inflow); the portion stays with the source |
| light | layer 0 has no cell above and takes the surface light; nothing below layer `D-1` |
| react sensors | SGZ: the missing neighbour reads the cell's own capped S |

## 6. Pass 2: flow (as `step.ts:263-313`, `shaders.ts` `flowShader`)

For every cell compute, with `M(j) = mass(j)` as in §4 and `U` from pass 1:

- **Wall reading (open choice 1).** For a neighbour offset `(a, b, c)` of a field `f` (`f = U` or `f = M`) define
  `F(a,b,c) = f( wrapx(x+a), wrapy(y+b), clampz(z+c) )` with `clampz(v) = min(max(v, 0), D-1)`. So at a wall the missing plane is replaced by the
  cell's own layer, the same `(x+a, y+b)` column: replicate (Neumann) padding.
- Smoothing weights `s(-1) = 1, s(0) = 2, s(+1) = 1`. The 27-point Sobel numerators:
  - `Gx = sum over b,c in {-1,0,1} of s(b)*s(c) * (F(+1,b,c) - F(-1,b,c))`
  - `Gy = sum over a,c of s(a)*s(c) * (F(a,+1,c) - F(a,-1,c))`
  - `Gz = sum over a,b of s(a)*s(b) * (F(a,b,+1) - F(a,b,-1))`

  The total absolute weight per side is 16, so `|G| <= 16 * range` for a field in `[0, range]` (mass) and `|G| <= 32 * 256` for the signed `U` in `[-256, 256]` (the difference spans both sides). Then `g = divi(G, 4)` (truncation toward zero, in WGSL `G / 4` on i32). The
  scale is 2D's: for a linear ramp `f = a*x`, 2D gives `8a` and `divi(32a, 4) = 8a`. Call the results `gUx, gUy, gUz, gMx, gMy, gMz`
  (`|gU| <= 2048 = 8*256`, `|gM| <= 4*16383` after the division; the slab's `gU` bound is twice 2D's `4*256` because the 3D smoothing is 16 per side against 4).
- `Mi = M(i)`; `alpha = Mi >= thetaMass ? 256 : divu(mulu(mulu(Mi, Mi), 256), mulu(thetaMass, thetaMass))`.
- For each axis `a in {x, y, z}`: `Fa = divi((256 - alpha) * gUa, 2048) - divi(alpha * gMa, massDiv)`; `da = divi(dtQ * Fa, 1024)`.
- If `cfg.motility` is not `false` and the cell is living: `gain = (neutral ? REF_PARAM1 : PARAM1[i]) & 0xff`, `mot = cells[MOT][i]`;
  `dx += motilityTerm(mot & 0xff, gain)`, `dy += motilityTerm((mot >>> 8) & 0xff, gain)`, `dz += motilityTerm((mot >>> 16) & 0xff, gain)`,
  with `motilityTerm(byte, gain) = divi((byte - 128) * gain, 256)`.
- `da = clamp(da, -DMAX, DMAX)` for each axis.
- `disp[i] = (dx + 64) | (dy + 64) << 8 | (dz + 64) << 16` (u32; each byte is in `[spread, 128 - spread]`).

Differences from 2D: a third axis, a 27-point stencil with the `/4` rescale, clamp-z walls, an MZ byte at bits 16..23. Adhesion is excluded. On the
GPU each stencil tap reads `m(j) = min(cells[CH_B + j] + cells[CH_P + j], 16383)` (`shaders.ts:410`) and `U[j]`.

## 7. Pass 3: transport

Source enumeration, one index `k` per `(ox, oy, oz)` offset of a source from the target `t`:
**`k = (oz + 1)*9 + (oy + 1)*3 + (ox + 1)`, `k = 0..26`** (oz outermost, then oy, then ox innermost; 2D's `k` is `(oy+1)*3 + (ox+1)` in the
same nesting). A source is `s_k = t + (ox, oy, oz)` with x, y wrapped; if `z + oz` is outside, source `k` does not exist: `s_k = OUTSIDE`
(`-1` on the CPU), `lot[k] = 0`, `shB[k] = shP[k] = shE[k] = 0`, no read of `disp` or `cells` at it. The genome lottery scans `k = 0..26` in increasing order;
absent sources add 0 to the cumulative sum, so they can never win.

### 7.1 Matter shares (B, P, E)

Constants `hw = HW`, `D1 = 2*hw`. For a source `s` with displacement `(dx, dy, dz)` unpacked from `disp[s]` (each byte `- 64`) define the
per-axis weights `wa(o) = w1d(da, o, hw)` for `a in {x,y,z}`, `o in {-1, 0, 1}` (each in `[0, D1]`, and `sum over o of wa(o) = D1` because
`|da| + hw <= 96`). Compute these nine numbers once per source.

`share3(q, wx, wy, wz) = mulShareD(mulShareD(mulShareD(q, wx, D1), wy, D1), wz, D1)` in this fixed **x then y then z** order, where
`mulShareD(q, w, d) = mulu(divu(q, d), w) + divu(mulu(q % d, w), d)` (the split form; it equals `floor(q*w/d)` exactly for `w <= d <= 2^14`).
The split form is **mandatory**: `q*w` alone overflows u32 for `E` near 2^27 and `w` up to 128. The nested floors are not the floor of the
product; that is the rule, and it is what both sides compute.

For target `t` and source `k` with offset `(ox, oy, oz)` and displacement `(dx, dy, dz)` of `s_k`, for each of the three species `q in {B[s], P[s], E[s]}`:

- **k is the centre (ox = oy = oz = 0)**: *stay* `= q - (sum over the targets at offset (tx, ty, tz) != (0,0,0) from the source, with z + tz in range, of share3(q, wx(tx), wy(ty), wz(tz)))`,
  computed with `subu`, which cannot wrap because the shares sum to at most `q` (§12). Targets outside in z are **not** subtracted: their shares stay with the
  source. A target is skipped when any of its three weights is 0 (its share is 0).
- **otherwise**: share `= share3(q, wx(-ox), wy(-oy), wz(-oz))`: the offset from source to target `t` is `-(ox, oy, oz)`.

The receiver recomputes exactly the `share3` arguments the sender used for its stay, so `sum over all targets of (what is sent) + stay = q`
exactly, for every cell and species; this is the conservation argument of the plan, carried over. The target accumulates
`inB = sum_k shB[k]`, `inP = sum_k shP[k]`, `inE = sum_k shE[k]` (u32, no wrap: §12) and `lot[k] = shB[k] + shP[k]`.
It writes `cells'[B] = inB`, `cells'[P] = inP`, `cells'[E] = inE`.

The evaluation structure is free (hoist the nested products, skip zero weights, compute the x-then-y product once and reuse it across z) as long as
every value equals the formula above.

### 7.2 Genome lottery and MOT (as `step.ts:380-441` without the `lossy` branch)

`T = inB + inP`. There is **no takeover** in a slab, so `waste = 0` always and the `+ waste` term on `C` in §7.3 does not exist.

- `T == 0`: `genome'[LIN_HI][t] = 0`, `genome'[LIN_LO][t] = 0`, `cells'[MOT][t] = MOT_ZERO3`.
- else: `r = draw(cellBase(seed, step, t), RND3.LOTTERY) % T`; scan `k = 0..26` with `cum += lot[k]` and pick the first `k` with `cum > r`
  (`cum` is u32 and never wraps since `cum <= T`). Let `s = s_win`, `(hi, lo) = (LIN_HI[s], LIN_LO[s])` read from the pre-transport `genome`.
  - Genome copy: if `genome'[LIN_HI][t] != hi || genome'[LIN_LO][t] != lo || (hi | lo) == 0`, copy **all 49 words** `genome'[g][t] = genome[g][s]`.
    Otherwise do nothing. This is the 2D skip (`step.ts:403-404`, transport shader `main`); it is not observable (a lineage id names one genome),
    so an implementation may copy unconditionally; the stateHash must not change either way. Words of a cell without lineage are don't-care
    (`canonicalGenome(genome, 49)`).
  - `cells'[MOT][t] = cells[MOT][s]` (all three packed bytes).

### 7.3 Diffusion of A, C and S (as `step.ts:443-465`, `diffOut` at 807-811)

Directions `d = 0..5` are `+x, -x, +y, -y, +z, -z`; `d ^ 1` is the opposite direction. The neighbour of `t` in direction `d` is `nbs[d]`
(x, y wrapped; **absent when the direction leaves `[0, D)` in z**: `d = 4` at `z = D-1`, `d = 5` at `z = 0`). For `sp = 0, 1, 2` (A, C, S) with
channel `ch`, base rate `Dsp = diffA, diffC, diffS`, gated for `sp < 2`:

- `v = cells[ch][t]` (pre-transport value).
- for `d = 0..5` with `nbs[d]` present:
  - `Pt = cells[P][t]`, `Pn = cells[P][nbs[d]]` (pre-transport, uncapped, as 2D). `De = sp < 2 ? divu(mulu(Dsp, gateK), addu(addu(gateK, Pt), Pn)) : Dsp`.
  - `v = subu(v, diffOut6(cells[ch][t], d, De, cellBase(seed, step, t), sp))`.
  - `v = addu(v, diffOut6(cells[ch][nbs[d]], d ^ 1, De, cellBase(seed, step, nbs[d]), sp))`.
- `cells'[ch][t] = v` (for `sp = 1` no waste is added).

`diffOut6(q, d, De, baseS, sp)`, where `baseS` is always the **sender's** `cellBase` (the receiver recomputes it; both sides call this with identical
arguments):

- `rot = draw(baseS, RND3.DIFF_ROT) % 6` (u32 remainder). **Differs from 2D**, which uses `baseS >>> 30` (open choice 3). `rot` depends only on the sender, so compute it once per
  cell per step.
- `portion = divu(q, 6) + (((d + rot) % 6) < (q % 6) ? 1 : 0)`. Because `(d + rot) % 6` runs over 0..5 as `d` does, the six portions sum to `q`
  exactly. Example: `q = 14, rot = 4`: portions for `d = 0..5` are `2, 2, 3, 3, 2, 2`.
- return `mulFrac(portion, De * 4, 10, draw(baseS, RND3.DIFF + d*3 + sp))`. With `De <= 256`, `De*4 <= 1024`, the result never exceeds `portion`
  (when `De*4 = 1024` the low part is exact and nothing rounds up), so `v` cannot underflow and the six outflows total at most `q`.

A portion aimed outside in z is never sent and stays with its source; there is no inflow from outside. The expected total leaving a cell is
`q*De/256`, as in 2D, spread over six directions instead of four (open choice 9).

Dissolved species `A, C, S` are not moved by displacement; only `B, P, E` and the genome are.

## 8. Pass 4: light (new)

One value per cell into `Lbuf`, computed once per step from the cells **after transport** (`cells'`), before react.

For each column `(x, y)`:

1. **Surface** `L0 = lightSurface(x, y, step)` where `step` is the pre-increment step: it is `RefSim.light` (`step.ts:152-181`) restricted to the two modes a
   slab admits, with `lx = x`, `ly = y` (one tile):
   - `L = lightBase`;
   - `uniform`: `L += lightAmp`; `gradient`: `L += divu(mulu(lightAmp, y), tileH - 1)`;
   - if `seasonPeriod > 0`: `ph = divu(mulu(step % seasonPeriod, 512), seasonPeriod)`, `tri = |ph - 256|`, `L += (seasonAmp * tri) >> 8`;
   - `L = clamp(L, 0, 255)`.
2. `Lbuf[y*W + x] = L0` (the cell `(x, y, 0)`).
3. For `z = 1 .. D-1`, with `m = min(B'[above] + P'[above], 16383)` of the cell **directly above**, `above = (x, y, z-1)` (post-transport values) and
   `T(m) = divu(mulu(256, lightK), addu(lightK, m))`:
   `L(x,y,z) = (L(x,y,z-1) * T(m)) >> 8`.
   A cell does not shade itself. `T(0) = 256`, so empty water is lossless. Example, `lightK = 1024`: `m = 1024` gives `T = 128`, `m = 3072` gives
   `T = 64`; from `L = 240`, one layer under `m = 1024` gives `L = 120`.

Bounds: `L <= 255`, `T <= 256`, product `< 2^16`; `256 * lightK <= 2^24`.

`Lbuf` is derived each step and is never part of the state. Dead cells get a value too (abiotic recycling uses it).

**GPU shape.** A separate pass `lightShader3(c)`, `@workgroup_size(8, 8, 1)`, dispatch `(ceil(W/8), ceil(H/8), 1)`, one thread per column; the thread
walks `z = 0..D-1` keeping the running `L` in a register. Bindings: `0` cells' (`c1`) read, `1` `Lbuf` read_write (`array<u32>` of `N` words),
`2` ledger read (`ctrl`, for `step`, as the transport shader reads it). Reads are `cells[CH_B + j] + cells[CH_P + j]` with `j = (z*H + y)*W + x`.

## 9. Pass 5: react (as `step.ts:475-703`, `shaders.ts` `reactShader`)

Per cell `i`: `base = cellBase(seed, step, i)`; `A, B, C, P, E, S` from `cells'`; `L = Lbuf[i]`; `living` from `genome'`; `mot = MOT_ZERO3`;
`heat = 0`; `lightIn = 0`; `newB = 0`; `F[] = 0`. Cells are independent (react reads only post-transport values and its own genome).

### 9.1 Pool caps

At cell load: `if E > POOL_MAX3 { heat += E - POOL_MAX3; E = POOL_MAX3 }`, the same for `S`. The same cap-with-heat is applied at exactly the other
places 2D applies `POOL_MAX` (`step.ts:521-529, 571-575, 586-590, 607-611`): after respiration (`E`), after decomposition (`E`), after
emission (`S`). That is five sites, all with `POOL_MAX3`. Growth, build and cost never raise `E`.

### 9.2 Sensors (only if `living && B > 0`)

Weights: if `neutral` the 177 bytes of `REF`, else the cell's 45 weight words, bytes sign-extended (`byte > 127 ? byte - 256 : byte`).
`cap24(v) = min(v, 0xffffff)`, `sg = signalGain ?? 1`. Neighbour cells of `(x,y,z)`: east `x+1`, west `x-1`, south `y+1`, north `y-1` (wrapping);
below `z+1`, above `z-1`; **an outside one reads the cell's own `cap24(S[i])`** (so at the surface `SGZ = cap24(S below) - cap24(S[i])`). `S[.]`
here is the post-transport value, before this cell's own pool cap, as 2D reads `cells[CH.S]` for neighbours (`step.ts:541-544`).

| input | formula |
|---|---|
| `x[0..3]` | `sat(A >> 2)`, `sat(B >> 2)`, `sat(C >> 2)`, `sat(P >> 2)` (`sat(v) = min(v, 127)`) |
| `x[4]` EPB | `sat(divu(mulu(cap24(E), 16), addu(B, 1)))` |
| `x[5]` LIGHT | `L >> 1` |
| `x[6]` S | `sat(S >> 2)` (the cell's own S after the §9.1 cap) |
| `x[7]` SGX | `clamp(divi(muli(Se - Sw, sg), 4), -127, 127)` |
| `x[8]` SGY | `clamp(divi(muli(Ss - Sn, sg), 4), -127, 127)` |
| `x[9]` U | `clamp(divi(U[i], 2), -127, 127)` |
| `x[10]` SGZ | `clamp(divi(muli(Sbelow - Sabove, sg), 4), -127, 127)` |

(`Se, Sw, Ss, Sn, Sbelow, Sabove` are the capped neighbour values.)

### 9.3 Controller `controllerForward3` (11 -> 8 -> 9)

Weights `wb` int8, `NN_BYTES3 = 177`; bytes 177..179 are never read.
- `h[j] = clamp(divi(acc, 128), 0, 127)` with `acc = wb[88 + j]*128 + sum over k = 0..10 of wb[k*8 + j] * x[k]` for `j = 0..7`.
- `o[k] = clamp(divi(acc, 128), -127, 127)` with `acc = wb[168 + k]*128 + sum over j = 0..7 of wb[96 + j*9 + k] * h[j]` for `k = 0..8`.
- `r(k) = max(o[k], 0)`; `OUT3`: `PHOTO 0, RESP 1, DECOMP 2, GROW 3, BUILD 4, EMIT 5, MX 6, MY 7, MZ 8`.
- `mot = packMot3(o[6], o[7], o[8]) = (o[6] + 128) | (o[7] + 128) << 8 | (o[8] + 128) << 16` (each byte in 1..255).

`|acc|` is at most `128*128 + 11*128*127`, far inside i32. Genes are excluded: the decomposition and build gates are always on, so the work sum below always
includes `r(2)` and `r(4)`.

### 9.4 Reactions (order and draws; `cat(B)` always means `cat(B, kCatHalf)` of the **current** `B`)

1. Photosynthesis: `t = mulShr(cat(B), r(PHOTO), 7); t = mulShr(t, L, 8); q = min(A, mulFrac(t, kPhoto, 12, draw(base, PHOTO)))`;
   `A -= q; B += q; newB += q; F.photo = q; lightIn = q*(eB - eA)`.
2. Respiration: `t = mulShr(cat(B), r(RESP), 7); q = min(B, mulFrac(t, kResp, 12, draw(base, RESP)))`; `B -= q; C += q; E += q*(eB - eC); F.resp = q`; cap `E`.
3. Decomposition: `t = mulShr(cat(B), r(DECOMP), 7); q = min(C, mulFrac(t, kDecomp, 12, draw(base, DECOMP)))`; `C -= q; A += q; E += q*(eC - eA); F.decomp = q`; cap `E`.
4. Growth: `g = eB - eA`; `t = mulShr(cat(B), r(GROW), 7); q = min(A, divu(E, g), mulFrac(t, kGrow, 12, draw(base, GROW)))`; `A -= q; B += q; E -= q*g; newB += q; F.grow = q`.
5. Build: `g = eP - eB`; `t = mulShr(cat(B), r(BUILD), 7); q = min(B, divu(E, g), mulFrac(t, kBuild, 12, draw(base, BUILD)))`; `B -= q; P += q; E -= q*g; F.build = q`.
6. Emit: `t = mulShr(cat(B), r(EMIT), 7); q = min(E, mulFrac(t, kEmit, 12, draw(base, EMIT)))`; `E -= q; S += q; F.emit = q`; cap `S`.
7. Cost: `sumr = r(0)+r(1)+r(2)+r(3)+r(4)+r(5)`; `t = mulShr(cat(B), sumr, 7)`; `cost = mulFrac(t, kCost, 16, draw(base, COST)) + mulFrac(B, kMaint, 16, draw(base, MAINT))`.
   If `E >= cost`: `E -= cost; heat += cost`. Else `deficit = cost - E; heat += E; E = 0; q = min(B, deficit); B -= q; C += q; F.starve = q; heat += q*(eB - eC)`.
8. Mutation (§9.6): if `newB > 0 && MUT_CAP > 0`: `p = newB > MUT_CAP ? 2^32 - 1 : mulu(newB, mutRate)`; if `draw(base, MUT) < p` the cell mutates.

Each step is `step.ts:560-648` and the `shaders.ts` react `main` unchanged, apart from `r(OUT.*)` coming from the 9-output net, `POOL_MAX3`, and the gene
gates being constant true.

### 9.5 Passive processes (all cells, living or not; `step.ts:650-672`)

`q = mulFrac(P, kPDecay, 16, draw(base, PDECAY)); P -= q; C += q; heat += q*(eP - eC); F.pdecay = q`;
`q = mulFrac(B, kBDecay, 16, draw(base, BDECAY)); B -= q; C += q; heat += q*(eB - eC); F.bdecay = q`;
`q = mulFrac(E, kELeak, 16, draw(base, ELEAK)); E -= q; heat += q`;
`q = mulFrac(S, kSDecay, 16, draw(base, SDECAY)); S -= q; heat += q`;
`t = mulFrac(C, L, 8, draw(base, ABIO1)); q = min(C, mulFrac(t, kAbio, 16, draw(base, ABIO2))); C -= q; A += q; heat += q*(eC - eA); F.abio = q`.
The `L` here is the shaded `Lbuf[i]`, so recycling slows with depth. The injury block of 2D does not exist.

Then, `if living && B == 0 && P == 0`: `LIN_HI = LIN_LO = 0` (the other genome words stay as don't-care). Write `A, B, C, P, E, S, mot` to `cells''`.
`mot` is `MOT_ZERO3` for every cell that did not run the controller (dead, or `B == 0`).

### 9.6 Mutation `mutateInPlace3` and lineage (as `mutateInPlace`, `step.ts:841`, and `shaders.ts` `mutate` 688-721)

On a mutation event: `parent = (LIN_HI, LIN_LO)` of the cell; then `mutateInPlace3(i, which = draw(base, MUT_WHICH), deltaRnd = draw(base, MUT_DELTA))`
(both draws are taken only on an event, as in 2D); then `LIN_HI = (step + 1) >>> 0`, `LIN_LO = i` (`packLineageLo` is the identity: no ring namespace, and
`i < N <= 2^24`); the event `(childHi = step + 1, childLo = i, parentHi, parentLo)` is recorded.

`mutateInPlace3`:
- `slot = which % 180` (`NN_BYTES3 + 3`, u32 remainder).
- `delta = (deltaRnd % (2*mutStep + 1)) - mutStep; if delta == 0 then delta = 1`.
- `slot < 177`: weight byte `slot`: word `W0 + (slot >> 2)`, shift `(slot & 3)*8`; `v = clamp(int8(byte) + delta, -127, 127)`; write the byte back.
- `slot == 177`: `mu = clamp((PARAM0 & 0xffff) + delta, 16, 4095)`; `PARAM0 = (PARAM0 & 0xffff0000) | mu`.
- `slot == 178`: `sd = delta >> 2` (arithmetic shift); if `sd == 0` then `sd = delta > 0 ? 1 : -1`; `sigma = clamp((PARAM0 >>> 16) + sd, 2, 1023)`; `PARAM0 = (PARAM0 & 0xffff) | sigma << 16`.
- `slot == 179`: `gain = clamp((PARAM1 & 0xff) + delta, 0, 255)`; `PARAM1 = (PARAM1 & 0xffffff00) | gain`.
- No ring branch and no gene flip. The three padding bytes (word 48, bytes 1..3) are not mutation targets and stay 0. In a neutral run the genome still mutates and
  keeps its lineage; expression uses `REF`.

### 9.7 Accounting (as 2D)

Per cell: `lightIn` and `heat` as above, `F[10]` fluxes (`FLUX_NAMES` order: photo, resp, decomp, grow, build, emit, starve, pdecay, bdecay, abio), roles words
`roles[2i] = sat16(F.photo) | sat16(F.grow) << 16`, `roles[2i+1] = sat16(F.decomp) | sat16(F.resp) << 16` with `sat16(v) = min(v, 65535)`. Ledger
totals are 64-bit sums over all cells (CPU: BigInt, with the `heatAcc` double spill at 2^50 of `step.ts:687-690`; GPU: per-thread 64-bit `(lo, hi)` heat, per-workgroup
`(lo, hi)` accumulators `wg_add`, then `add64`). Energy conservation closes exactly: `sum (eA*A + eB*B + eC*C + eP*P) + E + S + heatOut - lightIn` is constant, and
`A + B + C + P` is constant.

Events: the CPU pushes in increasing `i`; the GPU appends in arbitrary order (`atomicAdd` slot) and `drainLedger` sorts by `(childHi, childLo)`. With every
event of one step sharing `childHi` and `childLo = i`, the sorted GPU list equals the CPU list. Counters saturate as 2D (the event block of the react shader).

## 10. GPU: buffers, bindings, dispatch (`gpu-sim3.ts`)

`requestDevice(gpu, cfg)` computes its per-buffer need from `cellCount(cfg) * GENOME_CHANNELS * 4` (44 words). `GpuSim3` must use `genomeChannels(cfg)` = 49
(`49*524288*4 = 102.8 MB` at 256 x 256 x 8) through a slab-aware copy of `requestDevice` (do not edit the 2D one).

Buffers: `cells[2]` (7N words each; `cells[0]` is always the current state, `cells[1]` is the transport output), `genome[2]` (49N each; ping-pong with the
index `gcur`, as 2D), `U` (N i32), `disp` (N u32), `light` (N u32, new), `ledger` (`LEDGER_WORDS`), `events` (`eventCap*4` words), `roles` (2N), `stats`.
`upload(state)`: `validateState` (the slab path), write `cells[0]`, write **both** genome buffers with `state.genome`, write the ledger words
(step, light, heat, flux) as `gpu-sim.ts` `upload`. `cells[1]`, `U`, `disp`, `light` need no initialisation: every word is written before it is read in a step.

Passes per step with `p = gcur`, all in one compute pass, in this order. `maxStorageBuffersPerShaderStage` is requested at most 10; react uses 8.

| pass | pipeline | bindings (index: buffer, access) | workgroup | dispatch |
|---|---|---|---|---|
| affinity | `affinityShader3` | 0: `cells[0]` r; 1: `genome[p]` r; 2: `U` rw | `(8,8,4)` | `(W/8, H/8, D/4)` |
| flow | `flowShader3` | 0: `cells[0]` r; 1: `genome[p]` r; 2: `U` r; 3: `disp` rw | `(8,8,4)` | `(W/8, H/8, D/4)` |
| transport | `transportShader3` | 0: `cells[0]` r; 1: `genome[p]` r; 2: `disp` r; 3: `cells[1]` rw; 4: `genome[1-p]` rw; 5: `ledger` r (step) | `(8,8,4)` | `(W/8, H/8, D/4)` |
| light | `lightShader3` | 0: `cells[1]` r; 1: `light` rw; 2: `ledger` r | `(8,8,1)` | `(ceil(W/8), ceil(H/8), 1)` |
| react | `reactShader3` | 0: `cells[1]` r; 1: `genome[1-p]` rw; 2: `U` r; 3: `cells[0]` rw; 4: `ledger` atomic rw; 5: `events` rw; 6: `roles` rw; 7: `light` r | `(8,8,4)` | `(W/8, H/8, D/4)` |
| tick | `tickShader()` (2D's, unchanged) | 0: `ledger` rw | 1 | 1 |

Every per-cell shader reads `x = gid.x, y = gid.y, z = gid.z`, tests `x >= W || y >= H || z >= D`, and computes `i = (z*H + y)*W + x`. The guard is vacuous for
valid configs but kept so the dispatch shape can change. In react, as 2D, the workgroup epilogue (`wg_add`, `workgroupBarrier`, the `lid == 0` and
`lid <= FLUX_N` lanes) runs for every thread, so the guard wraps only the cell block, not the barrier (`shaders.ts:740-748, 932-948`). With 256 threads per workgroup the 11 flux lanes fit.

WGSL helper `nb3(x, y, z, dx, dy, dz) -> u32` returns `OUTSIDE` when `i32(z) + dz` is outside `[0, D)`; each shader that can see an outside neighbour tests
`!= OUTSIDE` before any buffer read. Index products `ch*N + i <= 49 * 2^24 < 2^32`.

`readStats` uses a slab `statsShader3` (the accumulators of `shaders.ts:1005`, per-cell index `i`, dispatch like the cell passes): sums of
`A, B, C, P, E, S`, the living count, and the dense count (`B + P >= 64`). `readSnapshot`, `readState`, `readRoles` and `probe` copy buffers of the new sizes; the
genome head for censuses stays words `0..3` (`n*4` words), `readState` and `probe` carry `GENOME_CHANNELS3` words.

**Conformance (what "bit for bit" means).** After any number of steps from the same state, CPU and GPU agree exactly on: every word of `cells` (all 7N; the
whole buffer is defined), the genome words of every living cell plus `LIN_HI/LIN_LO` of all cells, the ledger (`lightIn`, `heatOut`, `flux`), the drained
event list (sorted), the `roles` buffer, and `stateHash`.

## 11. What differs from 2D, in one place

| pass | 2D | slab |
|---|---|---|
| indexing | `i = y*W + x`, `nb` with tile math | `i = z*WH + y*W + x`, `nb3`, z closed, `OUTSIDE` |
| affinity | 2D disc kernel (R = 9 default, 8 x 8 groups) | 92-tap 3D kernel, outside = mass 0, full-sum divide; 8 x 8 x 4 groups, one 1960-word tile |
| flow | 2 axes, 8-neighbour Sobel (weight 4 per side) | 3 axes, 27-point Sobel (16 per side) `/4`; z clamp at walls; 3 disp bytes |
| transport shares | 9 sources, `mulShareD(q, wx*wy, 4hw^2)` | 27 sources, nested per-axis `mulShareD(.., D1 = 2hw)`; outside z: no source, no target |
| lottery | over 9 | over 27 in the fixed `k` order; 49 genome words + 3-byte MOT |
| diffusion | 4 dirs, `rot = base >>> 30`, quarter portions | 6 dirs, `rot = draw(DIFF_ROT) % 6`, sixth portions; outside dir not sent |
| light | per-cell `light_at(x, y, step)` inside react | surface `lightSurface` plus a column pass with shading `T(m)`; react reads `Lbuf` |
| react | 10 -> 8 -> 8, `POOL_MAX`, 160 weight bytes | 11 -> 8 -> 9, `POOL_MAX3`, 177 weight bytes; SGZ and MZ; mutation over 180 slots |
| MOT | 2 bytes | 3 bytes |
| takeover, injury, shape, genes, adhesion | optional branches | not present |

## 12. Bounds the implementation may rely on (for `docs/rules.md`, "The slab")

States are valid on entry (`validateState`): total matter `<= MATTER_MAX = 2^26` (so each of `A, B, C, P <= 2^26`), `E <= 2^27`, `S <= 2^27`,
`LIN_LO < N`, PARAM1 bytes 1..3 zero. The invariant `E, S <= 2^27` holds after every step (react re-caps both at the top and never leaves them higher).

| quantity | bound | why |
|---|---|---|
| affinity `conv` | `<= 9624 * 16383 = 157,669,992 < 2^28` (the plan's looser `255*16383*92 < 2^29` also holds) | taps `<= 255`, `M <= 16383`, weights sum to 9624 |
| `uq*1024` | `<= 16383 * 1024 < 2^24` | |
| `growth` | `s9 = 9*sigma^2 <= 9,418,761`, `(s9-dd)<<8 < 2^32` | as 2D |
| Sobel numerators | `|G| <= 16*16383` (mass), `<= 32*256 = 8192` (U, signed), `/4` after | `|gU| <= 2048`, `|gM| <= 65532` |
| `(256-alpha)*gU`, `alpha*gM`, `dtQ*F` | `<= 256*2048 = 2^19`, `<= 256*65532`, `<= 1024 * 131,064` | i32 safe (the `U` term is twice 2D's) |
| transport weights | each `wa(o) <= D1 <= 128`; `sum_o wa(o) = D1` | `\|da\| + hw <= 96` |
| `mulShareD` split | `(q % D1) * w < 2^14`; `(q / D1) * w <= q` | exact `floor(q*w/D1)` |
| shares sent by a source | `sum <= q` (each nested floor is at most the real product, the real products sum to `q` over all 27 targets, fewer at walls) | stay `= q - sum` cannot wrap |
| `inE` | `<= 27 * 2^27 = 3,623,878,656 < 2^32` | each source `E <= 2^27` |
| `inB, inP, T, cum` | `<= 2^26` | matter bound |
| diffusion | six portions sum to `q`; each out `<= portion`; `v <= 2^27 + 2^27 + 6 < 2^32` | inflow is six portions of neighbours `<= 2^27` |
| `De*4` in `mulFrac(.., 10, ..)` | `<= 1024 < 2^22` | |
| `De` (gate) | `D*gateK <= 256*65535 < 2^24` | |
| light | `L <= 255`, `T <= 256`, `L*T < 2^16`, `256*lightK <= 2^24` | |
| SGZ input | `cap24(S) <= 2^24-1`, difference `* sg <= 127` gives `< 2^31` | as SGX |
| `E` during react | `<= 2^27 + 31*2^26 < 2^32` before each re-cap | `q <= B <= 2^26` |
| per-cell heat | accumulated as a 64-bit `(lo, hi)` pair on the GPU (`hadd`) | the entry-cap excess alone can reach `26*2^27` |
| `LIN_LO` | `< N <= 2^24` | |

## 13. Open choices made here, and why

1. **Flow at the z walls: three readings of the plan's "an outside neighbour reads the cell's own value (zero gradient at the walls)"; this spec takes (b), clamp.**
   (a) *Centre substitution*: every outside tap reads the centre cell's `U`/`M`. Rejected: the x and y gradients lose the whole missing plane's contribution (a quarter of the
   stencil weight) at every wall cell, and the z tap is the only one the words describe literally.
   (b) *Clamp / replicate (taken)*: the outside tap `(x+a, y+b, z+c)` reads `(x+a, y+b, z)`, the cell's own layer. For the pure z tap this is literally "the cell's own value", it matches
   the plan's SGZ rule (outside neighbour reads own S), and Gx, Gy keep full stencil weight. The z gradient at a wall is the one-sided difference between the two real planes, so it is
   **not zero**: the "zero gradient" parenthetical is read as describing the padding (a constant extension past the wall), not the resulting `Gz`.
   (c) *Reflect*: the outside tap reads `(x+a, y+b, z-c)`, i.e. `F(a,b,-1) = f(x+a, y+b, z+1)` at `z = 0`. That makes `Gz` exactly 0 at the wall layers with Gx, Gy at full weight.
   It is the reading under which "zero gradient at the walls" holds literally, and it differs physically: with clamp, a surface cell that has mass below it feels the
   `-alpha*gM` repulsion in z (and the `U` term), with reflect it feels none, so matter would sit against a wall more freely.
   Why (b): it follows the words "cell's own value" for the tap they name, and it keeps the wall a boundary that still exerts its one real neighbour's force instead of a free
   slip. If review or M4 prefers (c), the change is one line in §6 (`clampz(z+c)` becomes the reflected index) in `sobel3` and its WGSL twin; nothing else moves.
   **Plan §3.3 needs a dated amendment stating whichever reading is final** (this file, as written, says (b)).
2. **Outside sentinel.** CPU `-1`, WGSL `0xffffffffu`. Not a valid index; never dereferenced.
3. **Diffusion rotation.** `rot = draw(baseS, DIFF_ROT) % 6`, not 2D's `baseS >>> 30` (plan §3.5). `baseS >>> 30` has four values and cannot rotate six directions.
4. **Light is its own pass and buffer** (`Lbuf`, N u32 words), not recomputed inside react: react would otherwise scan a column prefix per cell (cost `O(D^2)` per column).
   The plan's "one pass with one thread per column" is kept.
5. **One workgroup shape `(8,8,4)` for affinity, flow, transport, react, stats**, dispatch `(W/8, H/8, D/4)`. Affinity is the timed shape; the other passes follow so one dispatch
   geometry covers the world. Correctness does not depend on it (all sums are exact integer sums, all accumulators are atomic adds); M3 may retune the non-affinity passes.
6. **Sign convention.** `z` grows downward, `SGZ = S(z+1) - S(z-1)` ("below minus above" in the plan), `MZ > 0` and `dz > 0` move towards the floor. Same orientation as SGX (east - west) and SGY (south - north).
7. **27-source order** `k = (oz+1)*9 + (oy+1)*3 + (ox+1)`; absent z sources keep their `k` with `lot = 0`. The cumulative scan order is part of the rule.
8. **Nested share order** x, then y, then z; the stay uses the same expression as the receivers. Chosen for the `w <= D1 <= 128` precondition of `mulShareD` (an exact product
   `floor(q*wx*wy*wz/D1^3)` would need a divisor up to 2^21). The nested floors only ever round the amount sent down: deterministic, and exact in total.
9. **Diffusion rate.** The total fraction leaving is `De/256` as in 2D, spread over six directions, so each direction carries two thirds of 2D's per-direction rate. A consequence of the
   plan's §3.5, noted so M4 is not surprised.
10. **Genome-copy skip kept** (the "already holds the winner's lineage" rule): `GpuSim3.upload` writes both genome buffers and the CPU scratch starts at zero, and the rule is
    unobservable in `stateHash` either way (§7.2).
11. **Events** are compared as the sorted list (§9.7); the CPU list is already sorted.
12. **`Pt`, `Pn` in the gate** are the pre-transport, uncapped `P` of the two cells, as 2D (`step.ts:446, 455`); they are symmetric so both ends compute the same `De`.
13. **Neutral expression.** `REF` is the lifted generalist (`generalistGenome3`), the same phenotype both arms start from (plan §5.1); mutation still runs on the cell's own genome.
14. **Light uses the pre-increment `step`** for the seasonal term, like 2D's react (`step.ts:515`), and the post-transport mass of the layer above (plan §3.6).

## 14. Consequences to watch (not rule choices)

- With the default `spread = 8` (`hw = 40`, `D1 = 80`) a cell at rest keeps `(64/80)^3 = 0.512` of its matter per step in the slab against `0.64` in 2D: the 3D box blur is
  stronger. This is the plan's rule applied as written; it affects how tightly organisms hold together and is a candidate for M4 (`spread` is an ordinary config key).
- Transport is the heaviest pass: 27 sources and a three-fold nested share per target. The spec lets an implementation skip zero weights and hoist the x/y products, which at
  small displacements leaves at most 8 non-zero targets per source; M3's 100 steps/s gate measures what it costs.
- Matter pushed against a wall by `dz` stays in the wall layer (its out-of-range shares stay with the source); nothing leaves the slab through z.
- Light at layer 0 does not depend on matter; layer `z` depends on the matter above it after this step's transport, so shading reacts within the step.

## 15. Tests this spec implies (for M1 and M2; their own plans list them)

- M1: exact conservation over random slabs (matter and energy, 200 states); no matter crosses `z = 0` or `z = D-1`; light monotone non-increasing in z and equal to `lightSurface` at
  layer 0; z-mirror symmetry of affinity (mirrored `U`), flow (mirrored `disp` with `dz` negated; `divi` is odd-symmetric, so this is exact) and transport of `B, P, E` (the nested shares
  depend on `wz` only at the last stage, so mirroring z swaps `wz(-1)` and `wz(+1)` and nothing else); small hand examples of §7.1 (`hw = 40`, `d = 0`: `wa = (8, 64, 8)` for `o = -1, 0, 1`,
  and `share3(1000, 64, 64, 64) = 512`), of §7.3 (`q = 14, rot = 4`) and of §8.
- M2: `slab-*` golden cases at 32 x 32 x 8 and 64 x 64 x 8 (neutral, a shaded column, a state with matter against both walls, motility on and off, a season), bit for bit in Deno and in Chrome,
  per the conformance statement at the end of §10; the 2D `gpu_golden.ts` cases must still pass untouched.

## 16. Review (Codex pass and audits on M1 + M2, 2026-10-23)

No finding changed slab dynamics, so no existing `slab-` pin moved; six new cases were added with their own pins. Every RULE_VERSION 1 pin (27) and the ten
earlier slab pins are byte-identical.

| finding | outcome |
|---|---|
| P1 `GpuSim3.upload` accepts a different config | **Fixed.** `upload` compares `state.cfg` with the config the pipelines were built with (`configDiff`, key by key, absent == undefined) and throws, naming the keys, before any buffer write. A new world of another config needs a new `GpuSim3`. Tests: `packages/sim-gpu/test/gpu-sim3-create.test.ts`. |
| P2 creation failures leak | **Fixed.** `create` pops the error scope in a `finally` (a rejected shader no longer leaves one open); a failure after construction (including a validation error from the scope) destroys the sim; the constructor itself destroys every buffer it allocated if it throws part-way. Tested with a mocked device (scopes pushed == popped, all buffers destroyed). |
| P2 golden cases miss the arithmetic boundaries | **Fixed with six new small cases (16x16x8).** `slab-e-saturation` (27 aimed sources, E and S at 2^27 everywhere: post-transport E = 27 * 2^27 and heat excess about 3e10 per run), `slab-signal-limit` (random full-range controllers, S in {2^27, 0, below 2^24, anywhere} so neighbour differences straddle cap24 in all six directions, `signalGain` 127), `slab-rounding-spread{0,8,32}` (B, P, E from the values around multiples of D1 = 64, 80, 128 and around 2^27, motility bytes at the extremes with `dtQ` 0 so the weights run through 0, 1, D1 - 1, D1), `slab-motility-off` (`motility: false`). Mutation checks on the CPU reference, each caught by at least one new case (the review found the old ten never reach these values, and the mutations were run against the new cases only): SGZ without cap24 (`signal-limit`), per-cell heat truncated to u32 (`e-saturation`), the E cap at 2^24 on cell load (`e-saturation`, `rounding-*`), the E cap after respiration at the 2D 2^28 (`e-saturation`). The 2D cap at the cell-load site is value-equivalent at 2^28 (a later re-cap exports the same heat), which is why no case separates it; the u32 bound there is covered by the E sum being below 2^32 either way. Unit vectors in `step3d-ops.test.ts`: `share3` against exact BigInt nested floors on a boundary grid for D1 in {64, 80, 128}, and sent <= q for random weight triples with E up to 2^27. GPU and CPU hashes agree on all six in `tests/deno/gpu_golden.ts`. |
| P3 documented bounds false | **Fixed** in `docs/rules.md` and in §6 and §13 here: `\|G\| <= 32 * 256` for the signed `U` (so `\|gU\| <= 2048`), `(256 - alpha) * gU <= 2^19`, displacement bytes in `[spread, 128 - spread]`. The arithmetic was i32-safe; only the stated bounds were wrong. |
| P3 `feedNutrient` / `applyFeed` accept a slab | **Fixed.** `feedError` refuses a slab config (`FeedRefusedError`), so `feedNutrient`, `applyFeed` and any scheduled feed throw and change nothing. `applyLesion` takes a `RefSim` (which rejects a slab at construction) and `GpuSim3` has no `lesion`/`feed`, so there is no slab-typed lesion entry point; `clampLesionRadius` was left alone (a pure number clamp). Test in `packages/schema/test/feed.test.ts`; `experiments/3d-slab/audit_feed.ts` now reports the refusal. |
| P3 GPU golden not run by Codex | **Run here.** `deno run -A --no-lock tests/deno/gpu_golden.ts`: all cases PASS (27 2D, 10 earlier slab, 6 new), GPU hash == CPU hash, energy residual 0. |
| P3 64x64x8 slab cases slow in vitest | **Accepted.** The five 64x64x8 cases are skipped in `golden-hashes.test.ts` unless `BL_SLAB_BIG=1`; their pins stay in the table and the cases still run bit for bit against the GPU in Deno and Chrome. The 32x32x8 and 16x16x8 pins always run. |
| P3 limits audit, no break | **No action.** Optional promotion of the A-storm / A3 states was taken: `slab-e-saturation` is the aimed 27-source storm with E and S saturated. |
| P3 2D path untouched | **No action.** Re-confirmed: no 2D pin line changed. |
