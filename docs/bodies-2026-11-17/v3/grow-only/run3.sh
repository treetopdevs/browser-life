cd /Users/nicholas/develop/browser-life-bodies
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
D=docs/bodies-2026-11-17/v3/grow-only
V="node --no-warnings experiments/bodies/v3.ts --scenario crowd --steps 20000 --quiet --mut on"
for s in 1 2 3; do
$V --seed $s --gates grow --tag-mut-rate 400 --out $D/r3-A-grow-s$s &
$V --seed $s --gates grow --tag-mut-rate 400 --tag-blind --no-frames --out $D/r3-A-blind-s$s &
$V --seed $s --gates grow --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --out $D/r3-B-grow-s$s &
$V --seed $s --gates grow --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --tag-blind --no-frames --out $D/r3-B-blind-s$s &
$V --seed $s --gates grow --tags same --no-frames --out $D/r3-same-s$s &
wait
done; echo done > $D/r3.done
