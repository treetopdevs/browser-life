#!/bin/bash
cd /Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/wildcard
B="--scenario crowd --seed 1 --steps 20000 --tag-mut-rate 65536 --tag-mut-bud --tag-step 40"
./run.sh L-F $B --gates grow --founders 5 &
./run.sh L-Fblind $B --gates grow --founders 5 --tag-blind &
./run.sh L-C $B --gates share,signal --seam-cost 2 --raid 2 &
./run.sh L-Cblind $B --gates share,signal --seam-cost 2 --raid 2 --tag-blind &
./run.sh L-D $B --gates share,signal --seam-cost 3 &
./run.sh L-Dblind $B --gates share,signal --seam-cost 3 --tag-blind &
./run.sh L-I $B --gates share,signal --raid 3 &
./run.sh L-Iblind $B --gates share,signal --raid 3 --tag-blind &
wait
