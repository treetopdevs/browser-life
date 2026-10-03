#!/bin/bash
# watchdog.sh (instance cron, every 10 min). Releases a claim whose lane has died (its pid file names no live process) and
# restarts the lanes if commands are pending but no lane runs, so a crashed lane cannot stall the queue. Marks ops/finished
# once every command is done or failed and no lane runs; powers off 60 min after that (the Mac supervisor normally terminates
# first) or at 20 h uptime.
cd ~/bl || exit 1
for c in ops/claims/*; do
  [ -d "$c" ] || continue; id=$(basename "$c")
  { [ -e ops/done/$id ] || [ -e ops/fail/$id ]; } && continue
  pid=$(cat "$c/lane" 2>/dev/null)
  if [ -z "$pid" ]; then
    # A lane writes its pid right after claiming; only a claim older than two minutes without one is stale.
    [ $(( $(date +%s) - $(stat -c %Y "$c") )) -ge 120 ] || continue
  elif kill -0 "$pid" 2>/dev/null; then continue; fi
  rm -rf "$c"; echo "$(date -u +%FT%T) watchdog released $id" >> ops/lanes.log
done
total=$(grep -c '|' ops/cmds.txt); ended=$(( $(ls ops/done | wc -l) + $(ls ops/fail | wc -l) ))
if [ "$ended" -lt "$total" ] && ! pgrep -f "[o]ps/lane.sh" > /dev/null; then echo "$(date -u +%FT%T) watchdog: no lane running; restarting" >> ops/lanes.log; bash ops/start.sh; fi
if [ "$ended" -ge "$total" ] && ! pgrep -f "[o]ps/lane.sh" > /dev/null; then
  [ -e ops/finished ] || date -u +%s > ops/finished
  [ $(( $(date -u +%s) - $(cat ops/finished) )) -ge 3600 ] && sudo poweroff
fi
[ "$(awk '{print int($1)}' /proc/uptime)" -ge 72000 ] && sudo poweroff
