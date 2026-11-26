# Keep watching: compare particle worlds

This local prototype lets you choose movement recipes you enjoy. It does not automatically measure evolutionary progress.

1. Open `/particles/picker/` after `pnpm dev`.
2. Watch three worlds at the same seed and comparison age. The first comparison shows all three movement presets. After a choice, one is the exact selected baseline and two change one bounded recipe setting.
3. Pause and keep a favorite. Add a short reason if you want. The favorite becomes the exact baseline of a fresh comparison; two new variants appear beside it.
4. Export the recipe session to keep its choices and ancestry. Importing a session starts its current comparison paused at tick zero. It does not load the previous particle positions.

The adjustable recipe contains the three-family attraction table, alignment and food renewal. Everything else, including the population ceiling and food-seeking pull, remains fixed. A recipe selection is a person's design choice. Within each world, organisms still inherit traits and mutate independently.

All three worlds advance together. An extinct world remains empty while the global comparison clock continues, so it cannot hold the other worlds back. Comparisons restart at tick zero after a choice. New seeds/settings start a new history explicitly.

Sessions hold up to 30 selections. At the limit, export and start a new session. Imports are limited to 128KiB and validate the supported version, bounded finite settings and complete selection ancestry. Invalid imports leave the current session intact.

## Evidence

The original version1 default-preset pilot is preserved in [history](history/README.md). Current model checks pin the original default trajectories. Picker pilot choices are scripted to exercise selection paths and ancestry; they are not presented as preferences, survival improvements or an automated search result.

[Plan](picker-plan.md) · [Running decision log](decisions.html)
