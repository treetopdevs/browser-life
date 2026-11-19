#!/bin/bash
# usage: run.sh name args...   (runs from worktree root)
cd /Users/nicholas/develop/browser-life-bodies
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
n=$1; shift
d=docs/bodies-2026-11-17/v3/wildcard/$n
mkdir -p $d
echo "node --no-warnings experiments/bodies/v3.ts $* --out $d" > $d/cmd.txt
node --no-warnings experiments/bodies/v3.ts "$@" --quiet --out $d > $d/log.txt 2>&1 || echo FAIL $n
