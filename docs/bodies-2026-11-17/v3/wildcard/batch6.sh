#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/wildcard
T="--scenario crowd --steps 20000 --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --gates grow --founders 5"
for sup in 15 17; do for s in 1 2 3; do ./run.sh F$sup-s$s $T --seed $s --rules-override "{\"SUPPLY\":$sup}" --frames 1000,5000,10000,end & done
./run.sh F$sup-blind-s1 $T --seed 1 --tag-blind --rules-override "{\"SUPPLY\":$sup}" --frames end & done
wait
