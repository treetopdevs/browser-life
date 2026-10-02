#!/bin/bash
# lane.sh <n>: runs this instance's commands from ops/cmds.txt ("id|deps|command", a copy of tools/reg1-queue.ts's cmds-<n>.txt)
# in file order, as the R3 replication's lanes did. A command runs once every dependency is satisfied: a plain dependency must
# be in ops/done (if it is in ops/fail, the command fails too); an ordering-only dependency ~id only has to be in ops/done or
# ops/fail. Claims are mkdir locks in ops/claims. A failed command is retried once with the same seeds (registration validity
# step 2), except the device check.
cd ~/bl || exit 1
export PATH=$HOME/.deno/bin:$PATH
mkdir -p ops/claims ops/done ops/fail ops/logs
n=$1
while true; do
  progress=0; pending=0
  while IFS='|' read -r id deps cmd; do
    [ -z "$id" ] && continue
    { [ -e ops/done/$id ] || [ -e ops/fail/$id ]; } && continue
    pending=$((pending+1))
    [ -d ops/claims/$id ] && continue
    ready=1
    if [ "$deps" != "-" ]; then
      for d in ${deps//,/ }; do
        case $d in
          "~"*)
            d=${d#"~"}
            { [ -e ops/done/$d ] || [ -e ops/fail/$d ]; } || { ready=0; break; } ;;
          *)
            if [ -e ops/fail/$d ]; then mkdir ops/claims/$id 2>/dev/null && echo "dep $d failed" > ops/fail/$id; ready=0; break; fi
            [ -e ops/done/$d ] || { ready=0; break; } ;;
        esac
      done
    fi
    [ $ready = 1 ] || continue
    mkdir ops/claims/$id 2>/dev/null || continue
    echo "$(date -u +%FT%T) lane$n start $id" >> ops/lanes.log
    bash -c "$cmd" > ops/logs/$id.log 2>&1; rc=$?
    if [ $rc != 0 ] && [ "${id%%-*}" != devcheck ]; then
      echo "$(date -u +%FT%T) lane$n retry $id rc=$rc" >> ops/lanes.log
      mv ops/logs/$id.log ops/logs/$id.try1.log; bash -c "$cmd" > ops/logs/$id.log 2>&1; rc=$?
    fi
    if [ $rc = 0 ]; then touch ops/done/$id; else echo "rc=$rc" > ops/fail/$id; fi
    echo "$(date -u +%FT%T) lane$n end $id rc=$rc" >> ops/lanes.log
    progress=1; break
  done < ops/cmds.txt
  [ $pending = 0 ] && break
  [ $progress = 0 ] && sleep 20
done
echo "$(date -u +%FT%T) lane$n exit" >> ops/lanes.log
