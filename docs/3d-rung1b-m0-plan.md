# Rung 1b, M0 (schema): implementation plan

Scope: milestone "M0 Schema" of `docs/3d-rung1b-plan-2026-10-23.md` (§2, §3.1, §3.2, §4, §5.1). Schema package plus the minimum
edits to shared code. No `step3d.ts` (M1), no `shaders3d.ts` / `gpu-sim3.ts` (M2). Hard rule: every RULE_VERSION 1 pin, 2D hash and 2D
checkpoint stays byte-identical. The slab is a rule line selected by the optional key `tileD`; `RULE_VERSION` stays 1 and
`SCHEMA_VERSION` is untouched.

Facts found while reading the code that shape the plan:

- `generalistGenome` lives in `packages/schema/src/genome.ts`, not `step.ts`. Its weights are written through `w1/b1/w2/b2` and `IN`/`OUT`.
- The 2D `W1` index is `i*NN_H + j` and `NN_H3 = NN_H = 8`, so rows 0..9 of `W1` sit at the same byte offsets in both layouts. Everything after
  moves (B1 at 80 -> 88, W2 stride 8 -> 9, B2 at 152 -> 168). The lift still remaps by `(i,j)` and `(j,k)`, never by bytes, and no test may rely on the
  W1 coincidence.
- `validateConfig`'s generic loop walks `defaultConfig()` keys, so optional keys (`tileD`, `lightK`) need an explicit check, like `signalGain`.
- Callers of `cellCount` that assume 2D (`allocState`, `buildWorld`'s `H = n / W`, `motilityReader`, `canonicalGenome`, checkpoint decode, `validateState`)
  would silently mis-size a slab once `cellCount` multiplies by `tileD`. Each must either handle the slab or refuse it (see the edits below).
- `dayPeriod` / `wanderPeriod` / `wanderAmp` only act in light mode `sweep` (`step.ts:160-170`), which the slab excludes.
- `experiments/3d-bench/test/kernel3d.test.ts` is not in vitest's include globs and imports `assertKernels` from the bench file; the bench
  (`bench.ts`, `shader3d.ts`, `probe-8x8x8.ts`, `skeptic_wall.ts`, `harness.ts`, `web/web.ts`) imports `buildKernel3` from `./kernel3d.ts`.

## 0. Pre-change capture (before any edit)

Record, on the unmodified tree, the 2D compatibility fixtures the new compat test pins:

1. `digestWords` (two hex words) of the `u32` view of `encodeCheckpoint(state, {})` for three states: `generalistWorld` 64x64 seed 1 at step 0; the same after
   40 `RefSim` steps; a `tiledWorld` with tilesX = tilesY = 2 (32x32 tiles) after 10 steps with `migrationPeriod` set. Also `stateHash` of each.
2. `digestWords` of `new TextEncoder().encode(canonicalConfig(defaultConfig()))`.

Commit these as literals in `packages/schema/test/slab-compat.test.ts`. They must pass on the unmodified code first (run once before editing) and again at the end.

## 1. New files

### 1.1 `packages/schema/src/layout3d.ts` (constants only; imports `layout.ts`, nothing from `config.ts`)

```
export const NN_I3 = 11, NN_H3 = 8, NN_O3 = 9;
export const W1_OFF3 = 0;
export const B1_OFF3 = W1_OFF3 + NN_I3 * NN_H3;   // 88
export const W2_OFF3 = B1_OFF3 + NN_H3;            // 96
export const B2_OFF3 = W2_OFF3 + NN_H3 * NN_O3;    // 168
export const NN_BYTES3 = B2_OFF3 + NN_O3;          // 177
export const NN_WORDS3 = Math.ceil(NN_BYTES3 / 4); // 45
export const NN_PAD3 = NN_WORDS3 * 4 - NN_BYTES3;  // 3 padding bytes, always 0
export const IN3  = { ...IN,  SGZ: 10 } as const;
export const OUT3 = { ...OUT, MZ: 8 } as const;
export const G3 = { ...G };                         // same header slots; W0 = 4
export const GENOME_CHANNELS3 = G3.W0 + NN_WORDS3;  // 49
export const RND3 = { ...RND, DIFF: 1, DIFF_ROT: 19 } as const;   // DIFF + d*3 + sp, d in 0..5 -> 1..18; slots 20..39 unchanged
export const MOT_ZERO3 = 128 | (128 << 8) | (128 << 16);          // 0x808080
export function packMot3(mx: number, my: number, mz: number): number  // each int in -128..127 else throws; (mx+128) | (my+128)<<8 | (mz+128)<<16
export function unpackMot3(mot: number): [number, number, number]
```

`POOL_MAX3` lives in `config.ts` next to `POOL_MAX` (see §2) so `layout3d.ts` stays import-free of config and no cycle appears.

### 1.2 `packages/schema/src/kernel3d.ts`

Move `Kernel3`, `isqrt` and `buildKernel3(radius, flat = false)` verbatim from `experiments/3d-bench/kernel3d.ts`. Taps are `(dx, dy, dz, w)` quadruples, z outermost loop, then y, then x; that order is
part of the contract M1/M2 rely on and is pinned by a test. Doc comment: "radius must equal `cfg.kernelRadius`; the weight sum divides the conv even when taps fall outside z (§3.2)".
`assertKernels`, `affinity3dRef`, `growthRef`, `makeFill` stay in the bench file (throwaway); its local `Kernel3`/`isqrt`/`buildKernel3` are deleted and replaced by
`export { buildKernel3, type Kernel3 } from "@bl/schema";`. The bench imports and its own test keep working unchanged.

### 1.3 `packages/schema/src/genome3.ts`

```
export interface Genome3 { mu: number; sigma: number; motGain: number; weights: Int8Array /* NN_BYTES3 */ }
export const w1At3 = (i, j) => W1_OFF3 + i * NN_H3 + j;   // i < 11
export const b1At3 = (j)    => B1_OFF3 + j;
export const w2At3 = (j, k) => W2_OFF3 + j * NN_O3 + k;   // k < 9
export const b2At3 = (k)    => B2_OFF3 + k;
export function emptyGenome3(mu, sigma): Genome3
export function encodeGenome3(g, linHi, linLo): Uint32Array      // length 49; same refusal rules as encodeGenome (int8, exact length, JSON-roundtrip hint)
export function decodeGenome3(words: ArrayLike<number>): Genome3 // throws if PARAM1 bytes 1..3 are set (rings/genes are excluded from the slab)
export function genomeHex3(g: Genome3): string                   // words PARAM0.. as 8 hex digits each: 47 words = 376 digits
export function genomeFromHex3(hex: string): Genome3             // /^[0-9a-f]{376}$/ else throws
export function liftGenome(g: Genome): Genome3                   // throws if g.rings or g.genes is set
export function projectGenome(g: Genome3): Genome                // inverse of the lift on its image; drops SGZ row, MZ column, MZ bias
export function generalistGenome3(mu, sigma): Genome3            // = liftGenome(generalistGenome(mu, sigma)); not a second hand-built net
```

`liftGenome`: for `i < 10`, `j < 8`: `W1_3[i,j] = W1[i,j]`; `W1_3[10,j] = 0` for all `j`; `B1_3[j] = B1[j]`; for `j < 8`, `k < 8`: `W2_3[j,k] = W2[j,k]`; `W2_3[j,8] = 0`;
`B2_3[k] = B2[k]` for `k < 8`; `B2_3[8] = 0`; padding 0; `mu`, `sigma`, `motGain` copied. `generalistGenome3` calls the lift, so the neutral control and the evolving arm share one definition (§5.1).

### 1.4 `packages/schema/src/world3.ts`

```
export type SimKind = "2d" | "slab";
export const simKind = (cfg: {tileD?: number}): SimKind => (cfg.tileD === undefined ? "2d" : "slab");  // factory discriminator only
export interface Founder3 { x: number; y: number; z: number; radius: number; genome: Genome3; biomass: number; energy: number }
export interface InitSpec3 { nutrient: number; waste?: number; founders: Founder3[] }
export function allocState3(cfg): WorldState          // requires isSlab(cfg); cells n*7, genome n*49, flux and ledgers as allocState
export function buildWorld3(cfg, spec): WorldState
export function slabSpotsWorld(cfg, genome: Genome3, count = 8, nutrient = 32, biomass = 64): WorldState
export function validateState3(s): string[]           // not a slab -> ["not a slab state"]; else validateState(s)
```

`buildWorld3` follows `buildWorld` line for line, with these differences: `MOT` filled with `MOT_ZERO3`; index `i = z*W*H + y*W + x`; the founder is the ball `dx²+dy²+dz² <= r²`
(123 cells for r = 3); x and y wrap in the single tile, **z does not wrap: cells with `z+dz` outside `[0, D)` are skipped**; the fit check is `2r+1 <= min(tileW, tileH)` and `0 <= z < D`;
noise `draw(base, i) % (2*biomass+1)` with `base = lowbias32(seed ^ (idx*7919+17))`, energy split as in 2D; genome words from `encodeGenome3(f.genome, 0, packLineageLo(cfg, idx+1))`;
overlap behaves as in 2D (biomass adds, the later founder wins the genome words); ends with `validateState`.

`slabSpotsWorld`: positions from `h = lowbias32(seed*313 + i)`, `x = h % W`, `y = (h >>> 12) % H`, `z = draw(h, 7) % D`; radius 3; energy `2*biomass`. Salt 313 is new (31/131/197 are taken).
The named preset `slab-spots` and its registry entry are M5.

`validateState3` is a thin alias on purpose: the slab rules live inside `validateState` (§2) so every entry path (founding, checkpoint decode, `encodeCheckpoint`, a later `GpuSim3.upload`) hits the same code;
the alias is the explicit entry for callers that must refuse a 2D state.

### 1.5 `packages/schema/src/index.ts`

Add `export * from "./layout3d.ts"`, `"./kernel3d.ts"`, `"./genome3.ts"`, `"./world3.ts"`. Every new name carries a `3`/`Slab` marker, so nothing collides with `MOT_ZERO`, `IN`, `OUT`, `G`, `RND`.

## 2. Edits to existing files

### `config.ts`

- `WorldConfig`: `tileD?: number` and `lightK?: number`, each with a doc comment (absent = RULE_VERSION 1; slab on exactly when `tileD` is present; z closed; `lightK` is §3.6's attenuation constant). Not added to `defaultConfig()`.
- `cellCount = worldW * worldH * (c.tileD ?? 1)` (times the integer 1 for 2D, so identical).
- `export const POOL_MAX3 = 2 ** 27`; `export const isSlab = (c: {tileD?: number}) => c.tileD !== undefined`; `export const genomeChannels = (c) => isSlab(c) ? GENOME_CHANNELS3 : GENOME_CHANNELS`.
- `validateConfig`: add `["tileD", [4, 32]]` and `["lightK", [1, 65536]]` to the explicit optional-key loop (integer check there), then `errs.push(...validateSlab(c))` after `validateGenes`.
- `validateSlab(c)` (exported for tests; `[]` when both slab keys are absent):
  - `tileD` and `lightK` are set together (either alone is an error). Decision D1.
  - `tileD % 4 === 0` (8 x 8 x 4 workgroup; the plan's D = 8 is inside). D3.
  - `tilesX === 1 && tilesY === 1`.
  - `kernelRadius === 3` (every bound in §4, the 92-tap table and the affinity tile were derived for R = 3). D2.
  - `lightMode` is `uniform` or `gradient`.
  - These optional keys must be absent: `migrationPeriod`, `migrantCount`, `ringNamespace`, `pondPeriod`, `pondK`, `pondArm`, `pondDeath`, `pondExport`, `pondScore`, `takeover`, `takeoverKin`, `takeoverTol`, `cellPeriod`, `cellMutProb`, `shapeReach`, `injuryPeriod`, `injuryRadius`, `injuryProb`, `adhesion`, `kAdhesion`, `genes`, `kGene`, `geneFlip`, `wanderPeriod`, `wanderAmp`, `dayPeriod`. One message per key: `"<key> is not defined for a slab (tileD set)"`.
  - Allowed: `neutral`, `motility`, `signalGain`, `seasonPeriod`/`seasonAmp`, every ordinary rate. The existing checks still apply (`cellCount <= 2^24`, tile multiple of 8, light within 0..255, `2R+1 <= min(tileW, tileH)`).
- Nothing else. The `ringNamespace` lineage packing is untouched (a slab has none; the LIN_LO cell part `< n = 2^19`).

### `accounting.ts`

- `canonicalGenome(genome, channels = GENOME_CHANNELS)`: use `channels` in the body. `stateHashWords` calls `canonicalGenome(s.genome, genomeChannels(s.cfg))`. Default unchanged, so 2D hashes are byte-identical.

### `world.ts`

- `allocState(cfg)`: after `validateConfig`, `if (isSlab(cfg)) throw new Error("allocState: a slab config needs allocState3")` (`buildWorld` is protected through it).
- `validateState(s)`: `const gc = genomeChannels(s.cfg)`, `const pool = isSlab(s.cfg) ? POOL_MAX3 : POOL_MAX`. Use `gc` for the genome length check and the identical-lineage loop (`g < gc`); use `pool` for the E and S caps (message names the cap in force). For slab living cells also require `(genome[PARAM1*n+i] >>> 8) === 0` and `(genome[(gc-1)*n+i] >>> 8) === 0` (rings/genes excluded; the three padding bytes are 0). None of this runs for 2D.
- `motilityReader`: throw on a slab config (the slab reader is M5).
- `cloneState`, `isLiving`: generic, no change.

### `checkpoint.ts`

- Encode: `canonicalGenome(s.genome, genomeChannels(s.cfg))`.
- Decode: `genomeLen !== n * genomeChannels(cfg)` -> "checkpoint: genome size mismatch". The following `validateState` applies the 2^27 cap. No header, magic or version change.

### `packages/sim-ref/src/step.ts`, `packages/sim-gpu/src/gpu-sim.ts`

- One line each at the entry that takes a state (RefSim constructor; GpuSim constructor/`upload`): `if (isSlab(state.cfg)) throw new Error("... slab configs need the slab simulator")`. No 2D behaviour change. Doing it in M0 means M1 and M2 never touch those lines.

### `experiments/3d-bench/kernel3d.ts`

- Replace the local `Kernel3`/`isqrt`/`buildKernel3` by the re-export (§1.2). Everything else in the file stays.

### Not changed in M0

`golden.ts`, `golden-hashes.test.ts`, `presets.ts`, `founders.ts`, `runner`, `metrics`, `lineage`, shaders, `docs/rules.md` (the "The slab" section ships with M1, where the bounds are exercised).

## 3. Tests to add (all in `packages/schema/test/`, covered by vitest's glob)

**`layout3d.test.ts`**
1. Offsets: `B1_OFF3 === 88`, `W2_OFF3 === 96`, `B2_OFF3 === 168`, `NN_BYTES3 === 177`, `NN_WORDS3 === 45`, `NN_PAD3 === 3`, `GENOME_CHANNELS3 === 49`.
2. 2D constants unchanged: `NN_BYTES === 160`, `GENOME_CHANNELS === 44`, `NN_I/NN_H/NN_O === 10/8/8`, key sets of `IN`/`OUT` unchanged.
3. `IN3.SGZ === 10`, `OUT3.MZ === 8`; every other `IN3`/`OUT3` entry equals the 2D value.
4. `RND3`: last diffusion slot `DIFF + 5*3 + 2 === 18`, `DIFF_ROT === 19`; slots 1..19 pairwise distinct; every other `RND3` entry equals `RND` and none lies in 1..19.
5. MOT: pack/unpack round trip over `{-128, -1, 0, 1, 127}³`; `MOT_ZERO3 === packMot3(0,0,0) === 0x808080`; `(MOT_ZERO3 & 0xffff) === MOT_ZERO` (the 2D constant); `128`, `-129`, `1.5` throw; packed value `< 2^24`.

**`kernel3d.test.ts`** (the bench asserts, moved)
1. Tap counts for R = 3, 4, 5 are `[92, 250, 460]`; weight sum for R = 3 is 9,624; pin the R = 4, 5 sums from the first run.
2. `count * 255 * 16383 < 2^32` for each R, and `255 * 16383 * 92 < 2^29`.
3. Closed under all 6 axis permutations x 8 sign flips with equal weights (R = 3, 4, 5).
4. `buildKernel3(r, true)` has the same `count` and `sum` as `buildKernel(r)` and equal `(dx, dy, w)` tap for tap, for r in 3, 4, 9.
5. Order pinned: first tap of R = 3 and a `digestWords` of the whole tap array; no `(0,0,0)` tap; every `w > 0`; every `dx²+dy²+dz² < R²`.
6. The bench module's `buildKernel3` is the same function object as `@bl/schema`'s.

**`genome3.test.ts`**
1. Encode/decode round trip over 50 seeded random genomes with weights over `-128..127`; encoded length 49; bytes 177..179 are 0.
2. `genomeHex3` has 376 digits and round trips; `genomeFromHex3` rejects uppercase, 2D-length (336) and short strings.
3. `encodeGenome3` rejects weights of length 160 or 178 and non-int8 values; `decodeGenome3` rejects a word array whose PARAM1 has bytes 1..3 set.
4. Lift positions, for a random 2D genome `g` and `L = liftGenome(g)`: `L.weights[w1At3(i,j)] === g.weights[w1(i,j)]` for `i<10, j<8`; W1 row 10 all 0; `b1` equal; `W2` equal for `j<8, k<8`; `W2_3[j,8] === 0` for every j; `b2At3(k)` equal for `k<8`; `b2At3(8) === 0`; `mu/sigma/motGain` equal; padding 0.
5. Sub-network round trip: `projectGenome(liftGenome(g))` deep-equals `g` (all 160 bytes) for 100 random genomes; `liftGenome(projectGenome(h))` equals `h` whenever `h` has zero SGZ and MZ weights.
6. Phenotype preservation: a plain integer forward in the test (`sum in*w1 + b1`, ReLU, `sum h*w2 + b2`, no scaling) for both layouts; for 200 random inputs (ten inputs, plus an arbitrary 11th SGZ value for the lifted net) the first 8 outputs agree exactly and output 8 is 0.
7. `generalistGenome3(mu, sigma)` deep-equals `liftGenome(generalistGenome(mu, sigma))`; its SGZ row, MZ column and MZ bias are zero; known entries (`w1At3(IN.EPB,0)=127`, `w1At3(IN.LIGHT,1)=127`, `b1At3(2)=64`, `w2At3(1,OUT.PHOTO)=110`, `b2At3(OUT.RESP)=70`, `w2At3(0,OUT.GROW)=127`) are as in `generalistGenome`.
8. `liftGenome` throws for a genome with `rings` or `genes`.

**`world3.test.ts`** (32 x 32 x 8 for speed; one 256 x 256 x 8 test)
1. `allocState3`: `cells.length === 7*n`, `genome.length === 49*n`; at 256 x 256 x 8, `n === 524288`. `allocState` and `buildWorld` on the same cfg throw with the allocState3 message. `simKind` returns "slab" / "2d".
2. Single founder at `(16,16,4)`, r = 3: exactly 123 occupied cells; all within `|dz| <= 3`; MOT is `MOT_ZERO3` everywhere; total `A` equals `nutrient * n`; `validateState3(s)` is `[]`; `stateHash` equal across two builds.
3. Walls: founder at `z = 0`, r = 3: occupied cells equal the brute-force count of ball points with `dz >= 0`; layers 4..7 hold zero biomass and no genome (a wrap would land in layer 5). Same mirrored at `z = 7`. x/y wrap: a founder at `(0,0,4)` has cells at `x = 31` and `y = 31`.
4. Genome copy: every founder cell's 49 words equal `encodeGenome3(g, 0, idx+1)`; `LIN_HI = 0`; two founders have distinct `LIN_LO`.
5. `slabSpotsWorld`: 8 founder lineages present; same seed -> same hash; seed + 1 -> different hash; all centres in `[0, D)`; at 256 x 256 x 8 `validateState3` is `[]` (matter `32 * 2^19` plus founders is below `MATTER_MAX`).
6. `validateState3`: `E = 2^27` accepted and `2^27 + 1` rejected (message mentions E), same for S; `validateState` on a 2D state still accepts `E = 2^28` (the 2D cap did not move); a slab genome buffer of `44*n` words rejected ("genome buffer size mismatch"); two cells of one lineage differing only in genome word 48 rejected (loop bound); `LIN_LO >= n` rejected; living cell with PARAM1 byte 1 set rejected; matter above `MATTER_MAX` rejected; `validateState3` on a 2D state returns an error.

**`config-slab.test.ts`**
1. `"tileD" in defaultConfig()` and `"lightK" in defaultConfig()` are false; `canonicalConfig(defaultConfig())` contains neither string; its digest equals the literal captured in §0.
2. `cellCount`: 2D default 65,536; slab 256 x 256 x 8 is 524,288; `genomeChannels` gives 44 / 49.
3. Baseline slab config (`tileD 8, lightK 1024, kernelRadius 3, lightMode uniform, lightBase 40, lightAmp 200`) yields `[]`; also with `gradient`, seasons, `neutral`, `motility: false`, `signalGain`.
4. `it.each` over every excluded key: setting it (with a valid value, completing groups such as the pond/takeover/injury/cells/genes keys) yields an error naming that key.
5. Bad values: `tileD` in `{0, 3, 6, 36, 8.5, "8"}`; `lightK` in `{0, 65537, 1.5}`; `tileD` without `lightK`; `lightK` without `tileD`; `tilesX = 2`; `tilesY = 2`; `kernelRadius` 9 and 4; `lightMode` `patches` and `sweep`; `tileW = tileH = 2048` (2^25 cells) hits the existing size error.
6. Existing pond, injury and shape test configs still validate to `[]` (guards against the exclusion code leaking into 2D).

**`slab-compat.test.ts`** (the hard rule)
1. The §0 fixtures: `encodeCheckpoint` digest and `stateHash` of the three 2D states equal the literals from the unmodified tree; `decodeCheckpoint(encodeCheckpoint(s))` reproduces `cells` and `genome` exactly.
2. `canonicalGenome(g)` equals `canonicalGenome(g, 44)` bit for bit (stale words in an empty cell zeroed; same reference when clean).
3. Slab: `canonicalGenome(g, 49)` zeroes words 2..48 of an empty cell and keeps a live cell's; `stateHash` ignores stale words in empty cells and changes when word 48 of a live cell changes.
4. Slab checkpoint round trip: `decodeCheckpoint(encodeCheckpoint(slabState, obs))` returns equal cells, genome and cfg (`tileD`, `lightK` kept) and equal `artifactDigest`.
5. Slab decode refusals: a hand-reframed checkpoint whose genome section is `44*n` words (digest recomputed with `digestWords`) throws "genome size mismatch"; one with E poked to `2^27 + 1` throws the cap error; a 2D byte stream with `tileD` spliced into its config throws.
6. `new RefSim(slabState)` throws. The `GpuSim` guard is exercised in M2's Deno run (no GPU in vitest).

**Must stay green and untouched:** `packages/sim-ref/test/golden-hashes.test.ts` and `packages/sim-gpu/src/golden.ts` (`git diff` shows neither changed in M0), the rest of `packages/schema/test`, the bench's own test.

## 4. Order of work

1. §0 capture; add `slab-compat.test.ts` with the literals; run it green on the unmodified tree.
2. `layout3d.ts`, `kernel3d.ts` (+ bench re-export), their tests.
3. `config.ts` keys, `cellCount`, `genomeChannels`, `validateSlab`, config tests.
4. `accounting.ts`, `world.ts` (alloc guard, `validateState`), `checkpoint.ts`; compat tests 2-5.
5. `genome3.ts`, `world3.ts`, `index.ts`, their tests.
6. Constructor guards in `RefSim` / `GpuSim`.
7. Gates: `PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH pnpm typecheck && pnpm test`. On load-induced timeouts rerun just those files and report it. `deno run -A --no-lock tests/deno/gpu_golden.ts` if the GPU is free (M0 touches no shader, so 2D bit-for-bit must still hold). Confirm `git diff --stat` shows none of `golden-hashes.test.ts`, `golden.ts`, `shaders.ts`.
8. Codex Sol review (read-only, High) before the commit; the session lead commits.

## 5. Decisions (defaults chosen, cheap to flip)

- D1. `tileD` and `lightK` are required together. Alternative: `lightK` absent means no shading. Rejected: §3.6 defines no unshaded slab and the check always sets `lightK`.
- D2. `kernelRadius` must be 3 for a slab in v1 (bounds, the 92-tap table and the tile size assume it).
- D3. `tileD` in 4..32 and a multiple of 4 (workgroup depth 4). D = 8 is what the plan uses; D = 4 stays available for small tests.
- D4. `dayPeriod` is rejected with the slab although it is inert outside `sweep`, so an unused key can never make two equivalent configs hash differently.
- D5. `validateState` is generalized in place (`gc`, `pool`) instead of forking a second implementation; `validateState3` is a strict-slab alias. One path serves founding, checkpoint decode, `encodeCheckpoint` and `GpuSim3.upload`.
- D6. The constructor guards are in M0 so M1 and M2 can run in parallel without touching the same lines. The `createSim` factories arrive as `sim-ref/src/factory.ts` (M1) and `sim-gpu/src/factory.ts` (M2); M0 supplies only `simKind` and `isSlab`.
- D7. Left unguarded and out of scope: `packages/lineage`, `metrics`, `runner` still assume 2D layouts (`GENOME_CHANNELS`, `cellCount`); a slab config never reaches them before M5, which owns the "absent for a slab" list.

## 6. Risks specific to M0

- A 2D caller passing a genome of a length other than `n*44` to `canonicalGenome`: the default argument keeps the old behaviour.
- `cellCount` times `tileD`: 2D configs never carry `tileD`, so the multiplier is the integer 1; the compat test pins it.
- The §0 fixtures are the only guard against subtle serialization drift (config key order, header words); they must be captured before the first edit.

## 7. Review (Codex Sol, High, read-only)

No P1. Codex confirmed the lift, layout, kernel and pool-bound logic, 27/27 RULE_VERSION 1 CPU golden pins, and identical 2D fixtures.

| Finding | Outcome |
| --- | --- |
| P2 `GpuSim.upload()` accepted slab states | Fixed: same slab guard as `create()`, before any buffer write. Test: `packages/sim-gpu/test/slab-guard.test.ts` (no buffer property touched). |
| P2 founder diameter check included D | Fixed: check is `2r+1 <= min(tileW, tileH)`; z is clipped at the walls. Test: radius-3 ball at `tileD: 4`. |
| P2 founder z used `(h >>> 24) % D` | Fixed: `draw(h, 7) % D` as planned. Test pins the seed 5 centres (18,16,5), (21,21,5), (24,16,4). |
| P3 exclusion tests passed for the wrong reason | Fixed: grouped keys get complete groups (pondDeath/pondExport via arm `nat`), the 2D config is checked free of slab errors, and the exact slab diagnostic is asserted. |
| P3 decoder rejection tests only called the encoder | Fixed: valid slab bytes are mutated (44*n genome, E and S above 2^27), the checksum recomputed, and `decodeCheckpoint` must throw; a control case shows the harness accepts the unmutated stream. |
| P3 allowed 2D keys with a slab | Accepted as deliberate: comment added at `SLAB_EXCLUDED_KEYS`. `neutral: true` needs a slab neutral-reference path in M1. |
| P3 slab size bounded only by 2^24 cells | No change in M0. M1 clips z taps (kernelRadius 3 may exceed tileD 4); boundary tests (tileD 4, 32) are optional in M1. |
| P3 reserved bytes checked only for live cells | No change: `canonicalGenome` zeroes those words in hashes and checkpoints. |
| P3 `hunt1-ops.test.ts` supervise.sh timing failure | Unrelated, load-related; see rerun below. |
