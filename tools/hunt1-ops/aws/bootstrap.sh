#!/bin/bash
# bootstrap.sh N: on instance N (running, with ip-N written), installs Deno 2.9.7 (the Mac's) and the Vulkan loader (vulkan-tools; without it Deno's WebGPU falls back to GL and the device check fails), unpacks the source tarball and
# its ops files, installs the cron entries (@reboot start.sh; watchdog every 10 min) and starts the lanes. The device check is
# each queue's first command, so a GPU or Deno mismatch stops that instance before any history runs.
# Fails closed: nothing is installed until the instance's deadline is proven armed over ssh (launch.sh's user-data, run by cloud-init at first
# boot): /etc/bl-deadline holds the epoch in deadline-N, the root cron file and its check script are there, and a shutdown is scheduled
# (/run/systemd/shutdown/scheduled; waived once the instance is bootstrapped, since a reboot clears it and the cron enforces the deadline
# on its own). If that does not hold within five minutes of the instance answering ssh (or it never does), the
# instance is TERMINATED through the API and the termination confirmed (aws ec2 wait instance-terminated), then the script stops; if the
# termination cannot be confirmed it says so loudly and stops. (What uploaded user-data says does not prove the guest ran it.)
# Safe to repeat: once the instance has ops/bootstrapped, a repeat only reinstalls the cron entries and runs start.sh (which takes a
# lock and starts only the missing lanes); it never unpacks over running lanes, and an unreachable instance stops it.
# The ops state directory is runs/scaffold/ops-hunt1 under the workspace root. This script is tracked in tools/hunt1-ops/aws/ and
# tools/hunt1-queue.ts --ops copies it into the state directory; both places are three levels below the workspace root, which is
# how it finds it. Account and machine specifics (VPC, AMI, the colocated git repo, the workspace path of the launchd plist) are
# not in the script: they come from the gitignored aws.conf in the state directory, as do the credentials (awsenv.sh) and the keys.
set -euo pipefail
WS=$(cd "$(dirname "$0")/../../.." && pwd); O=$WS/runs/scaffold/ops-hunt1; n=${1:?instance}
cd "$O"; source ./awsenv.sh
ip=$(aws ec2 describe-instances --instance-ids "$(cat instance-$n)" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
case "$ip" in None|"") echo "instance $n has no public address (is it running?)" >&2; exit 1 ;; esac
echo "$ip" > ip-$n
CRON='(echo "@reboot bash $HOME/bl/ops/start.sh"; echo "*/10 * * * * bash $HOME/bl/ops/watchdog.sh") | crontab -'
for _ in $(seq 1 30); do ./rsh $n true 2>/dev/null && break; sleep 10; done
D=$(cat deadline-$n 2>/dev/null) || { echo "no deadline-$n: run launch.sh (it records the deadline of each instance) before bootstrapping" >&2; exit 1; }
case "$D" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*) ;; *) echo "deadline-$n does not hold an epoch" >&2; exit 1 ;; esac
armed=0
for _ in $(seq 1 30); do
  ./rsh $n "test \"\$(cat /etc/bl-deadline)\" = $D && test -s /etc/cron.d/bl-deadline && test -x /usr/local/sbin/bl-deadline-check && { test -e /run/systemd/shutdown/scheduled || test -e ~/bl/ops/bootstrapped; }" 2>/dev/null && { armed=1; break; }
  sleep 10
done
if [ $armed = 0 ]; then
  echo "instance $n has no armed deadline (/etc/bl-deadline = $D, /etc/cron.d/bl-deadline, a scheduled shutdown): terminating it" >&2
  if aws ec2 terminate-instances --instance-ids "$(cat instance-$n)" > /dev/null && aws ec2 wait instance-terminated --instance-ids "$(cat instance-$n)"; then
    echo "instance $n terminated (confirmed); re-run launch.sh for its replacement" >&2
  else
    echo "WARNING: the termination of instance $n ($(cat instance-$n)) is NOT confirmed; terminate it by hand now" >&2
  fi
  exit 1
fi
seen=0; ./rsh $n 'test -e ~/bl/ops/bootstrapped' || seen=$?
case $seen in
  0) echo "instance $n is already bootstrapped; reinstalling the cron entries and starting any missing lanes"
     ./rsh $n "$CRON; bash ~/bl/ops/start.sh; tail -2 ~/bl/ops/lanes.log"; exit 0 ;;
  1) ;;
  *) echo "instance $n is unreachable (ssh status $seen); not unpacking over a possibly running instance" >&2; exit 1 ;;
esac
./rsh $n 'mkdir -p ~/bl'
./rcp $n bl-src.tar.gz bl/; ./rcp $n ops-$n.tgz bl/
./rsh $n 'set -e; cd ~/bl && tar xzf bl-src.tar.gz && tar xzf ops-'$n'.tgz && test "$(cat ops/instance)" = '$n'
  curl -fsSL https://deno.land/install.sh | sh -s -- -y v2.9.7 >/dev/null 2>&1; ~/.deno/bin/deno --version | head -1
  sudo apt-get -qq update >/dev/null && sudo DEBIAN_FRONTEND=noninteractive apt-get -qq install -y vulkan-tools >/dev/null 2>&1; vulkaninfo --summary 2>&1 | grep -E "deviceName|driverName" | head -2
  nvidia-smi --query-gpu=name --format=csv,noheader
  '"$CRON"'
  bash ops/start.sh && touch ops/bootstrapped; sleep 5; tail -2 ops/lanes.log'
echo "instance $n bootstrapped ($ip)"
