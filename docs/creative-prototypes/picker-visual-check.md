# Picker visual check

Chrome at 1440×1050, seed 1201. The first comparison ran to approximately tick 508. Flocks formed compact food-centered groups, pursuit remained dispersed, and colonies supplied a cohesive comparison. The reviewer selected pursuit with the stated reason: “Prefer the dispersed pursuit motion over tight food-centered clusters.” This is an assistant preference used to exercise the creative workflow, not a user preference or an evolutionary fitness judgment.

Keeping pursuit restarted the exact recipe beside two changed attraction coordinates. At comparison tick 507 the populations were 150 / 148 / 162, with different particle positions and family balances. All three cards showed the same age, the retained recipe was labeled unchanged, and the two variation explanations described their altered interaction. The exported file recorded the choice at its original age and preserved the selected recipe.

Local evidence in `runs/particle-picker/`: `first-comparison.png`, `variants.png`, `comparison.webm`, `visual-selection.json`. These files are gitignored and not promised by the PR. The live page is `/particles/picker/`; the committed scripted pilot provides portable numerical evidence. Browser checks also cover phone layout, keyboard access, accessibility, import rejection, delayed-read races and the 30-choice limit.

Production packaging smoke applied the actual Dockerfile removal patterns to a temporary copy of the Vite build. Both particle pages and their entry/shared-model bundles were removed, and no particle-specific model/selection strings remained in JavaScript assets. No Docker image run or deployment is claimed.
