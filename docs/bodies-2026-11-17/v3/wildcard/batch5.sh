#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/wildcard
T="--scenario crowd --seed 1 --steps 12000 --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --gates grow --founders 5 --no-frames"
for sup in 14 17 20 32; do ./run.sh S-sup$sup $T --rules-override "{\"SUPPLY\":$sup}" & done
for u in 6 12; do ./run.sh S-upk$u $T --rules-override "{\"UPK\":$u}" & done
./run.sh S-bud12 $T --genome 16,60,12,0 &
./run.sh S-d10 $T --genome 10,60,4,0 &
./run.sh S-d28 $T --genome 28,60,4,0 &
wait
