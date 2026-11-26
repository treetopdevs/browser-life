#!/bin/bash
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
cd /Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/all-three-evolvable-tol; mkdir -p tol
G="--gates share,grow,signal --mut on --tol-gene --scenario crowd --steps 20000"
for r in 6000 32768; do
 for s in 1 2 3; do
  node --no-warnings tolscan.ts tol/A-$r-s$s.json $G --tag-mut-rate $r --seed $s &
  node --no-warnings tolscan.ts tol/B-$r-s$s.json $G --tag-mut-rate $r --seed $s --tag-blind &
  wait
 done
done
