cd /Users/nicholas/develop/browser-life-bodies
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
D="docs/bodies-2026-11-17/v3/_skeptic/grow-only (GATE_GROW only)"
R="$D/runs"
V="--scenario crowd --quiet --mut on --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --steps 12000"
w(){ nm=$1; shift; node --no-warnings "$D/wound2.ts" "$R/W-$nm.json" 8 $V "$@" > "$R/W-$nm.log" 2>&1 & }
w D-grow-s4 --seed 4 --genome 16,60,16,0 --gates grow
w D-blind-s4 --seed 4 --genome 16,60,16,0 --gates grow --tag-blind
w B-grow-s5 --seed 5 --gates grow
w B-blind-s5 --seed 5 --gates grow --tag-blind
for s in 4 5 6; do
 POS="48,48" EVERY=500 node --no-warnings "$D/own.ts" "$R" L-inert-s$s --scenario crowd --founders 1 --quiet --seed $s --steps 20000 --genome 16,60,16,0 --gates grow --tags same > "$R/L-inert-s$s.log" 2>&1 &
 POS="48,48" EVERY=500 node --no-warnings "$D/own.ts" "$R" L-blind-s$s --scenario crowd --founders 1 --quiet --seed $s --steps 20000 --genome 16,60,16,0 --gates grow --tags same --tag-blind > "$R/L-blind-s$s.log" 2>&1 &
done
wait; echo done > "$R/launch3.done"
