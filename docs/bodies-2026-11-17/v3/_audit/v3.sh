#!/bin/zsh
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
cd /Users/nicholas/develop/browser-life-bodies
node --no-warnings experiments/bodies/v3.ts "$@"
