cd /Users/nicholas/develop/browser-life-bodies
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
D="docs/bodies-2026-11-17/v3/_skeptic/grow-only (GATE_GROW only)"
R="$D/runs"
V="--scenario crowd --quiet --mut on --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --steps 20000 --genome 16,60,16,0"
run(){ nm=$1; shift; FRAMES=20000 node --no-warnings "$D/own.ts" "$R" "$nm" "$@" > "$R/$nm.log" 2>&1 & }
# founder-spacing / torus placement tests (seed 4)
POS="37,37;85,43;59,85" run F-shift3-grow-s4 $V --seed 4 --gates grow
POS="37,37;85,43;59,85" run F-shift3-blind-s4 $V --seed 4 --gates grow --tag-blind
POS="48,48" run F-one-grow-s4 $V --seed 4 --founders 1 --gates grow
POS="48,48" run F-one-blind-s4 $V --seed 4 --founders 1 --gates grow --tag-blind
run F-same-grow-s4 $V --seed 4 --gates grow --tags same
run F-same-blind-s4 $V --seed 4 --gates grow --tags same --tag-blind
# plain (no gate) D mutation: gates off entirely, same mutation settings -> baseline mark patches
wait; echo done > "$R/launch2.done"
