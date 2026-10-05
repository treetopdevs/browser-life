#!/bin/bash
# lane.sh <n>: runs this instance's commands from ops/cmds.txt ("id|deps|command", a copy of tools/hunt1-queue.ts's cmds-<n>.txt)
# in file order, as the R3 replication's lanes did. A command runs once every dependency is satisfied: a plain dependency must
# be in ops/done (if it is in ops/fail, the command fails too); an ordering-only dependency ~id only has to be in ops/done or
# ops/fail. Claims are mkdir locks in ops/claims, each holding its lane's pid (ops/claims/<id>/lane) and, once the command has
# started, its process group (ops/claims/<id>/pgid: "<pgid> <boot id>").
# Each command runs in a process group of its own (setsid). The child publishes that group in the claim and checks that the claim is
# still this lane's BEFORE it execs the command (it exits without running it if either fails; its command line carries bl-claim:<id>
# until then), so start.sh releases a claim only when the lane is gone AND no process of the group is left or about to start. When the
# command's leader returns, the lane kills whatever remains of the group (TERM, then KILL after REAP_GRACE seconds) and waits until
# the group is empty before it retries the command or publishes done/fail: a retry or a replacement never overlaps a survivor, whose
# output history.sh would otherwise delete. A failed command is retried once with the same seeds (registration validity step 2),
# except the device check (ids devcheck-<n>); a command that failed because a dependency failed was never run and is not retried.
cd ~/bl || exit 1
export PATH=$HOME/.deno/bin:$PATH
mkdir -p ops/claims ops/done ops/fail ops/logs
command -v setsid > /dev/null || { echo "$(date -u +%FT%T) lane$1: no setsid; not starting" >> ops/lanes.log; exit 1; }
n=$1
REAP_GRACE=${REAP_GRACE:-10}
claim_mine() { [ "$(cat "ops/claims/$1/lane" 2>/dev/null)" = "$$" ]; }
run_cmd() { # run_cmd ID CMD LOG: CMD in a new session and process group; 125 if its child could not register or the claim is no longer this lane's
  rm -f "ops/claims/$1/pgid"
  LANE_PID=$$ setsid bash -c 'c=ops/claims/$1; echo "$$ $(cat /proc/sys/kernel/random/boot_id 2>/dev/null)" > "$c/pgid.tmp" && mv "$c/pgid.tmp" "$c/pgid" && [ "$(cat "$c/lane")" = "$LANE_PID" ] || exit 125; exec bash -c "$0"' "$2" "$1" "bl-claim:$1" > "$3" 2>&1 &
  wait $!
}
reap_group() { # reap_group ID: nothing of the command's group may outlive its leader: TERM, KILL after the grace period, then wait until the group is empty (1 if it will not go)
  local pg boot k
  [ -s "ops/claims/$1/pgid" ] || return 0
  read -r pg boot < "ops/claims/$1/pgid"
  [ -n "$pg" ] && [ "$boot" = "$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)" ] || return 0
  kill -0 -- "-$pg" 2> /dev/null || return 0
  kill -TERM -- "-$pg" 2> /dev/null
  for ((k = 0; k < REAP_GRACE; k++)); do kill -0 -- "-$pg" 2> /dev/null || return 0; sleep 1; done
  kill -KILL -- "-$pg" 2> /dev/null
  for ((k = 0; k < 60; k++)); do kill -0 -- "-$pg" 2> /dev/null || return 0; sleep 1; done
  return 1
}
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
    echo $$ > ops/claims/$id/lane   # start.sh releases a claim only when this pid and the command's group are both gone
    echo "$(date -u +%FT%T) lane$n start $id" >> ops/lanes.log
    survived=0
    run_cmd "$id" "$cmd" ops/logs/$id.log; rc=$?
    if ! claim_mine "$id"; then echo "$(date -u +%FT%T) lane$n lost claim $id; not publishing" >> ops/lanes.log; progress=1; break; fi
    reap_group "$id" || survived=1
    if [ $rc != 0 ] && [ "${id%%-*}" != devcheck ] && [ $survived = 0 ]; then
      echo "$(date -u +%FT%T) lane$n retry $id rc=$rc" >> ops/lanes.log
      mv ops/logs/$id.log ops/logs/$id.try1.log; run_cmd "$id" "$cmd" ops/logs/$id.log; rc=$?
      if ! claim_mine "$id"; then echo "$(date -u +%FT%T) lane$n lost claim $id; not publishing" >> ops/lanes.log; progress=1; break; fi
      reap_group "$id" || survived=1
    fi
    if [ $survived = 1 ]; then echo "rc=$rc: the command's process group survived SIGKILL" > ops/fail/$id
    elif [ $rc = 0 ]; then touch ops/done/$id
    else echo "rc=$rc" > ops/fail/$id; fi
    echo "$(date -u +%FT%T) lane$n end $id rc=$rc" >> ops/lanes.log
    progress=1; break
  done < ops/cmds.txt
  [ $pending = 0 ] && break
  [ $progress = 0 ] && sleep 20
done
echo "$(date -u +%FT%T) lane$n exit" >> ops/lanes.log
