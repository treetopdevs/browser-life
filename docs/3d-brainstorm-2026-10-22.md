# A 3D Cadence Garden: is it possible, and what would it take? (2026-10-22)

Brainstorm and feasibility note. No code, no rule change, no golden pin moves. Everything below either
leaves RULE_VERSION 1 untouched (rung 0) or lives on its own new rule line (rungs 1 to 3). Numbers marked
"estimate" come from arithmetic on today's code and today's measured speed, not from a 3D run; rung 1's
first step is the benchmark that replaces them. The visual companion is `docs/3d-brainstorm-2026-10-22.html`.

## Short answer

Yes. There are two different things "3D" can mean here, and they cost very different amounts:

- **A 3D view of today's flat world.** The world stays a 2D sheet. It is drawn as a landscape you can
  orbit: biomass and membrane rise as height, lineages colour the hills, nutrient and waste lie in the
  valleys. No physics change, no pin moves. Days of work.
- **A 3D world.** The world becomes a volume: a jar or a water column. Matter moves in three
  directions, light comes from above and is shaded by what grows over it. This is a new rule line, with
  its own CPU reference, its own WGSL twin and its own golden cases. The shader is not the expensive part.
  The expensive part is keeping two implementations equal bit for bit and re-teaching every tool that
  assumes two dimensions. That is weeks.

The rest of this note explains why 3D is worth it beyond looks, what breaks, what it costs, and a staged
path where each rung ends with a check that can stop the line.

## 1. Why a 3D world could be more than prettier

The 2D world fakes one thing that a 3D world gets for free: **depth under light**.

- **Shade.** Light enters from the top and each layer absorbs some, in proportion to the biomass and
  membrane in it. Whatever grows above takes light from whatever is below. In 2D, light is a fixed map
  (gradient, patches, sweep); nothing can shade anything. In 3D, competition for light is spatial and
  self-made. That pressure is what produced canopies, kelp forests and phytoplankton blooms.
- **Layers without being told.** Photosynthesisers should sit near the top. Decomposers should sit below,
  where dead matter collects. Grazers should sit in between. In 2D every role shares one surface and the
  gradient only hints at zones. A column could stratify on its own, and stratification is something we
  can see and measure (role by depth).
- **Sinking and a floor.** A small downward bias on bound matter gives sediment: waste and dead mass
  pile up at the bottom, where abiotic recycling turns them back into nutrient, which then has to diffuse
  up to the light. That is a real nutrient loop with a length scale, like a lake's.
- **Insides.** In 3D a membrane can enclose a volume completely. A blob of biomass inside a shell of
  polymer is a closed compartment, which is closer to a cell than any 2D ring. The ownership and cells
  sandboxes (`docs/sandbox-ownership.md`, `docs/sandbox-cells.md`) asked for exactly this kind of
  individuality.
- **It fits the brand.** The garden is already a sealed jar with a sun. A 3D world is that jar, literally:
  a glass cylinder you can turn, lit from above, green near the surface and dark below.

None of this is promised. Rung 1's checks are there to find out whether any of it happens.

## 2. What today's code assumes is flat

From `docs/rules.md`, `packages/schema/src/layout.ts`, `packages/sim-ref/src/step.ts` and
`packages/sim-gpu/src/shaders.ts`:

| Piece | 2D today | 3D needs |
|---|---|---|
| Affinity kernel | Ring of radius `kernelRadius` (9 by default), 224 non-zero taps, shared-memory tile of (8·2 + 2R)² = 34² words | A shell: 250 taps at radius 4, 2,552 at radius 9. An 8-cell 3D tile with its halo is (8 + 2R)³ words: 10.7 KiB at R = 3 and exactly 16 KiB at R = 4, which is the whole WebGPU default for workgroup memory. Radius 5 and up need a smaller tile or another scheme. |
| Flow gradients | Sobel 3×3 on U, M and P | Sobel 3×3×3, plus a z component |
| Transport | Box of half-width ≤ 1 cell, so a destination receives from at most **9** sources | At most **27** sources (see the bounds problem below) |
| Diffusion | 4 directions, quarter portions, 12 random-draw slots | 6 directions, sixth portions, 18 slots |
| Controller | Inputs SGX, SGY; outputs MX, MY; MOT packs (mx, my) in 16 bits | SGZ and MZ, so a 10 → 8 → 8 network becomes 11 → 8 → 9. The genome grows from 44 to about 49 words. |
| Light | A 2D field computed per cell | A per-column scan from the top, layer by layer (one thread per column) |
| Lesions, feeds, sun sweep, pond tiles, migration offsets | Discs, x positions and 2D tiles | Spheres, columns, 3D tiles |
| Census and tracker | Connected bound-mass components on a 2D grid | 6- or 26-connected components in 3D |
| Checkpoints, lineage inspector, coordinator capabilities, renderer | 2D layout | A third dimension in the layout, the format and every reader |

Because the genome layout and the neighbourhoods change, a 3D world cannot be a new optional
`WorldConfig` key on RULE_VERSION 1. It is its own line, like the game kernel line
(`docs/evolution-game-brainstorm-2026-10-16.md`): a new `RULE_VERSION` (or a separate "volume" rule
line), a new reference step, a new WGSL twin and new golden pins. Every RULE_VERSION 1 world, pin and
result stays as it is.

### The bounds problem

`docs/rules.md` relies on "after transport, `E ≤ 9 · 2^28 < 2^32` (at most nine sources contribute)". In
3D, 27 sources contribute, and 27 · 2^28 ≈ 7.2 · 10^9 overflows a u32. Two fixes:

- **Lower `POOL_MAX` to 2^27.** 27 · 2^27 ≈ 3.6 · 10^9 < 2^32. The `react` bound
  `E + q·gap ≤ 2^27 + 2^26·31 < 2^32` still holds. It costs nothing except a smaller energy pool per cell,
  which a new rule line is free to choose. This is the recommended fix.
- **Carry E as a 64-bit (lo, hi) pair during transport.** This keeps today's pool size, but adds work and
  code on the hottest path.

A second transport bound breaks too, and lowering `POOL_MAX` does not fix it. A source's share to a
destination is `floor(q·w/D²)`, computed by `mulShareD` (`packages/sim-ref/src/step.ts`) as
`(q / D²)·w + ((q % D²)·w) / D²`. That is exact only while `(q % D²)·w` fits a u32, which holds in 2D
because `D² ≤ 2^14`. In 3D the overlap is a volume, `w ≤ D³`, and at the default spread `D³ = 512,000`:
`q % D³ = 511,999` times `w = 262,144` is about 1.3 · 10^11. The fix belongs to the new rule line: define
the 3D share as three nested per-axis shares, `mulShareD(mulShareD(mulShareD(q, wx, D), wy, D), wz, D)`.
Each stage stays inside today's proven 2D bound, and conservation stays exact because the source keeps
whatever the shares do not hand out, as it already does. It rounds slightly differently from a single
`floor(q·w/D³)`, which a new rule line is free to choose.

The other bounds (`MATTER_MAX`, the `mulShr` limits, the 64-bit heat ledger) do not depend on the
neighbourhood size and carry over. The adhesion bound uses `|∇P| ≤ 4·16383`, which comes from the 3×3
Sobel weights; a 3×3×3 Sobel has larger weights, so that bound has to be redone, and that is easy.

## 3. What it costs to run

### Kernel work per step (exact tap counts, from `buildKernel`'s rule extended to 3D)

Today is 65,536 cells × 224 taps ≈ 14.7 M taps per step, at about 2,000 steps a second on the Mac.

| World | Cells (× today) | Taps per cell | Kernel work (× today) |
|---|---|---|---|
| 256² at R 9 (today) | 1 | 224 | 1 |
| Slab 256 × 256 × 8 at R 3 | 8 | 92 | 3.3 |
| Slab 256 × 256 × 8 at R 4 | 8 | 250 | 8.9 |
| Cube 64³ at R 3 | 4 | 92 | 1.6 |
| Cube 64³ at R 4 | 4 | 250 | 4.5 |
| Cube 64³ at R 5 | 4 | 460 | 8.2 |
| Cube 64³ at R 9 | 4 | 2,552 | 45.6 |
| Cube 96³ at R 4 | 13.5 | 250 | 15.1 |
| Cube 128³ at R 4 | 32 | 250 | 35.7 |

The other passes (flow, transport, react with its little network) scale with the cell count, not the
tap count. So a rough estimate: **a 64³ jar at radius 3 to 4 runs at a few hundred steps a second**,
fast enough to watch evolve. **128³ runs at tens of steps a second**: beautiful to watch, slow for
evolution. Radius 9 in 3D is out of reach without a different convolution scheme (for example, a ring
built as the difference of two separable integer blurs, which costs O(R) per cell per axis rather than
O(R³)). That is a research item, not rung 1.

### Memory (per cell: 7 channels × 2, genome 44 words × 2, U, displacement, 2 role words = 106 words)

| World | Total | Largest single buffer (one genome copy) |
|---|---|---|
| 256² (today) | 28 MB | 11.5 MB |
| Slab 256 × 256 × 8 | 222 MB | 92 MB |
| Cube 64³ | 111 MB | 46 MB |
| Cube 96³ | 375 MB | 156 MB, over the 128 MiB default binding limit |
| Cube 128³ | 889 MB | 369 MB |

Up to 64³ (or the 8-deep slab) fits WebGPU's default limits, so it runs on any WebGPU device. Above that
it depends on the device. `requestDevice` (`packages/sim-gpu/src/gpu-sim.ts`) already asks for the
adapter's own maximum buffer and binding sizes, and refuses a world that does not fit. So 96³ may well run
on the Mac's GPU today, while many phones and integrated GPUs would refuse it. The per-cell genome copy is
what makes big worlds device-dependent. Genomes are already immutable per lineage id, so the portable fix
is to store each lineage's genome once in a table and have cells point to it. That needs an allocator for new lineages on the GPU and a way to
reclaim dead ones, while staying deterministic. That is real work, and it only matters for rung 3.

## 4. Drawing it

Today's renderer (`packages/sim-gpu/src/renderer.ts`) draws straight from the simulation's storage
buffers, inside the worker, with no copy. A 3D view should keep that property. Copying state to the CPU
every frame (a 64³ world is about 7 MB of cell channels) would cost more than the step.

**What three.js can and cannot do here** (checked against three.js r186, released 2026-09-24, and the
WebGPU spec, by a research pass on 2026-10-22):

- `WebGPURenderer` accepts an existing `GPUDevice` (the `device` parameter of `WebGPUBackend`) and does
  not destroy it. So three.js and the simulation can share one device.
- It works in a worker with an `OffscreenCanvas` (three.js PR #27520). The lab's worker is bundled by
  Vite, so the "import maps don't work in workers" caveat does not bite.
- It **cannot** read a raw `GPUBuffer` as a storage buffer through any public API. Its buffer attributes
  are always created from a CPU-side array.
- It **can** wrap an existing `GPUTexture` with no copy (`ExternalTexture`). It supports `r32uint`
  textures. Whether that wrapper works for a 3D texture is unverified.
- It ships raymarched volume examples at 128³ and 200³ (`webgpu_volume_perlin`,
  `webgpu_compute_texture_3d`, `webgpu_volume_cloud`), but no measured frame rates. Its marching-cubes
  addon runs on the CPU, so it is no use here.
- WebGPU's default limits are fine for the textures: 3D textures up to 2048 per side, and `r32uint`
  storage textures allow read-write without extra features.

**So the bridge is a tiny "pack" pass.** After each displayed step, one compute pass writes what the
view needs into a texture: for rung 0, a 256² texture of height and colour; for a volume, a 64³ texture
of density and colour (1 MB). The pass is GPU to GPU and cheap. three.js then draws from that texture
through `ExternalTexture`: a displaced, lit landscape for rung 0, a raymarched box for the jar.

**Recommendation.**

- **Rung 0: use three.js.** An orbit camera, lighting, shadows, fog and a glass jar model all come for
  free, and the pack pass gives it a supported, copy-free path. The simulation does not change at all.
- **The volume (rungs 1b and 2): prototype with three.js first, keep a fallback.** If `ExternalTexture`
  will not take a 3D texture, write the raymarch as one more WGSL pass in the style of `renderer.ts` (a
  full-screen triangle that steps a ray through the volume). That is a few hundred lines. Either way, the
  pack pass is the same.
- **Not** instanced cubes per voxel (262,144 cubes at 64³ is heavy and looks like Minecraft, not life),
  and **not** CPU marching cubes.

three.js was the suggestion, not a requirement. Its value here is the scene around the world (camera,
jar, light, post-processing), not the drawing of the cells themselves.

## 5. A staged path

Each rung ends with a check that can stop the line. Nothing on rungs 1 to 3 touches RULE_VERSION 1.

**Rung 0: a 3D view of the flat world (days; no physics change).**
A new view mode in the lab (and maybe the garden page): the 2D world as an orbitable landscape. Height
from B + P, colour from lineage (as the lineage view does), nutrient and waste as tinted ground, light as
the sky's brightness across the map. It reads the same GPU buffers the 2D renderer reads.
*Check:* does it make the world easier or more fun to read than the flat view? Show three people, or
just ask yourself after a week. If not, stop here; nothing else depended on it.

**Rung 1a: a 3D kernel benchmark (a day or two; throwaway code).**
First time today's 2D affinity pass alone at 256², R 9, so its share of the 0.5 ms step is known. Then
time one WGSL affinity pass over a 64³ volume at R 3 and at R 4 (R 4 fills the 16 KiB workgroup memory
exactly, so its result is data on that limit too), plus a trivial transport pass with 27 sources, in the
lab and in Deno. *Check:* the 3D affinity pass at 64³, R 4 takes at most 4.5× today's affinity pass (the
tap table's ratio), so the shared-memory tiling still pays off in 3D. If it is slower, try R 3 or the
slab; if neither stays within its own ratio, stop.

**Rung 1b: the slab (one to two weeks).**
A 256 × 256 × 8 water column, light from the top, attenuated layer by layer. The 3D rule line's first
real version: CPU reference, WGSL twin, golden cases, conservation exact, `POOL_MAX` 2^27, nested per-axis transport shares, sixth-portion
diffusion, Sobel 3×3×3, MZ and SGZ in the controller, an optional sinking bias. It keeps most of today's
world (the large surface), so existing seeds and founders adapt easily.
*Check (written before the run, like every check in this repo):* less light at depth means less
photosynthesis at depth whatever evolves, so the check compares against the `neutral` control (one
phenotype everywhere, lineages still propagating) under the same attenuated light. Everything below is
fixed before any run:

- *Activity.* The role buffer holds each cell's last-step photo, grow, decomp and resp counts (saturated
  at 65,535; saturation is reported, not corrected). For a layer group, sum each of the four counts over
  its cells and over the 10 censuses ending at step 300,000, so one quiet step does not decide anything.
- *Photo share* of a layer group = photo / (photo + grow + decomp + resp). If the total is zero, the
  share is undefined.
- *D* = photo share of the top two layers − photo share of the bottom two. If either share is undefined,
  that seed fails.
- *Bar.* Run 3 neutral seeds. Let m be the mean of their D and r the range (max − min). An evolving seed
  passes if its D > m + r.
- *Decision.* 3 of 3 evolving seeds pass: go to rung 2. 0 of 3: depth did nothing beyond the light, and
  the line pauses. 1 or 2 of 3: run 3 more seeds of each arm, recompute m and r over all 6 neutral seeds,
  and go only if at least 5 of the 6 evolving seeds pass; otherwise pause.

**Rung 2: the jar (two to four weeks after 1b).**
A 64³ volume (or a 64² × 32 column), the 3D renderer, and the 3D census (components, roles by depth).
Lesions become spheres; the sun becomes light from above that can dim, as the sun letter already allows.
*Check:* the stratification readout, exactly as in rung 1b. A second check on enclosed compartments
(biomass inside a closed polymer shell, more often than in a matched 2D run) is allowed only after a dated
note fixes, before any rung 2 run: what "closed" means (which connectivity, what polymer threshold), the
count's denominator (per census, per million cells), what the matched 2D run holds equal (seeds, matter
per cell, total light), the pass threshold, and what mixed seeds mean. Until that note exists, rung 2 is
judged on stratification alone.

**Rung 3: big worlds (open-ended).**
The genome table, 128³, the separable ring kernel, and the archipelago and garden in 3D (checkpoints,
islands, stitching, coordinator capabilities). Only worth starting if rung 2 shows something a 2D world
does not.

## 6. What stays hard

- **Two implementations.** Every 3D rule exists twice, in TypeScript and WGSL, and must match bit for bit
  on every GPU. The 2D line took weeks of golden-case work to get there; 3D repeats it.
- **Seeing inside.** A volume full of life is murky. Slices, depth fog, isosurfaces and "peel the top
  layer" controls are not optional; without them the 3D world is a coloured cloud.
- **Touching it.** Feeding, wounding and picking a lineage need a 3D cursor: a ray into the volume and a
  depth. That is a design problem for the lab, not just code.
- **Phones.** The garden's audience includes phones. A 64³ world uses about 111 MB of GPU memory and
  several times today's work; many phones will need the flat view or a smaller jar.
- **Tools.** The census, tracker, lineage inspector, checkpoint format, stitching and coordinator all
  assume 2D. Rung 2 needs the census; most of the rest waits for rung 3.

## 7. What this note does not show

- No 3D code ran. The speed numbers are estimates scaled from today's 2D speed; rung 1a measures them.
- Nothing here shows that a 3D world evolves anything a 2D world does not. Stratification and
  compartments are hypotheses with checks, not predictions.
- The memory figures assume today's per-cell genome copy and ping-pong buffers; a different layout
  changes them.
