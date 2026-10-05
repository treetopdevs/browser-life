#!/bin/bash
# start.sh (instance, @reboot and at bootstrap): clears unfinished claims, then starts LANES lanes.
cd ~/bl || exit 1
mkdir -p ops/claims ops/done ops/fail ops/logs runs/scaffold/reg1
for c in ops/claims/*; do [ -d "$c" ] || continue; id=$(basename $c); [ -e ops/done/$id ] || [ -e ops/fail/$id ] || rm -rf "$c"; done
rm -f ops/finished
LANES=${LANES:-6}
for n in $(seq 1 $LANES); do nohup bash ops/lane.sh $n > /dev/null 2>&1 & done
echo "$(date -u +%FT%T) started $LANES lanes" >> ops/lanes.log
