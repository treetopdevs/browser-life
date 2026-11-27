cd /Users/nicholas/develop/browser-life-bodies
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
D=docs/bodies-2026-11-17/v3/grow-only
for s in 1 2 3; do
node --no-warnings experiments/bodies/v3.ts --scenario crowd --seed $s --steps 20000 --quiet --gates grow --out $D/r2-crowd-grow-s$s &
node --no-warnings experiments/bodies/v3.ts --scenario crowd --seed $s --steps 20000 --quiet --gates grow --tags same --no-frames --out $D/r2-crowd-grow-same-s$s &
node --no-warnings experiments/bodies/v3.ts --scenario crowd --seed $s --steps 20000 --quiet --no-frames --out $D/r2-crowd-plain-s$s &
done; wait; echo done > $D/r2.done
