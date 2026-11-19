#!/bin/bash
# usage: run1.sh rung name seed scenario flags...   (20000 steps crowd default)
cd /Users/nicholas/develop/browser-life-bodies
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
rung=$1; n=$2; s=$3; sc=$4; shift 4
O=docs/bodies-2026-11-17/v3/seam-conflict/$rung/$n/s$s
node --no-warnings experiments/bodies/v3.ts --scenario $sc --seed $s --quiet --out $O "$@" > /dev/null 2> docs/bodies-2026-11-17/v3/seam-conflict/err_${rung}_${n}_$s.txt
