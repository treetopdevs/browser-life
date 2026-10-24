# CPU feasibility result

**32/32 saved pairs passed** the fixed joint 40% damage prescription; the gate required at least 30. Status: `FEASIBILITY-PASS-ENGINEERING-PENDING`. No simulation steps or fresh scientific seeds were run.

The selector examined 39,773 circles and admitted 214 candidates after the prescribed dose, collateral and remnant gates. Every pair has a selected parent/mutant lesion within 37.5–42.5% destruction, within 2.5 percentage points of each other, with no more than 5% outside-target damage and at least 80% surviving target mass in the overlap-selected eligible remnant. Candidate rejection counts use the first failed gate, so they do not show whether rejected-dose circles would pass later gates.

The second, provenance/finalization-hardened run reproduced the first run's selected pairs and input hashes exactly. [FEASIBILITY.json](FEASIBILITY.json) preserves the 32 selected pairs, 64 input case/checkpoint identities, result digest and source/runtime manifest. Raw source checkpoints remain in the original checkout's gitignored v1 bundle; the new checkout uses an explicit read-only source path.

Validation: Deno check and repository typecheck passed; 24 selector and v1 recovery focused tests passed, including the exact 80% remnant boundary. Corrupting an input case was rejected against the pinned inventory and produced TECHNICAL-STOP without a success result; reusing that output directory was refused. Independent Sol6.1 High review verified all 64 input case/checkpoint hashes and all selected numerical gates. Its finalization/provenance findings were fixed and follow-up review cleared the CPU slice.

This establishes physical feasibility on the engineering bodies only. Native CPU/GPU intervention checks, endpoint/observer validation and the three-arm fresh-seed runner remain unfinished. No recovery improvement, hidden genotype advantage, or causal damage effect is inferred. The larger prototype backlog remains active.

Sonnet 5.5 High fallback found no blockers. Its target-integrity and wrap-test suggestions were implemented; the final rerun selected the same 32 pairs. See [implementation review](IMPLEMENTATION-REVIEW.md).
