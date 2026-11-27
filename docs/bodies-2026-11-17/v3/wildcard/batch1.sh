#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/wildcard
B="--scenario crowd --seed 1 --steps 8000 --no-frames --tag-mut-rate 65536 --tag-mut-bud --tag-step 40"
./run.sh w-A $B --gates grow &
./run.sh w-B $B --gates share,grow,signal &
./run.sh w-C $B --gates share,signal --seam-cost 2 --raid 2 &
./run.sh w-D $B --gates share,signal --seam-cost 3 &
./run.sh w-E $B --gates grow --mut on &
./run.sh w-F $B --gates grow --founders 5 &
./run.sh w-G $B --gates share,signal,grow --tol 4 --tag-step 24 &
./run.sh w-H $B --gates grow --genome 16,60,8,0 &
./run.sh w-I $B --gates share,signal --raid 3 &
wait
