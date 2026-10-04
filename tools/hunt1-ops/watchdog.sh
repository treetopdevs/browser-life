#!/bin/bash
# watchdog.sh (instance cron, every 10 min). Releases dead claims by running `start.sh sweep`, which takes start.sh's lock (so a sweep
# never overlaps another recovery or a start) and releases a claim only when its lane AND its command's process group are gone (see
# start.sh), and restarts the lanes if commands are pending but no lane runs, so a crashed lane cannot stall the queue. Marks
# ops/finished once every command is done or failed and no lane runs. It never powers the instance off: the instances are launched
# with shutdown behaviour `terminate`, so a power-off would destroy results the Mac has not pulled. A finished instance idles until
# the supervisor's final pull and teardown or the absolute deadline that cloud-init armed at first boot (launch.sh's user-data:
# /etc/bl-deadline = launch + 13 h, a root cron every minute and at reboot that runs `shutdown -h now` past it), which alone bounds
# the compute at 13 h x 3 x $1.006 = $39.23 (about $39.9 with the volumes, which die with the instance) whatever happens to the Mac,
# to bootstrap or to reboots; the supervisor reserves that remaining cost before it spends on egress.
cd ~/bl || exit 1
bash ops/start.sh sweep
total=$(grep -c '|' ops/cmds.txt); ended=$(( $(ls ops/done | wc -l) + $(ls ops/fail | wc -l) ))
if [ "$ended" -lt "$total" ] && ! pgrep -f "[o]ps/lane.sh" > /dev/null; then echo "$(date -u +%FT%T) watchdog: no lane running; restarting" >> ops/lanes.log; bash ops/start.sh; fi
if [ "$ended" -ge "$total" ] && ! pgrep -f "[o]ps/lane.sh" > /dev/null; then
  [ -e ops/finished ] || date -u +%s > ops/finished
fi
