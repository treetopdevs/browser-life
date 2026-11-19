#!/bin/bash
# usage: run.sh name args...   (run from worktree root)
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
D=docs/bodies-2026-11-17/v3/all-three-fixed
n=$1; shift
echo "$n: $*" >> $D/commands.txt
node --no-warnings experiments/bodies/v3.ts --out $D/$n --quiet "$@" > $D/$n.log 2>&1
