#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/wildcard
T="--scenario crowd --steps 15000 --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --gates grow --founders 5 --frames end"
for sup in 18 19; do for s in 1 2; do ./run.sh G$sup-s$s $T --seed $s --rules-override "{\"SUPPLY\":$sup}" & done; done
./run.sh G18-d24-s1 $T --seed 1 --genome 24,60,4,0 --rules-override '{"SUPPLY":18}' &
./run.sh G19-d24-s1 $T --seed 1 --genome 24,60,4,0 --rules-override '{"SUPPLY":19}' &
./run.sh G18-upk-s1 $T --seed 1 --rules-override '{"SUPPLY":24,"UPK":5}' &
./run.sh G18-upk7-s1 $T --seed 1 --rules-override '{"SUPPLY":24,"UPK":7}' &
wait
