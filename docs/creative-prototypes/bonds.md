# Connected shapes

At `/particles/bonds/`, compare the same starting particle ecology with no connections, flexible chains, and denser networks. The chains allow two links per particle and can form rings; networks allow four. These are supplied constraints, not shapes discovered from nothing.

Nearby particles of the same founding family can connect. A bond pushes or pulls toward a preferred separation, breaks when stretched too far, and disappears when an endpoint dies. Connections carry no food and are not inherited. Individual particles still reproduce with occasional changes to their movement traits; a connected group does not reproduce as a unit.

Spring steering is engineered. The base model still charges its usual movement cost, but the extension does not track spring potential energy or claim physical energy conservation. Graph components describe connections, not organisms.

The three panels share a seed, recipe and comparison clock. Pause, step, restart, change the seed or movement recipe, and save a comparison observation. Saved observations cannot resume. Empty worlds remain empty; there is no rescue or reseeding.

[Plan and mechanics](bonds-plan.md) · [Decision log](decisions.html)

## First results

All nine fixed runs stayed populated through 6,000 ticks. Final chain worlds held 36–49 connected groups, with largest groups of 9–15 particles; mesh held 9–11 groups, with largest groups of 19–28. The final median live-link age was 69–78.5 ticks for chains and 61–62 for mesh. Nearly all removed links disappeared with dead endpoints, rather than breaking from stretch. Links keep being replaced; a connected shape is not a permanent set of individuals.

Initial visual inspection found strings and open polygons in chains, while mesh mostly made compact patch-centered knots. This is a visible difference worth retaining, with no claim of group reproduction. [All outcomes](bonds-pilot.md) · [Validation](bonds-validation.md).

[Independent visual review](reviews/bonds-visual-review.md) records exactly which frames were inspected. The local browser recording spans tick0 to6,000, with continuous4× playback through displayed5,985 followed by15 single-tick steps. It is available in `runs/bonds/browser/bonds-seed1201-tick-0-through-6000-pace4x.webm`; media are local and not shipped in the PR.
