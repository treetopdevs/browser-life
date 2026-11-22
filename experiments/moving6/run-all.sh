#!/bin/bash
# Runs one step of MOVING6 (docs/six-wall-moving-2026-11-22/PLAN.md). Resumable: finished segments are skipped.
# One GPU job at a time: do not start two of these side by side.
#   experiments/moving6/run-all.sh adopt <seed>                # MIX25 NO_PHAGE: take over the stored run of seed 1 or 2 and replay its two tracked windows with the move log
#   experiments/moving6/run-all.sh replay <setting> <arm> <seed> <a-b>   # replay one stored tracked window of the earlier screen into runs/moving6/controls
#   experiments/moving6/run-all.sh check "<settings>"          # GPU = CPU reference, all four arms, seed 1 (CHECK_SEED=33 for a later confirmation)
#   experiments/moving6/run-all.sh check-variant <PH_x@MIX25>  # the same check, all four arms, for a phage variant before its first run
#   experiments/moving6/run-all.sh run <setting> <arm> <seed> <steps>    # one run with the standard layout (also extends one)
#   experiments/moving6/run-all.sh gate "<settings>"           # NO_PHAGE, seeds 1 and 2, 40,000 steps
#   experiments/moving6/run-all.sh stage2 "<settings>"         # PHAGE, seeds 1 and 2, 40,000 steps
#   experiments/moving6/run-all.sh stage3 "<settings>"         # all four arms, seeds 1 to 4, 100,000 steps
#   experiments/moving6/run-all.sh late <setting>              # PHAGE and NO_PHAGE, seeds 1 and 2, on to 200,000 steps
#   experiments/moving6/run-all.sh snap <setting> <arm> <seed> <t0> <name>   # PNG of three snapshots from t0, 1,000 steps apart
#   experiments/moving6/run-all.sh confirm <setting>           # NOT RUN IN THIS LINE: seeds 33 to 40, all four arms, 100,000 steps,
#                                                              # into runs/moving6-confirm. The runner refuses these seeds until the
#                                                              # allowed list in experiments/moving6/settings.ts is changed (PLAN.md).
set -euo pipefail
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
cd "$(dirname "$0")/../.."
OUT=runs/moving6
DOC=docs/six-wall-moving-2026-11-22
# The earlier screen's raw runs. Read only: nothing is written there.
STORED=${STORED:-/Users/nicholas/develop/browser-life-dropgenes-all/runs/spot6}
mkdir -p "$OUT/logs"
# Every job's wall time is logged, finished or failed (a failed job still used the GPU).
logtime() { echo "$(date +%FT%T) $1: $2 s" >> "$OUT/logs/gpu-seconds.log"; }
timed() { # label command...
  local label=$1 t0=$SECONDS rc=0
  shift
  "$@" || rc=$?
  if [ $rc -eq 0 ]; then logtime "$label" $((SECONDS - t0)); else logtime "$label FAILED (exit $rc)" $((SECONDS - t0)); fi
  return $rc
}

# The earlier screen's layout: steps 0 to 10,000 tracked (founding), 10,000 to 20,000 untracked, then every
# 20,000-step window tracked, with three snapshots 1,000 steps apart from the middle of each.
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
  timed "$1 $2 seed $3 to $4" deno run -A --no-lock experiments/moving6/run.ts --out "${RUNS_OUT:-$OUT}" --setting "$1" --arm "$2" --seed "$3" --steps "$4" --track "$TRACK" --snap "$SNAP"
}
replay() { # setting arm seed a-b out
  timed "replay $1 $2 seed $3 window $4" deno run -A --no-lock experiments/moving6/run.ts --replay "$STORED" --out "$5" --setting "$1" --arm "$2" --seed "$3" --window "$4"
}
gpucheck() { # settings(comma separated) label
  set -o pipefail
  timed "gpu-check $2 (mostly the CPU reference)" deno run -A --no-lock experiments/moving6/gpu-check.ts --settings "$1" --arms PHAGE,NO_PHAGE,NEUTRAL_PHAGE,SINGLE_WALL --seed "${CHECK_SEED:-1}" | tee -a "$OUT/gpu-check.txt"
}

case "${1:-}" in
  adopt)
    # The stored MIX25 no-phage run of this seed becomes this line's run: its untracked segment, saved states and
    # snapshots are copied, and its two tracked windows are replayed (equal to the stored ones, or the runner stops).
    d="$OUT/MIX25/NO_PHAGE/seed-$2"
    mkdir -p "$d"
    cp "$STORED/MIX25/NO_PHAGE/seed-$2/seg-10000-20000.json" "$STORED/MIX25/NO_PHAGE/seed-$2"/state-*.bin "$STORED/MIX25/NO_PHAGE/seed-$2"/snap-*.bin "$d/"
    replay MIX25 NO_PHAGE "$2" 0-10000 "$OUT"
    replay MIX25 NO_PHAGE "$2" 20000-40000 "$OUT"
    ;;
  replay)
    replay "$2" "$3" "$4" "$5" "$OUT/controls"
    ;;
  check)
    gpucheck "${2// /,}" "$2"
    ;;
  check-variant)
    gpucheck "$2" "$2"
    ;;
  run)
    one "$2" "$3" "$4" "$5"
    ;;
  gate)
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
  late)
    for s in 1 2; do for a in PHAGE NO_PHAGE; do one "$2" "$a" $s 200000; done; done
    ;;
  confirm)
    RUNS_OUT=runs/moving6-confirm
    for s in 33 34 35 36 37 38 39 40; do
      for a in PHAGE NO_PHAGE NEUTRAL_PHAGE SINGLE_WALL; do one "$2" "$a" $s 100000; done
    done
    ;;
  snap)
    mkdir -p "$DOC"
    deno run -A --no-lock experiments/b2check/render.ts --dir "$OUT/$2/$3/seed-$4" --times "$5,$(($5 + 1000)),$(($5 + 2000))" --size 128 --zoom 3 --out "$DOC/snap-$6.png"
    ;;
  *) echo "usage: $0 adopt|replay|check|check-variant|run|gate|stage2|stage3|late|snap|confirm (see the header)" >&2; exit 2 ;;
esac
