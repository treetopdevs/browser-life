# Travelling oases visual inspection

Independent inspection of four local browser screenshots, seed 1201, mutation enabled: pursuit and flocks at approximately 2,000 and 6,000 ticks. The visible counters in the captures actually read **2,001 and 6,001**; filenames use the capture targets. All three environments appear side by side. This review inspected the PNG pairs, not continuous playback; the recorded WebM files remain available locally.

## What is visible

**Pursuit:** all three environments contain dispersed particles with small local clumps at both times. The slow arm has several conspicuous compact groups at tick 2,001, but the later frame again contains a mixture of scattered particles and local clumps. The moving patch outlines visibly occupy shifted positions. These frames do not establish a distinct new motion regime or stronger regrouping than the still arm. At tick 6,001 the visible populations are 153 / 155 / 160, consistent with the separate numerical sweep's finding that the three pursuit environments remain broadly similar in population, without asserting cross-runtime numerical identity.

**Flocks:** compact, mostly family-coloured clusters remain the dominant shape in all three environments. At tick 2,001 many clusters sit close to patch centres. By tick 6,001, the moving arms contain more empty patch regions and the faster arm has a few scattered particles as well as compact clusters. Visible populations change from 144 / 180 / 172 at tick 2,001 to 126 / 106 / 80 at tick 6,001 (still / slow / faster). This one illustrative seed shows a more noticeable difference in occupancy and population than pursuit, but is not an ensemble result or evidence that speed generally lowers survival.

The flocks frames are consistent with patch-centred compact groups, and do not show obvious widespread mixing or sustained regrouping. Two separated frames cannot establish that the same cluster follows a particular patch continuously, whether clusters split/merge between frames, or whether a compact shape retains the same particle IDs. Birth/death totals also preclude treating visual shape persistence as individual identity persistence. The supplied steering remains part of the explanation. Seasonal renewal is a reasonable next creative candidate to test changing opportunities, rather than tuning these speeds until a preferred outcome appears.

## Presentation

The three world cards, controls, family colours, population counts, patch outlines and shared tick labels are readable in these desktop captures. All population histories use aligned ranges: 0–2,001 in the early pair and 3,001–6,001 in the later pair. The explicit supplied-steering/environment disclosure and geometric inside-patch explanation are present. Bright filled patches visibly distinguish unused stock in the flocks frames; rounded numeric stocks are supplemental.

The captured history canvases occupied nearly square panels. After this inspection, the charts were shortened to a 3.6:1 aspect ratio, verified by desktop and phone browser checks. Recordings retain the earlier presentation; simulation behavior is unchanged. Separate browser checks cover mobile layout, keyboard operation and hidden-page handling. Extinction clock behavior has unit coverage; extinction chart rendering was reviewed in code, not exercised by these captures.

## Local artifacts

All paths below are relative to this checkout and are under gitignored `runs/oases/`; the recordings are not shipped in the PR:

- `runs/oases/pursuit-2000.png` and `runs/oases/pursuit-6000.png`
- `runs/oases/flocks-2000.png` and `runs/oases/flocks-6000.png`
- `runs/oases/pursuit.webm` and `runs/oases/flocks.webm` (recorded browser runs; not continuously reviewed here)
- `runs/oases/pursuit-observation.json` and `runs/oases/flocks-observation.json` (browser observations; not resumable)

Use [oases-pilot.md](oases-pilot.md) for the fixed nine-run pursuit evidence, rather than generalizing from this single visual seed. The screenshot observations support a restrained conclusion: changing patch positions are visible, flocks remains predominantly compact, and pursuit remains dispersed with local clusters. Continuous following and stronger regrouping remain unestablished.
