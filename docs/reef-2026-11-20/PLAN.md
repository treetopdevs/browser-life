# Plan: The Reef — Mechanochemical Morphogenesis in a Vertical Water Column (Direction C)

*2026-11-20. Branch: `reef-world` (branched from `main`, leaves `RULE_VERSION 1` and all existing sandboxes untouched).*

## Why this is perpendicular to every branch on `main`

Every previous world on `main` (`RULE_VERSION 1`, `bodies-loose`, `vesicle-thread`, `oligomer` Phase A, `droplets` Phase B2) lived in a **flat 2D diffusion bath** (or isotropic box) where cell geometry did not physically create niches, and phenotypes were drawn from a small closed menu (named gene bytes or 6 immiscible colors).

**The Reef** flips the world on its side into a **2D vertical cross-section** (sunlit surface at `y = 0`, seabed at `y = H`) with **real physical tradeoffs**:

1. **Directional sunlight + real shadow casting:** Light enters from the top; pigmented cells physically shade everything below them. Height and canopy shape are physical weapons.
2. **Gravity + sinking detritus + seabed nutrient cycling:** Dead biomass sinks to the seabed as marine snow and mineralizes into dissolved nutrients. **Energy enters at the top; recycled matter accumulates at the bottom.**
3. **Exact integer matter conservation (`residual = 0`):** Every unit of matter (`nut`, `det`, `cell.mass`, `cell.nut`) is an exact integer quantum. No external food tap; nothing is created or destroyed.
4. **No `Organism` class, no named cell types:** Multicellular bodies are emergent connected graphs of spring-hinge bonded cells. Every cell runs the same compact fixed-size developmental GRN (`8 → 6 → 9`, 102 `int8` weights) reading strictly local physical cues (light after shadows, external nutrients, detritus, seabed contact, bond count, and 2 bond-diffused morphogens) to express continuous traits (`pigment`, `armor`, `digest`, `anchor`, `contract`, morphogens, `bondKeep`, `divAngle`).
5. **Symplastic transport along bonds:** Bonded cells passively exchange `nut` (up from roots) and `energy` (down from sunlit leaves) across shared bonds, giving differentiated multicellularity a direct physical payoff.

---

## Falsification Ladder

### Rung 0: Physics, Conservation & Determinism (Unit Gate)
- Exact integer matter conservation (`residual === 0`) across uptake, bond transport, growth, division, death, sinking, diffusion, and mineralization.
- Dark-world (`light = 0`) decays to `0` living cells with `residual === 0`.
- Real shadow casting: a pigmented upper cell strictly reduces light on a lower cell (`FULL` vs `NO_SHADOW`).
- Symplastic bridge: an anchored multicellular stalk spanning nutrient-rich seabed to sunlit water captures more growth than an unbonded control (`NO_BONDS`) in the same stratified column.
- Bit-determinism across identical seeds; pure observers do not change the digest.

### Rung 1: Abiotic Niches & Multicellularity (No Grazing Yet)
*Question: Do shadows + gravity/seabed separation + bond-mediated multicellularity break the single-generalist attractor without any predation or named roles?*

- **Arms (4–8 seeds each, starting from the same simple unicellular founder):**
  - `FULL`: shadows ON, gravity/sinking ON, bonds ON.
  - `NO_SHADOW`: uniform light (no occlusion), gravity ON, bonds ON.
  - `NO_GRAVITY`: well-mixed nutrients/detritus (no sinking/seabed gradient), shadows ON, bonds ON.
  - `NO_BONDS`: shadows ON, gravity ON, daughters always detach (unicellular control).
- **Pass criteria (pre-declared):**
  1. **Multicellularity & height:** `FULL` sustains multi-cell bonded bodies (mean body size ≥ 3 and canopy reach significantly higher than `NO_BONDS`).
  2. **Within-body differentiation OR niche divergence:** In ≥ 75% of `FULL` seeds, either (a) bonded bodies exhibit systematic vertical tissue differentiation (top cells higher `pigment`, bottom cells higher `anchor`/`digest` than a within-body shuffled null), or (b) the population splits into ≥ 2 spatially/functionally distinct clades (e.g., sunlit phototrophs vs. benthic detritivores), exceeding `NO_SHADOW` and `NO_GRAVITY`.
  3. Exact matter conservation (`residual === 0`) in every run.

### Rung 2: Mechanical Contact Grazing & Locomotion (After Rung 1)
- Enable contact digestion of soft foreign cells (resisted by `armor`), contractile swimming/crawling thrust via anisotropic fluid drag, and wave/current shear.
- Test whether grazing drives an arms race (armored/tall flora vs. mobile grazers vs. benthic decomposers).
