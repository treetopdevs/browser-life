#!/bin/bash
# Runs one queue of the B2 compartment check (docs/b2-compartment-check-2026-11-21/PLAN.md). Resumable: finished
# segments are skipped. Start queue a and queue b side by side (two simulations at a time).
#   experiments/b2check/run-all.sh a    # GPU check, PHAGE, SINGLE_WALL, ONE64_B2, ONE64_SPOT, seeds 13-16
#   experiments/b2check/run-all.sh b    # NO_PHAGE, seeds 13-16
#   experiments/b2check/run-all.sh c    # optional extension: PHAGE and SINGLE_WALL to 240,000 steps
#   experiments/b2check/run-all.sh snaps  # draw the seed 13 snapshots into the docs folder
set -euo pipefail
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
cd "$(dirname "$0")/../.."
OUT=runs/b2check
mkdir -p "$OUT"
run() { deno run -A --no-lock experiments/b2check/run.ts --out "$OUT" "$@"; }
case "${1:-}" in
  a)
    # A failed parity check stops the queue (a pipeline on the left of && would not trip set -e).
    if [ ! -f "$OUT/gpu-check.txt" ]; then
      deno run -A --no-lock experiments/b2check/gpu-check.ts | tee "$OUT/gpu-check.tmp"
      mv "$OUT/gpu-check.tmp" "$OUT/gpu-check.txt"
    fi
    for s in 13 14 15 16; do
      run --world PHAGE --seed $s --steps 80000 --track 0-10000,60000-80000 --snap 70000,71000,72000
      run --world SINGLE_WALL --seed $s --steps 80000 --track 0-10000,60000-80000 --snap 70000,71000,72000
    done
    for s in 13 14 15 16; do
      run --world ONE64_B2 --seed $s --steps 30000 --track 0-10000,10000-30000 --snap 20000,21000,22000
      run --world ONE64_SPOT --seed $s --steps 30000 --track 0-10000,10000-30000 --snap 20000,21000,22000
    done
    ;;
  b)
    for s in 13 14 15 16; do
      run --world NO_PHAGE --seed $s --steps 240000 --track 0-10000,60000-80000,220000-240000 --snap 70000,71000,72000,230000,231000,232000
    done
    ;;
  c)
    for s in 13 14 15 16; do
      run --world PHAGE --seed $s --steps 240000 --track 0-10000,60000-80000,220000-240000 --snap 70000,71000,72000,230000,231000,232000
      run --world SINGLE_WALL --seed $s --steps 240000 --track 0-10000,60000-80000,220000-240000 --snap 70000,71000,72000,230000,231000,232000
    done
    ;;
  snaps)
    DOC=docs/b2-compartment-check-2026-11-21
    png() { deno run -A --no-lock experiments/b2check/render.ts --dir "$OUT/$1/seed-13" --times "$2" --size "$3" --zoom "$4" --out "$DOC/snap-$1-seed13-$5.png"; }
    png PHAGE 70000,71000,72000 128 3 70k
    png SINGLE_WALL 70000,71000,72000 128 3 70k
    png NO_PHAGE 70000,71000,72000 128 3 70k
    png NO_PHAGE 230000,231000,232000 128 3 230k
    png ONE64_B2 20000,21000,22000 64 6 20k
    png ONE64_SPOT 20000,21000,22000 64 6 20k
    if [ -f "$OUT/PHAGE/seed-13/snap-230000.bin" ] && [ -f "$OUT/PHAGE/seed-13/snap-231000.bin" ] && [ -f "$OUT/PHAGE/seed-13/snap-232000.bin" ]; then png PHAGE 230000,231000,232000 128 3 230k; fi
    ;;
  *) echo "usage: $0 a|b|c|snaps" >&2; exit 2 ;;
esac
