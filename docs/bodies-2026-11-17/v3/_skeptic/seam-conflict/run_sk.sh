#!/bin/bash
# usage: run_sk.sh name seed steps [flags...]   -> runs/<name>_s<seed>
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
cd /Users/nicholas/develop/browser-life-bodies
S=docs/bodies-2026-11-17/v3/_skeptic/seam-conflict
n=$1; s=$2; st=$3; shift 3
node --no-warnings $S/sk_run.ts --scenario crowd --seed $s --steps $st --sk-out $S/runs/${n}_s$s "$@" > $S/runs/log_${n}_s$s.txt 2>&1
