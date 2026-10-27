# Soup and islands

Open `/boundaries/` on the local development server. Four panels use the same starting seed and age: smooth growth, smooth growth with reinforced boundaries, threshold growth, and threshold growth with boundaries. Pause, step or reset the comparison. Density and nutrient views share a fixed 0–1 scale; the wall overlay shows supplied barriers. Wrapping edges make the square a torus.

This is an engineered continuous field toy. Density is a proxy, not a collection of organisms. Nutrient is renewed by a fixed spatial pattern. Walls accumulate near density differences, decay, and block density diffusion when either endpoint is at least .55; nutrient still crosses. Walls do not block local growth. Threshold growth favors already dense patches and suppresses thin background. Its growth coefficient differs from the smooth recipe, so this is a recipe comparison rather than a single-factor causal assay.

A region is four-connected density at least .35, containing at least four cells. Tiny regions are counted separately. Region counts do not identify organisms, track lineages or demonstrate division. Sampled change measures density and threshold-mask changes over the displayed interval; a bright or sharply outlined still shape can have little ongoing change.

Exports contain observations, fields, rules and bounded recent history; they do not resume a simulation. Extinct fields freeze without rescue. The browser and command-line runner use the same source but no cross-engine bit identity is claimed.

[Plan and review decisions](boundaries-plan.md) · [Fixed six-seed comparison](boundaries-pilot.md) · [Decision log](decisions.html#boundaries)

The fixed comparison produced a clear limitation: smooth growth and walls alone filled the square, while walls plus threshold growth kept3–6 islands but showed no late active-mask changes. Keep this as a shape-making demonstration; the fixed rules did not deliver sustained shape turnover.

Local animation: `runs/boundaries/browser/boundaries-seed1201-through-3000.webm`, with actual screenshots at ticks0,505,1503 and3004.

No merge, deployment, research-kernel change, heredity or evolution claim belongs to this slice.
