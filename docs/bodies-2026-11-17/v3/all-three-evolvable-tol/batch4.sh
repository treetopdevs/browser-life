#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies
D=docs/bodies-2026-11-17/v3/all-three-evolvable-tol
G=(--gates share,grow,signal); M=(--mut on --tag-mut-rate 6000 --tol-gene)
for s in 1 2 3; do
 $D/run.sh r3C6k-sametags-s$s --scenario crowd --seed $s --steps 20000 "${G[@]}" "${M[@]}" --tags same --frames 0,20000 &
 $D/run.sh r3W6k-wound-s$s --scenario wound-in-crowd --seed $s --steps 15500 --wound-at 14000 "${G[@]}" "${M[@]}" --frames 0,end &
 $D/run.sh r3Wb6k-woundblind-s$s --scenario wound-in-crowd --seed $s --steps 15500 --wound-at 14000 "${G[@]}" "${M[@]}" --tag-blind --frames 0,end &
 wait
done
