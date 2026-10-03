#!/bin/bash
# start.sh [sweep] (instance; bootstrap, @reboot, the watchdog's restart and its sweep): starts the lanes that are missing, up to LANES
# (6), and never disturbs a running one; with `sweep` it only releases dead claims. Everything runs under one OS-held lock
# (ops/start.lock, flock held by this process on fd 9 through a python wrapper that re-execs the script; the kernel releases it when
# the process dies, however it dies, and no lock file is ever deleted or "recovered") that the watchdog's sweep takes too (it calls
# `start.sh sweep`), so two recoveries never overlap: they could not both inspect an old dead owner and have the second delete the
# replacement claim a lane made in between. A contender waits up to START_LOCK_WAIT seconds (5), then exits quietly. A claim is released only
# when ALL of these hold, checked again, with the owner unchanged, immediately before it is removed: its lane pid is dead (a claim
# with no lane pid is given two minutes), no process of the command's group (ops/claims/<id>/pgid, published by lane.sh before the
# command runs) is alive, and, if no group was published, the claim is two minutes old and no process still carries bl-claim:<id>
# (a child that has not registered yet). A command that outlived its lane thus keeps its claim: it never runs twice, and a
# replacement never cleans up (history.sh) or writes over a survivor's output. Lanes claim with mkdir, as before. Started lanes are
# recorded in ops/lanes.pids ("<lane number> <pid>").
SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
cd ~/bl || exit 1
mkdir -p ops/claims ops/done ops/fail ops/logs runs/scaffold/reg1
if [ -z "${BL_LOCKED:-}" ]; then   # take the OS-held lock (fd 9) and run this script again under it
  exec python3 -c 'import fcntl, os, sys, time
lockfile, wait, rc, msg = sys.argv[1], float(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
fd = os.open(lockfile, os.O_CREAT | os.O_RDWR, 0o644)
end = time.time() + wait
while True:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except OSError:
        if time.time() >= end:
            if msg:
                sys.stderr.write(msg + "\n")
            sys.exit(rc)
        time.sleep(0.1)
if fd != 9:
    os.dup2(fd, 9)
    os.close(fd)
os.set_inheritable(9, True)
os.environ["BL_LOCKED"] = "1"
os.execv("/bin/bash", ["/bin/bash"] + sys.argv[5:])' "$PWD/ops/start.lock" "${START_LOCK_WAIT:-5}" 0 "" "$SELF" "$@"
fi
unset BL_LOCKED
LANES=${LANES:-6}
alive() { # alive PID WORD: PID is a live process whose command line names WORD (after a reboot a reused pid is not a lane)
  kill -0 "$1" 2>/dev/null && ps -p "$1" -o args= 2>/dev/null | grep -q -F "$2"
}
group_alive() { # group_alive CLAIMDIR: some process of the command's group (lane.sh's "<pgid> <boot id>") is alive in this boot
  local pg boot
  [ -s "$1/pgid" ] || return 1
  read -r pg boot < "$1/pgid"
  [ "$boot" = "$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)" ] && [ -n "$pg" ] && kill -0 -- "-$pg" 2>/dev/null
}
claim_dead() { # claim_dead CLAIMDIR: the lane is gone and nothing of its command survives or is about to start
  local c=$1 pid
  pid=$(cat "$c/lane" 2>/dev/null)
  if [ -z "$pid" ]; then [ -n "$(find "$c" -maxdepth 0 -mmin +2)" ] || return 1
  elif alive "$pid" ops/lane.sh; then return 1; fi
  group_alive "$c" && return 1
  if [ ! -s "$c/pgid" ]; then
    [ -n "$(find "$c" -maxdepth 0 -mmin +2)" ] || return 1
    pgrep -f "bl-claim:$(basename "$c")\$" > /dev/null && return 1
  fi
  return 0
}
for c in ops/claims/*; do
  [ -d "$c" ] || continue; id=$(basename "$c")
  { [ -e "ops/done/$id" ] || [ -e "ops/fail/$id" ]; } && continue
  owner="$(cat "$c/lane" 2>/dev/null)|$(cat "$c/pgid" 2>/dev/null)"
  claim_dead "$c" || continue
  [ "$owner" = "$(cat "$c/lane" 2>/dev/null)|$(cat "$c/pgid" 2>/dev/null)" ] && claim_dead "$c" || continue   # same owner, still dead, right before the removal
  rm -rf "$c"; echo "$(date -u +%FT%T) start.sh released $id" >> ops/lanes.log
done
[ "${1:-}" = sweep ] && exit 0
touch ops/lanes.pids
running=0; keep=""; used=" "
while read -r ln pid; do
  [ -n "$pid" ] || continue
  if alive "$pid" ops/lane.sh; then running=$((running+1)); keep="$keep$ln $pid"$'\n'; used="$used$ln "; fi
done < ops/lanes.pids
printf '%s' "$keep" > ops/lanes.pids
started=0
for n in $(seq 1 "$LANES"); do
  [ "$running" -ge "$LANES" ] && break
  case "$used" in *" $n "*) continue ;; esac
  nohup bash ops/lane.sh "$n" 9>&- > /dev/null 2>&1 &   # (a lane must not inherit the lock)
  echo "$n $!" >> ops/lanes.pids
  running=$((running+1)); started=$((started+1))
done
[ "$started" -gt 0 ] && rm -f ops/finished
echo "$(date -u +%FT%T) started $started lanes ($running of $LANES running)" >> ops/lanes.log
