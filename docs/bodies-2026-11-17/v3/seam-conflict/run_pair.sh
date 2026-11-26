#!/bin/bash
# usage: run_pair.sh name "flags"   (seeds 1..3, 12000 steps)
cd /Users/nicholas/develop/browser-life-bodies
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
n=$1; shift
for s in 1 2 3; do
  node --no-warnings experiments/bodies/v3.ts --scenario pair --steps 12000 --seed $s --quiet --frames 0,1000,12000 --out docs/bodies-2026-11-17/v3/seam-conflict/r1/$n/s$s "$@" > /dev/null 2>docs/bodies-2026-11-17/v3/seam-conflict/r1_$n.err &
done
wait
