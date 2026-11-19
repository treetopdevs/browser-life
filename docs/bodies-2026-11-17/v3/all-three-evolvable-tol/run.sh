#!/bin/bash
# usage: run.sh name extra-args...   (seed via SEED env); run from worktree root
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
D=docs/bodies-2026-11-17/v3/all-three-evolvable-tol
n=$1; shift
node --no-warnings experiments/bodies/v3.ts --quiet --out $D/$n "$@" > $D/logs/$n.log 2>&1
