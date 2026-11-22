#!/bin/sh
# Droplet genes, heritable trait: run one calibration setting (gated, selected ladder) from two start levels.
# Usage: trait-screen.sh <name> <levels> <geneSat> <mutLevel> <highStart> <steps> <seeds> [arms] [jobs]
#   e.g. trait-screen.sh c01 5 2 0.015625 3 20000 1,2
# Output: runs/dropgenes/trait/screen/<name>/L<start>-K2-cap16-<ARM>-s<seed>.json. Finished runs are skipped,
# so the script can be re-invoked after an interruption. Calibration seeds are 1 to 4 only.
set -eu
name=$1; levels=$2; sat=$3; mut=$4; high=$5; steps=$6; seeds=$7; arms=${8:-GATED_SEL}; jobs=${9:-2}
case ",$seeds," in *,[5-9],*|*,[1-9][0-9]*,*) echo "calibration uses seeds 1 to 4 only" >&2; exit 2;; esac
here=$(cd "$(dirname "$0")" && pwd)
for start in 0 "$high"; do
  deno run -A --no-lock "$here/sweep.ts" --dir "runs/dropgenes/trait/screen/$name" --genes 2 --caps 16 --seeds "$seeds" \
    --steps "$steps" --mutPar 0 --jobs "$jobs" --arms "$arms" --levels "$levels" --mutLevel "$mut" --startLevel "$start" --tag "L$start" \
    --ov "{\"diffT\":0.1,\"diffW\":0.03,\"diffF\":0.6,\"diffA\":0.44,\"geneSat\":$sat}"
done
