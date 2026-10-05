#!/bin/bash
# finish.sh: the transition hunt's Stage 1 Mac steps after the AWS queue (hunt "Validity" step 7; Amendment 3 item 7).
# Runs only once supervise.sh has written `done`. Under the budget stop nothing is analysed (the report runs with
# --budget-stopped only). Otherwise: the two reproducibility reruns the draw selects (the commands in the queue manifest's
# `mac` section; one that stops on an event-buffer overflow at census 1,000 is repeated at census 100 under `repro-c100`, the same spec
# otherwise, and exactly one complete rerun is kept per history), then `scaffold-report.ts hunt1` into
# experiments/scaffold/readouts/hunt1.json with both repro directories. A collision marker stops here.
# Written for macOS /bin/bash 3.2; every exit reports, and a failed step exits 1.
# The ops state directory is runs/scaffold/ops-hunt1 under the workspace root. This script is tracked in tools/hunt1-ops/aws/ and
# tools/hunt1-queue.ts --ops copies it into the state directory; both places are three levels below the workspace root, which is
# how it finds it. Account and machine specifics (VPC, AMI, the colocated git repo, the workspace path of the launchd plist) are
# not in the script: they come from the gitignored aws.conf in the state directory, as do the credentials (awsenv.sh) and the keys.
set -uo pipefail
WS=$(cd "$(dirname "$0")/../../.." && pwd); O=$WS/runs/scaffold/ops-hunt1
cd "$WS" || exit 1   # the scaffold workspace root
H=runs/scaffold/hunt1; OUT=experiments/scaffold/readouts/hunt1.json
log() { echo "$(date '+%F %T') $*" | tee -a "$O/finish.log"; }
die() { log "NOT finished: $*"; exit 1; }
[ -f "$O/done" ] || die "supervise.sh has not finished (no $O/done)"
[ -f "$O/collision" ] && die "collision marker present: outputs from two instances share paths"
for n in 1 2 3; do [ -f "$O/incomplete-$n" ] && log "instance $n ended incomplete (the report's queue check decides)"; done
if pgrep -f "[d]eno run" >/dev/null; then log "other deno jobs on this Mac (step rates are shared):"; pgrep -fl "[d]eno run" | tee -a "$O/finish.log"; fi
report() { # report ARGS...: hunt1 into $OUT via a temp file; the readout must parse with an outcome
  deno run -A tools/scaffold-report.ts hunt1 "$@" > "$OUT.tmp" 2> "$O/report.err" \
    && python3 -c "import json,sys; sys.exit(0 if 'outcome' in json.load(open('$OUT.tmp')) else 1)" && mv "$OUT.tmp" "$OUT"
}
if [ -f "$O/budget-stopped" ]; then
  log "budget stop: no reruns, no analysis"
  report --budget-stopped --pond-death 32768 --device $H/device $H/device-inst1 $H/device-inst2 $H/device-inst3 || die "the report failed (see $O/report.err)"
  log "report written (budget-stopped)"; exit 0
fi
complete() { [ -f "$1/manifest.json" ] && python3 -c "import json,sys; sys.exit(0 if json.load(open('$1/manifest.json')).get('summary') is not None else 1)" 2>/dev/null; }
# The reruns, verbatim from the committed manifest (Amendment 3 item 7), and the same spec at census 100 under repro-c100 for an
# event-buffer overflow (the hunt's Validity 3, as history.sh does for the histories). A complete rerun is kept (and then no other
# is); an incomplete one is removed first. After an overflow the census-1,000 run is not repeated.
python3 - <<'PY' > "$O/reruns.txt" || die "cannot read the queue manifest's reruns"
import json
q = json.load(open("experiments/scaffold/hunt1-queue.json"))
for r in q["mac"]["reproducibility"]["reruns"]:
    cmd = r["cmd"]
    a = cmd.split()
    cond = a[a.index("--conditions") + 1]
    c100 = cmd.replace("--experiment repro ", "--experiment repro-c100 ", 1).replace("--census 1000 ", "--census 100 ", 1)
    assert "--experiment repro-c100 " in c100 and "--census 100 " in c100, cmd
    print(f"{cond}\t{r['seed']}\t{cmd}\t{c100}")
PY
while IFS=$'\t' read -r cond seed cmd cmd100; do
  d1=$H/repro/ponds/$cond/seed-$seed; d2=$H/repro-c100/ponds/$cond/seed-$seed; tag=$cond-$seed
  if complete "$d1"; then
    log "rerun $d1 complete; kept"
    [ -e "$d2" ] && { rm -rf "$d2" || die "cannot remove $d2"; log "removed $d2: one rerun is kept per history"; }
    continue
  fi
  if complete "$d2"; then log "rerun $d2 (census 100) complete; kept"; continue; fi
  if [ ! -f "$O/repro-$tag.overflow" ]; then
    rm -rf "$d1" || die "cannot remove $d1"
    log "rerun: $cmd"
    bash -c "$cmd" > "$O/repro-$tag.log" 2>&1 < /dev/null; rc=$?
    if [ $rc = 0 ]; then complete "$d1" || die "rerun $d1 did not complete"; continue; fi
    grep -q "event buffer overflow" "$O/repro-$tag.log" || die "rerun failed: $cmd (see $O/repro-$tag.log)"
    touch "$O/repro-$tag.overflow"; log "overflow at census 1,000: rerunning at census 100 under repro-c100"
  else log "the census-1,000 rerun of $tag overflowed earlier; rerunning at census 100"; fi
  rm -rf "$d2" || die "cannot remove $d2"
  log "rerun: $cmd100"
  bash -c "$cmd100" > "$O/repro-$tag.c100.log" 2>&1 < /dev/null || die "rerun failed: $cmd100 (see $O/repro-$tag.c100.log)"
  complete "$d2" || die "rerun $d2 did not complete"
done < "$O/reruns.txt"
repro="$H/repro"; [ -n "$(find "$H/repro-c100" -name manifest.json 2>/dev/null | head -1)" ] && repro="$repro $H/repro-c100"
runs=""; for e in hist hist-c100 anc anc-c100; do [ -d $H/$e ] && runs="$runs $H/$e"; done
log "report"
report --assays $H/assays --runs $runs --device $H/device $H/device-inst1 $H/device-inst2 $H/device-inst3 --repro $repro \
  --queue experiments/scaffold/hunt1-queue.json --status "$O/status-1.json" "$O/status-2.json" "$O/status-3.json" --pond-death 32768 \
  || die "the report failed (see $O/report.err)"
log "report written: $OUT ($(python3 -c "import json; print(json.load(open('$OUT'))['outcome'])"))"
