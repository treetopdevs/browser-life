#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies
D=docs/bodies-2026-11-17/v3/all-three-evolvable-tol
G=(--gates share,grow,signal); M=(--mut on --tag-mut-rate 6000 --tol-gene --genome 16,60,0,0)
for s in 1 2 3; do
 $D/run.sh r4A-budless-s$s --scenario crowd --seed $s --steps 20000 "${G[@]}" "${M[@]}" --frames 0,20000 &
 $D/run.sh r4B-budless-blind-s$s --scenario crowd --seed $s --steps 20000 "${G[@]}" "${M[@]}" --tag-blind --frames 20000 &
 wait
done
