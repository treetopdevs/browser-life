#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/wildcard
T="--tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --gates grow --founders 5"
for r in 8 11; do for s in 1 2 3; do
./run.sh WB-r$r-s$s --scenario wound-in-crowd --seed $s --steps 15000 --wound-at 10000 --wound-radius $r --wound-watch 5000 --wound-every 100 $T --frames 9999,10000,10300,12000,end &
done; done
./run.sh WB-r11-blind-s1 --scenario wound-in-crowd --seed 1 --steps 15000 --wound-at 10000 --wound-radius 11 --wound-watch 5000 --wound-every 100 $T --tag-blind --frames end &
wait
