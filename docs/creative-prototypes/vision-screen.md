# Vision screen

Open `/vision-screen/` locally to inspect a real local image/text model's failed calibration. Choose dot count, layout and fixture type, then select an image to see its raw resemblance scores and paired comparisons. Export preserves all56 images and108 comparisons as integer pixel coordinates and scores. These are supplied still images; there are no simulation clips or selected worlds in this result.

The gate passed67/108 comparisons and failed41. We stopped before breeding, as planned. A few obvious negative controls outrank intended targets under the fixed margin. This is evidence against using this particular model, rendering and target score to steer the next search. It does not establish that all visual judges are unsuitable.

This slice implements Candidate6's calibration and inspection stage. Recipe generation helpers exist and are tested, but the simulation search, long-run follow-up and 3D promotion were not executed or completed. The next creative experiment can return to the queued circulating-current aquarium, or explicitly revise the judge in a separate plan; this failed result stays intact.

[Plan and review resolutions](vision-screen-plan.md) · [All failed comparisons](vision-calibration.md) · [Validation](vision-screen-validation.md) · [Local model setup](vision-runtime.md)

## Local reproduction

Use the isolated Python setup in the runtime document and Node24.2.0. No paid inference is involved. In a fresh output directory, `node tools/vision-screen/calibrate.ts` generates the prescribed images and executes local CPU scoring. `node tools/vision-screen/report-calibration.ts` verifies scored pixels and produces the stopped/passed artifact. Existing score outputs are deliberately not overwritten: preserve an existing `runs/vision-screen/calibration` directory under another name before a fresh run. Never discard the negative baseline to hide a rerun.

`node tools/vision-screen/check.ts` is a quick static freshness, pixel and arithmetic check. It does not load model weights or reperform inference. Model source, weights, processor configuration and package versions are recorded separately; cosine equality across different hardware/software stacks is not promised. The page plays stored pixel coordinates and never reruns the simulation or downloads a model.

Private prototype only. Production packaging removes the page and its chunks; nothing is deployed by this work.
