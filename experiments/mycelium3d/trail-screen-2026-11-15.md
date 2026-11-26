# 3D mycelium: first trail screen (15 Nov 2026)

**EXPLORATION.** Plan step B4 (`docs/3d-expansion-plan-2026-11-15.md`, Phase 1). There is no pre-registration, no gate and no label. The runs are judged by eye from the pictures plus descriptive numbers. Two seeds per setting, so any pattern seen in one seed only is marked as such.

**Bottom line.** In this screen, depth alone does not keep trail. Only the toll road keeps it, as a fog everywhere without sinking and as a bed on the floor with sinking. The owner gate and conduit were idle (no territories formed), so the 2D lead was not tested.

When waste sinks, particles carry matter upward in every sinking run without the toll (16 of 16). That flux roughly matches the expected net downflow of the field rules run by run, but in the second half of every sinking run, no trail component of any size runs from the surface group to the floor group.

**The question.** Does depth, plus the 2D levers, keep trail alive? In the default 3D world, trail is purged almost everywhere, as it was in 2D.

## Setup

- **Rule.** `mycelium3d-r0` on the GPU twin (`GpuMycelium3d`). The kernel files were not touched.
- **World.** A 64 × 64 × 32 field (131,072 cells). That is 8× the default 32 × 32 × 16, so founders and the particle cap scale by 8: 8,192 founders and `maxParticles` 65,536 (the rule's cap). The largest population in any run was 21,245, and no birth was refused. Every other key is `defaultConfig()`: `light` 1, uniform light, `diffA`/`diffC` 40, inherit, and so on.
- **Run length.** 50,000 steps on seeds 1 and 2. No cut was needed (timing below).
- **Grid.** 3 × 3 × 2 settings × 2 seeds = 36 runs:
  - **`sinkShift`:** absent (`sinkoff`), 6, 4.
  - **Trail rule:**
    - `none`: no key.
    - `toll`: the 2D R4 toll road as in `tools/mycelium/bootstrap-arms.ts` `TOLL`: `trailMoveDiscount` 64, `trailDiscountMode` toll **and `moveCost` 12** (default 2). So toll differs from none in two ways, and in 3D the movement cost also charges `|MZ|`.
    - `owner`: the 2D owner screen's no-toll N-EC arm (the 6-of-8 lead): `trailOwner` gid, `ownerDefend` 4 (θ mid), `ownerConduit` 30 (g mid, sized on 2D territorial pilots), cap absent (255), no toll. **These strengths were sized in 2D and not re-sized for 3D.**
  - **`lightK`:** 16, 64.
- **Ledger.** The full state was read back every 20 steps (2,500 reads per run, 90,000 in all). At each read the runner checked the step count and both ledger residuals (matter, and energy against `lightIn − heat`). Every one was exactly 0. `validateState` ran every 2,000 steps and found no problem.
- **Code.**
  - `tools/mycelium3d/screen.ts`: the runner; `--render` and `--table` work without the GPU.
  - `tools/mycelium3d/observe-screen.ts`: the grid and the pure readouts.
  - `tools/test/mycelium3d-screen.test.ts`: the unit tests.
- **Spans over every component** (added after a review). The first grid kept only the largest component, and the stored files do not hold the trail field. So the 24 sinking runs were rerun with readout version 3, which adds the count of components, the longest span among all of them, and how many reach from G1 to G8 and from layer 0 to layer 31. Output is in `runs/mycelium3d-screen-spans/`. The runs are deterministic: every readout, window and projection of the rerun equals the first grid's byte for byte (24 of 24), and every ledger check was again residual 0. The no-sinking runs were not rerun; the claim is about sinking worlds.
- **Raw output.** `runs/mycelium3d-screen/` (gitignored): `runs/<id>.json`, `run-log.jsonl` (36 started and 36 finished lines), `png/<id>.png`, `contact-sheet.png` and `table.md` (the full readout table).
- **Commands.**
  ```
  deno run -A --no-lock tools/mycelium3d/screen.ts --out runs/mycelium3d-screen --jobs 2
  deno run -A --no-lock tools/mycelium3d/screen.ts --out runs/mycelium3d-screen --render
  deno run -A --no-lock tools/mycelium3d/screen.ts --out runs/mycelium3d-screen --table
  ```
- **Timing.**
  - One owner run alone took 92 s for 50,000 steps (with 2,500 reads).
  - The grid at `--jobs 2` took 39.6 minutes of wall time. Individual runs took 109 to 161 s (mean 132 s) while sharing the GPU with each other and with a machine at load about 370.

### Readouts

Every 2,000 steps, the readouts are taken from `read()`. "Late" means the mean over the readouts in (25,000, 50,000]. The groups are 8 slabs of 4 layers each: G1 is layers 0–3 (the surface) and G8 is layers 28–31 (the floor).

- **Particles, matter and light by depth.**
  - Particles and body matter M, and field A, C and P, are summed per group (also stored per layer).
  - Light is the mean per cell of the plane the next step uses, in /256.
- **Trail.**
  - The trail mass by group.
  - The share of occupied cells (at least one particle) that hold P ≥ 1.
  - The **largest 6-connected component** of cells with P ≥ 1 (x and y wrap, z closed): its size, z-range and cells per group. It is computed twice: over the whole volume, and with the floor layer (z 31) left out. With sinking, trail rains onto the floor, and a floor sheet is litter, not structure.
- **Net upward transport by particles.** For every particle alive at two consecutive reads 20 steps apart (matched by id), the sum of M at the earlier read × the layers it rose ((z_before − z_after) / 256, because z grows downward). Gross up, gross down and net are reported per 1,000 steps in matter-layers.
  - **What it misses:**
    - moves of particles born or dead inside a 20-step interval (the matched share of matter is 0.92 to 0.97);
    - changes of M inside an interval;
    - back-and-forth within an interval;
    - child placement;
    - all field transport.
  - **How to read it.** When the matter per layer is steady, the net body flux equals the matter bodies release above where they took it up. Positive therefore means bodies lift matter.
- **Field fluxes, for scale.** These are expected values from per-layer totals, not measured (`fieldFlux`):
  - sinking sends (C + P) / 2^k down from every layer above the floor;
  - diffusion sends q · De / 1536 through each z face.

  Diffusion of C is computed on the profile sinking leaves, because diffusion follows sinking within a step. The estimates are approximate: they read the end-of-step state, and they ignore the owner conduit's extra A rate.

  **Check.** In a steady state, the net field downflow (sinking − diffusion of C − diffusion of A) should equal the particles' net up. Per run they come close: they agree in sign in 33 of 36 runs, and to within 0.3 million matter-layers per 1,000 steps in 29 of 36. The largest gaps (up to 1.9 million, with the particle flux the smaller in magnitude) are in no-sinking worlds with strong downward particle flux, where the 5 to 8% of matter on unmatched particles matters most. This supports the transport readout, as an approximate one.
- **Turnover.** Births and deaths per 1,000 particle-steps.
- **Genotype count.** The number of live genotype ids.
- **Owner worlds.** The share of directed face edges from owned cells whose neighbour has the same owner, and the median min(Q, Q) on those edges. This is the check for an idle conduit.

## Pictures

**Contact sheet:** `runs/mycelium3d-screen/contact-sheet.png`, copied to `experiments/mycelium3d/trail-screen-2026-11-15-contact-sheet.png` because `runs/` is gitignored.

- **Layout.** There is one tile per run at step 50,000.
  - Rows are sinking × trail rule.
  - Columns are k16 s1, k16 s2, k64 s1, k64 s2.
- **Inside each tile.**
  - Top views (x by y, summed over z) are above; side views (x by z, summed over y, surface up) are below.
  - Particles are orange on the left, and trail is green on the right.
- **Colour scale.** One log scale is shared by all tiles, so a world without trail is black.

The per-run tiles are in `runs/mycelium3d-screen/png/`.

## Tables

Each cell is "mean of the two seeds (seed 1 / seed 2)". The z-spans are late-window means of the number of layers the largest component covers (0 = no trail), plus the late maximum. Full table, including every per-run row: `runs/mycelium3d-screen/table.md`.

### Trail

| setting | trail P | P in G1-2 | P in G8 | occupied cells with trail | largest component (cells) | its z-span | its z-span, max | largest component without the floor layer | its z-span | same-owner edge share | median min(Q,Q) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| sinkoff.none.k16 | 5,362 (10,645 / 79) | 683 (1,307 / 58) | 426 (851 / 0) | 0.026 (0.052 / 0.001) | 64 (124 / 4) | 3.5 (5.8 / 1.1) | 7 (11 / 3) | 61 (117 / 4) | 3.3 (5.5 / 1.1) | - (- / -) | - (- / -) |
| sinkoff.none.k64 | 5,241 (10,162 / 320) | 4,559 (9,005 / 113) | 30 (53 / 8) | 0.045 (0.088 / 0.002) | 1,099 (2,178 / 20) | 3.0 (4.2 / 1.8) | 6 (7 / 5) | 1,099 (2,178 / 20) | 3.0 (4.2 / 1.8) | - (- / -) | - (- / -) |
| sinkoff.toll.k16 | 344,433 (337,825 / 351,042) | 274,146 (263,198 / 285,095) | 7,654 (8,048 / 7,260) | 0.941 (0.940 / 0.941) | 48,297 (48,053 / 48,540) | 31.9 (31.8 / 32.0) | 32 (32 / 32) | 47,810 (47,742 / 47,879) | 30.9 (30.8 / 31.0) | - (- / -) | - (- / -) |
| sinkoff.toll.k64 | 657,861 (651,374 / 664,349) | 479,365 (478,327 / 480,403) | 18,007 (17,827 / 18,188) | 0.963 (0.962 / 0.963) | 93,250 (93,076 / 93,424) | 32.0 (32.0 / 32.0) | 32 (32 / 32) | 90,619 (91,131 / 90,107) | 31.0 (31.0 / 31.0) | - (- / -) | - (- / -) |
| sinkoff.owner.k16 | 15,162 (18,340 / 11,984) | 6,176 (7,178 / 5,173) | 1,060 (1,107 / 1,013) | 0.106 (0.136 / 0.076) | 1,617 (511 / 2,723) | 13.5 (11.2 / 15.8) | 25 (17 / 32) | 1,602 (511 / 2,693) | 13.5 (11.2 / 15.8) | 0.065 (0.040 / 0.091) | 1.0 (1.0 / 1.0) |
| sinkoff.owner.k64 | 302 (1 / 603) | 68 (1 / 136) | 7 (0 / 14) | 0.002 (0.000 / 0.005) | 7 (0 / 14) | 0.9 (0.2 / 1.7) | 3 (1 / 4) | 7 (0 / 14) | 0.9 (0.2 / 1.7) | 0.040 (0.000 / 0.079) | 0.5 (0.0 / 1.0) |
| sink6.none.k16 | 3,878 (7,745 / 12) | 70 (141 / 0) | 2,415 (4,827 / 4) | 0.029 (0.058 / 0.000) | 156 (310 / 1) | 3.2 (5.8 / 0.6) | 7 (12 / 2) | 46 (91 / 1) | 2.7 (4.8 / 0.6) | - (- / -) | - (- / -) |
| sink6.none.k64 | 7,619 (15,197 / 42) | 1,020 (2,018 / 23) | 3,015 (6,015 / 16) | 0.057 (0.114 / 0.000) | 735 (1,466 / 3) | 3.7 (6.7 / 0.7) | 7 (10 / 3) | 179 (356 / 2) | 4.5 (8.2 / 0.7) | - (- / -) | - (- / -) |
| sink6.toll.k16 | 313,539 (335,087 / 291,991) | 0 (0 / 0) | 75,275 (80,947 / 69,604) | 0.996 (1.000 / 0.992) | 34,724 (32,475 / 36,973) | 10.2 (9.3 / 11.0) | 12 (11 / 12) | 30,657 (28,410 / 32,904) | 9.2 (8.3 / 10.0) | - (- / -) | - (- / -) |
| sink6.toll.k64 | 525,964 (530,803 / 521,124) | 4 (0 / 8) | 216,679 (235,652 / 197,705) | 0.993 (0.999 / 0.987) | 43,340 (32,575 / 54,104) | 14.2 (10.2 / 18.2) | 16 (11 / 20) | 39,244 (28,479 / 50,008) | 13.2 (9.2 / 17.2) | - (- / -) | - (- / -) |
| sink6.owner.k16 | 4,913 (6,930 / 2,896) | 268 (158 / 379) | 3,404 (5,009 / 1,798) | 0.035 (0.050 / 0.020) | 181 (301 / 61) | 4.7 (6.0 / 3.3) | 7 (8 / 5) | 98 (160 / 35) | 4.3 (5.4 / 3.3) | 0.072 (0.054 / 0.090) | 1.0 (1.0 / 1.0) |
| sink6.owner.k64 | 6,565 (13,029 / 100) | 1,803 (3,582 / 24) | 3,435 (6,830 / 39) | 0.054 (0.107 / 0.001) | 1,279 (2,554 / 4) | 4.0 (6.4 / 1.6) | 6 (8 / 3) | 88 (173 / 3) | 3.1 (4.7 / 1.5) | 0.047 (0.050 / 0.044) | 0.9 (1.0 / 0.8) |
| sink4.none.k16 | 6,895 (13,317 / 472) | 31 (49 / 13) | 6,701 (13,004 / 399) | 0.064 (0.122 / 0.005) | 2,555 (5,093 / 16) | 4.2 (6.1 / 2.4) | 7 (9 / 4) | 113 (219 / 8) | 2.8 (3.4 / 2.3) | - (- / -) | - (- / -) |
| sink4.none.k64 | 680 (843 / 517) | 11 (8 / 15) | 541 (717 / 364) | 0.011 (0.017 / 0.006) | 22 (28 / 16) | 2.8 (3.2 / 2.5) | 6 (6 / 6) | 15 (21 / 10) | 2.9 (3.5 / 2.3) | - (- / -) | - (- / -) |
| sink4.toll.k16 | 369,490 (384,361 / 354,618) | 0 (0 / 0) | 358,188 (374,708 / 341,668) | 0.978 (0.981 / 0.974) | 20,078 (19,389 / 20,767) | 7.6 (6.9 / 8.3) | 9 (9 / 9) | 15,982 (15,293 / 16,671) | 6.6 (5.9 / 7.3) | - (- / -) | - (- / -) |
| sink4.toll.k64 | 490,052 (485,689 / 494,415) | 0 (0 / 0) | 482,027 (475,773 / 488,281) | 0.982 (0.985 / 0.979) | 19,319 (19,520 / 19,117) | 7.2 (6.8 / 7.6) | 9 (8 / 10) | 15,223 (15,424 / 15,021) | 6.2 (5.8 / 6.6) | - (- / -) | - (- / -) |
| sink4.owner.k16 | 4,653 (7,137 / 2,170) | 8 (16 / 0) | 4,548 (6,928 / 2,169) | 0.050 (0.078 / 0.023) | 1,570 (2,996 / 143) | 3.5 (4.8 / 2.1) | 5 (7 / 3) | 31 (55 / 6) | 2.2 (3.2 / 1.2) | 0.066 (0.056 / 0.075) | 1.0 (1.0 / 1.0) |
| sink4.owner.k64 | 6,593 (13,112 / 73) | 6 (7 / 4) | 6,355 (12,650 / 60) | 0.074 (0.148 / 0.001) | 2,594 (5,183 / 4) | 3.8 (6.4 / 1.2) | 5 (8 / 2) | 85 (168 / 1) | 2.2 (3.9 / 0.4) | 0.065 (0.058 / 0.071) | 1.0 (1.0 / 1.0) |

### Population, light and matter by depth

| setting | particles | in G1 | in G8 | births /1k particle-steps | genotypes, final | light G1 /256 | light G8 /256 | C share in G8 | A in G1 |
|---|---|---|---|---|---|---|---|---|---|
| sinkoff.none.k16 | 12,621 (12,504 / 12,738) | 4,513 (4,679 / 4,347) | 701 (634 / 769) | 4.34 (3.13 / 5.56) | 5,760 (6,127 / 5,392) | 170 (169 / 171) | 25 (21 / 29) | 0.222 (0.184 / 0.259) | 84,905 (87,914 / 81,896) |
| sinkoff.none.k64 | 14,778 (14,822 / 14,734) | 4,409 (4,952 / 3,867) | 842 (798 / 887) | 4.84 (4.32 / 5.36) | 6,169 (6,328 / 6,010) | 192 (185 / 199) | 33 (31 / 35) | 0.200 (0.156 / 0.244) | 79,710 (83,098 / 76,323) |
| sinkoff.toll.k16 | 3,374 (3,183 / 3,566) | 2,460 (2,362 / 2,558) | 57 (43 / 72) | 2.87 (2.08 / 3.65) | 1,699 (1,675 / 1,723) | 93 (93 / 92) | 3 (3 / 3) | 0.128 (0.130 / 0.126) | 95,603 (79,699 / 111,506) |
| sinkoff.toll.k64 | 6,283 (6,233 / 6,333) | 3,717 (3,673 / 3,761) | 130 (127 / 133) | 2.29 (1.68 / 2.89) | 3,031 (3,000 / 3,062) | 136 (136 / 135) | 8 (9 / 8) | 0.121 (0.115 / 0.127) | 66,298 (61,624 / 70,973) |
| sinkoff.owner.k16 | 12,394 (11,866 / 12,922) | 4,656 (4,812 / 4,500) | 668 (560 / 776) | 5.08 (4.35 / 5.81) | 5,438 (5,166 / 5,710) | 172 (170 / 175) | 27 (22 / 31) | 0.155 (0.127 / 0.183) | 84,191 (85,908 / 82,474) |
| sinkoff.owner.k64 | 15,036 (15,695 / 14,377) | 4,551 (5,238 / 3,864) | 851 (824 / 878) | 5.04 (5.27 / 4.80) | 6,243 (6,527 / 5,958) | 192 (187 / 196) | 32 (29 / 34) | 0.203 (0.160 / 0.245) | 76,617 (79,400 / 73,834) |
| sink6.none.k16 | 9,638 (9,186 / 10,090) | 2,033 (1,340 / 2,727) | 1,136 (1,247 / 1,026) | 3.37 (3.01 / 3.73) | 4,569 (4,326 / 4,811) | 215 (226 / 204) | 41 (44 / 38) | 0.839 (0.846 / 0.833) | 73,894 (71,255 / 76,534) |
| sink6.none.k64 | 11,444 (10,902 / 11,987) | 2,865 (1,939 / 3,790) | 1,394 (1,443 / 1,346) | 3.57 (3.03 / 4.11) | 5,284 (5,173 / 5,394) | 210 (222 / 199) | 51 (50 / 52) | 0.837 (0.844 / 0.831) | 74,604 (70,335 / 78,874) |
| sink6.toll.k16 | 2,918 (2,868 / 2,969) | 0 (0 / 0) | 178 (148 / 207) | 3.53 (3.29 / 3.77) | 1,340 (1,308 / 1,372) | 256 (256 / 256) | 8 (7 / 8) | 0.893 (0.897 / 0.890) | 105,815 (107,661 / 103,969) |
| sink6.toll.k64 | 5,226 (5,337 / 5,114) | 0 (0 / 0) | 1,141 (1,211 / 1,071) | 4.25 (4.00 / 4.49) | 2,201 (2,266 / 2,135) | 256 (256 / 256) | 41 (44 / 39) | 0.906 (0.910 / 0.902) | 122,355 (119,379 / 125,330) |
| sink6.owner.k16 | 9,569 (9,091 / 10,047) | 2,604 (1,356 / 3,852) | 1,092 (1,198 / 987) | 3.82 (3.36 / 4.28) | 4,622 (4,552 / 4,692) | 204 (226 / 183) | 42 (43 / 40) | 0.843 (0.849 / 0.837) | 77,880 (70,332 / 85,429) |
| sink6.owner.k64 | 11,326 (10,934 / 11,719) | 3,892 (3,890 / 3,893) | 1,293 (1,292 / 1,293) | 3.89 (3.51 / 4.26) | 5,185 (5,082 / 5,288) | 197 (194 / 200) | 51 (50 / 52) | 0.835 (0.838 / 0.832) | 78,415 (79,065 / 77,764) |
| sink4.none.k16 | 6,648 (6,078 / 7,217) | 1,090 (598 / 1,582) | 2,240 (2,520 / 1,960) | 3.24 (3.18 / 3.30) | 2,907 (2,746 / 3,067) | 229 (239 / 220) | 80 (88 / 73) | 0.989 (0.992 / 0.986) | 69,686 (67,476 / 71,896) |
| sink4.none.k64 | 7,467 (6,960 / 7,974) | 778 (171 / 1,386) | 2,753 (3,308 / 2,198) | 3.49 (3.33 / 3.65) | 3,445 (3,247 / 3,642) | 242 (253 / 231) | 100 (114 / 86) | 0.989 (0.992 / 0.986) | 63,507 (61,052 / 65,962) |
| sink4.toll.k16 | 3,490 (3,394 / 3,586) | 0 (0 / 0) | 2,783 (2,815 / 2,750) | 3.85 (4.12 / 3.58) | 1,519 (1,380 / 1,657) | 256 (256 / 256) | 98 (101 / 95) | 0.999 (0.999 / 0.999) | 118,664 (124,768 / 112,560) |
| sink4.toll.k64 | 4,906 (4,864 / 4,948) | 0 (0 / 0) | 4,322 (4,135 / 4,508) | 3.68 (2.95 / 4.41) | 2,057 (2,016 / 2,097) | 256 (256 / 256) | 156 (151 / 160) | 0.999 (0.999 / 0.999) | 122,623 (118,749 / 126,498) |
| sink4.owner.k16 | 6,589 (6,038 / 7,141) | 781 (592 / 970) | 2,478 (2,442 / 2,513) | 3.44 (2.86 / 4.02) | 3,035 (2,889 / 3,180) | 237 (241 / 233) | 87 (86 / 89) | 0.990 (0.992 / 0.988) | 67,363 (65,682 / 69,045) |
| sink4.owner.k64 | 7,380 (7,043 / 7,717) | 596 (230 / 961) | 3,010 (3,158 / 2,862) | 2.89 (2.80 / 2.98) | 3,647 (3,257 / 4,036) | 245 (252 / 239) | 105 (110 / 101) | 0.991 (0.992 / 0.990) | 65,736 (62,579 / 68,894) |

### Vertical matter flux (matter-layers per 1,000 steps, late window)

| setting | net up, particles | net field down (expected) | gross up, particles | matched share | sinking down (expected) | diffusion up, C (expected) | diffusion up, A (expected) |
|---|---|---|---|---|---|---|---|
| sinkoff.none.k16 | -2,456,220 (-2,234,180 / -2,678,259) | -2,646,740 (-2,233,027 / -3,060,453) | 7,220,399 (4,841,952 / 9,598,846) | 0.930 (0.953 / 0.907) | 0 (0 / 0) | 2,719,325 (2,355,929 / 3,082,720) | -72,585 (-122,903 / -22,268) |
| sinkoff.none.k64 | -990,604 (2,601,431 / -4,582,639) | -1,981,742 (2,207,149 / -6,170,633) | 9,691,901 (9,190,813 / 10,192,989) | 0.920 (0.929 / 0.911) | 0 (0 / 0) | 1,998,237 (-2,170,697 / 6,167,171) | -16,495 (-36,452 / 3,462) |
| sinkoff.toll.k16 | -273,145 (-459,157 / -87,133) | -274,168 (-439,217 / -109,119) | 332,248 (363,775 / 300,721) | 0.960 (0.970 / 0.950) | 0 (0 / 0) | -176,068 (-111,512 / -240,623) | 450,235 (550,729 / 349,742) |
| sinkoff.toll.k64 | 5,752 (487,316 / -475,813) | -10,811 (564,738 / -586,360) | 1,939,812 (2,509,616 / 1,370,008) | 0.974 (0.978 / 0.970) | 0 (0 / 0) | -494,618 (-1,229,591 / 240,355) | 505,430 (664,854 / 346,006) |
| sinkoff.owner.k16 | 652,859 (-384,778 / 1,690,496) | 527,956 (-455,202 / 1,511,114) | 9,029,457 (6,806,311 / 11,252,604) | 0.916 (0.929 / 0.904) | 0 (0 / 0) | -452,621 (570,954 / -1,476,196) | -75,335 (-115,751 / -34,918) |
| sinkoff.owner.k64 | -2,312,835 (-164,855 / -4,460,815) | -3,470,674 (-628,718 / -6,312,630) | 8,177,076 (4,838,568 / 11,515,584) | 0.917 (0.914 / 0.919) | 0 (0 / 0) | 3,458,243 (634,828 / 6,281,659) | 12,431 (-6,110 / 30,972) |
| sink6.none.k16 | 759,489 (466,775 / 1,052,203) | 745,284 (191,414 / 1,299,154) | 3,740,593 (1,884,495 / 5,596,692) | 0.948 (0.955 / 0.941) | 46,121,375 (46,405,784 / 45,836,966) | 45,284,166 (46,106,225 / 44,462,107) | 91,925 (108,145 / 75,705) |
| sink6.none.k64 | 1,087,446 (378,647 / 1,796,244) | 1,244,378 (518,282 / 1,970,474) | 4,338,359 (2,391,589 / 6,285,130) | 0.943 (0.953 / 0.934) | 44,319,148 (45,154,984 / 43,483,313) | 42,953,774 (44,496,123 / 41,411,424) | 120,997 (140,579 / 101,414) |
| sink6.toll.k16 | -161,998 (-2,995 / -321,000) | -264,996 (-177,976 / -352,015) | 333,622 (120,280 / 546,964) | 0.955 (0.957 / 0.953) | 54,147,412 (54,353,077 / 53,941,748) | 54,550,474 (54,655,454 / 54,445,493) | -138,066 (-124,401 / -151,731) |
| sink6.toll.k64 | 658,320 (62,587 / 1,254,053) | 756,285 (280,929 / 1,231,640) | 1,237,694 (443,115 / 2,032,273) | 0.941 (0.948 / 0.934) | 51,534,579 (51,322,363 / 51,746,794) | 51,070,271 (51,332,091 / 50,808,451) | -291,977 (-290,657 / -293,297) |
| sink6.owner.k16 | 920,826 (17,526 / 1,824,126) | 736,226 (-73,713 / 1,546,166) | 4,705,901 (1,793,486 / 7,618,316) | 0.940 (0.947 / 0.932) | 46,091,800 (46,775,626 / 45,407,975) | 45,285,127 (46,714,556 / 43,855,699) | 70,447 (134,784 / 6,110) |
| sink6.owner.k64 | 1,685,553 (1,965,736 / 1,405,371) | 1,601,880 (1,503,839 / 1,699,921) | 6,698,786 (6,222,504 / 7,175,068) | 0.938 (0.945 / 0.931) | 44,051,038 (44,279,965 / 43,822,112) | 42,404,785 (42,719,079 / 42,090,490) | 44,374 (57,047 / 31,701) |
| sink4.none.k16 | 1,264,425 (465,372 / 2,063,478) | 1,230,762 (271,819 / 2,189,704) | 3,986,371 (2,036,213 / 5,936,528) | 0.949 (0.950 / 0.948) | 96,188,469 (97,886,683 / 94,490,255) | 94,851,102 (97,499,138 / 92,203,065) | 106,606 (115,725 / 97,486) |
| sink4.none.k64 | 1,051,818 (180,828 / 1,922,809) | 949,386 (164,628 / 1,734,144) | 4,010,788 (750,283 / 7,271,292) | 0.946 (0.949 / 0.943) | 94,357,315 (96,629,486 / 92,085,144) | 93,243,478 (96,263,916 / 90,223,040) | 164,451 (200,942 / 127,961) |
| sink4.toll.k16 | 20,621 (7,383 / 33,859) | -100,664 (30,919 / -232,246) | 398,690 (226,644 / 570,735) | 0.947 (0.944 / 0.951) | 95,138,570 (94,598,841 / 95,678,298) | 95,539,274 (94,913,119 / 96,165,428) | -300,040 (-345,196 / -254,884) |
| sink4.toll.k64 | -28,205 (59,704 / -116,115) | -311,751 (-145,657 / -477,845) | 628,459 (476,639 / 780,280) | 0.949 (0.959 / 0.938) | 90,220,209 (91,237,803 / 89,202,615) | 90,840,416 (91,590,591 / 90,090,240) | -308,456 (-207,131 / -409,780) |
| sink4.owner.k16 | 963,766 (449,538 / 1,477,993) | 950,570 (320,151 / 1,580,990) | 3,524,311 (1,524,949 / 5,523,672) | 0.946 (0.955 / 0.938) | 96,652,507 (97,809,476 / 95,495,538) | 95,515,448 (97,319,349 / 93,711,548) | 186,488 (169,976 / 203,001) |
| sink4.owner.k64 | 542,071 (237,895 / 846,247) | 575,274 (296,855 / 853,694) | 2,300,634 (1,659,802 / 2,941,466) | 0.956 (0.957 / 0.955) | 94,935,272 (95,969,822 / 93,900,721) | 94,192,156 (95,556,703 / 92,827,608) | 167,842 (116,264 / 219,419) |

### Depth profiles of five representative settings (late window, seed mean)

**`sinkoff.none.k64`**

| group | particles | M | A | C | P | light /256 |
|---|---|---|---|---|---|---|
| G1 | 4,409 | 563,114 | 79,710 | 450,389 | 4,263 | 192 |
| G2 | 2,656 | 332,380 | 83,375 | 302,825 | 296 | 113 |
| G3 | 2,019 | 249,811 | 80,710 | 313,353 | 195 | 79 |
| G4 | 1,562 | 194,890 | 79,148 | 389,947 | 174 | 61 |
| G5 | 1,280 | 160,856 | 79,018 | 488,626 | 148 | 50 |
| G6 | 1,076 | 136,454 | 78,548 | 593,360 | 87 | 42 |
| G7 | 934 | 119,030 | 79,359 | 697,991 | 49 | 37 |
| G8 | 842 | 107,443 | 77,748 | 810,274 | 30 | 33 |


**`sinkoff.toll.k64`**

| group | particles | M | A | C | P | light /256 |
|---|---|---|---|---|---|---|
| G1 | 3,717 | 296,167 | 66,298 | 604,284 | 374,429 | 136 |
| G2 | 1,043 | 99,210 | 80,952 | 571,147 | 104,936 | 43 |
| G3 | 479 | 65,220 | 117,749 | 526,448 | 50,966 | 27 |
| G4 | 338 | 50,367 | 133,484 | 515,224 | 37,580 | 20 |
| G5 | 240 | 37,963 | 145,656 | 509,720 | 28,701 | 15 |
| G6 | 187 | 30,302 | 154,598 | 505,911 | 23,535 | 12 |
| G7 | 148 | 23,718 | 162,849 | 503,827 | 19,708 | 10 |
| G8 | 130 | 20,581 | 158,745 | 515,318 | 18,007 | 8 |


**`sink6.owner.k64`**

| group | particles | M | A | C | P | light /256 |
|---|---|---|---|---|---|---|
| G1 | 3,892 | 516,181 | 78,415 | 65,465 | 1,351 | 197 |
| G2 | 1,018 | 140,945 | 77,325 | 14,380 | 452 | 129 |
| G3 | 512 | 74,794 | 70,864 | 7,144 | 169 | 115 |
| G4 | 550 | 80,159 | 69,918 | 8,604 | 102 | 106 |
| G5 | 857 | 118,692 | 70,933 | 17,365 | 149 | 96 |
| G6 | 1,557 | 197,503 | 75,459 | 71,338 | 355 | 81 |
| G7 | 1,648 | 210,698 | 74,778 | 550,145 | 554 | 64 |
| G8 | 1,293 | 161,290 | 78,672 | 3,715,971 | 3,435 | 51 |


**`sink4.none.k16`**

| group | particles | M | A | C | P | light /256 |
|---|---|---|---|---|---|---|
| G1 | 1,090 | 151,662 | 69,686 | 7,424 | 14 | 229 |
| G2 | 460 | 65,555 | 69,630 | 3,553 | 17 | 197 |
| G3 | 308 | 44,359 | 68,836 | 2,604 | 13 | 183 |
| G4 | 263 | 38,159 | 68,239 | 2,349 | 11 | 172 |
| G5 | 263 | 38,372 | 67,943 | 2,479 | 10 | 164 |
| G6 | 403 | 57,629 | 67,493 | 3,864 | 18 | 154 |
| G7 | 1,622 | 202,914 | 75,392 | 34,455 | 110 | 130 |
| G8 | 2,240 | 271,076 | 74,890 | 5,058,142 | 6,701 | 80 |


**`sink6.toll.k64`**

| group | particles | M | A | C | P | light /256 |
|---|---|---|---|---|---|---|
| G1 | 0 | 6 | 122,355 | 0 | 3 | 256 |
| G2 | 0 | 0 | 122,066 | 0 | 1 | 256 |
| G3 | 0 | 13 | 121,581 | 1 | 5 | 256 |
| G4 | 3 | 468 | 120,422 | 64 | 247 | 256 |
| G5 | 101 | 13,078 | 113,866 | 1,312 | 7,177 | 254 |
| G6 | 523 | 45,560 | 99,019 | 3,204 | 37,143 | 233 |
| G7 | 3,457 | 241,345 | 76,531 | 444,574 | 264,709 | 135 |
| G8 | 1,141 | 81,625 | 76,798 | 4,343,751 | 216,679 | 41 |

## Reading

**Where trail persists.**

- **Toll road: retained in all 12 runs, both seeds, every sinking and light setting, as in 2D.** It is a fog, not a network.
  - **Without sinking:**
    - trail is in 94 to 96% of occupied cells;
    - the largest component holds 48,000 to 93,000 cells (37 to 71% of the whole volume) and spans all 32 layers;
    - about 80% of the mass sits in G1–2, and the deep part of the component is thin (it only needs P ≥ 1).
  - **With sinking,** the trail lies as a thick bed in the lower part (late spans 7 to 18 layers up from the floor). The particles live on and just above that bed (mostly G7–G8). G1 holds 0 particles in all 8 toll + sinking runs, and the surface gets full light (256/256) with its nutrient unused.
  - **Population.** Toll worlds carry a third to half the population of the others (2,900 to 6,300 against 6,600 to 15,000), on top of a sixfold move cost.
  - Whether the trail is used is not read here.
- **No rule: mostly purged.**
  - Seed 1 keeps a thin trace in 5 of the 6 sinking/light cells: 7,700 to 15,200 P, faint diagonal streaks in the top view, and components of 124 to 5,093 cells.
  - Seed 2 is near zero in all six cells (at most 520 P), and so is seed 1 in `sink4.none.k64` (843 P).
  - **This is a one-seed pattern.** Each seed is one founder set shared by all 18 settings, so seed 1's founders may simply carry depositors.
  - With sinking, most of what remains sits in the floor group: the component without the floor layer is 1 to 356 cells.
- **Owner gate + conduit: about the same as no rule.**
  - **`sinkoff.owner.k16`:** both seeds keep trail (18,340 and 11,984 P). Its late spans are the largest outside the toll (11 and 16 layers, at times all 32 in seed 2), and seed 1's top view shows regular diagonal bands, the most structured picture in the screen.
    - **But this rests on seed 2 alone.** Seed 1 also keeps trail with no rule (`sinkoff.none.k16`: 10,645), and seed 2's trail swings from 2,600 to 34,000 between readouts.
    - It does not repeat at k64.
  - **The conduit was idle.** The same-owner share of edges is 4 to 9% and the median min(Q, Q) is 1 everywhere, so the conduit's extra rate on a typical owned edge is (1 · 30) >> 4 = 1. The 2D clan territories behind the 2D lead did not form. **This screen says nothing about whether an operating owner conduit keeps trail in 3D.**

**How far trail spans in z.**

- **Full depth (32 layers):** only toll without sinking. In those 4 runs, the largest component spans layers 0 to 31 in 51 of the 52 late readouts. The exception is `sinkoff.toll.k16` seed 1 at step 48,000, where it spans layers 0 to 28 (29 layers); hence that run's late mean of 31.8.
- **Sinking caps it.** Every large component under sinking is anchored on the floor. No rule and owner: late spans of 1 to 7 layers, at most 12. With the floor layer removed, those components are small (under 360 cells).
- **In the late window, no trail component of any size reaches from the surface group to the floor group in any sinking world.** This is measured over every 6-connected component, not just the largest (`componentSpans`; see Setup). Such a component appears in 0 of 312 late readouts (24 sinking runs × 13 readouts, steps 26,000 to 50,000). The longest late span of any component is 20 layers (`sink6.toll.k64` seed 2); without the toll it is 16.
  - Early on such components do exist. In 11 of the 24 sinking runs (all 8 toll runs, plus 3 others), at least one readout between steps 2,000 and 20,000 has one, and each such component reaches from layer 0 to layer 31. These are the founders' first trail before it is purged or sinks: all 24 toll readouts with one are at step 20,000 or earlier, and the 4 no-rule or owner readouts with one are at step 6,000 or earlier.
  - Readouts are snapshots every 2,000 steps, so a spanning component that forms and breaks between them would be missed.

**Does matter move up?**

- **Sinking works as section 3 of the plan expects.**
  - Floor-group waste is 84% (sink 6) and 99% (sink 4) of all C, against 12 to 22% without sinking.
  - Expected sinking of 44 to 97 million matter-layers per 1,000 steps is almost balanced by diffusion of C back up the steep gradient. The expected net field downflow is −0.5 to +2.2 million.
- **Particles carry matter up in every sinking run without the toll (16 of 16 runs, both seeds).** Net up is +0.02 to +2.1 million matter-layers per 1,000 steps, 1 to 35% of their gross upward movement. Run by run it matches the net field downflow (Check, above).
  - **Under the toll** it is small: −0.3 to +0.06 million, except `sink6.toll.k64` seed 2 at +1.25 million.
  - **Without sinking** the sign is mixed (−4.6 to +2.6 million). Where it is negative, diffusion of C carries the matter back up.
  - **What this shows and doesn't.** Descriptively, when waste sinks, bodies take up matter lower than where they release it. **This is not evidence of selection for lifting, nor of structure doing it.** The populations are two-tiered, with a surface band and a floor band (depth profiles above), and the floor band may simply rise toward food.
- **The dark floor is not dark at sink 4.** With bodies concentrated near the floor and few at the surface, floor light is 80 to 156/256. Light reaches the waste pile, so the floor turns waste into nutrient and becomes a second productive layer. This weakens the plan's premise that nutrient is made only near the top.
- **`lightK` 16 against 64.**
  - Light: without sinking, floor light is 25 against 33 with no rule, and 3 against 8 under the toll.
  - Population: k64 supports more particles in all 9 setting pairs (by 12 to 86%).
  - Trail: no pattern follows `lightK` consistently across both seeds.

**Turnover and genotypes.** Births equal deaths within 0.01 per 1,000 particle-steps everywhere (steady populations), at 2.3 to 5.1 per 1,000 particle-steps. Genotypes at 50,000 steps:

- 4,600 to 6,200 in no-sinking and sink-6 worlds without a toll;
- about 2,900 to 3,600 at sink 4;
- 1,300 to 3,000 under the toll.

## What to try next

1. **Make the owner conduit operate before judging it.** Size θ and g on 3D pilots, as the 2D owner screen did (O1: median owned x on territorial runs), or try `trailOwner` id with a higher θ. Then rerun the owner row with more seeds. `sinkoff.owner.k16` is the cheapest place to start, but its signal rests on one seed. Run 4 or more fresh seeds there against `sinkoff.none.k16`, with a conduit-off branch.
2. **Keep the floor dark if the plan's premise is wanted.** Use a larger `light` with a smaller `lightK`, or shade by the waste C on the floor. As it stands, sink 4 moves life to the floor rather than creating a lift problem.
3. **Separate the toll from `moveCost` 12.** Add a `moveCost` 12 arm without the toll (the 2D `mc12-base`), and a public-mode discount. That would tell whether the fog is the toll's doing, and whether 3D toll beds are used (R4's ALIGN/OCC readouts on z too).
4. **Measure lift directly.** Record per-layer eat and excrete totals (an observer-only change, or a GPU counter) instead of inferring them from body moves. Then repeat with heredity blocked, to see whether the positive net lift is evolved or physical.
5. **Look at it.** Render turntables of `sinkoff.owner.k16.s1` (the diagonal bands) and of a sink-6 toll bed with the B3 renderer.

## Uncertain

- **The net upward transport is approximate, though it closes against the field budget run by run.** It assumes the population and layers are near steady (floor C still rises slowly at sink 4: about 1% over the last 25,000 steps in `sink4.none.k16.s1`), and 3 to 9% of matter per interval is on unmatched particles.
- **The field fluxes are expected values from layer totals, not counted moves.**
- **Two seeds is too few.** No-rule and owner trail is bimodal by seed and swings by an order of magnitude over time, so the seed means in those rows are not stable.
- **Seeds 1 and 2 are the default seeds** used by `run.ts` and the RULES.md tuning. That is fine for exploration, but they are not fresh.
