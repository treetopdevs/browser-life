cd /Users/nicholas/develop/browser-life-bodies
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
D=docs/bodies-2026-11-17/v3/grow-only
for s in 1 2 3; do
node --no-warnings experiments/bodies/v3.ts --scenario wound-in-crowd --steps 14000 --wound-at 12000 --quiet --mut on --gates grow --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --tag-blind --no-frames --seed $s --out $D/r3-W-Bblind-s$s &
done; wait; echo done > $D/r5.done
