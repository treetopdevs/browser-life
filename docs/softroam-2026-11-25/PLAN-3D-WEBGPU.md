# Plan: True 3D Soft Roam on WebGPU (128 × 128 Aquarium)

Date: 2026-11-28  
Status: Revised architectural plan (post-adversarial review by Codex `gpt-6.1-sol` High & Claude `claude-opus-5-5` High; pre-implementation)

## 1. Goal and Research Motivation

Soft Roam today (`apps/lab/src/softroam/kernel.ts`) is an off-grid 2D integer particle ecology with an optional discrete-level extension (`depth: 2..4` in chunk 5, `NOTE-5.md`). Discrete levels showed multi-layer coexistence is possible, but exposed two structural limits:

1. **Ecology:** With food restricted to the floor, 80–88% of cells hug level 0 and everything off the floor starves without a hardcoded hunger dive.
2. **Spatial richness:** Discrete level jumps have no continuous vertical mechanics, no 3D swimming gaits, no 3D body morphologies, and no volumetric resource gradients.

The long-term target is a **true 3D Soft Roam aquarium**—scaling from **`128 × 128 × 32`** (Phase A/B) to **`128 × 128 × 128`** (Phase C)—running **bit-for-bit deterministic 32-bit integer physics on WebGPU** with an identical CPU reference twin and a real-time **WebGPU 3D renderer** (building on `apps/lab/src/volume3d/` and `apps/lab/src/mycelium3d/`).

---

## 2. Exact 32-Bit Integer & Determinism Contract (Non-Negotiable)

Consistent with `docs/rules.md`:

- **Wrapping 32-bit integer semantics in both TS and WGSL:** WGSL has no `i64`/`u64`, and concrete 32-bit integer overflow in WGSL wraps (two's complement, not UB). The TypeScript reference twin **must not** rely on JS 53-bit double arithmetic (unlike 2D `kernel.ts:478, 1717, 1915`):
  - Every 32-bit multiply in TS uses `Math.imul(a, b)`; every signed/unsigned result is normalized with `| 0` or `>>> 0`.
  - Division and modulo explicitly guard `divisor === 0` and `INT_MIN / -1` (`-0x80000000 / -1`) before executing.
  - `isqrt32(n: u32) -> u32` uses a shared bitwise restoring / binary-search integer algorithm in both TS and WGSL—never `Math.sqrt`.
- **Bounded squared distances (no 32-bit overflow):**
  - At `128 × 128 × 128` with `U = 1024`, toroidal horizontal deltas reach `65,536` (`dx² = 2³²`, which wraps to `0` in `u32`!) and non-wrapping vertical deltas reach `131,072`.
  - **Rule:** Every pairwise distance check first rejects any pair with `|dx| > MAX_DELTA || |dy| > MAX_DELTA || |dz| > MAX_DELTA` where `MAX_DELTA = 16383` units (16 tiles), guaranteeing `dx² + dy² + dz² ≤ 3 · 16383² = 805,208,067 < 2³⁰ < 2³¹`.
  - For stretched bonds (which could momentarily exceed 16 tiles under extreme impulses), `dx, dy, dz` are shifted right by `s = 1..4` until `max(|dx|, |dy|, |dz|) <= 16383` before squaring, then the resulting `isqrt32` is shifted left by `s` (identical helper in TS and WGSL).
- **Closed matter conservation:** `water food + floor detritus + cell stores + reservoir + leafPool == matter` with **exact zero residual** every step.
- **Order-independent determinism:** Counter-based PRNG (`roamHash(seed, step, cid, channel)`), double-buffered position/velocity snapshots, symmetric pair-hash conflict resolution, and deterministic sorted free-slot allocation.
- **Zero impact on existing 2D Soft Roam:** All 3D simulation code lives in a new package/module (`packages/softroam3d-ref/` + `packages/softroam3d-gpu/` or `apps/lab/src/softroam3d/`) so every existing 2D Soft Roam digest and test pin remains untouched.

---

## 3. World Geometry, Multi-Resolution Voxels & Rule Calibration

A `128 × 128 × 128` 1-tile voxel grid holds `2,097,152` voxels. Even on desktop WebGPU, a 4-pass scalar 6-neighbor stencil on 2.1M voxels touches ~256 MiB of logical traffic per step (before L2 caching) and is far too slow for the CPU reference twin.

### Multi-Resolution Layout

| Layer | Resolution | Voxels (`128×128×32`) | Voxels (`128×128×128`) | Design & Arithmetic Contract |
| --- | --- | --- | --- | --- |
| **Particle coordinates** | Continuous integer `(x, y, z)` in `[0, S·U) × [0, H·U] × [0, S·U)` | — | — | Periodic wrap in `X, Z`; hard floor `y = 0` and surface `y = H·U` with damped wall repulsion. |
| **Spatial hash grid** | 2-tile buckets (`64 × H/2 × 64`) | `65,536` buckets | `262,144` buckets | Cell diameter `D = 1024`; touch radius `1.25 D` fits inside `3 × 3 × 3` buckets (27 buckets). Rebuilt every substep and before life queries. |
| **Food & marine snow** | Floor (`128 × 128`) + coarse water column (`64 × H/2 × 64`) | `16,384 + 65,536` | `16,384 + 262,144` | Exact integer matter per voxel; sinking moves exact floored shares downward with remainder kept in source. |
| **Scent field** | **2-tile voxels (`64 × H/2 × 64`)** (or 4-tile `32 × H/4 × 32` for 128³) | `65,536` (`8,192` at 4-tile) | `262,144` (`32,768` at 4-tile) | **Calibrated 6-neighbor stencil:** Diffusion reach scales in *voxels*, not tiles (`√(2^shift / 12)` voxels in 3D). At 2-tile stride, `shift = 9` gives ~6.5 voxels ≈ 13 tiles (~8 voxels ≈ 16 tiles at `shift = 10`). At 4-tile stride, `shift = 7` (~3.3 voxels ≈ 13 tiles) trades precision; **2-tile is preferred for Phase A** unless profiling proves 4-tile necessary. |
| **Light attenuation** | Per-column top-down prefix sum on `64 × H/2 × 64` | `65,536` voxels | `262,144` voxels | **Deliberate 3D rule change** (not a 1:1 port of per-tile 2D light): leaves share 2-tile column light attenuated by depth and overhead cell density. |

### Exact Staged 3D Scent Interpolation (No 32-bit Overflow)

In 2D `kernel.ts:1862`, scent interpolation uses wider JS double products because the fine field reaches `2²³`. In 32-bit integer arithmetic:
- Cap fine scent values at `SCENT_MAX = (1 << 20) - 1` (`1,048,575`).
- Use fractional voxel weights `fx, fy, fz ∈ [0, 1024]` (`10` bits, derived from `(pos & (VOXEL_U - 1)) >> (VOXEL_SHIFT - 10)`).
- Interpolate **one axis at a time**, shifting right by `10` after each stage:
  1. `c00 = c000 + (((c100 - c000) * fx) >> 10)` (and `c01, c10, c11`) — max product `2²⁰ · 2¹⁰ = 2³⁰ < 2³¹`.
  2. `c0 = c00 + (((c10 - c00) * fy) >> 10)` (and `c1`).
  3. `val = c0 + (((c1 - c0) * fz) >> 10)`.
- Every intermediate stays strictly within signed 32-bit `[-2³⁰, 2³⁰]`, matching identically in TS and WGSL.

---

## 4. Phased Simulation Design

### Phase A — Continuous 3D Motion & Shallow Aquarium (`128 × 128 × 32`)
*Goal: Prove bit-exact CPU ↔ WebGPU 32-bit integer physics and a genuinely inhabited 3D water column.*

1. **3D Coordinates & Mechanics:**
   - Cell state: `(x, y, z)`, `(vx, vy, vz)`, `(remX, remY, remZ)`.
   - 3D bond springs, brace springs, soft-sphere repulsion (`dist < D`), and contact-normal thrust projection.
2. **3D Heading & Steering:**
   - `(yaw, pitch)` in 10-bit integer angles (`yaw ∈ [0, 1023]`, `pitch ∈ [-220, 220]`) mapped to `Q14` unit vectors via `SIN_QUARTER`.
   - **Sight scan cost mitigation:** In 2D, `sight` up to 8 tiles scans a `9 × 9 = 81` neighborhood. In 3D with 2-tile buckets, an 8-tile radius spans `9³ = 729` buckets per seeing mouth! Phase A mitigates this with a **4-tile coarse occupancy bitmask / summary grid** (`32 × 8 × 32`) so empty 4-tile regions are skipped in 1 bit-test, plus keeping default 3D `sight` at `4–6` tiles (`5³ = 125` to `7³ = 343` buckets max, mostly skipped by bitmask).
3. **3D Ecology & Falsifiable Persistence Gate:**
   - **Marine snow & suspended food:** Patches spawn in mid/upper water and sink slowly (exact integer advection); floor detritus slowly recycles to the reservoir on death/decay or supports bottom scavengers, rather than trapping all matter on the floor forever.
   - **Buoyancy gene (`lift`):** Heritable neutral-buoyancy equilibrium height + vertical swim cost.
   - **Falsifiable Ecological Bar (before Phase B/C):** Across a full seasonal year (12,000 steps) on at least 4 **unseen seeds**, **≥ 30% of live cells must persist off the floor** (`y > 2` tiles) without any hardcoded hunger-dive hack, with exact zero matter residual. If floor-hugging recurs as in `NOTE-5.md` (80–88% on floor), tune marine-snow sinking/buoyancy mechanics before scaling up.

### Phase B — 3D Body Plans, Orientation Frame & Swimming Gaits
*Goal: Volumetric 3D creatures (tubes, cups, fins, corals) that swim in 3D.*

1. **3D Growth Lattice `(gx, gy, gz)`:**
   - 6 cardinal directions (`±x, ±y, ±z`) + up to 6–8 3D cross-braces (`√2 L`, `√3 L`) so 3D bodies hold volume.
2. **3D Orthonormal Frame `(fwd, right, up)` in `Q14`:**
   - Integer Gram–Schmidt re-orthonormalization (`dot` sum `≤ 3 · 16384² < 2³⁰`) with a **per-body angular remainder** (so slow turns don't quantize to zero) and a **degenerate-basis fallback** (resetting `right`/`up` from the cardinal axis least aligned with `fwd` if `|cross| < 16`).
3. **3D Inner Pulse + Anisotropic Drag (Optional Key):**
   - Optional parallel-vs-perpendicular drag ratio along each cell's bond axis so internal spring flexing from the 40-weight pulse network can generate net thrust (ablatable via config key).

### Phase C — Full `128 × 128 × 128` Aquarium on WebGPU
*Goal: Scale height `H` to 128 tiles and cell cap to `16,384` (stretch `32,768` after benchmarking).*

---

## 5. WebGPU Compute & Render Architecture

### Memory Budget (SoA `u32`/`i32` Storage Buffers)
- Per cell (positions, prev/vel/rem, store, genes, kinds, pulse 40×i8 weights, braces, links, labels): ~192 bytes/cell → **3.1 MiB at 16k cells**, **12.6 MiB at 64k cells**.
- Spatial hash + scratch radix buffers: ~2–6 MiB depending on `H`.
- Coarse 3D scent + food + light grids (double-buffered `u32`): ~1.5 MiB at `128 × 128 × 32` (2-tile), ~6 MiB at `128 × 128 × 128` (2-tile).
- **Total GPU working set: < 25 MiB** even at `128 × 128 × 128` — memory capacity is not the bottleneck; **dispatch latency, sight scans, and connected-components iterations** are.

### Deterministic Compute Pipeline (1 Step)

1. **`build_hash` (called before EACH mechanics substep AND before `life_eat_touch`):**
   - **Never reuse stale buckets across substeps** (matches `kernel.ts:1951`).
   - Run a **lossless two-key stable GPU radix sort** over active cells: first stable-sort by full 32-bit `cid`, then stable-sort by full 32-bit `bucketId` (preserving all 18+ bits of `bucketId` at `128 × 128 × 128` = `262,144` buckets with zero bit truncation).
   - **No fixed small-bucket assumption:** Every cell in an arbitrarily dense pileup is sorted deterministically by `(bucketId, cid)` so each bucket occupies one contiguous `[bucketStart, bucketStart + bucketCount)` range with zero silent truncation or CPU/GPU divergence.
   - Emit `bucketStart[]` / `bucketCount[]` and a coarse 4-tile occupancy bitmask in the same pass.
2. **`connected_components` (explicitly matching every relabel point: start of step, post-death, and grip if needed):**
   - **New 3D canonical rule (both CPU & GPU):** Shiloach–Vishkin hooking (`parent[root] = min(parent[root], neighborRoot)`) + pointer jumping (`parent[i] = parent[parent[i]]`) over `mother[]` and `braces[]`, converging to canonical root = **minimum `cid`** in each component.
   - **Convergence guarantee:** Run a fixed conservative iteration count (e.g. `K = 16` hook+jump rounds, sufficient for chains up to `2¹⁶` cells under Shiloach–Vishkin's `O(log N)` worst-case bound) AND verify zero remaining unmerged edges during periodic census/golden checks.
3. **`commands` (3D sight/fear, body aim reduction, inner pulse, thrust):**
   - Each seeing/fleeing cell scans nearby occupied 4-tile super-buckets and records its best `(priority, score, targetCid, ownCid)` in a 2-word struct (no lossy 32-bit packing).
   - **Per-body aim reduction:** Deterministic segmented reduction over cells sorted by `(bodyRoot, cellCid)` (reusing the radix sort primitive) — zero 32-bit atomic key truncation!
   - Evaluate 40-weight inner pulse network and compute per-cell integer thrust.
4. **`mechanics_substep` (×4 substeps, each preceded by `build_hash`):**
   - Bond and brace spring forces can safely use **wrapping integer `atomicAdd`** on per-cell force accumulators `(fx, fy, fz)` (unclamped two's-complement addition is strictly commutative and associative — order-independent without building a per-step children CSR!).
   - Neighbor repulsions gather from the `3 × 3 × 3` sorted buckets, contact normals project thrust, then a separate integration pass clamps velocity and updates `(x, y, z)` into ping-pong buffers.
5. **`life_eat_touch_divide` (preceded by `build_hash`):**
   - **Eat:** Voxel-level gather over sorted bucket ranges; exact proportional integer split with hash-ordered remainder (zero atomics, exact conservation).
   - **Touch / bite / crack:** Per-cell top-4 contacts by symmetric pair-hash rank; second pass checks mutual membership; exact floor-split drain.
   - **Flow, upkeep, wear, death:** Bond flow, death + compost drop into cell's voxel.
   - **Deterministic free-slot & division allocation:** Compact free slots into a **sorted free-slot list** via prefix sum each step (identical in CPU and GPU twins—replacing 2D's death-order LIFO free list). Sort ready-to-divide cells by `cid`, prefix-sum their indices, and pair the `k`-th dividing cell with the `k`-th free slot.
6. **`fields_step`:**
   - 4 ping-pong 6-neighbor 3D scent passes on the coarse grid.
   - 1 vertical pass for marine snow advection + top-down light attenuation.
   - Periodic parallel-sum conservation audit asserting `residual == 0`.

### Zero-Readback WebGPU Render Pipeline

Reads directly from GPU `storage` buffers and 3D field textures (no per-frame CPU readback):
1. **Pass 1 — Instanced 3D Sphere Impostors + Bond Ribbons** (exact perspective ray–sphere intersection + `frag_depth`, matching `mycelium3d/render.ts` and `softroam/tank-gl.ts`).
2. **Pass 2 — Volumetric Water & Marine-Snow Haze Raymarch** (front-to-back march through coarse 3D food/light textures composited against sphere depth, with glass tank edges and optional peel/slice planes from `volume3d`).
3. **Pass 3 — Floor Plane & Soft Shadows** (column-density shadow onto `y = 0`).

---

## 6. Verification & Benchmark Gates

1. **CPU Reference Twin First (`packages/softroam3d-ref`):** Pure 32-bit wrapping integer TS (`Math.imul`, `|0`, `>>>0`, `isqrt32`) with unit tests pinning conservation (`residual === 0`), slot/order independence, overflow edge cases (`dx = 65536`, dense 64-cell single-bucket pileups, long 200-cell chains for Shiloach–Vishkin), and `RULE_VERSION` state hashes.
2. **WGSL Golden Parity (`tests/deno/softroam3d_golden.ts`):** 200+ steps of multi-body 3D scenarios on both CPU and native Deno WebGPU asserting **bit-for-bit identical state digests** every step.
3. **Measured Performance Gates (before Phase C scaling):**
   - Benchmark the full pipeline (including 5× `build_hash` radix sorts, Shiloach–Vishkin CC, sight bitmask scans, 4-pass scent stencil, and volumetric raymarch) on Deno WebGPU + browser before committing to `32k–64k` cells.
   - Target Phase A (`128 × 128 × 32`, 4,000 live cells): `≥ 60 FPS` render, `≥ 60–120 steps/s` sim on Apple Silicon / mid-range desktop GPU.
   - Target Phase C (`128 × 128 × 128`, 16,000 live cells): `≥ 60 FPS` render, `≥ 30 steps/s` sim (with `32k` as a measured stretch goal, not an assumed baseline).
4. **Browser Compatibility:** `/softroam/` keeps the WebGL2 3D tilted tank renderer (runs on Chrome, Firefox, Safari, mobile); `/softroam3d/` targets WebGPU with a clear capability banner when unavailable.
