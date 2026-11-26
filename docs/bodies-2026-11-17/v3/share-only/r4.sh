#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies; D=docs/bodies-2026-11-17/v3/share-only
M="--mut on --tag-mut-rate 32768 --tag-step 64 --tag-mut-bud"
for s in 1 2 3; do
 node --no-warnings experiments/bodies/v3.ts --scenario crowd --steps 20000 --quiet --frames end --seed $s --founders 5 --out $D/r2-plain5-s$s > $D/r2-plain5-s$s.log 2>&1 &
 node --no-warnings experiments/bodies/v3.ts --scenario wound-in-crowd --steps 9600 --wound-at 8000 --quiet --seed $s $M --gates share --out $D/r3w-share-s$s > $D/r3w-share-s$s.log 2>&1 &
 node --no-warnings experiments/bodies/v3.ts --scenario wound-in-crowd --steps 9600 --wound-at 8000 --quiet --seed $s $M --gates share --tag-blind --out $D/r3w-blind-s$s > $D/r3w-blind-s$s.log 2>&1 &
done; wait; touch $D/r4.done
