# Cadence Garden

An artificial-life ecology whose individuals and histories are inferred from local rules.

## Language

**Lab world**:
The interactive world's evolving physical state and its accumulated observer history.

**Census**:
An observation of the world's individuals and lineages at a simulation step.

**Checkpoint**:
A saved physical state and matching observer history from which the world can continue.

**Replay twin**:
An independent copy of a world's physical state advanced through the same steps to verify deterministic continuation.

**Lab session**:
The account of which Checkpoints cover the current Lab world, and which of its steps and hand edits would be lost by replacing it.
_Avoid_: dirty flags, save queue, page state

**Hand edit**:
A lesion or a feed. A Checkpoint covers it only when that Checkpoint was saved on purpose. An automatic Checkpoint covers the step and leaves the hand edit uncovered.
_Avoid_: touch, dirty bit
