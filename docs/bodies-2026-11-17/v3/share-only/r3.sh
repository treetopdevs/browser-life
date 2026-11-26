#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies; D=docs/bodies-2026-11-17/v3/share-only
M="--mut on --tag-mut-rate 32768 --tag-step 64 --tag-mut-bud"
run(){ n=$1; shift; node --no-warnings experiments/bodies/v3.ts --scenario crowd --steps 20000 --quiet --frames 1000,5000,10000,end --out $D/$n "$@" > $D/$n.log 2>&1; }
for s in 1 2 3; do
 run r3-share-s$s --seed $s $M --gates share &
 run r3-blind-s$s --seed $s $M --gates share --tag-blind &
 run r3-same-s$s --seed $s --mut on --tags same --gates share &
done; wait
