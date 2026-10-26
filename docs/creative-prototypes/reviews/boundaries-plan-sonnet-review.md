Status: I finished the read-only pass. I read the plan, the integration files you listed, and `apps/lab/test/particle-comparison-clock.test.ts`. I also did one grep of the particle `index.html` heads and one sitemap glob. I changed nothing and ran no commands.

The model arithmetic is sound. With dt=.25, 4·dt·DB=.16 and 4·dt·DN=.30, so both diffusion updates are convex combinations. The reaction increments are bounded as well, so B and N stay inside [0,1]. That shapes finding 3 below.

## Must fix before implementation

1. **There is no success criterion, and the failure labels have no definitions (L22, L17, L24).**
   - The plan only names negative outcomes: "spread/freeze" and "walls merely preserve starting blobs".
   - The census has no metric for "preserve starting blobs", such as overlap of the B≥.35 mask with the tick-0 mask. It has no definition of "spread" or "freeze" either.
   - "Late change over 2000–3000" (L22) is undefined. It could be the mean of the 100-tick intervals with toTick in (2000,3000], or something else.
   - For a world that went extinct earlier it must be reported as "extinct", not 0, and the plan must say how six seeds are aggregated.
   - `meanAbsDelta` of B conflates uniform growth or decay with shape change. L24 asks the reviewer to tell "changing shapes" from "static boundary contrast", but nothing measures shape change. Add a mask-flip fraction between samples.
   - Write numeric predicates for each outcome, and the positive criterion, before the first run. Otherwise the classification is post hoc.

2. **The clock contract does not fit the existing helper (L19, L30, L14).**
   - `comparison-clock.ts:2-3` requires `particles: readonly unknown[]`. It also records extinction externally, in `extinctionTicks` (`:14`).
   - The plan's world has no `particles` and has its own `extinctionTick` getter, and L19 forbids adapting particle concepts.
   - Choose one:
     - A new field-world clock keyed on `extinctionTick`. It needs the same lockstep, freeze, no-resurrection, all-extinct-stops and tick-cap test as `particle-comparison-clock.test.ts:5-22`.
     - A widened shared interface.
   - State which extinction record is authoritative.
   - State whether `BoundaryWorld.step()` on an extinct world is itself a no-op (tick, history and N unchanged). L14 says "freeze" but not who enforces it.
   - L3's "dependent PR" still holds either way, because the Vite, Dockerfile and Caddy edits sit next to the bonds entries.

3. **Several unit tests are unreachable through the stated API (L27, L30, L14, L34).**
   - The constructor is `(seed, mode)` and the snapshot is not resumable. So no test can set up the states the plan lists:
     - uniform diffusion;
     - wall gating across the seam;
     - new-wall timing;
     - tiny-component cutoff or wrap;
     - clamp or floor.
   - The clamp case is worse: by the bounds above, clamp adjustment is provably 0 in any real run.
   - Add a documented test seam, such as a pure `stepFields` and a `componentStats(B, size)` export, or a test-only `fromFields`.
   - Add an invariant that clamp adjustment is 0 within roundoff in real runs. A nonzero value then flags a bug.
   - "Holds no mutable references to caller inputs" (L34) is vacuous when the inputs are a uint32 and a string. The real question is whether the field getters return live arrays or copies. Say which, and test that `snapshot()` is independent of later steps.

4. **Sampling and census timing are ambiguous (L32, L17, L22).**
   - L32 says sampled-change is "computed before updating the previous-sample field copy", but `census()` is a public call.
   - If `census()` advances that copy, the 100-tick interval depends on how often the UI calls it.
   - Specify that `step()` takes the samples, at tick%100==0 and at extinction, and that `census()` is side-effect free. Test `step(250)` against 250 single steps, including `history`.
   - An extinction on a multiple of 100 must emit one sample, not two.
   - State whether CLI "scheduled samples" after extinction are omitted or carried as frozen rows (L22 "retain all scheduled outcomes").
   - `blockedEdgeFraction` is ambiguous in two ways. The denominator should be the 8192 undirected edges. It should also say whether it uses W as of the last step or the new W that gates the next tick.
   - Define `neighborContrast` (per cell or per edge, max or mean) and "active cell" (B≥.35, same as the component threshold?).
   - Also define the history bound (L32). State what the download records when the 300-sample cap drops the oldest samples, such as a `droppedSamples` count. State whether sample 0 is kept.

5. **Initialization is under-specified for a "bit-identical" claim (L14).** None of these is stated:
   - the PRNG algorithm and its uint32 to [0,1) mapping;
   - how seed 0 is handled (xorshift-style PRNGs stick at 0);
   - draw order (per blob: x, y, radius, then the 4096 noise draws in raster order?);
   - whether the radius is σ or a cutoff, and whether it is continuous or integer;
   - whether the profile is exp(−d²/2r²) or exp(−d²/r²);
   - minimum-image torus distance;
   - whether overlapping blobs sum before the .95 clamp;
   - whether the centers are integer cells.

   F should also say that x and y are integer cell indices.

6. **The exact update formulas are missing (L8–L10).**
   - The flux is never written down. It should be `dt·D·(old_a − old_b)`.
   - The plan never says clamp is followed by floor, with `<.0001` strict, applied to B only.
   - The ledger should say whether `diffusionResidual` is the sum of the deltas actually applied to cells. It must not be the sum of edge fluxes, which cancels by construction.
   - "Diffusion-sum residual ≤1e-10" (L34) must say whether it covers B only or N as well.
   - Say that the ledger checks bookkeeping and not reaction correctness. Reaction correctness needs hand-computed single-cell tests.
   - "Isotropic" (L8) is wrong for a 4-neighbor stencil. Say symmetric under edge direction instead.
   - State that `walls` is the smooth reaction plus walls, and `both` is the threshold reaction plus walls. L5 does not say so.

7. **Production gating is only named, not specified (L19).**
   - `deploy/Caddyfile:9` matches `(?i)^/particles(?:/|$)` only. `/boundaries` needs its own case-insensitive matcher, placed before the redirects and `try_files`.
   - `Dockerfile.site:6` removes explicit globs per particle entry. The plan needs `dist/boundaries` and `assets/boundaries-*.{js,css}`.
   - The asset prefix follows the `input` key at `vite.config.ts:161-179`. A `manualChunks` entry at `:156-160` must also keep the `boundaries-` prefix, or the glob misses it.
   - Name a check that the built `dist` has no boundaries markers after the removal. The plan says only "public-route regression" and does not say how a Caddy deny is exercised.
   - Not a problem: the existing private pages carry `robots noindex` and no canonical (grep of the particle `index.html` files). `apps/lab/public/sitemap.xml` exists, so "no sitemap" means not adding to it.

## Should fix (cheap, and they affect honesty)

- **Evidence freshness (L27).** Re-running 24 runs of 3000 ticks inside vitest is likely slow. I estimate tens of seconds, but I haven't measured it. Specify the mechanism: a source/rules digest plus a spot replay of one seed, for example. Also name the CLI runtime, entry point and output path.
- **Browser/CLI equivalence (L24).** `Math.sin`, `cos` and `exp` are not bit-stable across JS engines. "Same-runtime" (L6) is right, but the plan should say the browser capture is not claimed to equal the CLI batch beyond the runtime they share. If it is claimed, add a check that the exported tick-N snapshot matches a CLI replay.
- **Write down the predicted outcome.**
  - Smooth and walls modes: background ≈.02 at N=.8 grows to a carpet. Mean-field B* is about .53–.82 across F, above the .35 census threshold. The prediction is one spanning component and no walls.
  - Threshold and both modes: wall production at the flanks of the starting blobs, at B·|ΔB|≈.05, gates them within a few dozen ticks. That blocks the transport that lets fronts move, and nothing in the rules reopens a wall.
  - These are my back-of-envelope estimates, not simulated. The plan's own stop rules look like the expected outcome, which is honest, but recording the prediction first makes a surprise informative.
- **Wall display (L17).** The legend should state that W acts only as a binary gate at ≥.55, even though the field is continuous.
- **Island metaphor (L17).** The "Soup and islands" title is inverted when the filled phase is the majority. Consider reporting whether the B≥.35 region spans the torus.
- **Pace and tick cap.** The plan sets neither a maximum pace nor a total-tick cap. The particle clock caps at 10M. Four 4096-cell worlds on the main thread at high pace could stall frames.
- **Seed field (L17).** Say what the UI does with a seed that is not a uint32.
