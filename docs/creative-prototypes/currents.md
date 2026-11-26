# Nutrient currents

The aquarium now has an engineered way to bring nutrients back from the bottom: 32 paired columns carry them up one side and down the other. Only nutrient moves with the pump. Biomass and detritus follow the original rules, and every material unit remains accounted for.

Open `/currents/` locally. The live tanks compare still water and pumps, each with and without a finite rain supply. Switch to **Difference from still water** to see exactly where the pump changes nutrient availability. The arrows show the supplied pump direction; they are not measurements of fluid velocity.

The recorded replay below the live tanks contains all three seeds and all four conditions. Choose the early close-up (one saved state every four ticks) or the full run (one every hundred ticks), then play or scrub. Labels show actual saved ticks; the viewer does not invent states between them. Changing the recorded seed pauses playback and verifies the next file before displaying it.

## First fixed result

All six pump-enabled worlds still contain biomass at tick 6,000. All six still-water controls lose it by tick 1,000 (790, 1,000 and 790 for seeds 1201–1203). The original aquarium model produces exactly the same still-water results.

The pumps produce large early blooms: sampled peaks range from 10,617 to 12,918 biomass units. By tick 6,000, those blooms have shrunk to 469–496 units across 33–36 occupied cells. During the final 1,000 ticks, each surviving tank still converts 4,695–6,221 nutrient units into biomass, alongside mortality and recycling. This is ongoing turnover, not a frozen final image.

Finite rain ends at tick 4,096. Rain-fed pump tanks continue shrinking substantially afterward; survival through 6,000 does not establish indefinite persistence. These supplied patches have no genes or inherited traits, so this result does not demonstrate evolution.

[Validation and review closure](current-validation.md) · [All twelve outcomes](current-pilot.md) · [Plan and decisions](current-plan.md) · [Decision log](decisions.html#currents-next)

## Reproduction and local scope

Use Node 24.2.0. `node tools/currents/explore.ts --check` validates the retained evidence and replay files without rerunning the simulation. `--replay-check` reruns the fixed batch and compares all outcomes and compressed replay assets. `--write` generates a complete batch; preserve prior records when making a new experiment.

The `.replay` containers hold losslessly gzip-compressed little-endian fields. The neutral extension avoids browsers unpacking them before the compressed-byte integrity check. All original numeric results and compressed bytes were preserved through that packaging correction.

The page, manifest and replay files are excluded from production packaging. No deployment is part of this slice.
