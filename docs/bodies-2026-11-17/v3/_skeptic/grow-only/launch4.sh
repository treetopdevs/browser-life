cd /Users/nicholas/develop/browser-life-bodies
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
D="docs/bodies-2026-11-17/v3/_skeptic/grow-only (GATE_GROW only)"
R="$D/runs"
V="--scenario crowd --quiet --mut on --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --steps 20000 --gates grow"
for s in 1 2 3; do FRAMES=20000 node --no-warnings "$D/own.ts" "$R" B-grow-s$s $V --seed $s > "$R/B-grow-s$s.log" 2>&1 & done
for s in 4 5; do
 MODEL="/Users/nicholas/develop/browser-life-bodies/$D/model128.ts" SIZE=128 node --no-warnings "$D/own.ts" "$R" T128-D-grow-s$s $V --seed $s --genome 16,60,16,0 > "$R/T128-D-grow-s$s.log" 2>&1 &
 MODEL="/Users/nicholas/develop/browser-life-bodies/$D/model128.ts" SIZE=128 node --no-warnings "$D/own.ts" "$R" T128-D-blind-s$s $V --seed $s --genome 16,60,16,0 --tag-blind > "$R/T128-D-blind-s$s.log" 2>&1 &
done
wait; echo done > "$R/launch4.done"
