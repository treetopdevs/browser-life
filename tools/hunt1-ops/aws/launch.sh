#!/bin/bash
# launch.sh: key pair and security group bl-scaf-hunt1, then three g5.xlarge (g6.xlarge fallback), one per instance of the
# registration's queue. Writes instance-N, type-N, launched-N (epoch seconds), `charged` (the cost ledger's start: the earliest
# launch) and sg.conf. Run only after the user has approved the dated draw note.
# The ops state directory is runs/scaffold/ops-hunt1 under the workspace root. This script is tracked in tools/hunt1-ops/aws/ and
# tools/hunt1-queue.ts --ops copies it into the state directory; both places are three levels below the workspace root, which is
# how it finds it. Account and machine specifics (VPC, AMI, the colocated git repo, the workspace path of the launchd plist) are
# not in the script: they come from the gitignored aws.conf in the state directory, as do the credentials (awsenv.sh) and the keys.
# One launch.sh runs at a time: launch.lock is an OS-held lock (flock held on fd 9 by this process, taken by a python wrapper that re-execs
# the script; the kernel releases it when the process dies, however it dies, and no lock file is ever deleted or "recovered"), for its
# whole run; a second launch.sh exits at once. Safe to run again after a partial launch: it never
# overwrites an existing bl_key; an existing AWS key pair is reused only if its fingerprint is the local key's (else it stops); the
# security group is the one in sg.conf or found by name. Before a slot's run-instances request is submitted, the whole request (deadline
# epoch, client token, type, subnet, user-data and its hash) is persisted to pending-N and pending-N.ud, and any later invocation
# replays it unchanged (same token, same parameters: AWS returns the instance if the first submission created it) until the slot is
# resolved: the instance recorded with its arming verified, or a definitive refusal. Before any new submission the slot is reconciled
# by tag (Name=bl-scaf-hunt1-N) AND by the pending request's client token (describe-instances filters on both; either may lag behind
# a creation), an instance found is adopted, never launched twice, and the final sweep terminates any instance under the key pair or
# carrying a pending client token that no instance-N file records.
# The absolute bound: every instance is launched with shutdown behaviour `terminate` (its volume is DeleteOnTermination) and with
# cloud-init user-data that, at first boot and before any bootstrap, writes launch + 13 h to /etc/bl-deadline, installs a root cron
# (every minute and @reboot) that runs `shutdown -h now` once the clock passes it, and schedules `shutdown -h` for the remaining
# minutes. 13 h x 3 x $1.006 = $39.23, about $39.9 with the volumes, and the supervisor reserves that remaining cost (and one more
# transfer) before it lets egress spend, so the total stays under its $46 teardown and the draw's $48 stop whatever becomes of the
# Mac, of bootstrap or of reboots. The launch fails closed: the user-data is part of every run-instances request (never retried
# without it), a refusal stops the launch, and each new or adopted instance is checked to carry it (describe-instance-attribute),
# else it is terminated (termination confirmed) and the launch stops. A finished instance idles until the supervisor's final pull
# and teardown or this deadline.
# Residual window: user-data is only what was uploaded; that the guest armed it is proven by bootstrap.sh over ssh (it reads
# /etc/bl-deadline, the cron file and the scheduled shutdown, and terminates the instance, confirming it, if they are not there within
# five minutes). Between launch and that check an instance has no proven deadline; the Mac is present throughout by construction,
# since launch.sh is run by hand after the user's approval and bootstrap.sh follows it at once.
SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
WS=$(cd "$(dirname "$0")/../../.." && pwd); O=$WS/runs/scaffold/ops-hunt1
cd "$O" || exit 1
[ -f "$O/aws.conf" ] || { echo "launch.sh: $O/aws.conf is missing; create it from the account's values: VPC=<vpc id>, AMI=<ami id>, REPO=<the colocated git repo make-src.sh archives>, WORKSPACE=<this workspace's absolute path, for the launchd plist>" >&2; exit 1; }
source "$O/aws.conf"
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
os.execv("/bin/bash", ["/bin/bash"] + sys.argv[5:])' "$PWD/launch.lock" 0 1 "launch.sh: another launch.sh holds launch.lock" "$SELF" "$@"
fi
unset BL_LOCKED
aws() { command aws "$@" 9>&-; }   # (an aws child must not inherit the lock)
source ./awsenv.sh
KN=bl-scaf-hunt1   # (VPC and AMI come from aws.conf)
LIVE=pending,running,stopping,stopped
DEADLINE_H=13
PAUSE=${LAUNCH_PAUSE:-5}
die() { echo "launch.sh: $*" >&2; exit 1; }

# --- the key: an existing local key is never touched ---
have_key=0
if [ -e bl_key ]; then
  [ -s bl_key ] || die "bl_key exists but is empty; move it aside"
  [ -s bl_key.pub ] || ssh-keygen -y -P "" -f bl_key > bl_key.pub || die "cannot derive bl_key.pub from bl_key"
  have_key=1
elif [ -e bl_key.pub ]; then die "bl_key.pub exists without bl_key; move it aside"
fi
awsfp=$(aws ec2 describe-key-pairs --filters Name=key-name,Values=$KN --query 'KeyPairs[0].KeyFingerprint' --output text) || die "describe-key-pairs failed"
[ "$awsfp" = None ] && awsfp=""
fp() { sed -e 's/^SHA256://' -e 's/=*$//'; }
if [ -n "$awsfp" ]; then
  [ $have_key = 1 ] || die "the AWS key pair $KN exists but there is no local bl_key; delete the key pair (aws ec2 delete-key-pair --key-name $KN) only if no instance uses it"
  localfp=$(ssh-keygen -l -E sha256 -f bl_key.pub | awk '{print $2}')
  [ "$(echo "$awsfp" | fp)" = "$(echo "$localfp" | fp)" ] || die "the AWS key pair $KN has fingerprint $awsfp, but the local bl_key is $localfp; not reusing it and not overwriting either (delete the key pair only if no instance uses it)"
  echo "key pair $KN exists with the local key's fingerprint; reusing it"
else
  [ $have_key = 1 ] || ssh-keygen -q -t ed25519 -N "" -C $KN -f bl_key || die "ssh-keygen failed"
  aws ec2 import-key-pair --key-name $KN --public-key-material fileb://bl_key.pub --tag-specifications "ResourceType=key-pair,Tags=[{Key=Name,Value=$KN}]" --query KeyPairId --output text || die "import-key-pair failed"
fi
chmod 600 bl_key

# --- the security group: sg.conf's, else by name, else created ---
SG=""; [ -f sg.conf ] && SG=$(sed -n 's/^SG=//p' sg.conf | head -1)
if [ -n "$SG" ]; then
  SG=$(aws ec2 describe-security-groups --filters Name=group-id,Values="$SG" --query 'SecurityGroups[0].GroupId' --output text) || die "describe-security-groups failed"
  [ "$SG" = None ] && SG=""
fi
if [ -z "$SG" ]; then
  SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$KN Name=vpc-id,Values=$VPC --query 'SecurityGroups[0].GroupId' --output text) || die "describe-security-groups failed"
  [ "$SG" = None ] && SG=""
fi
if [ -z "$SG" ]; then
  SG=$(aws ec2 create-security-group --group-name $KN --description "browser-life transition hunt Stage 1, temporary" --vpc-id $VPC --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$KN}]" --query GroupId --output text) || die "create-security-group failed"
fi
echo "sg $SG"; echo "SG=$SG" > sg.conf
MYIP=$(curl -s --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')
case "$MYIP" in [0-9]*.[0-9]*.[0-9]*.[0-9]*) ;; *) die "cannot learn this Mac's public IP (got '${MYIP:0:40}')" ;; esac
open=$(aws ec2 describe-security-groups --group-ids "$SG" --query "SecurityGroups[0].IpPermissions[?FromPort==\`22\`].IpRanges[].CidrIp" --output text) || die "describe-security-groups failed"
case " $(echo "$open" | tr -s '[:space:]' ' ') " in
  *" $MYIP/32 "*) echo "ssh already open for $MYIP" ;;
  *) aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr "$MYIP/32" --query Return --output text || die "authorize-security-group-ingress failed" ;;
esac
SUBNETS=$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC Name=default-for-az,Values=true --query 'Subnets[].[SubnetId,AvailabilityZone]' --output text) || die "describe-subnets failed"
[ -n "$SUBNETS" ] || die "no default subnets in $VPC"
[ -s launch-nonce ] || od -An -N4 -tx1 /dev/urandom | tr -d ' \n' > launch-nonce   # the client tokens' stem, kept across re-runs

# --- the instances ---
epoch_of() { python3 -c "import datetime,sys; print(int(datetime.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00')).timestamp()))" "$1"; }
lookup() { # lookup FILTER...: "LaunchTime id type" of the live instances matching the filters; fails if the lookup does
  aws ec2 describe-instances --filters "$@" Name=instance-state-name,Values=$LIVE --query 'Reservations[].Instances[].[LaunchTime,InstanceId,InstanceType]' --output text
}
pend_get() { sed -n "s/^$2=//p" "pending-$1" | head -1; }
pend_clear() { rm -f "pending-$1" "pending-$1.ud"; }
pend_write() { # pend_write N TYPE SUBNET DEADLINE: the whole request, persisted before it is submitted
  local tok
  tok="bl-hunt1-$(cat launch-nonce)-$1-$(printf '%s' "$2-$3-$4" | cksum | cut -d' ' -f1)"
  user_data "$4" > "pending-$1.ud"
  printf 'deadline=%s\ntoken=%s\ntype=%s\nsubnet=%s\nudhash=%s\n' "$4" "$tok" "$2" "$3" "$(cksum < "pending-$1.ud" | tr ' ' -)" > "pending-$1.tmp" && mv "pending-$1.tmp" "pending-$1"
}
tagged() { # the earliest live instance of slot N, by its tag and by the client token of its pending request, as "LaunchTime id type"; fails if a lookup does
  local out more
  out=$(lookup Name=tag:Name,Values=$KN-$1) || return 1
  if [ -s "pending-$1" ]; then more=$(lookup Name=client-token,Values="$(pend_get "$1" token)") || return 1; out="$out"$'\n'"$more"; fi
  echo "$out" | grep . | sort | head -1
}
record() { # record N ID TYPE LAUNCH_EPOCH DEADLINE_EPOCH
  echo "$2" > instance-$1; echo "$3" > type-$1; echo "$4" > launched-$1; echo "$5" > deadline-$1
}
user_data() { # user_data DEADLINE_EPOCH: the cloud-init script that arms the draw's absolute deadline at first boot
  sed "s/@DEADLINE@/$1/" <<'EOF'
#!/bin/bash
# bl-deadline: the draw's absolute hard stop, armed at first boot before any bootstrap (written by launch.sh)
echo @DEADLINE@ > /etc/bl-deadline
chmod 644 /etc/bl-deadline
cat > /usr/local/sbin/bl-deadline-check <<'CHECK'
#!/bin/bash
if [ "$(date +%s)" -ge "$(cat /etc/bl-deadline)" ]; then /sbin/shutdown -h now; fi
CHECK
chmod 755 /usr/local/sbin/bl-deadline-check
printf '%s\n' 'PATH=/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin' '* * * * * root /usr/local/sbin/bl-deadline-check' '@reboot root /usr/local/sbin/bl-deadline-check' > /etc/cron.d/bl-deadline
chmod 644 /etc/cron.d/bl-deadline
m=$(( ($(cat /etc/bl-deadline) - $(date +%s) + 59) / 60 ))
if [ "$m" -le 0 ]; then /sbin/shutdown -h now; else /sbin/shutdown -h +"$m"; fi
EOF
}
deadline_of() { # deadline_of ID: the deadline epoch in the user-data the instance carries; fails if it carries none (retried: a new instance may not be visible yet)
  local v txt d k
  for k in 1 2 3; do
    v=$(aws ec2 describe-instance-attribute --instance-id "$1" --attribute userData --query UserData.Value --output text 2>/dev/null) && [ -n "$v" ] && [ "$v" != None ] && break
    v=""; sleep "$PAUSE"
  done
  [ -n "$v" ] || return 1
  txt=$(echo "$v" | python3 -c 'import base64,sys; sys.stdout.write(base64.b64decode(sys.stdin.read()).decode())') || return 1
  d=$(echo "$txt" | sed -n 's/^echo \([0-9]\{10,\}\) > \/etc\/bl-deadline$/\1/p' | head -1)
  [ -n "$d" ] && echo "$txt" | grep -q '/etc/cron.d/bl-deadline' && echo "$txt" | grep -q 'shutdown -h' && echo "$d"
}
unarmed() { # unarmed ID: an instance without the deadline is terminated at once, and the termination confirmed; never kept
  echo "instance $1 does not carry the deadline user-data: terminating it" >&2
  aws ec2 terminate-instances --instance-ids "$1" --query 'TerminatingInstances[0].CurrentState.Name' --output text >&2 && aws ec2 wait instance-terminated --instance-ids "$1" ||
    echo "WARNING: could not confirm the termination of $1; terminate it by hand now" >&2
}
adopt() { # adopt N: the earliest live instance of slot N (by tag or by its pending request's client token), if any; a lookup that fails stops the launch: never launch blind
  local found lt id ty d
  found=$(tagged "$1") || die "cannot look up the instances of slot $1 (tag $KN-$1, client token); not launching blind"
  [ -n "$found" ] || return 1
  read -r lt id ty <<< "$found"
  d=$(deadline_of "$id") || { unarmed "$id"; return 1; }
  record "$1" "$id" "$ty" "$(epoch_of "$lt")" "$d"; pend_clear "$1"
  echo "instance $1: adopted $id ($ty), already launched, deadline $d"
}
FATAL='InvalidUserData|Parameter validation failed|Unknown options|usage: aws'   # the user-data was not accepted: nothing is launched without it
DEFINITIVE='An error occurred \((InsufficientInstanceCapacity|Unsupported|VcpuLimitExceeded|InstanceLimitExceeded|InvalidParameterValue|InvalidParameterCombination|UnauthorizedOperation|OptInRequired|InvalidAMIID|InvalidSubnetID|InvalidKeyPair|InvalidGroup|InvalidBlockDeviceMapping|InsufficientFreeAddressesInSubnet)'
try_launch() { # try_launch N: submits pending-N exactly as recorded: 0 launched (IID set), 1 refused by AWS, 2 outcome unknown, 3 user-data refused. A response without an
  # instance id is not a refusal: the same request (same client token, same user-data) is repeated, which returns the instance if the first one created it.
  local n=$1 tok T SN k OUT
  tok=$(pend_get "$n" token); T=$(pend_get "$n" type); SN=$(pend_get "$n" subnet); IID=""
  [ "$(cksum < "pending-$n.ud" | tr ' ' -)" = "$(pend_get "$n" udhash)" ] || die "pending-$n.ud does not match its recorded hash; look for an instance (tag $KN-$n, client token $tok) before removing pending-$n"
  for k in 1 2 3; do
    OUT=$(aws ec2 run-instances --image-id $AMI --instance-type "$T" --subnet-id "$SN" --associate-public-ip-address --key-name $KN --security-group-ids "$SG" --client-token "$tok" --user-data "file://$PWD/pending-$n.ud" --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=150,VolumeType=gp3,DeleteOnTermination=true}' --instance-initiated-shutdown-behavior terminate --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$KN-$n},{Key=Budget,Value=scaffold}]" "ResourceType=volume,Tags=[{Key=Name,Value=$KN-$n}]" --query 'Instances[0].InstanceId' --output text 2>launch.err.cur)
    cat launch.err.cur >> launch.err
    IID=$(echo "$OUT" | grep -o -E '^i-[0-9a-f]+$' | tail -1)
    [ -n "$IID" ] && return 0
    grep -q -E "$FATAL" launch.err.cur && return 3
    grep -q -E "$DEFINITIVE" launch.err.cur && return 1
    echo "instance $n $T $SN: no instance id and no refusal ($(tail -1 launch.err.cur | cut -c1-100)); repeating the same request ($k of 3)"
    sleep "$PAUSE"
  done
  return 2
}
attempt() { # attempt N: submit (or replay) pending-N and resolve it: 0 recorded, 1 refused (request cleared), 2 outcome unknown (request kept), 3 user-data refused or instance unarmed (stop)
  local n=$1 rc k d
  try_launch "$n"; rc=$?
  echo "instance $n $(pend_get "$n" type) $(pend_get "$n" subnet): ${IID:-no instance} $(tail -1 launch.err 2>/dev/null | cut -c1-100)"
  case $rc in
    0) d=$(deadline_of "$IID") && [ "$d" = "$(pend_get "$n" deadline)" ] || { unarmed "$IID"; pend_clear "$n"; return 3; }
       # A replayed request returns its instance whatever became of it: one that is no longer live (the final sweep terminated it) is not usable.
       case "$(aws ec2 describe-instances --instance-ids "$IID" --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null)" in
         pending|running) ;;
         stopping|stopped) echo "instance $n: the request returned $IID, which is not running; terminating it and starting a new request"; aws ec2 terminate-instances --instance-ids "$IID" > /dev/null; pend_clear "$n"; return 1 ;;
         terminated|shutting-down) echo "instance $n: the request returned $IID, which is already terminated; starting a new request"; pend_clear "$n"; return 1 ;;
         *) return 2 ;;
       esac
       record "$n" "$IID" "$(pend_get "$n" type)" "$((d - DEADLINE_H * 3600))" "$d"; pend_clear "$n"; return 0 ;;
    1) pend_clear "$n"; return 1 ;;
    2) for k in 1 2 3; do sleep "$PAUSE"; adopt "$n" && return 0; done; return 2 ;;
    *) pend_clear "$n"; return 3 ;;
  esac
}
launch_one() { # launch_one N: 0 recorded, 1 no capacity anywhere, 2 outcome unknown or 3 user-data refused or instance unarmed (stop launching)
  local n=$1 T SN AZ dl rc now
  adopt "$n" && return 0
  if [ -s "pending-$n" ]; then
    dl=$(pend_get "$n" deadline); now=$(date +%s)
    if [ "$dl" -le $((now + 600)) ]; then echo "instance $n: its pending request's deadline has passed (nothing of it is live); dropping it"; pend_clear "$n"
    else
      echo "instance $n: replaying its pending request (token $(pend_get "$n" token)), unchanged"
      attempt "$n"; rc=$?
      [ $rc = 1 ] || return $rc
    fi
  fi
  for T in g5.xlarge g6.xlarge; do
    while read -r SN AZ; do
      adopt "$n" && return 0
      echo "instance $n: trying $T in $AZ"
      dl=$(( $(date +%s) + DEADLINE_H * 3600 ))   # counted from before the request, so never later than launch + 13 h
      pend_write "$n" "$T" "$SN" "$dl"
      attempt "$n"; rc=$?
      [ $rc = 1 ] || return $rc
    done <<< "$SUBNETS"
  done
  return 1
}
stopped=0
for n in 1 2 3; do
  if [ -s instance-$n ]; then
    echo "instance $n exists: $(cat instance-$n)"
    pend_clear "$n"
    if [ ! -s launched-$n ]; then
      lt=$(aws ec2 describe-instances --instance-ids "$(cat instance-$n)" --query 'Reservations[0].Instances[0].LaunchTime' --output text) && [ -n "$lt" ] && epoch_of "$lt" > launched-$n
      [ -s launched-$n ] || die "instance $n has no launched-$n and its launch time cannot be read"
    fi
    if [ ! -s deadline-$n ]; then
      deadline_of "$(cat instance-$n)" > deadline-$n || { rm -f deadline-$n; unarmed "$(cat instance-$n)"; die "instance $n carried no deadline and was terminated; remove instance-$n and re-run"; }
    fi
    continue
  fi
  launch_one "$n"; rc=$?
  [ $rc = 2 ] && { echo "instance $n: the outcome of the launch is unknown (its request is kept in pending-$n and is replayed unchanged on the next run); stopping" >&2; stopped=1; break; }
  [ $rc = 3 ] && { echo "instance $n: the deadline user-data was refused or is missing from the instance; not launching without it" >&2; stopped=1; break; }
  [ $rc = 1 ] && echo "instance $n: no capacity in any subnet or type"
done
for n in 1 2 3; do echo "$n: $(cat instance-$n 2>/dev/null) $(cat type-$n 2>/dev/null) launched $(cat launched-$n 2>/dev/null) deadline $(cat deadline-$n 2>/dev/null)"; done
# The cost ledger starts at the earliest launch, so the supervisor's first pass charges from launch.
if [ ! -s charged ]; then
  first=$(cat launched-1 launched-2 launched-3 2>/dev/null | sort -n | head -1)
  [ -n "$first" ] && echo "$first" > charged
fi

# --- the final sweep: a request still pending is looked for once more (by tag and client token); anything under the key pair, or carrying
# a pending client token, that no instance-N file records is a leak: terminate it now ---
leak=0
for n in 1 2 3; do
  [ -s "pending-$n" ] && [ ! -s "instance-$n" ] && { adopt "$n" || true; }
done
live=$(aws ec2 describe-instances --filters Name=key-name,Values=$KN Name=instance-state-name,Values=$LIVE --query 'Reservations[].Instances[].InstanceId' --output text) || { echo "WARNING: cannot list the instances under $KN to look for untracked ones; check by hand" >&2; leak=1; live=""; }
for n in 1 2 3; do
  [ -s "pending-$n" ] || continue
  more=$(lookup Name=client-token,Values="$(pend_get "$n" token)") || { echo "WARNING: cannot look up client token of pending-$n; check by hand" >&2; leak=1; continue; }
  live="$live $(echo "$more" | awk '{print $2}')"
done
tracked=" $(cat instance-1 instance-2 instance-3 2>/dev/null | tr '\n' ' ') "
for id in $live; do
  case "$tracked" in *" $id "*) continue ;; esac
  echo "untracked instance $id (under $KN or with a pending client token): terminating it"
  aws ec2 terminate-instances --instance-ids "$id" --query 'TerminatingInstances[0].CurrentState.Name' --output text || { echo "WARNING: could not terminate $id; terminate it by hand" >&2; leak=1; }
done
missing=0; for n in 1 2 3; do [ -s instance-$n ] || missing=1; done
[ $missing = 1 ] && echo "not all three instances are launched; re-run launch.sh to retry the missing ones" >&2
[ $stopped = 0 ] && [ $leak = 0 ] && [ $missing = 0 ]
