cd /Users/nicholas/develop/browser-life-bodies
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
D="docs/bodies-2026-11-17/v3/_skeptic/grow-only (GATE_GROW only)"
R="$D/runs"
V="--scenario crowd --quiet --mut on --tag-mut-rate 65536 --tag-mut-bud --tag-step 40"
for s in 4 5; do
 FRAMES=20000 node --no-warnings "$D/own.ts" "$R" B-grow-s$s $V --steps 20000 --seed $s --gates grow > "$R/B-grow-s$s.log" 2>&1 &
 FRAMES=20000 node --no-warnings "$D/own.ts" "$R" B-blind-s$s $V --steps 20000 --seed $s --gates grow --tag-blind > "$R/B-blind-s$s.log" 2>&1 &
 FRAMES=20000 node --no-warnings "$D/own.ts" "$R" D-grow-s$s $V --steps 20000 --seed $s --gates grow --genome 16,60,16,0 > "$R/D-grow-s$s.log" 2>&1 &
 FRAMES=20000 node --no-warnings "$D/own.ts" "$R" D-blind-s$s $V --steps 20000 --seed $s --gates grow --genome 16,60,16,0 --tag-blind > "$R/D-blind-s$s.log" 2>&1 &
done
FRAMES=40000 node --no-warnings "$D/own.ts" "$R" D-grow-s1-40k $V --steps 40000 --seed 1 --gates grow --genome 16,60,16,0 > "$R/D-grow-s1-40k.log" 2>&1 &
FRAMES=40000 node --no-warnings "$D/own.ts" "$R" D-blind-s1-40k $V --steps 40000 --seed 1 --gates grow --genome 16,60,16,0 --tag-blind > "$R/D-blind-s1-40k.log" 2>&1 &
wait
echo done > "$R/launch1.done"
