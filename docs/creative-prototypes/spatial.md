# Spatial particle worlds

Open `/spatial/` locally. The three founding families now move, feed and reproduce in a real three-dimensional space. They interact across the cube's opposite faces, so a particle leaving one face returns through the other. This is an independent creative toy; the earlier 2D worlds are unchanged.

Start with **Pursuit**, then compare **Flocks** and **Colonies** using the same seed. Apply settings with **Start new world**; the active settings label identifies the running recipe. Play with the camera fixed first. Orbit the cube or use the depth slice to inspect whether apparent crossings are actually separated in depth. Camera and slice controls do not alter the simulation. The displayed count can be smaller than the full population when a slice is active.

Eight supplied food patches renew energy. Their overlapping spheres and fixed order favor some feeding locations; food seeking can organize particles into layers near the supplied centers. Pursuit changes direction of movement, not predation. Offspring inherit three attraction traits with occasional small mutations, and split their parent's energy. A population ceiling blocks and counts births; finite lifespans and energy shortages remove particles. Those ingredients are engineered, not discovered from a bare physics law.

The world starts paused. One tick always applies the same simulation rules. Playback requests 60 ticks per second at1x or240 at4x, with bounded work per frame; slow devices may advance more slowly. The run stops at6,000 ticks or extinction. The chart shows retained recent history, while an exported observation saves the current state and that history; it cannot resume. Replay is only promised within the same runtime.

[Accepted plan and review resolutions](spatial-plan.md) · [Backlog inventory](backlog-status.md) · [Decision log](decisions.html#spatial-next)

## First fixed observations

All nine runs (three recipes × seeds1201–1203) retain all three families through6,000 ticks. Final populations range from130 to170. During the final1,000 ticks, each world records658–880 births and647–874 deaths, so apparent clusters contain ongoing turnover.

Pursuit is the most variable recipe. Seed1201 spreads across an average18.2 of125 spatial bins and4.41 of5 depth bands late in the run; seed1202 contracts to8.2 bins and2.08 bands. Flocks average6.0–7.7 bins, forming tight food-centered knots. Colonies average9.0–12.7 bins. No world hits the population ceiling during the late window. These are observations, not a score for evolution or a guarantee of future survival.

Actual fixed-camera browser recordings of all three recipes at seed1201 reach6,000 ticks. Flocks show tight clusters, pursuit shows dispersed particles and changing family shares, and colonies form separated groups. The supplied food geometry still strongly organizes them. Adding depth produces a useful exploration view; it has not removed the tendency to settle around resources.

[Every outcome and early/late metrics](spatial-pilot.md) · [Validation and review record](spatial-validation.md)
