# Spatial particle worlds pilot

Fixed matrix: three presets × seeds 1201, 1202, 1203 × up to 6,000 ticks; mutation enabled. Each outcome was independently repeated and its full final snapshot compared. Node v24.2.0; rules version 1; model SHA-256 `d7c666ceb6969a52e7ac151625f03864cc583a742e17104913f12ad9e7f3fe30`.

| Preset | Seed | Ticks | Extinction tick | Final population | Births / deaths | Family extinction ticks (0, 1, 2) | Max ledger residual |
|---|---:|---:|---:|---:|---:|---|---:|
| flocks | 1201 | 6000 | — | 149 | 5167 / 5138 | —, —, — | 2.487e-8 |
| flocks | 1202 | 6000 | — | 130 | 4534 / 4524 | —, —, — | 1.723e-8 |
| flocks | 1203 | 6000 | — | 153 | 5078 / 5045 | —, —, — | 2.390e-8 |
| pursuit | 1201 | 6000 | — | 160 | 4585 / 4545 | —, —, — | 2.910e-8 |
| pursuit | 1202 | 6000 | — | 168 | 4915 / 4867 | —, —, — | 2.774e-8 |
| pursuit | 1203 | 6000 | — | 168 | 4462 / 4414 | —, —, — | 2.843e-8 |
| colonies | 1201 | 6000 | — | 166 | 5236 / 5190 | —, —, — | 2.711e-8 |
| colonies | 1202 | 6000 | — | 164 | 5226 / 5182 | —, —, — | 2.716e-8 |
| colonies | 1203 | 6000 | — | 170 | 5230 / 5180 | —, —, — | 2.688e-8 |

## Early and late observations

| Preset | Seed | Window | Living / executed steps | Mean speed | Mean absolute vz | z / horizontal ratio | Mean occupied bins | Occupied z band min–max | Population min–max (final) | Cap fraction | Births / deaths delta |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| flocks | 1201 | early (1–1,000) | 1000/1000 | 0.000586 | 0.000285 | 0.9475 | 24.05 | 2–5 | 120–240 (145) | 0.0130 | 880 / 855 |
| flocks | 1201 | late (5,001–6,000) | 1000/1000 | 0.000420 | 0.000223 | 1.0980 | 7.71 | 2–4 | 136–175 (149) | 0.0000 | 780 / 802 |
| flocks | 1202 | early (1–1,000) | 1000/1000 | 0.000560 | 0.000278 | 0.9762 | 20.67 | 2–5 | 120–240 (152) | 0.0210 | 882 / 850 |
| flocks | 1202 | late (5,001–6,000) | 1000/1000 | 0.000385 | 0.000194 | 1.0129 | 6.00 | 2–2 | 118–134 (130) | 0.0000 | 658 / 647 |
| flocks | 1203 | early (1–1,000) | 1000/1000 | 0.000595 | 0.000293 | 0.9802 | 22.93 | 2–5 | 120–239 (152) | 0.0000 | 875 / 843 |
| flocks | 1203 | late (5,001–6,000) | 1000/1000 | 0.000440 | 0.000218 | 0.9792 | 7.41 | 2–3 | 128–159 (153) | 0.0000 | 742 / 738 |
| pursuit | 1201 | early (1–1,000) | 1000/1000 | 0.002548 | 0.001260 | 0.9849 | 52.04 | 5–5 | 120–198 (137) | 0.0000 | 677 / 660 |
| pursuit | 1201 | late (5,001–6,000) | 1000/1000 | 0.000914 | 0.000436 | 0.9170 | 18.22 | 3–5 | 124–171 (160) | 0.0000 | 738 / 748 |
| pursuit | 1202 | early (1–1,000) | 1000/1000 | 0.002339 | 0.001193 | 1.0332 | 51.19 | 5–5 | 120–201 (136) | 0.0000 | 688 / 672 |
| pursuit | 1202 | late (5,001–6,000) | 1000/1000 | 0.000466 | 0.000232 | 0.9966 | 8.17 | 2–3 | 159–177 (168) | 0.0000 | 880 / 874 |
| pursuit | 1203 | early (1–1,000) | 1000/1000 | 0.002147 | 0.001047 | 0.9547 | 47.13 | 5–5 | 120–202 (132) | 0.0000 | 713 / 701 |
| pursuit | 1203 | late (5,001–6,000) | 1000/1000 | 0.000706 | 0.000310 | 0.8374 | 13.24 | 2–4 | 130–181 (168) | 0.0000 | 806 / 785 |
| colonies | 1201 | early (1–1,000) | 1000/1000 | 0.000805 | 0.000404 | 0.9944 | 40.16 | 4–5 | 120–240 (137) | 0.0200 | 879 / 862 |
| colonies | 1201 | late (5,001–6,000) | 1000/1000 | 0.000670 | 0.000335 | 0.9969 | 10.68 | 3–3 | 150–176 (166) | 0.0000 | 868 / 870 |
| colonies | 1202 | early (1–1,000) | 1000/1000 | 0.000802 | 0.000408 | 1.0240 | 36.46 | 5–5 | 120–240 (148) | 0.0190 | 872 / 844 |
| colonies | 1202 | late (5,001–6,000) | 1000/1000 | 0.000677 | 0.000340 | 1.0062 | 9.00 | 2–2 | 152–174 (164) | 0.0000 | 872 / 868 |
| colonies | 1203 | early (1–1,000) | 1000/1000 | 0.000816 | 0.000409 | 1.0016 | 39.24 | 4–5 | 120–240 (149) | 0.0040 | 873 / 844 |
| colonies | 1203 | late (5,001–6,000) | 1000/1000 | 0.000645 | 0.000322 | 0.9955 | 12.66 | 4–4 | 152–175 (170) | 0.0000 | 867 / 866 |

- Early summaries cover ticks 1–1,000. Late summaries cover ticks 5,001–6,000. Motion and occupancy means use living steps; population range and turnover include every executed step, including the extinction step. Unavailable metrics are null.
- Late assay flags prompt scrutiny when every living late step occupies one z band or mean absolute vz is zero: none were flagged.
- Spatial occupancy and movement are descriptive observations, not success thresholds. Food is engineered renewable energy; pursuit is not predation. A population cap can constrain births. The outcomes do not establish adaptation, evolution, or persistence beyond the recorded horizon.
- The JSON retains every 100-tick census, full snapshots at 0/1,000/3,000/6,000 when reached and at exact extinction, plus each independent repeat. Replay is same-runtime only.

Check the recorded batch without simulation: `node tools/spatial/explore.ts --check`. Reproduce every run and repeat: `node tools/spatial/explore.ts --replay-check`.
