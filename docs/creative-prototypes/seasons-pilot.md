# Seasonal food patches: bounded descriptive evidence

Nine fixed runs: flocks, mutation enabled, seeds 1201–1203, still / 600-tick phases / 1,800-tick phases, target 10,800 ticks. No interventions, rescue, or tuning. Runtime v24.2.0; toy rules version 4.

| Environment | Seed | Finished tick | Final family counts | Per-family min | Per-family max | First family loss tick | Sampled low→rebound episodes | Realized/offered renewal | Max abs residual | World extinction |
|---|---:|---:|---|---|---|---|---|---:|---:|---:|
| still | 1201 | 10800 | 43/23/64 | 34/16/40 | 76/83/98 | —/—/— | 0/0/0 | 0.7434 | 6.313e-8 | — |
| still | 1202 | 10800 | 19/0/110 | 16/0/40 | 94/88/125 | —/3126/— | 0/0/0 | 0.7362 | 5.816e-8 | — |
| still | 1203 | 10800 | 22/64/0 | 3/40/0 | 81/93/83 | —/—/5449 | 1/0/0 | 0.5819 | 3.997e-8 | — |
| seasonal-600 | 1201 | 10800 | 23/22/154 | 3/3/40 | 80/86/200 | —/—/— | 4/5/0 | 0.9998 | 4.016e-8 | — |
| seasonal-600 | 1202 | 10800 | 64/0/90 | 40/0/40 | 92/86/139 | —/2044/— | 0/0/0 | 0.9028 | 2.682e-8 | — |
| seasonal-600 | 1203 | 10800 | 97/0/69 | 35/0/40 | 109/79/113 | —/3982/— | 0/0/0 | 0.8324 | 2.222e-8 | — |
| seasonal-1800 | 1201 | 10800 | 57/25/78 | 18/9/4 | 85/86/110 | —/—/— | 0/0/1 | 0.7410 | 8.306e-9 | — |
| seasonal-1800 | 1202 | 10800 | 80/27/41 | 25/16/3 | 88/86/86 | —/—/— | 0/0/1 | 0.8032 | 2.311e-8 | — |
| seasonal-1800 | 1203 | 10800 | 81/26/22 | 14/22/3 | 109/95/75 | —/—/— | 0/0/1 | 0.7868 | 1.711e-8 | — |

No seasonal run was extinct before tick 1,800, so the six-arm early-extinction stop rule did not trigger. No tuning was performed in this slice. The fixed sweep retains all outcomes. Total population-cap ticks by environment: still 171, seasonal-600 154, seasonal-1800 154. Maximum absolute energy residual across all runs: 6.313e-8.

Family lows are sampled at censuses with 1–9 members and end at a later sampled census with at least 20; episodes cannot overlap, and a family that reaches zero cannot rebound. Per-family extrema and loss ticks are checked every tick. These are visible demographic swings, not fitness, adaptation, or independent recovery.

Censuses and patch stocks include tick 0, every 100 ticks, exact phase changes, and extinction. For period 600, tick 600 closes phase 0, then tick 601 is the first step of phase 1 and closes its one-tick interval; the same applies at tick 1800/1801 for period 1800. Within each seed, the world states of seasonal-600 and seasonal-1800 are bit-identical through tick 600 and diverge at tick 601. The machine-readable artifact includes every tick's family counts, interval ledger renewal deltas, offered renewal, realized/offered ratios, cap counts, residuals, stocks, regime, and transitions.

Within each seed, arms begin with the same state; all arms share phase order and initial stock, with row 0 rich first. Their later random trajectories diverge. Offered renewal can exceed realized renewal when patches are full. Food seeking steers toward the nearest patch regardless of stock, so clustering at a depleted patch is possible. These runs support no paired significance claim and no claim of adaptation.

The [season evidence](seasons-pilot.json) is compact JSON. Freshness check without simulation or writes: `node tools/particles/explore-seasons.ts --check`. The [compatibility receipt](seasons-compatibility.jsonl) records complete v3 artifact comparisons and the still-flock census prefix.
