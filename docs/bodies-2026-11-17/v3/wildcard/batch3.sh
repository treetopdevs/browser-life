#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/wildcard
T="--tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --gates grow --founders 5"
for s in 1 2 3; do
./run.sh W-F-s$s --scenario wound-in-crowd --seed $s --steps 13500 --wound-at 12000 $T &
done
./run.sh W-Fblind-s1 --scenario wound-in-crowd --seed 1 --steps 13500 --wound-at 12000 $T --tag-blind &
for s in 1 2 3; do
./run.sh M-F-mut-s$s --scenario crowd --seed $s --steps 20000 $T --mut on --mut-rate 12 --frames 5000,end &
done
./run.sh M-F-geneblind-s1 --scenario crowd --seed 1 --steps 20000 $T --mut on --mut-rate 12 --gene-blind --frames end &
./run.sh L-F-s2 --scenario crowd --seed 2 --steps 20000 $T --frames end &
./run.sh L-F-s3 --scenario crowd --seed 3 --steps 20000 $T --frames end &
wait
