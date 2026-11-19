cd /Users/nicholas/develop/browser-life-bodies
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
D="docs/bodies-2026-11-17/v3/_skeptic/grow-only (GATE_GROW only)"
R="$D/runs"
V="--scenario crowd --quiet --mut on --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --gates grow --genome 16,60,16,0"
node --no-warnings "$D/own.ts" "$R" R-D-grow-s4 $V --steps 20000 --seed 4 > "$R/R-D-grow-s4.log" 2>&1 &
node --no-warnings "$D/own.ts" "$R" R-D-blind-s4 $V --steps 20000 --seed 4 --tag-blind > "$R/R-D-blind-s4.log" 2>&1 &
node --no-warnings "$D/own.ts" "$R" R-D-grow-s1-40k $V --steps 40000 --seed 1 > "$R/R-D-grow-s1-40k.log" 2>&1 &
node --no-warnings "$D/own.ts" "$R" R-D-blind-s1-40k $V --steps 40000 --seed 1 --tag-blind > "$R/R-D-blind-s1-40k.log" 2>&1 &
wait; echo done > "$R/launch5.done"
