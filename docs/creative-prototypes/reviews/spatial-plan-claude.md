**Verdict:** no blocker. The model contract is mostly sound, and the energy identity holds as written: consumption is internal, splitting conserves energy, and deaths go to `deathLoss`. Fix the items below before implementation.

## Concrete contradictions

1. **"Aborts on invariant failure" vs "records failure, not shortened success"** (pilot paragraph). Pick one. I'd write a failure record for that run, exit nonzero, mark the whole matrix failed, and have `--check` reject it.
2. **"Max-depth-band occupancy remains 1"** (gate) is not a census field. The census has "occupied z bands (5)". Rename the gate to "occupied z bands == 1".
3. **"Fixed tick pacing … no hidden catchup"** conflicts with "copied from 2D". `apps/lab/src/particles/main.ts:132` uses a wall-clock accumulator, clamped to 100 ms and scaled by speed. Decide:
   - **Recommended:** 1x = 1 tick per rendered frame, 4x = 4 ticks per frame, no accumulator. At 120 Hz this runs twice as fast in wall-clock time, so say so in the UI.
   - **Alternative:** keep the accumulator and drop the "fixed" wording.
4. **"Render module independent from model"** but the slice uses `torusDelta`, which the model exports. Define the dependency: render imports only types and `torusDelta`, and takes read-only arrays. Or duplicate the helper with a parity test.
5. **"Reduced-motion starts paused"** is redundant, since everything starts paused. Either drop it or say what reduced motion changes. I'd cap 4x or smooth the camera.
6. **"History charts show actual population"** vs the retained `historyMax` 300 at `sampleEvery` 10. A 6000-tick run keeps only the last 3000 ticks, which is not stated. State it in the UI. Say that the runner's 100-tick census calls `census()` directly and does not read `history`.

## Missing implementation decisions

**Determinism**
- **Norm computation.** `Math.hypot` is not required to be correctly rounded and can differ across engines. The 2D model also uses `** 2`. Specify `Math.sqrt(x*x+y*y+z*z)` and `r*r`, so browser animations and Deno pilot numbers are far less likely to diverge. Otherwise state that browser clips are not asserted to equal pilot trajectories.
- **RNG draw order.** "x/y/z and vx/vy/vz in that order" is ambiguous. The 2D order is x, y, vx, vy, age, lifespan. Pin the 3D order as x, y, z, vx, vy, vz, age, lifespan. For newborns, pin x-offset, y-offset, z-offset, then lifespan. Mutation-off must not touch `mutationRandom`, as in 2D.
- **Where the 3D norm applies.** Name movement cost, `meanSpeed` and the food-seeking normalisation. The plan only says "cap".
- **RULES version.** Set `version: 1` and add `sourceVersion: 4`, so the 2D `version: 4` isn't copied literally.
- **Energy identity.** Check it at every 100-tick census, not only at the horizon.

**Food geometry** (declared, but not examined)
- Radius .30 on a .5 lattice means adjacent spheres overlap. The lattice covering radius is about .433, so coverage is partial (about 70%, my estimate) but the overlaps are large.
- With "first intersecting by array order", low-index patches drain first in overlap zones. Declare that this is intended.
- Nearest-centre seeking plus a symmetric lattice pulls particles to two z-planes (.25 and .75). z occupancy may look layered rather than three-dimensional. That is fine, but it is the likeliest "why is it flat" finding.

**Assay**
- **Mean |vz| alone doesn't show 3D motion.** Add the isotropy ratio mean|vz| / mean(|vx|,|vy|) to the census and pilot. Food and interaction geometry are axis-symmetric, so a ratio far from 1 flags an axis bug cheaply. Pre-state that it is a diagnostic, not a pass criterion.
- **Index the binning.** Define `floor(x*5)`, which is safe because `wrap` returns [0,1).

**Camera and render**
- Perspective vs orthographic is unspecified, yet "depth-scaled markers" implies perspective. Pin:
  - the camera distance and FOV;
  - the default yaw and pitch, which must not be axis-aligned (pitch 0, yaw 0 collapses depth);
  - the painter's sort, with ties broken by id;
  - the back and front cube edges drawn in two passes.
- Say how the torus seam is shown: raw [0,1] positions with no ghosts, so particles jump faces. State that in the disclosure.
- The food spheres overlap heavily. Default to centers or rings, with spheres opt-in and drawn translucent behind particles. Say whether spheres are clipped at the cube faces or wrapped.
- Pin the slice boundary rule, `|torusDelta(z−c)| <= .10`, inclusive or not.
- Add a test that camera and slice changes during a running world leave the state hash identical to a run with no camera input. The current browser check covers only the paused case.

**Files and API**
- No file list: the page, `render.ts`, the pilot tool and the Vite input.
- No signatures for `project(point, camera)` or `Camera`. This matters because the plan delegates "disjoint files" while the parent owns the API.

## No hidden change to old worlds

The standalone model is clean. The residual risk is shared config: the Vite input, Dockerfile, `.dockerignore` and Caddy edits. The Dockerfile, `.dockerignore` and Caddy were not inspected, and a quick grep of the Docker/Caddy/Vite configs found no mention of particles. Specify the exclusion mechanism, and check that existing page outputs and the existing tests are unchanged after the edit. Also keep `/spatial/` out of the catalogue, sitemap and nav.

## One tension to settle

"No hidden tuning after results" conflicts with your goal of a watchable prototype. Pre-declare that a failed or flat pilot allows one documented revision. It would be a new `RULES` version, with the failed pilot retained. Without that, a flat 3D result stalls the slice instead of producing something watchable.

I made no edits and ran no simulations.
