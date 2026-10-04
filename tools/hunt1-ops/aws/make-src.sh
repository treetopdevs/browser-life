#!/bin/bash
# make-src.sh COMMIT: the instances' source tarball from exactly that commit (git archive of the colocated repo), plus each
# instance's ops files (from tools/hunt1-queue.ts --ops) and its shipped inputs: the registration's eight scaf sources of its
# indices, manifest.json and checkpoints/b100-pre.blck only (ship-<n>.txt; the hunt reads nothing else of the registration).
# The ops state directory is runs/scaffold/ops-hunt1 under the workspace root. This script is tracked in tools/hunt1-ops/aws/ and
# tools/hunt1-queue.ts --ops copies it into the state directory; both places are three levels below the workspace root, which is
# how it finds it. Account and machine specifics (VPC, AMI, the colocated git repo, the workspace path of the launchd plist) are
# not in the script: they come from the gitignored aws.conf in the state directory, as do the credentials (awsenv.sh) and the keys.
# (REPO, from aws.conf, is the colocated git repository the source tarball is archived from.)
set -euo pipefail
WS=$(cd "$(dirname "$0")/../../.." && pwd); O=$WS/runs/scaffold/ops-hunt1
[ -f "$O/aws.conf" ] || { echo "make-src.sh: $O/aws.conf is missing; create it from the account's values: VPC=<vpc id>, AMI=<ami id>, REPO=<the colocated git repo make-src.sh archives>, WORKSPACE=<this workspace's absolute path, for the launchd plist>" >&2; exit 1; }
source "$O/aws.conf"
C=${1:?commit}
cd "$O"
# The ops files here must be the committed copies (tools/hunt1-queue.ts --ops writes them): a stale start.sh or watchdog.sh would ship
# the registration's lane without process groups or its blind claim clearing and 20 h power-off, and a stale supervisor or launcher
# would run without the fixes it was reviewed with. The AWS scripts are tracked in tools/hunt1-ops/aws/; the launchd plist is that
# template with @WORKSPACE@ filled in from aws.conf.
for f in lane.sh start.sh watchdog.sh history.sh; do cmp -s "$f" "$WS/tools/hunt1-ops/$f" || { echo "$O/$f is not tools/hunt1-ops/$f; regenerate the ops files (tools/hunt1-queue.ts --ops)" >&2; exit 1; }; done
for f in launch.sh supervise.sh bootstrap.sh finish.sh make-src.sh rsh rcp; do cmp -s "$f" "$WS/tools/hunt1-ops/aws/$f" || { echo "$O/$f is not tools/hunt1-ops/aws/$f; regenerate the ops files (tools/hunt1-queue.ts --ops)" >&2; exit 1; }; done
sed "s#@WORKSPACE@#$WORKSPACE#g" "$WS/tools/hunt1-ops/aws/com.browser-life.scaf-hunt1.plist" | cmp -s - com.browser-life.scaf-hunt1.plist || { echo "$O/com.browser-life.scaf-hunt1.plist is not tools/hunt1-ops/aws/com.browser-life.scaf-hunt1.plist with WORKSPACE from aws.conf; regenerate the ops files (tools/hunt1-queue.ts --ops)" >&2; exit 1; }
git -C "$REPO" archive --format=tar "$C" deno.json deno.lock packages tools experiments docs/scaffold-transition-hunt-v1.md docs/scaffold-registration-v1.md docs/scaffold-protocol-v1.md docs/scaffold-integration-v1.md > bl-src.tar
git -C "$REPO" rev-parse "$C" > src-commit
for n in 1 2 3; do
  rm -rf stage-$n; mkdir -p stage-$n/ops
  cp cmds-$n.txt stage-$n/ops/cmds.txt
  cp lane.sh history.sh devcheck.sh start.sh watchdog.sh stage-$n/ops/
  echo "$n" > stage-$n/ops/instance
  while read -r f; do
    [ -n "$f" ] || continue
    mkdir -p "stage-$n/$(dirname "$f")"; cp -p "$WS/$f" "stage-$n/$f"
  done < ship-$n.txt
  # The shipped sources must still hash as their manifests say (the instance's branch runs re-check this too).
  test "$(find stage-$n/runs/scaffold/reg1 -name b100-pre.blck | wc -l | tr -d ' ')" = 8
  tar czf ops-$n.tgz -C stage-$n .
done
gzip -f bl-src.tar
echo "bl-src.tar.gz from $(cat src-commit); ops-1/2/3.tgz ($(du -h ops-1.tgz | cut -f1) each, with 8 sources)"
