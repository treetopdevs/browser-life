#!/bin/bash
# history.sh EXPERIMENT CONDITION SEED STEPS PRECYCLE: one history or ancestor world at census 1,000; if that run stops on an
# event-buffer overflow, the same spec at census 100 under EXPERIMENT-c100 (registration validity step 3, Amendment 1).
set -u
cd ~/bl || exit 1
export PATH=$HOME/.deno/bin:$PATH
mkdir -p ops/logs
# tools/run.ts appends to an existing bundle's files, so a directory left incomplete by an earlier attempt (a killed process,
# a lost instance, the lane's one retry) is removed first; a complete one is kept, and tools/run.ts then skips it.
clean() { d=runs/scaffold/reg1/$1/ponds/$2/seed-$3; [ -d "$d" ] || return 0
  python3 -c "import json,sys; sys.exit(0 if json.load(open('$d/manifest.json')).get('summary') is not None else 1)" 2>/dev/null || { echo "removing incomplete $d"; rm -rf "$d"; }; }
clean $1 $2 $3
log=ops/logs/history-$1-$2-$3.c1000.log
deno run -A tools/run.ts --out runs/scaffold/reg1 --experiment $1 --preset ponds --conditions $2 --seeds $3 --steps $4 --census 1000 --deep 10 --checkpoint 0 --pre-cycle $5 2>&1 | tee $log
rc=${PIPESTATUS[0]}
if [ $rc -ne 0 ] && grep -q "event buffer overflow" $log; then
  echo "overflow at census 1,000: rerunning at census 100 under $1-c100"
  clean $1-c100 $2 $3
  deno run -A tools/run.ts --out runs/scaffold/reg1 --experiment $1-c100 --preset ponds --conditions $2 --seeds $3 --steps $4 --census 100 --deep 10 --checkpoint 0 --pre-cycle $5
  exit $?
fi
exit $rc
