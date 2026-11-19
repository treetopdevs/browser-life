cd /Users/nicholas/develop/browser-life-bodies; D=docs/bodies-2026-11-17/v3/signal-only
C="--scenario wound-in-crowd --steps 9600 --quiet --mut on --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --wound-at 8000 --gates signal"
for s in 1 2; do
node --no-warnings experiments/bodies/v3.ts $C --seed $s --out $D/w-sig-s$s &
node --no-warnings experiments/bodies/v3.ts $C --seed $s --tag-blind --out $D/w-blind-s$s &
done; wait
