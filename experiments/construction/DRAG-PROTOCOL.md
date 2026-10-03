# Fixed polymer-drag pilot

This is a new constructed possibility test under rule version 2. It does not replace the successful stationary witness or relabel the unsuccessful moving confirmations.

The only selected physics change for this probe is the implemented `polymerDrag`: source polymer reduces outgoing B/P/E shares while preserving retained matter and energy at the source. The pressure-transport idea remains a separate, unimplemented proposal; this pilot does not introduce it.

Use the portable stationary witness genome and all of its parameters, except `ruleVersion:2`, `spread:1`, `polymerDrag:true`, `dtQ:0`, and `adhesion:false`. Motility and mutation remain disabled. One site at (16,16) starts with 1,024 B and 2,048 E on the 32×32 torus. All other matter and free energy, including initial P, are zero. Every arm receives the identical initial resource arrays.

Six fixed arms:

1. Builder: drag on, dissolved polymer gate on.
2. Builder: drag on, dissolved gate off.
3. Builder: drag off, dissolved gate on.
4. Builder: both effects off.
5. Matched nonbuilder: only BUILD bias 16→0, feedback wiring unchanged.
6. The recorded strongest simple nonbuilder, `simple-p127-r0-d127-g64`.

Both nonbuilders use drag and gating on; neither can produce P. The selected comparator is the best from the disclosed earlier stationary search, not a newly established optimum in this changed ecology. All builder controls continue paying actual construction and ordinary maintenance costs.

First run seed 1, continuously through 10,000 steps, with real checkpoints and endpoints at 3,000 and 10,000. No parameter tuning follows this pilot. Record initial and endpoint checkpoints, full configuration and genome, source hashes and snapshots before execution, 100-step traces, exact conservation, construction expenditure, active B, integrated B and cumulative directed A/C transport across the original site. B transport is sampled from the pre-step state at each 100-step observation and corresponds to that executed transport step. Spatial support and external-B maxima are sampled, not exact per-step maxima.

The functional question is whether construction preserves active biomass after paying its costs, compared with both nonbuilders. Examine the two ablations separately: drag can supply a mechanical benefit, while the dissolved gate supplies chemical retention. Do not attribute a combined benefit exclusively to one effect. Do not require locomotion or call redistribution propagation.

A negative pilot ends this experiment. A clean positive permits proposing a prospectively frozen fresh-seed confirmation; it does not automatically launch that confirmation, mixed-neighbour studies, accessibility studies or evolution.

Reproduce using a new output directory:

```sh
deno run --allow-read --allow-write tools/construction-drag.ts runs/construction/drag-pilot-v1
```
