#!/bin/bash
# Runs one step of SPOT6 (docs/six-wall-spot-2026-11-22/PLAN.md). Resumable: finished segments are skipped.
# One GPU job at a time: do not start two of these side by side.
#   experiments/spot6/run-all.sh parity                       # runner with no overrides = run-droplets.ts, seed 1
#   experiments/spot6/run-all.sh check                        # GPU = CPU reference at every non-default setting, seed 1
#   experiments/spot6/run-all.sh run <setting> <arm> <seed> <steps>   # one run with the standard layout (also extends one)
#   experiments/spot6/run-all.sh stage1 "<settings>"          # NO_PHAGE, seeds 1 and 2, 40,000 steps
#   experiments/spot6/run-all.sh stage2 "<settings>"          # PHAGE, seeds 1 and 2, 40,000 steps
#   experiments/spot6/run-all.sh check-variant <PH_x@setting> # the same check for a phage variant, before its first run
#   experiments/spot6/run-all.sh stage3 "<settings>"          # all four arms, seeds 1 to 4, 100,000 steps
#   experiments/spot6/run-all.sh snap <setting> <arm> <seed> <t0> <name>   # PNG of three snapshots from t0, 1,000 steps apart
set -euo pipefail
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
cd "$(dirname "$0")/../.."
OUT=runs/spot6
DOC=docs/six-wall-spot-2026-11-22
mkdir -p "$OUT/logs"

# The standard layout: steps 0 to 10,000 tracked (founding), 10,000 to 20,000 untracked, then every 20,000-step
# window tracked, with three snapshots 1,000 steps apart from the middle of each.
layout() {
  TRACK="0-10000"
  SNAP=""
  local a
  for ((a = 20000; a < $1; a += 20000)); do
    TRACK="$TRACK,$a-$((a + 20000))"
    SNAP="$SNAP,$((a + 10000)),$((a + 11000)),$((a + 12000))"
  done
  SNAP="${SNAP#,}"
}
# The pattern-blind and one-wall arms are needed for their census rows only: their last window alone is tracked.
layout_rows() {
  TRACK="$(($1 - 20000))-$1"
  SNAP="$(($1 - 10000)),$(($1 - 9000)),$(($1 - 8000))"
}
one() { # setting arm seed steps
  if [ "$2" = PHAGE ] || [ "$2" = NO_PHAGE ]; then layout "$4"; else layout_rows "$4"; fi
  local t0=$SECONDS
  deno run -A --no-lock experiments/spot6/run.ts --out "$OUT" --setting "$1" --arm "$2" --seed "$3" --steps "$4" --track "$TRACK" --snap "$SNAP"
  echo "$(date +%FT%T) $1 $2 seed $3 to $4: $((SECONDS - t0)) s" >> "$OUT/logs/gpu-seconds.log"
}

case "${1:-}" in
  parity)
    deno run -A --no-lock experiments/confirm/run-droplets.ts --out "$OUT/parity/confirm" --seeds 1 --steps 5000
    for a in PHAGE NO_PHAGE SINGLE_WALL NEUTRAL_PHAGE; do
      deno run -A --no-lock experiments/spot6/run.ts --setting B2 --arm $a --seed 1 --out "$OUT/parity/spot6" --steps 5000 --track 0-2500
    done
    deno run -A --no-lock experiments/spot6/parity.ts --confirm "$OUT/parity/confirm" --spot6 "$OUT/parity/spot6" --seed 1 --steps 5000 | tee "$OUT/parity.txt"
    ;;
  check)
    t0=$SECONDS
    {
      deno run -A --no-lock experiments/spot6/gpu-check.ts --settings MIX25,MIX50,MIX75,DIFF_ONLY --arms PHAGE,NEUTRAL_PHAGE
      deno run -A --no-lock experiments/spot6/gpu-check.ts --settings SPOT --arms PHAGE,NEUTRAL_PHAGE,NO_PHAGE,SINGLE_WALL
    } | tee "$OUT/gpu-check.tmp"
    mv "$OUT/gpu-check.tmp" "$OUT/gpu-check.txt"
    echo "$(date +%FT%T) gpu-check: $((SECONDS - t0)) s (mostly the CPU reference)" >> "$OUT/logs/gpu-seconds.log"
    ;;
  check-variant)
    deno run -A --no-lock experiments/spot6/gpu-check.ts --settings "$2" --arms PHAGE,NEUTRAL_PHAGE | tee -a "$OUT/gpu-check.txt"
    ;;
  run)
    one "$2" "$3" "$4" "$5"
    ;;
  stage1)
    for st in $2; do for s in 1 2; do one "$st" NO_PHAGE $s 40000; done; done
    ;;
  stage2)
    for st in $2; do for s in 1 2; do one "$st" PHAGE $s 40000; done; done
    ;;
  stage3)
    for st in $2; do
      for s in 1 2 3 4; do
        for a in PHAGE NO_PHAGE NEUTRAL_PHAGE SINGLE_WALL; do one "$st" "$a" $s 100000; done
      done
    done
    ;;
  snap)
    mkdir -p "$DOC"
    deno run -A --no-lock experiments/b2check/render.ts --dir "$OUT/$2/$3/seed-$4" --times "$5,$(($5 + 1000)),$(($5 + 2000))" --size 128 --zoom 3 --out "$DOC/snap-$6.png"
    ;;
  *) echo "usage: $0 parity|check|check-variant|run|stage1|stage2|stage3|snap (see the header)" >&2; exit 2 ;;
esac
