#!/bin/bash
# Transition hunt Stage 1 AWS supervisor: one pass per launchd invocation (StartInterval 600; com.browser-life.scaf-hunt1).
# A pass (1) charges the shared cost ledger (compute, volumes, any instance under the key pair that no instance-N file records);
# (2) tears everything down if a teardown is already pending or the budget is spent (below), BEFORE any transfer; (3) pulls each running
# instance's runs/scaffold/hunt1/ (device bundle to device-inst<N>/device/, the anc-copy worlds of instances 2-3 to
# ../hunt1-anc-copy/inst<N>/<dir>/, ops logs, and a status-<N>.json of done/failed command ids), every transfer bounded by what is left
# of PASS_LIMIT (360 s; a transfer that cannot finish is killed and resumes next pass; the starting instance rotates so none starves),
# limited to BWLIMIT KB/s (20,000) and charged as egress (the bytes rsync reports when it finished, else the most the limit allows for
# the time it ran), with the budget re-checked before EVERY transfer; (4) marks an instance final only if everything pulled and
# validated in the same pass; and tears down when all three are final or the budget is spent. Teardown writes `done` and unloads only
# once the instances are terminated and the key pair and security group are confirmed deleted. A stopped instance is never restarted
# (the instances terminate on shutdown, so it should not happen): it is marked final and incomplete and teardown terminates it.
# The budget. launch.sh arms each instance, at first boot, with an absolute deadline of launch + 13 h (a root cron that runs
# `shutdown -h now`; shutdown behaviour terminate, volumes deleted with the instance), so even without this supervisor the compute is
# bounded. What the ledger has spent is not the whole story: egress added to a ledger that is still to pay for 13 h of compute can
# overrun the cap even though every instance is terminated on time. So the supervisor keeps a RESERVE and tears down as soon as
#     ledger + reserve >= CAP - 2 ($46),   reserve = sum over live instances of (deadline - now, at least 0) x ($1.006 + volume $0.0164)
#                                                      + the most the next transfer can cost (BWLIMIT x 1024 x PASS_LIMIT bytes x $0.09/GB)
# (an untracked instance counts a full 13 h), where the ledger already includes DEBITS: before each transfer its maximum (TMAX, the
# last term above) is added to `cost` (write a temporary file, mv it over) and recorded in a durable file debit-<pass>-<instance>-<kind>;
# after the transfer the ledger moves by actual - TMAX (a refund when it cost less, an excess charged) and the file is removed. A pass
# that is killed in between leaves the full maximum charged and its debit file in place, and nothing refunds it on restart, so
# interrupted transfers cannot escape the ledger. Every ledger update is atomic (tmp + mv). One supervisor runs at a time: supervise.lock
# is an OS-held lock (flock on fd 9, taken by a python wrapper that re-execs this script; the kernel releases it when the process dies,
# however it dies, and no lock file is ever deleted or "recovered"); a second pass exits at once. Every transfer that writes a local
# destination (each rsync; each ssh into a file, which includes the tar) KEEPS fd 9, together with the subshell and timer that wait on it:
# if the supervisor alone is killed, an orphaned transfer holds the lock until it exits, so no new pass can run while a writer is still
# at the same destinations. Without a supervisor an orphan is bounded by rsync --timeout (I/O stalls: a minute), ssh ServerAlive
# (about two minutes) and its own timer (the pass limit). Only the short aws CLI calls close fd 9 in their child. Outputs that are published
# later (status, ops-log archive, file list) are written under per-pass temporary names (.tmp.<pass>) and moved into place by the lock
# holder after validation; a pass first removes the temporary files of earlier passes. At launch: 13 x 3 x $1.006 = $39.23 + volumes $0.64 = $39.9, plus one transfer $0.66, is
# $40.5, leaving about $5.5 of egress under $46; compute moves from the reserve to the ledger as time passes, so the sum only grows with
# egress. The expected egress is about $2-3. If the Mac is lost, the deadlines end the compute at launch + 13 h with the ledger at
# its last value plus at most the reserve, below the $48 stop. Run only after the user has approved the dated draw note.
# The ops state directory is runs/scaffold/ops-hunt1 under the workspace root. This script is tracked in tools/hunt1-ops/aws/ and
# tools/hunt1-queue.ts --ops copies it into the state directory; both places are three levels below the workspace root, which is
# how it finds it. Account and machine specifics (VPC, AMI, the colocated git repo, the workspace path of the launchd plist) are
# not in the script: they come from the gitignored aws.conf in the state directory, as do the credentials (awsenv.sh) and the keys.
WS=$(cd "$(dirname "$0")/../../.." && pwd); O=$WS/runs/scaffold/ops-hunt1; SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
[ -f "$O/aws.conf" ] || { echo "supervise.sh: $O/aws.conf is missing; create it from the account's values: VPC=<vpc id>, AMI=<ami id>, REPO=<the colocated git repo make-src.sh archives>, WORKSPACE=<this workspace's absolute path, for the launchd plist>" >&2; exit 1; }
source "$O/aws.conf"
PLIST=$HOME/Library/LaunchAgents/com.browser-life.scaf-hunt1.plist
KN=bl-scaf-hunt1
RATE=1.006; CAP=48; EBS=150; EGRESS=0.09   # $/h per instance (g5.xlarge; g6 is cheaper), GB of EBS, $/GB out
DEADLINE_H=13   # launch.sh's deadline: launch + 13 h
PASS_LIMIT=${PASS_LIMIT:-360}; RETRY_PAUSE=${RETRY_PAUSE:-10}; BWLIMIT=${BWLIMIT_KB:-20000}   # a transfer is limited to BWLIMIT KB/s, so its egress is at most BWLIMIT x 1024 x its seconds
cd "$WS" || exit 1
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
os.execv("/bin/bash", ["/bin/bash"] + sys.argv[5:])' "$O/supervise.lock" 0 0 "" "$SELF" "$@"
fi
unset BL_LOCKED
exec >> "$O/supervise.log" 2>&1
source "$O/awsenv.sh"; SG=""; [ -f "$O/sg.conf" ] && source "$O/sg.conf"
aws() { command aws --cli-connect-timeout 15 --cli-read-timeout 60 "$@" 9>&-; }   # (children must not inherit the lock)
log() { echo "$(date '+%F %T') $*"; }
[ -f "$O/done" ] && exit 0
SSH="ssh -i $O/bl_key -o UserKnownHostsFile=$O/known_hosts -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4"
calc() { awk "BEGIN { printf \"%.6f\", $1 }"; }   # the ledger's arithmetic (awk: a pass makes dozens of these)
add_cost() { awk -v p="$O/cost" -v a="$1" 'BEGIN { getline v < p; printf "%.4f", v + a > (p ".tmp") }' && mv -f "$O/cost.tmp" "$O/cost"; }   # atomic: write aside, rename over
cost() { cat "$O/cost" 2>/dev/null || echo 0; }
charge_bytes() { add_cost "$(calc "${1:-0}/1e9*$EGRESS")"; }
TMAX=$(calc "$BWLIMIT*1024*$PASS_LIMIT/1e9*$EGRESS")   # the most one more transfer can cost: the limit for the whole pass
CAPB=$((BWLIMIT * 1024 * PASS_LIMIT))                 # ... and the most it can move: ssh output is cut at this many bytes
# debit_open KIND: before a transfer (pass $k, instance $n) its maximum goes into the ledger and into a durable debit file; debit_close ACTUAL settles it:
# the ledger moves by ACTUAL - TMAX (a refund when it cost less, an excess is charged) and the file goes. Interrupted, both stay: the maximum stays charged.
debit_open() { DEBIT="$O/debit-$k-$n-$1"; add_cost "$TMAX" && printf '%s\n' "$TMAX" > "$DEBIT.tmp" && mv -f "$DEBIT.tmp" "$DEBIT"; }
debit_close() { add_cost "$(calc "$1 - $TMAX")"; rm -f "$DEBIT"; }

# limited SECS CMD...: CMD with a wall-clock limit (macOS has no timeout(1)); 124 when it was killed at the limit
limited() {
  local secs=$1 flag pid killer rc; shift
  flag=$(mktemp "$O/limited.XXXXXX") || return 1
  "$@" & pid=$!
  ( sp=""; trap '[ -n "$sp" ] && kill $sp; exit 0' TERM   # the timer: TERM (the command finished in time) ends it quietly
    sleep "$secs" & sp=$!; wait $sp
    echo killed > "$flag"; pkill -TERM -P "$pid"; kill -TERM "$pid"
    sleep 2 & sp=$!; wait $sp
    pkill -KILL -P "$pid"; kill -KILL "$pid" ) > /dev/null 2>&1 &
  killer=$!
  wait "$pid"; rc=$?
  kill "$killer" 2>/dev/null; wait "$killer" 2>/dev/null
  [ -s "$flag" ] && rc=124
  rm -f "$flag"; return $rc
}
pass_start=$(date +%s)
time_left() { echo $(( PASS_LIMIT - ($(date +%s) - pass_start) )); }
# bounded CMD...: CMD within what is left of this pass; 99 (not run) with under 5 s left. It and what it runs keep the lock (fd 9) until they exit.
bounded() { local l; l=$(time_left); [ "$l" -ge 5 ] || return 99; limited "$l" "$@"; }
STOPPED=0
transfer_ok() { # false (98) once the ledger plus the reserve plus this transfer's maximum has reached the stop: no further transfer, and the pass ends in teardown
  [ "$STOPPED" = 1 ] && return 98
  if over_stop "$TMAX"; then STOPPED=1; log "the ledger (\$$(cost)) plus the reserve (\$$(reserve)) and a transfer (\$$TMAX) has reached the stop; no more transfers this pass"; return 98; fi
  return 0
}

read -r now h <<< "$(python3 -c "
import glob,os,time; p='$O/charged'; now=time.time()
if os.path.exists(p): last=float(open(p).read())
else:
    ls=[float(open(f).read()) for f in glob.glob('$O/launched-*')]
    last=min(ls) if ls else now-600
print(now, max(0.0, (now-last)/3600))")"

# --- 1. the ledger: compute for every instance that ran in the interval (running, pending, stopping, unknown, and the pass in which it
# went from one of those to stopped or terminated), the volumes until termination, and anything under the key pair no file records ---
declare -a st addr dl
untracked=""
for n in 1 2 3; do
  INST=$(cat "$O/instance-$n" 2>/dev/null)
  [ -n "$INST" ] || { st[$n]=none; continue; }
  d=$(cat "$O/deadline-$n" 2>/dev/null)   # its deadline epoch; failing that launch + 13 h, failing that 13 h from now
  [ -n "$d" ] || { l=$(cat "$O/launched-$n" 2>/dev/null); [ -n "$l" ] && d=$(( ${l%.*} + DEADLINE_H * 3600 )); }
  dl[$n]=${d:-$(( ${now%.*} + DEADLINE_H * 3600 ))}
  read -r state ip <<< "$(aws ec2 describe-instances --instance-ids "$INST" --query 'Reservations[0].Instances[0].[State.Name,PublicIpAddress]' --output text 2>/dev/null)"
  st[$n]=$state; addr[$n]=$ip
  prev=$(cat "$O/state-$n" 2>/dev/null); bill=0
  case "$state" in
    running|pending|stopping|"") bill=1 ;;   # an unknown state (a failed API call) is charged as running, so a missed pass never undercounts
    *) case "$prev" in ""|running|pending|stopping|unknown) bill=1 ;; esac ;;
  esac
  [ $bill = 1 ] && add_cost "$(calc "$RATE*$h")"
  [ "$state" != terminated ] && add_cost "$(calc "$EBS*0.08/730*$h")"
  echo "${state:-unknown}" > "$O/state-$n"
done
tracked=" $(cat "$O"/instance-1 "$O"/instance-2 "$O"/instance-3 2>/dev/null | tr '\n' ' ') "
if all=$(aws ec2 describe-instances --filters Name=key-name,Values=$KN Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].[InstanceId,State.Name]' --output text 2>/dev/null); then
  while read -r id state; do
    [ -n "$id" ] || continue
    case "$tracked" in *" $id "*) continue ;; esac
    case "$state" in running|pending|stopping) add_cost "$(calc "$RATE*$h")" ;; esac
    add_cost "$(calc "$EBS*0.08/730*$h")"
    untracked="$untracked $id"
  done <<< "$all"
else log "cannot list the instances under $KN (untracked ones would not be charged this pass)"; fi
[ -n "$untracked" ] && log "UNTRACKED instances under $KN:$untracked (charged; teardown terminates them)"
echo "$now" > "$O/charged"
# reserve [EXTRA]: the most the instances can still cost: each live one (any state but terminated) to its deadline at the compute and volume
# rates, each untracked one for a full DEADLINE_H, plus EXTRA
reserve() {
  local extra=${1:-0} n t r secs=0
  t=$(date +%s)
  for n in 1 2 3; do
    case "${st[$n]}" in none|terminated|shutting-down) continue ;; esac
    r=$(( ${dl[$n]} - t )); [ $r -gt 0 ] || r=0; secs=$((secs + r))
  done
  set -- $untracked; secs=$((secs + $# * DEADLINE_H * 3600))
  calc "$secs/3600*($RATE + $EBS*0.08/730) + $extra"
}
over_stop() { [ "$(calc "($(cost) + $(reserve "${1:-0}") >= $CAP - 2)")" = 1.000000 ]; }   # the ledger plus the reserve (plus EXTRA) has reached the stop
states() { local n; for n in 1 2 3; do printf ' i%s=%s' "$n" "${st[$n]:-unknown}"; done; }
note() { log "$*"; echo "$* $(date '+%F %T')" >> "$O/notes"; }   # COLLISION, LOST and STUCK stay in STATUS for the rest of the draw
debits() { local f c=0; for f in "$O"/debit-*; do [ -f "$f" ] && case "$f" in *.tmp) ;; *) c=$((c + 1)) ;; esac; done; echo $c; }   # debit files left by interrupted transfers: each stays charged in full
status() { { echo "cost=\$$(cost)/$CAP reserve=\$$(reserve)$1${untracked:+ untracked:$untracked}$([ "$(debits)" != 0 ] && echo " interrupted-debits:$(debits)") $(date '+%F %T')"; cat "$O/notes" 2>/dev/null; } > "$O/STATUS"; }
stop_reason() { echo "budget spent: ledger \$$(cost) + reserve \$$(reserve) reached \$$((CAP - 2)) of the \$$CAP stop"; }

# list the security groups that are still there (by name, and the recorded id); non-zero if a lookup failed
sg_left() {
  local a b=""
  a=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$KN Name=vpc-id,Values=$VPC --query 'SecurityGroups[].GroupId' --output text 2>/dev/null) || return 1
  [ -n "$SG" ] && { b=$(aws ec2 describe-security-groups --filters Name=group-id,Values="$SG" --query 'SecurityGroups[].GroupId' --output text 2>/dev/null) || return 1; }
  echo "$a $b" | tr -s '[:space:]' '\n' | grep -v -e '^$' -e '^None$' | sort -u | tr '\n' ' '
  return 0
}
kp_left() { aws ec2 describe-key-pairs --filters Name=key-name,Values=$KN --query 'KeyPairs[].KeyName' --output text 2>/dev/null | grep -v '^None$'; [ "${PIPESTATUS[0]}" = 0 ]; }
teardown() {
  log "tearing down ($1)"; echo "$1" > "$O/teardown-reason"
  # Live instances: every tracked id plus every instance launched with this key pair, each checked on its own (a purged id
  # only drops out; it never fails the others). Each is terminated individually.
  cand=$( { cat $O/instance-1 $O/instance-2 $O/instance-3 2>/dev/null; aws ec2 describe-instances --filters Name=key-name,Values=$KN --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null | tr '\t' '\n'; } | grep -E '^i-[0-9a-f]+$' | sort -u)
  ok=1; live=""
  for id in $cand; do
    cur=$(aws ec2 describe-instances --instance-ids $id --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null)
    case "$cur" in
      pending|running|stopping|stopped|shutting-down) live="$live $id"; aws ec2 terminate-instances --instance-ids $id >/dev/null || ok=0 ;;
    esac
  done
  [ -n "$live" ] && { aws ec2 wait instance-terminated --instance-ids $live || ok=0; }
  # Confirmation: a successful listing with nothing under this key pair still alive. Anything else retries next pass.
  alive=$(aws ec2 describe-instances --filters Name=key-name,Values=$KN Name=instance-state-name,Values=pending,running,stopping,stopped,shutting-down --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null) || ok=0
  [ -n "$alive" ] && ok=0
  if [ $ok = 0 ]; then
    log "termination not confirmed (live:${live:- none}; left: ${alive:-?}); the supervisor stays loaded and retries next pass"
    echo "TEARDOWN PENDING $(date '+%F %T'): $1; cost \$$(cost)" >> "$O/STATUS"; exit 1
  fi
  log "terminated:${live:- none live}"
  # The key pair and security group go next, and `done` is written only once both are confirmed gone.
  aws ec2 delete-key-pair --key-name $KN >/dev/null 2>&1 && log "deleted key pair $KN"
  # (a security group can refuse deletion for a moment while the terminated instances' interfaces detach: a few tries)
  for try in 1 2 3; do
    gs=$(sg_left) || break
    [ -n "${gs// /}" ] || break
    [ $try -gt 1 ] && sleep "$RETRY_PAUSE"
    for g in $gs; do aws ec2 delete-security-group --group-id "$g" >/dev/null 2>&1 && log "deleted security group $g"; done
  done
  kpl=$(kp_left); kprc=$?; sgl=$(sg_left); sgrc=$?
  if [ $kprc != 0 ] || [ $sgrc != 0 ] || [ -n "$kpl" ] || [ -n "${sgl// /}" ]; then
    why="key pair: ${kpl:-gone}$([ $kprc != 0 ] && echo ' (lookup failed)'); security group: ${sgl:-gone}$([ $sgrc != 0 ] && echo ' (lookup failed)')"
    log "cleanup not confirmed ($why); the supervisor stays loaded and retries next pass"
    echo "CLEANUP PENDING $(date '+%F %T'): $1; $why; cost \$$(cost)" >> "$O/STATUS"; exit 1
  fi
  touch "$O/done"; echo "DONE $(date '+%F %T'): $1; cost \$$(cost)" >> "$O/STATUS"
  launchctl bootout "gui/$(id -u)/com.browser-life.scaf-hunt1" 2>/dev/null; rm -f "$PLIST"; exit 0
}

# --- 2. a teardown already under way, or the hard stop: before any transfer ---
if [ -f "$O/teardown-reason" ]; then status "$(states)"; teardown "$(cat "$O/teardown-reason")"; fi
if over_stop; then touch "$O/budget-stopped"; status "$(states)"; teardown "$(stop_reason)"; fi

# --- 3. transfers, each bounded and charged ---
# xssh CMD FILE: CMD on the instance (ip) into FILE, bounded in time and cut at CAPB bytes (what a transfer's debit pays for); status in RRC (255 unreachable, 99 no time left)
xssh() {
  { bounded $SSH ubuntu@"$ip" "$1" 2>/dev/null; echo $? > "$2.rc"; } | head -c "$CAPB" > "$2"
  RRC=$(cat "$2.rc" 2>/dev/null || echo 255); rm -f "$2.rc"
}
# rcmd KIND CMD: CMD on the instance: output in ROUT, status in RRC (98 the budget stops it); a transfer: debited first, then charged its output bytes
rcmd() {
  transfer_ok && debit_open "$1" || { ROUT=""; RRC=98; return; }
  xssh "$2" "$O/rcmd.out.$k"; ROUT=$(cat "$O/rcmd.out.$k")
  debit_close "$(calc "$(wc -c < "$O/rcmd.out.$k" | tr -d ' ')/1e9*$EGRESS")"; rm -f "$O/rcmd.out.$k"
}
# rfile KIND CMD FILE: the same into FILE; its size is charged whether or not the command finished
rfile() {
  transfer_ok && debit_open "$1" || { : > "$3"; RRC=98; return; }
  xssh "$2" "$3"
  debit_close "$(calc "$(wc -c < "$3" | tr -d ' ')/1e9*$EGRESS")"
}
# rpull KIND SRC DST [RSYNC OPTION...]: one bounded, bandwidth-limited rsync pull, debited first. Egress: the bytes it reports received when it finished; when it
# failed, was killed or reported none, the larger of that and the most the limit allows for the seconds it ran (rounded up), which is what it may have sent
rpull() {
  local kind=$1 src=$2 dst=$3 out b t0 el cap; shift 3
  transfer_ok && debit_open "$kind" || return 98
  mkdir -p "$dst"
  t0=$(date +%s)
  out=$(bounded rsync -az --partial --timeout=60 --bwlimit="$BWLIMIT" --stats "$@" -e "$SSH" ubuntu@"$ip":"$src" "$dst" 2>&1); RRC=$?
  [ $RRC = 99 ] && { log "no time left in this pass for $src"; debit_close 0; return 99; }
  el=$(( $(date +%s) - t0 + 1 ))
  b=$(echo "$out" | awk '/^sent .* bytes +received .* bytes/ {for (i = 1; i < NF; i++) if ($i == "received") {v = $(i + 1); gsub(/,/, "", v); print v + 0}}' | tail -1)   # rsync 3 and openrsync both end with "sent N bytes  received M bytes"
  if [ $RRC = 0 ] && [ -n "$b" ]; then debit_close "$(calc "$b/1e9*$EGRESS")"
  else cap=$(calc "$BWLIMIT*1024*$el"); debit_close "$(calc "(${b:-0} > $cap ? ${b:-0} : $cap)/1e9*$EGRESS")"; fi
  [ $RRC = 0 ] || log "rsync of $src failed (rc $RRC, ${el} s): $(echo "$out" | tail -2 | tr '\n' ' ')"
  return $RRC
}
# status_check STATUS CMDS N: "complete" if STATUS is valid JSON of instance N with every command of CMDS done or fail, "partial" if valid but not, nothing if invalid
status_check() {
  python3 -c 'import json,sys
s = json.load(open(sys.argv[1]))
assert s["instance"] == int(sys.argv[3])
c = s["commands"]
ids = [l.split("|", 1)[0] for l in open(sys.argv[2]) if l.strip()]
print("complete" if all(c.get(i) in ("done", "fail") for i in ids) else "partial")' "$@" 2>/dev/null
}
# pull_instance N IP: everything of instance N; it is final only if every pull and every validation succeeded in this pass
pull_instance() {
  local n=$1 ok=1 fin=0 counts d sc tmp
  ip=$2; echo "$ip" > "$O/ip-$n"
  rcmd fin 'if test -e bl/ops/finished; then echo yes; else echo no; fi'
  if [ $RRC != 0 ]; then log "instance $n: ssh failed (rc $RRC); retrying next pass"; line="$line i$n=running:unreachable"; return; fi
  [ "$ROUT" = yes ] && fin=1
  rcmd counts 'cd bl/ops && echo "$(ls done | wc -l)d/$(ls fail | wc -l)f/$(grep -c "|" cmds.txt)"'; counts=${ROUT// /}
  rpull main bl/runs/scaffold/hunt1/ "$WS/runs/scaffold/hunt1/" --exclude '/device/' --exclude '/anc-copy*/' || ok=0
  # The device bundle and the anc-copy worlds (anc-copy, and anc-copy-c100 after an overflow) go to per-instance directories: they share relative
  # paths across instances, and anc-copy must never sit under a `hunt1 --runs` root beside the canonical anc (Amendment 3). Under
  # device-inst<N>/device/ the bundle's path still ends in its runId (device/ponds/pond-nat/seed-4905001), which the report checks.
  rcmd dirs 'cd bl/runs/scaffold/hunt1 2>/dev/null && for d in device anc-copy anc-copy-c100; do if [ -d $d ]; then echo $d; fi; done; true'
  if [ $RRC != 0 ]; then ok=0; log "instance $n: cannot list its bundle directories (rc $RRC)"; fi
  for d in $ROUT; do
    case "$d" in
      device) rpull device bl/runs/scaffold/hunt1/device/ "$WS/runs/scaffold/hunt1/device-inst$n/device/" ;;
      anc-copy|anc-copy-c100) rpull "$d" "bl/runs/scaffold/hunt1/$d/" "$WS/runs/scaffold/hunt1-anc-copy/inst$n/$d/" ;;
      *) true ;;
    esac || ok=0
  done
  # The ops-log archive, written aside, validated and then moved.
  tmp="$O/remote-ops-$n.tgz.tmp.$k"
  rfile tar 'tar czf - -C bl ops/logs ops/lanes.log ops/done ops/fail 2>/dev/null' "$tmp"
  if [ $RRC = 0 ] && tar tzf "$tmp" > /dev/null 2>&1; then mv -f "$tmp" "$O/remote-ops-$n.tgz"; else ok=0; rm -f "$tmp"; log "instance $n: ops-log archive not usable (rc $RRC)"; fi
  # The status export: valid JSON for this instance; final only if every command of its cmds file is done or fail.
  tmp="$O/status-$n.json.tmp.$k"
  rfile status 'cd bl/ops && python3 -c "
import json,os
c={i:\"done\" for i in os.listdir(\"done\")}
c.update({i:\"fail\" for i in os.listdir(\"fail\")})
print(json.dumps({\"instance\": int(open(\"instance\").read()), \"commands\": c}))"' "$tmp"
  sc=$(status_check "$tmp" "$O/cmds-$n.txt" "$n")
  if [ $RRC = 0 ] && [ -n "$sc" ]; then mv -f "$tmp" "$O/status-$n.json"
  else ok=0; rm -f "$tmp"; log "instance $n: status export not usable (rc $RRC)"; fi
  if [ $fin = 1 ] && [ $ok = 1 ] && [ "$sc" != complete ]; then ok=0; log "instance $n: finished, but its status lists commands that are neither done nor failed"; fi
  if [ $fin = 1 ] && [ $ok = 1 ]; then
    rfile files 'set -o pipefail; cd bl/runs/scaffold/hunt1 && find . -type f ! -path "./device/*" ! -path "./anc-copy*/*" | sort' "$O/files-$n.txt.tmp.$k"
    if [ $RRC = 0 ]; then
      mv -f "$O/files-$n.txt.tmp.$k" "$O/files-$n.txt"
      dup=$(cat $O/files-*.txt 2>/dev/null | sort | uniq -d | head -5)
      [ -n "$dup" ] && { note "COLLISION: instance $n: paths also written by another instance (outputs mixed?): $dup"; touch "$O/collision"; }
      touch "$O/final-$n"
    else ok=0; rm -f "$O/files-$n.txt.tmp.$k"; log "instance $n: file list not usable (rc $RRC)"; fi
  fi
  line="$line i$n=running:${counts:-?}:fin=$fin:sync=$ok"
}

myip=$(curl -s --max-time 10 https://checkip.amazonaws.com)
k=$(( $(cat "$O/pass-count" 2>/dev/null || echo 0) + 1 )); echo $k > "$O/pass-count"
# earlier passes' temporary outputs go (their writers held the lock: none is left)
rm -f "$O"/remote-ops-*.tgz.tmp.* "$O"/status-*.json.tmp.* "$O"/files-*.txt.tmp.* "$O"/rcmd.out.* "$O"/limited.*
case $((k % 3)) in 0) order="1 2 3" ;; 1) order="2 3 1" ;; *) order="3 1 2" ;; esac   # the instance a slow transfer starves rotates
line=""
for n in $order; do
  [ "$STOPPED" = 1 ] && break
  state=${st[$n]}
  case "$state" in
    none) line="$line i$n=none" ;;
    running)
      ip=${addr[$n]}
      if [ -z "$ip" ] || [ "$ip" = None ]; then line="$line i$n=running:no-ip"; continue; fi
      [ -n "$myip" ] && aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr "$myip/32" >/dev/null 2>&1 && log "opened SSH for $myip"
      pull_instance "$n" "$ip" ;;
    stopped)
      # Instances terminate on shutdown, so this should not happen. A stopped one is never restarted (that would renew its compute past the
      # deadline): it is marked final and incomplete, and teardown terminates it.
      if [ ! -f "$O/final-$n" ]; then note "STUCK i$n: stopped before its final pull; not restarting it (cost \$$(cost))"; touch "$O/final-$n" "$O/incomplete-$n"; fi
      line="$line i$n=$state" ;;
    "") log "instance $n: no state (API call failed?); retrying next pass"; line="$line i$n=unknown" ;;
    terminated|shutting-down)
      # Terminated out of band (host failure, manual action) before its final pull: nothing more can be pulled.
      if [ ! -f "$O/final-$n" ]; then note "LOST i$n: $state before its final pull; marked final and incomplete"; touch "$O/final-$n" "$O/incomplete-$n"; fi
      line="$line i$n=$state" ;;
    *) line="$line i$n=$state" ;;
  esac
done
status "$line"

# --- 4. the end: all three final, or the hard stop (the pass's own egress counts) ---
if [ -f "$O/final-1" ] && [ -f "$O/final-2" ] && [ -f "$O/final-3" ]; then teardown "all three queues ended; final pulls done"
elif [ "$STOPPED" = 1 ] || over_stop; then touch "$O/budget-stopped"; teardown "$(stop_reason)"; fi
