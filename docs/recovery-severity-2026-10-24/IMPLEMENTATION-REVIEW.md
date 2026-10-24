# Feasibility implementation reviews

Scope: zero-step CPU feasibility prototype only. Recovery-time/GPU engineering and fresh scientific trials are not implemented by this slice.

## Sol 6.1 High, read-only

Verified the frozen v1 manifest, all 64 case pins/canonical digests/grown checkpoint sizes and hashes, the result digest, all 32 pair files, and every selected dose/collateral/80%-remnant/pair-difference gate. Selector math, toroidal geometry and overlap semantics matched the plan.

Findings fixed before commit:

- Capture imported-source provenance through Git HEAD plus tracked patch, alongside new-source hashes and Deno.version.
- Publish the successful result last, after its digest, by atomic rename. Readers require both and reject failure markers or temporary files.
- Create the output directory exclusively so concurrent launches cannot reuse it.

Final follow-up: no remaining blockers for the CPU-only slice. Exact 80% boundary coverage was added; 22 focused tests pass. The exact 128 minimum-remnant boundary was not artificially manufactured with invalid target geometry.

## Requested Argon 4 High adversarial review

The installed model inventory lists gemini-4-argon-high. The first read-only headless attempt could not read files because command permission was unavailable; no output was produced. A second request supplied a self-contained source packet and prohibited tool calls. That process remains live at initial publication. This is a pending review, not a clean verdict; the PR stays draft until its outcome is assessed. Sol review above is complete and is not represented as an Argon substitute.

## Authorized Sonnet 5.5 High fallback and disposition

The tool-free source-packet fallback completed with NO BLOCKERS. Argon's source-only request remains pending; the initial file-access refusal is retained in the record. This is a Sonnet verdict, not an Argon verdict.

Useful suggestions fixed: the seam test now actually crosses the torus; the selector verifies that the target is exactly one full original census component; subset/mixed-component rejection tests were added; a negative feasibility gate exits 3; failure-record errors cannot mask the original error. Existing publication ordering and source-revision capture already addressed findings against the older packet. Full-component validation required moving synthetic collateral away from the original body so the fixture remains a valid separate component.

All 24 focused tests and Deno check pass. The final zero-step run remains 32/32 feasible with identical selected pairs and pinned inputs. Fixed thresholds stay explicit in this protocol; timing belongs to integrity evidence and is not claimed byte-reproducible. Source HEAD/patch plus new-file hashes cover this slice's inspected imports. The aggregate negative status remains distinct from runtime errors. No changes to wound thresholds, seed policy or fresh-trial gates.
