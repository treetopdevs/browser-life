#!/bin/zsh
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
cd /Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/_audit
for f in a_mut_seam a2_bud_seam b_gates c_order c_order3 c_raid2 f_tracker h_scramble; do node --no-warnings $f.ts > $f.out 2>&1; done
echo done > run_fast.done
