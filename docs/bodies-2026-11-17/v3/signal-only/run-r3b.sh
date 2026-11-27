cd /Users/nicholas/develop/browser-life-bodies; D=docs/bodies-2026-11-17/v3/signal-only
C="--scenario crowd --steps 20000 --quiet --mut on --frames 3000,20000 --tag-mut-rate 65536 --tag-mut-bud --tag-step 40"
for s in 1 2 3; do
node --no-warnings experiments/bodies/v3.ts $C --seed $s --gates signal --out $D/r3b-sig-s$s &
node --no-warnings experiments/bodies/v3.ts $C --seed $s --gates signal --tag-blind --out $D/r3b-blind-s$s &
done; wait
