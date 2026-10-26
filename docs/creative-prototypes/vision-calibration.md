# Targeted vision calibration

Status: **stopped-calibration**. Fixed judge/target calibration failed. No simulation selection or prompt tuning performed.

Actual local CLIP ViT-B/32 inference on 54 fixed layouts, blank and one-dot controls, plus two duplicate frames. 67/108 required ordering comparisons pass. Duplicate-frame maximum cosine difference: 0.

These are image/text resemblance scores, not motion recognition or proof of evolution. All failed comparisons and exact pixel inputs are retained in [the artifact](vision-calibration.json). The local model revision and file hashes are recorded there.

| Target | Negative | Margin difference |
|---|---|---:|
| cal-60-layout0-6 | cal-60-layout0-1 | -0.000334 |
| cal-60-layout0-6 | diagnostic-one | -0.000643 |
| cal-60-layout0-12 | cal-60-layout0-1 | -0.005650 |
| cal-60-layout0-12 | cal-60-layout0-uniform | -0.001001 |
| cal-60-layout0-12 | diagnostic-blank | -0.004822 |
| cal-60-layout0-12 | diagnostic-one | -0.005958 |
| cal-60-layout1-12 | cal-60-layout1-1 | -0.003163 |
| cal-60-layout1-12 | cal-60-layout1-uniform | -0.002594 |
| cal-60-layout1-12 | diagnostic-blank | -0.002574 |
| cal-60-layout1-12 | diagnostic-one | -0.003709 |
| cal-60-layout2-12 | cal-60-layout2-1 | -0.002502 |
| cal-60-layout2-12 | diagnostic-blank | -0.001047 |
| cal-60-layout2-12 | diagnostic-one | -0.002183 |
| cal-120-layout0-6 | diagnostic-blank | -0.002807 |
| cal-120-layout0-6 | diagnostic-one | -0.003942 |
| cal-120-layout0-12 | cal-120-layout0-1 | -0.001574 |
| cal-120-layout0-12 | diagnostic-blank | -0.006109 |
| cal-120-layout0-12 | diagnostic-one | -0.007245 |
| cal-120-layout0-seam6 | diagnostic-blank | -0.000223 |
| cal-120-layout0-seam6 | diagnostic-one | -0.001359 |
| cal-120-layout1-6 | cal-120-layout1-1 | -0.000789 |
| cal-120-layout1-6 | diagnostic-blank | -0.001154 |
| cal-120-layout1-6 | diagnostic-one | -0.002290 |
| cal-120-layout1-12 | diagnostic-blank | -0.000092 |
| cal-120-layout1-12 | diagnostic-one | -0.001228 |
| cal-120-layout1-seam6 | diagnostic-one | -0.000816 |
| cal-120-layout2-6 | cal-120-layout2-1 | -0.006424 |
| cal-120-layout2-6 | diagnostic-one | -0.000214 |
| cal-120-layout2-12 | cal-120-layout2-1 | -0.013298 |
| cal-120-layout2-12 | diagnostic-blank | -0.005952 |
| cal-120-layout2-12 | diagnostic-one | -0.007088 |
| cal-120-layout2-seam6 | cal-120-layout2-1 | -0.003013 |
| cal-240-layout0-12 | cal-240-layout0-1 | -0.004369 |
| cal-240-layout0-12 | diagnostic-blank | -0.007313 |
| cal-240-layout0-12 | diagnostic-one | -0.008448 |
| cal-240-layout1-12 | cal-240-layout1-1 | -0.001222 |
| cal-240-layout1-12 | diagnostic-blank | -0.001545 |
| cal-240-layout1-12 | diagnostic-one | -0.002681 |
| cal-240-layout2-12 | cal-240-layout2-1 | -0.000592 |
| cal-240-layout2-12 | diagnostic-blank | -0.003407 |
| cal-240-layout2-12 | diagnostic-one | -0.004543 |
