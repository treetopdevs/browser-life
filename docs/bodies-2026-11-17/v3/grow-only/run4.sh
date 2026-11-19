cd /Users/nicholas/develop/browser-life-bodies
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
D=docs/bodies-2026-11-17/v3/grow-only
V="node --no-warnings experiments/bodies/v3.ts --steps 20000 --quiet --mut on --gates grow --tag-mut-rate 65536 --tag-mut-bud --tag-step 40"
for s in 1 2 3; do
$V --scenario crowd --genome 16,60,16,0 --seed $s --out $D/r3-D-grow-s$s &
$V --scenario crowd --genome 16,60,16,0 --seed $s --tag-blind --no-frames --out $D/r3-D-blind-s$s &
$V --scenario wound-in-crowd --seed $s --steps 14000 --wound-at 12000 --out $D/r3-W-B-s$s &
done; wait; echo done > $D/r4.done
