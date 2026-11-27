#!/bin/bash
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
cd /Users/nicholas/develop/browser-life-bodies
S=docs/bodies-2026-11-17/v3/_skeptic/seam-conflict
n=$1; s=$2; st=$3; shift 3
node --no-warnings $S/sk_events.ts --scenario crowd --seed $s --steps $st --sk-out $S/runs/ev_${n}_s$s.json "$@" > $S/runs/evlog_${n}_s$s.txt 2>&1
