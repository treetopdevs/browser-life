# The 3D line, expanded (2026-11-15)

A plan to reopen the 3D line and push it a long way: from a closed rung 1b and a page of layer tiles to living jars you can turn in your hand, with neural creatures that grow through a volume, and in the end a shared 3D world. It replaces the stop that closed the line on 2026-10-24. Nothing here is built yet.

## 1. Where the line stands

What exists on `main` (9ef17ee2):

- **A 3D rule set that works.** The slab (`step3d.ts`, `shaders3d.ts`, `RefSim3`/`GpuSim3`, optional `tileD` and `lightK`) is generic in W, H and D, with CPU and GPU matching bit for bit (46 golden cases) and exact conservation. The 2D rules and their pins are unchanged.
- **Speed.** 256 × 256 × 8 (524,288 cells) runs at about 234 steps/s on the M3 Pro, 160 to 280 in the browser. Rung 1a timed one 64³ affinity pass at R 3 (108 µs, M3 Pro); a whole 64³ step has not been timed.
- **The vacancy kill** (cyclic competition, K = 3 to 8 types) is an opt-in kernel key. It requires mutation off. At 256 × 256 × 4 it kept all three types in 2 of 3 seeds, with whole-layer takeovers in cyclic order. A rare immune clone grew from about 1% to between 6% and 32% in 4 of 4 seeds (`experiments/3d-rps/invasion/RESULTS.md`).
- **`/slab/`**: a live viewer with one tile per layer plus a top-down view. There is no volume view of the 3D world yet.
- **`/spatial/`**: a 240-particle CPU toy in a unit torus, drawn with Canvas2D. It shows that orbit and slice controls read well, but it is too small to build on.
- **A volume renderer sandbox that never landed** (`claude/3d-volume-view`, 22 Oct). It has five approaches; four of them (ray march, surfaces, points, slices) do not use three.js. Its report recommends ray march for water and haze, a surface skin for bodies, and three's lighting ideas ported without three. It was tested on a smooth stand-in field, not on real simulation states.
- **The mycelium world** (`tools/mycelium/`): neural particles on a 2D torus. Each has a 160-byte controller, and particles lay trail. CPU and GPU match bit for bit (69 cases), and the ledger is exact.
  - **How its economy works:** light turns waste into nutrient in each cell, and that is the only energy input. Particles eat nutrient, excrete waste, and pay for trail.
  - **What it taught us:** evolved controllers purge costly trail (R3 PASS). When a toll keeps the trail, it is paid for but not used (R4 TOLL-ONLY). Without the toll, the gate plus a conduit held trail in 6 of 8 slots; this is the open lead (owner screen, 2026-11-15).

**Why the line closed.** The calibrations required 1% to 50% of cells living, alive at both the top and the floor, and settled. Of 420 runs, none passed.

**What those failures actually show.** Read differently, they are the best material we have. Take N12 / μ50 / σ8 / `lightK` 64 on 256 × 256 × 8 (`experiments/3d-slab/m4b-results.tsv`):
- About 44% of cells are living, and 43% of the light reaches the floor.
- Per layer, the top three are 86% to 99% full, layer 3 about 60%, layer 4 under 8%, and the bottom two empty.

That is a canopy over a dark floor, which is occupancy by depth, not yet roles by depth. Some rows are still rising at 50k steps, and the N16 rows reach 53% to 63% living. These were 8-layer runs with `lightK` tuned for 8 layers, so they do not carry over to a jar unchanged. Nobody has looked at them in 3D.

## 2. What changes in how we work

Following the 2026-10-04 direction (cool evolving life and shared worlds, not defensible endpoints):

- **No living-window gate.** The rung 2 plan reuses the 1% to 50% window and would stop at the same wall. Worlds are screened by eye from turntables and contact sheets, with a few descriptive numbers: living and activity by layer, light at the floor, turnover, lineage count, enclosed bodies. Labels are exploration labels. No freezes or pre-registration unless asked.
- **What stays strict:** integer arithmetic, CPU and GPU matching bit for bit, and exact matter and energy ledgers. These are cheap, and they are what make replay, archipelago verification and shared worlds possible. Every new lever has to balance energy (`docs/rules.md`).
- **New rules go in new files behind optional keys.** Nothing under `RULE_VERSION` 1 changes. `tools/mycelium/world.ts` and `gpu.ts` are left alone: their digest is pinned, and a peer session is working there.
- **`package.json` and `pnpm-lock.yaml` stay byte for byte** (the food-replay pin from PR #161). The renderer is plain WebGPU, with no three.js.
- **Pages are public, as you decided on 2026-11-14.** A new page goes in through a journal card plus a row in `apps/lab/src/experiments/ledger.ts`. It reaches the site when `main` is deployed, which still needs your word.
- **Every phase ends with something you can open.** Timings are taken on the work Mac; this Mac often runs at load 200 or more.

## 3. Two bets on one foundation

Two substrates, sharing a renderer, capture tools and census.

| | Bet A: the living jar (grid) | Bet B: neural mycelium in a volume (particles) |
|---|---|---|
| Base | slab kernel, already generic in depth | new rule `mycelium3d-r0`, modelled on `tools/mycelium` |
| What lives | chemistry plus per-cell controllers; lineages as coloured matter | individual neural particles that eat, move in x, y and z, lay trail, split |
| Memory, field | 106 u32 per cell: 64³ about 111 MB, 96³ about 375 MB, 128³ about 890 MB (needs a genome table) | 3 u32 per cell: 128³ about 25 MB, 256³ about 200 MB |
| Memory, bodies | in the field | about 200 B per particle with today's 160 B controller: 300k is about 60 MB. A 64-unit hidden layer is about 1.5 KB each: 300k is about 450 MB, not phone-sized |
| Speed | not measured at 64³; measure in Phase 1 | not measured; the 2D world is the reference |
| Why it might work | canopy worlds already exist; new levers add turnover | depth separates where nutrient is made from where matter ends up (below) |
| Main risk | carpets return once worlds get rich | particles purge trail as they did in 2D |

**Recommendation: B is the headline, A is the second bet.**
- B is closest to the look you are after (branching, growing networks).
- B scales to big volumes when brains stay small.
- Depth gives B a reason for structure that the flat world lacked.
- A comes cheaply because the kernel exists, and the renderer serves both.

### What depth adds to mycelium

In mycelium, light turns waste into nutrient, cell by cell. With light falling from the top and shaded by what grows there:

- **Nutrient is made only near the top.** That is where particles can eat.
- **Waste that sinks leaves the light.** Excreted waste and decayed trail drift down, so matter piles up as dark waste on the floor, where it can never become food. The top then runs short of the raw material it needs. (No floor recycling in this world: turning waste into nutrient without light would create energy and break the ledger.)
- **So lifting matter back up keeps the top productive.** That could happen through upwelling, by bodies diving and returning, or along conduits.

This is a commons problem. The lift helps everyone near the top, not just whoever pays for it, which is exactly where 2D trail failed. The levers that held trail in 2D (owner-weighted conduits, the gate) are the ones to try first. Whether evolution builds lifting structure is the question; this is a design to look at, not a claim.

## 4. Phases

### Phase 0: see it (about a week)

1. **Land the renderer without three.js.** Take `raymarch`, `isosurface`, `points` and `slices` from `claude/3d-volume-view` into a shared `apps/lab/src/volume3d/`, and leave out `three-volume/`.
   - Add a "pack" adapter that turns slab state into the renderer's two RGBA8 3D textures: density, lineage colour, light and polymer.
   - Use an orbit camera, a peel/slice control, depth fog, and the surface skin for bodies above a density.
   - Check: the volume tests pass, and `package.json` is unchanged.
   - Judge readability on real slab states, not the stand-in field.
2. **Volume view on `/slab/`.** Add a view switch (layer tiles or volume) and a turntable button.
   - Add presets that re-run the canopy settings from M4b by seed (e.g. N12 / μ50 / σ8 / K64, seeds 101–103). The results file holds summaries, not states, so these are fresh runs of the same 8-layer slabs, drawn as a thick sheet, not a jar.
3. **Deterministic capture.** A Deno or Playwright tool replays a seed to step N and renders a turntable to frames, then to MP4 and GIF.
   - A contact-sheet tool lays a sweep out as a grid of stills, one per setting.
   - These are how every later screen is judged.
4. **A 3D view of the flat world** (brainstorm rung 0; not built). An orbitable landscape for the 2D lab: height from B + P, colour from lineage. It is cheap and shows the garden itself in 3D.

*You can open:* `/slab/` as a turning volume with canopy presets; a landscape view in the lab; turntable videos.

### Phase 1: two bets in parallel (two to three weeks)

**Bet A: the living jar**

- **A1. Jar shapes and their own calibration.**
  - Allow 64³ and 64² × 32 on the slab kernel. This needs only validation and new golden cases, which have to match bit for bit.
  - Time a full step on the work Mac.
  - Run a short `lightK` × nutrient screen for the jar: the rung 2 plan's grid was `lightK` 1024 to 8192, because 64 layers shade far more than 8.
  - Run the 8-layer canopy settings to 150k steps to see whether they settle or drift to carpet.
- **A2. New levers** (optional keys, CPU and WGSL twins, parity cases, energy balanced):
  - *sinking*: bound matter and waste drift down;
  - *floor decomposition*: waste on the bottom layer decays to nutrient. This is downhill (eC > eA) and exports the difference as heat, so the ledger stays exact;
  - *upwelling pulses*: periodic vertical mixing;
  - *day/season light*: already exists in 2D, port it;
  - *vacancy kill with mutation*: a new key that lifts the mutation-off restriction so the K types can evolve their beats-masks.
- **A3. A wide screen.** Start from the jar calibration's most layered settings, crossed with the levers on log-spaced grids.
  - Size the screen from the step time measured in A1, and split it across both Macs.
  - Judge by contact sheet and turntable.
  - Descriptive numbers: living and activity by layer, light at the floor, turnover per 1k steps, lineage count.
- **A4. Enclosure census.** 3D connected components, plus biomass inside a closed polymer shell (26-connectivity, polymer above a threshold). It is descriptive, and it is the "cells with insides" signal from the brainstorm.

**Bet B: neural mycelium in a volume**

- **B1. `mycelium3d-r0`.** New files under `tools/mycelium3d/`; the 2D mycelium rules carry over except as listed here.
  - **Space:** positions in x, y and z in fixed point. The field A, C, P sits on a grid that wraps in x and y and is closed in z.
  - **Light:** it enters at the top and is attenuated layer by layer by trail and by particle mass. Light turns waste into nutrient where it falls, as in 2D.
  - **Sinking:** waste and decaying trail sink by a set fraction per step.
  - **Controller:** lifted the way `genome3.ts` lifts the slab's. It adds z gradients of trail and nutrient, plus a light input, and an MZ output.
  - **Order of work:** CPU reference first, then the WGSL twin, with parity cases and an exact ledger from day one.
- **B2. Levers from 2D, available from the start:** owner-weighted conduits and the gate (the 6 of 8 lead), plus the toll road for comparison. Start where 2D left off rather than relearning that trail gets purged.
- **B3. Rendering:** particles as lit impostors coloured by genotype, and trail and waste as ray-marched haze. It uses the same turntable and capture tools.
- **B4. First screen:** sinking rate × conduit × light depth, at a 64³ field and 20k to 50k particles. It is judged the same way: by eye, plus numbers.
  - matter by depth;
  - the upward flux of matter;
  - the vertical span of connected trail;
  - particles by depth;
  - turnover.

*You can open:* a 64³ grid jar and a 3D mycelium jar, side by side, with contact sheets and turntables from both screens.

### Phase 2: pick and grow (two to four weeks)

You choose from Phase 1 by eye. Then:

1. **Scale.**
   - Mycelium at a 128³ field with 100k to 300k particles (measured on the work Mac).
   - The grid jar to 96³ or 128³ through a per-genotype genome table, which cuts the 88 genome words per cell to an index.
2. **Bigger brains.** An option to widen the hidden layer (8 → 32 → 64 units; about 160 B → 0.7 to 1.5 KB of int8 weights per particle), which comes closer to the "~10k parameters per particle" look. Bit for bit still holds. The costs are GPU time and memory (300k particles at 64 units is about 450 MB), measured before the default is decided.
3. **Touch it.** A 3D cursor that casts a ray into the volume, with a depth slider. Wounds and feeds become spheres, and clicking picks a lineage. Includes a 3D inspector.
4. **Long runs.** Days-long runs on both Macs, recorded as checkpoints and time-lapses.
   - A 3D lineage and tracker view.
   - A simple 3D "bell" for events: trail reaching from top to floor, an enclosure count jumping, a new layer colonised.

*You can open:* a big jar you can poke, with a time-lapse of its history.

### Phase 3: share it (open-ended)

- **3D checkpoints** in the existing artifact format, with segmented equal to continuous byte for byte.
- **Archipelago islands** that run 3D segments, through a coordinator capability flag.
- **A long-running shared jar.**
- **The garden's sealed jar in real 3D.** Phones get a smaller jar, small brains, or a slice view where WebGPU 3D is weak.

## 5. Order of the first week

1. Port the renderer core and pack adapter (Phase 0.1), with the `/slab/` view switch.
2. Build the capture tool, and render turntables of the canopy settings re-run by seed (0.2, 0.3).
3. In parallel: write the `mycelium3d-r0` rules note (B1), only the prose, the controller layout and an energy-balance check. Then the CPU reference.
4. Show you the turntables before any new rule is written. If no canopy world looks alive in 3D, Bet A is reweighted before more goes into it.

## 6. Risks

| Risk | What we do |
|---|---|
| The volume reads as murk | Peel/slice, surface skin for bodies, depth fog. Judge on real states in week 1. |
| Grid worlds carpet again once enriched | A2's levers aim at turnover. If they fail, the jar becomes the renderer's showcase and B carries the line. |
| 3D mycelium purges its trail too | Owner conduits and the gate from the start. Sinking gives lifting a reason. If structure still dies, report it plainly and try bodies that bond (the particle prototypes have breakable bonds). |
| A new lever leaks energy | Every lever gets a ledger test against `docs/rules.md` before any screen. |
| Memory at 128³ for the grid, or big brains at 300k particles | Genome table before any 128³ grid run; brain width chosen after measuring. |
| Browser differences (Safari, Firefox, phones) | Chrome first; measure the others in Phase 3. Slice view as fallback. |
| Peer work on `tools/mycelium/` | Bet B lives in `tools/mycelium3d/` and edits nothing in `tools/mycelium/`. |

## 7. Decisions (taken 2026-11-15)

The user chose every recommendation on 2026-11-15 and asked to start implementing.

1. **Headline substrate:** 3D mycelium (B) is the headline, and the grid jar (A) is the second bet.
2. **three.js:** no. The renderer is plain WebGPU, so `package.json` and `pnpm-lock.yaml` stay pinned.
3. **Compute:** the two Macs. Cloud GPUs need a separate yes, with a cost estimate.
4. **Rigor:** exploration labels and screening by eye. The bit-exact and ledger tests stay.
5. **Mutation in cyclic competition:** yes, through a new optional key. The old records stay valid.
6. **Deploy:** whenever the user chooses. Phases 0 and 1 do not need it.

Work started the same day with Phase 0.1 (the renderer) and B1 (the `mycelium3d-r0` rules and CPU reference).
