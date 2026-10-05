# Browser Life

An artificial-life ecology whose individuals and histories are inferred from local rules.

Artificial-life experiments infer ecological organization from local rules and compare independently generated histories.

## Language

**Lab world**:
The interactive world's evolving physical state and its accumulated observer history.

**Census**:
An observation of the world's individuals and lineages at a simulation step.

**Checkpoint**:
A saved physical state and matching observer history from which the world can continue.

**Replay twin**:
An independent copy of a world's physical state advanced through the same steps to verify deterministic continuation.

**Run**: One history generated from a preset, condition and seed over a specified observation schedule.

**Cohort**: The selected completed runs considered together for ensemble inference or calibration; eligibility determines which histories contribute measurements.

**Ensemble**: Runs across experimental conditions with compatible rules, observation schedules and configurations, compared as independent replicates.

**Calibration pilot**: A dedicated neutral-only cohort used to estimate an activity threshold independently of the ensemble being tested.

**Eligible run**: A completed history that satisfies the applicable cohort checks and exact conservation requirement.

**Metapopulation ring**: Runs connected by exchanges of matter and genomes; its connected seeds are not independent replicates.
