#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/wildcard
T="--scenario crowd --steps 20000 --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --gates grow --founders 5 --frames end"
for s in 1 2 3; do ./run.sh L-F-same-s$s $T --seed $s --tags same & done
for s in 2 3; do ./run.sh L-Fblind-s$s $T --seed $s --tag-blind & done
wait
