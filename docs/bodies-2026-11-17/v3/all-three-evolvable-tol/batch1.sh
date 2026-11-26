#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies
D=docs/bodies-2026-11-17/v3/all-three-evolvable-tol
G=(--gates share,grow,signal); M=(--mut on --tag-mut-rate 400 --tol-gene)
for s in 1 2 3; do
 $D/run.sh r2-crowd-s$s --scenario crowd --seed $s --steps 20000 "${G[@]}" --frames 0,5000,20000 &
 $D/run.sh r3A-evol-s$s --scenario crowd --seed $s --steps 20000 "${G[@]}" "${M[@]}" --frames 0,5000,10000,20000 &
 wait
 $D/run.sh r3B-blind-s$s --scenario crowd --seed $s --steps 20000 "${G[@]}" "${M[@]}" --tag-blind --frames 0,5000,20000 &
done; wait
