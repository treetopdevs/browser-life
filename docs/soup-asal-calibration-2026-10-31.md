# Can a CLIP observer see copiers take over? (2026-10-31)

Step 1 of the plan in [mlst-evolution-papers-2026-10-31.md](mlst-evolution-papers-2026-10-31.md). ASAL (Kumar et al., arXiv 2412.17799) scores open-endedness by embedding rendered frames with CLIP and asking how different each frame is from everything before it. Before trusting that on the garden, where hand-built signals failed (bell v2: Negative), we test it where the answer is known.

**The known event.**
- Grid seed 1 (240 × 135, radius 2, `tools/soup.ts`) produced self-copying programs at step 16,961. cubff's copy test scores the leader 64 of 64.
- In its frames, a copier territory sweeps in from the right edge and covers the grid by about step 18,300.
- Grid seed 2 ran to step 43,009 and never produced copiers. It had one short entropy blip at about 38,913, in which every program stayed distinct. It is the null.

Written before any frame is embedded. The readout goes at the end in a dated section; the rules are not edited after scoring starts.

## Frames

- **Source:** `runs/soup/grid-240x135-r2-noheads/seed-{1,2}/frames/*.png`, as written by `tools/soup.ts`: 1920 × 1080, every program an 8 × 8 block of its byte colours (cubff's palette), every 128 steps.
  - Seed 1 has 165 frames, steps 0 to 21,057.
  - Seed 2 has 337 frames, steps 0 to 43,009.
- **Preprocessing:** letterbox each frame to a square on black, then resize to the model's input size (224) with bicubic resampling, then apply the model's normalisation. CLIP's default centre crop would cut off the left and right of a 16:9 frame, and seed 1's copiers enter from the right.
- **Family view:** the lab's families view is not scored. Snapshots that would let us render it exist only every ~4,096 steps before 21,057, too sparse for this test.

## Observer

- **Model:** CLIP ViT-B-32 with OpenAI weights, the model family ASAL uses. In `open_clip` that is `ViT-B-32-quickgelu` with `pretrained="openai"`: the OpenAI weights were trained with QuickGELU activations. This was corrected on 2026-10-31 after a three-frame setup smoke test warned about it, before any frame was scored.
- **Versions:** open_clip_torch 2.32.0 and torch 2.7.1, on the CPU.
- **Pinned:** the record stores the open_clip and torch versions and a SHA-256 over the model's parameters in state-dict order.
- **Isolation:** it runs in an isolated `uv run --with ...` environment. It reads PNGs and nothing else, and never feeds back into the soup.
- **Embeddings:** L2-normalised image embeddings, `e_t` for frame t in step order.

## Scores

- **Novelty** of frame t: `n_t = 1 − max_{s<t} cos(e_t, e_s)`. This is how unlike every earlier frame of the same run it is; ASAL's historical nearest-neighbour novelty. The first frame has no novelty.
- **ASAL open-endedness score** of a run over a set of frames: the mean over those frames of `max_{s<t} cos(e_t, e_s)`. Lower means more open-ended.

## Sets

- **W, the takeover window (seed 1):** frames with step in [16,896, 19,200].
- **B1, seed 1 before the takeover:** frames with step in [4,096, 16,768]. Steps before 4,096 are burn-in, when the random soup's first structure forms.
- **N2, the null (seed 2):** frames with step ≥ 4,096, including the blip.
- **θ** = max(max novelty over B1, max novelty over N2).

## Rules

**Primary: SEES TAKEOVER** if the largest novelty in W is above θ, that is, above every pre-takeover frame of seed 1 and every frame of the null run. The record also gives the first frame in W above θ.

**Palette control (C1).** Recolour every frame by permuting its channels (R, G, B → B, R, G), then repeat the primary rule with fresh embeddings and a fresh θ. **PALETTE-ROBUST** if it also holds. The record also gives the correlation between the original and recoloured novelty series over all frames.

**Order control (C2, descriptive).** For seed 1, the ASAL open-endedness score over frames from step 4,096, in true order and in 20 seeded random orders. The record gives where the true order falls among the shuffles, and the mean novelty of W's frames in each.

**Blip (secondary).** Does seed 2's novelty in [38,400, 40,448] rise above the 99th percentile of its other frames from step 4,096? A yes means CLIP reacts to structure without copiers. That counts against reading CLIP novelty as "life", in the spirit of Yin's finding that ASAL open-endedness does not track self-replication in Life-like rules.

**Verdict.**
- **PASS:** SEES TAKEOVER on the original frames and under C1.
- **PARTIAL:** SEES TAKEOVER on the original frames only.
- **FAIL:** not SEES TAKEOVER on the original frames.

**What follows, fixed now.**
- **PASS:** step 3 (a CLIP bell on the bell v2 garden corpus) may go ahead, with these same controls.
- **PARTIAL:** step 3 goes ahead only with a palette-invariant rendering, decided before it runs.
- **FAIL:** do not run step 3 with this observer. A copier takeover that cubff's copy test scores 64/64 and that is plain to the eye is the easiest case we have.

## Limits

- One takeover and one null, from one rule set. Before the readout, PASS means "can see this event", not a calibrated rate.
- Byte-view frames only.
- CLIP sees a 224-pixel square, so each program is about 0.9 pixels wide. CLIP sees texture and colour regions, not individual programs.

## Readout

Added 2026-10-31 after scoring. No rule above changed after scoring started.

**How it was run.**
- Embeddings: `tools/observe/clip_embed.py`, run as `uv run --no-project --python 3.12 --with open_clip_torch==2.32.0 --with torch==2.7.1 --with pillow --with numpy python -I tools/observe/clip_embed.py --recolor none|brg --out runs/observe/g{1,2}-{none,brg}.json <frames>`.
- Scores: `deno run -A --no-lock tools/soup-asal.ts`, which writes `runs/observe/calibration.json`.
- Model: ViT-B-32-quickgelu with OpenAI weights. Parameter SHA-256 `b2db866e4f9396c83e55909cb6b4ee705e42a2f0f4b6be7e8c1ad4c563d8c7c9`.

### Verdict: **PASS**, with a thin margin under recolouring, and CLIP also reacts to the non-copier blip

| | Largest novelty in W (step) | Before takeover, B1 | Null run, N2 | θ | SEES TAKEOVER |
|---|---|---|---|---|---|
| Original colours | **0.0340** (17,536) | 0.0206 (13,952) | 0.0191 (38,656) | 0.0206 | yes, ratio 1.65 |
| Recoloured (C1) | **0.0343** (17,536) | 0.0154 | 0.0317 (39,168) | 0.0317 | yes, ratio 1.08 |

- **Where it fires:** the first frame above θ is step 17,536 in both colourings, about 600 steps after the copy test first finds a copier (16,961). That is when the copier territory becomes a visible region in the frames.
- **How long it stays up:** novelty stays raised for several frames, 0.012–0.034 from 17,536 to 18,048, against about 0.005 before the takeover.
- **Colouring:** the novelty series under the two colourings correlate at 0.94 (seed 1) and 0.85 (seed 2).
- **Blip (secondary): seen, in both colourings.** Seed 2's novelty around its entropy blip peaks at 0.0191 (original) and 0.0317 (recoloured), against a 99th percentile of 0.0141 and 0.0125 on its other frames. Recoloured, the null's blip comes within 8% of the takeover peak. CLIP novelty responds to visible structure that has no copiers in it. That fits Yin's finding that ASAL open-endedness does not track self-replication.
- **Order control (C2):** the true order has a higher historical similarity (ASAL score 0.9929) than all 20 shuffles (0.9905–0.9919). That is what temporal continuity predicts, so the score sees time. Across the takeover window, novelty is raised overall: the mean over W is 0.0152 against 0.0051 over B1, and novelty crosses θ again at 18,816 (0.0316). In shuffled orders the mean novelty of W's frames ranges from 0.0121 to 0.0217, so this control neither confirms nor rules out a shift localised in time. It shows only that the W frames stay novel whatever their order.
- **ASAL score per run (frames from 4,096):** seed 1 0.9930, seed 2 0.9938. Seed 1 is slightly more open-ended by ASAL's measure. With one run each, this is description only.
- **Scale:** after the burn-in, novelties are small (similarities about 0.97–0.995). During the burn-in they are larger, for example 0.143 at step 128 (0.178 recoloured). To CLIP at 224 pixels, every post-burn-in soup frame looks much like every other, and the observer works in the last few percent of its range.

**What this means.**
- By the rule fixed beforehand, step 3 (a CLIP bell on the bell v2 garden corpus) may go ahead, with these same controls.
- Two things carry forward into step 3's rules, before it runs:
  1. A recoloured arm, with a PASS required in both colourings.
  2. A null that has structure but no biology. Here that was the blip; in the garden it would be the nudge nulls.
- CLIP novelty here means "something visibly changed", not "life happened". In this one test the visible change from copiers was larger and lasted longer than the change from a non-copier blip, but not by much.
