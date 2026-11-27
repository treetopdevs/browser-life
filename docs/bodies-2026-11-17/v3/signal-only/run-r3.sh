cd /Users/nicholas/develop/browser-life-bodies; D=docs/bodies-2026-11-17/v3/signal-only
C="--scenario crowd --steps 20000 --quiet --mut on --frames 5000,20000"
for s in 1 2 3; do
node --no-warnings experiments/bodies/v3.ts $C --seed $s --tag-mut-rate 400 --gates signal --out $D/r3-sig-s$s &
node --no-warnings experiments/bodies/v3.ts $C --seed $s --tag-mut-rate 400 --gates signal --tag-blind --out $D/r3-blind-s$s &
node --no-warnings experiments/bodies/v3.ts $C --seed $s --tag-mut-rate 400 --gates signal --tags same --out $D/r3-same-s$s &
done; wait
