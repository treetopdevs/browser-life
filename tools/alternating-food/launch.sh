#!/bin/bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
NODE="/Users/nicholas/.nvm/versions/node/v24.2.0/bin/node"
PLAN="docs/creative-prototypes/alternating-food-plan.md"
MODEL="apps/lab/src/alternating-food/model.ts"
RUNNER="tools/alternating-food/explore.ts"
LAUNCHER="tools/alternating-food/launch.sh"
PLAN_SHA="0233fb33daab0c1fa6198e3f1840f3fb0056add96bc4a1a7a82a2e110ce5c7c8"

cd "$ROOT"
[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || { echo 'Launch requires darwin/arm64.' >&2; exit 2; }
[[ -x "$NODE" ]] || { echo "Required Node executable is missing: $NODE" >&2; exit 2; }
[[ "$("$NODE" --version)" == "v24.2.0" ]] || { echo 'Launch requires Node 24.2.0.' >&2; exit 2; }
[[ -d node_modules ]] || { echo 'Workspace dependencies are not installed.' >&2; exit 2; }
[[ ! -e docs/creative-prototypes/alternating-food-seed-1203.json && ! -e docs/creative-prototypes/alternating-food-seed-1203.md ]] || { echo 'Refusing to overwrite alternating-food evidence.' >&2; exit 2; }

sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
[[ "$(sha256 "$PLAN")" == "$PLAN_SHA" ]] || { echo 'Committed plan hash does not match the reviewed plan.' >&2; exit 2; }
for path in "$PLAN" "$MODEL" "$RUNNER" "$LAUNCHER" package.json pnpm-lock.yaml; do
  git ls-files --error-unmatch "$path" >/dev/null 2>&1 || { echo "Required committed input is not tracked: $path" >&2; exit 2; }
  [[ -z "$(git status --porcelain -- "$path")" ]] || { echo "Required input has uncommitted changes: $path" >&2; exit 2; }
  [[ "$(sha256 "$path")" == "$(git show "HEAD:$path" | shasum -a 256 | awk '{print $1}')" ]] || { echo "Working input differs from committed input: $path" >&2; exit 2; }
done
[[ "$(sha256 docs/creative-prototypes/split-food-replication-seed-1203.json)" == "edc38df48f5d08d198fe59d18a5eb9af0dbd068e37a30a49de82ab91797b5f14" ]] || { echo 'Historical split artifact pin mismatch.' >&2; exit 2; }
[[ "$(sha256 docs/creative-prototypes/split-food-replication-index-1203.json)" == "591ebadc051f55f7d8eeb774b9fab4694b820f814f719696029ad900fcde01f3" ]] || { echo 'Historical split index pin mismatch.' >&2; exit 2; }
[[ "$(sha256 docs/creative-prototypes/split-food-replication-validation.md)" == "22800cadbd42548600909444065853854fd68062a8a636201f2bc415a43a9461" ]] || { echo 'Historical validation pin mismatch.' >&2; exit 2; }

PRELAUNCH_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_HEAD="$(git rev-parse HEAD)"
ATTEMPTS_ROOT="runs/alternating-food/attempts"
[[ ! -e "$ATTEMPTS_ROOT" || -z "$(find "$ATTEMPTS_ROOT" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo 'A prior attempt or reservation exists; retries require separately reviewed repair.' >&2; exit 2; }
mkdir -p "$ATTEMPTS_ROOT"
mkdir "$ATTEMPTS_ROOT/reservation.lock" || { echo 'Another attempt already reserved the single-run allowance.' >&2; exit 2; }
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
ATTEMPT_DIR="$ATTEMPTS_ROOT/run-$RUN_ID"
mkdir "$ATTEMPT_DIR"
INTENT="$ATTEMPT_DIR/intent.json"
cat > "$INTENT" <<EOF_JSON
{
  "schemaVersion": 1,
  "status": "intent-recorded-before-launch",
  "runId": "$RUN_ID",
  "gitHead": "$GIT_HEAD",
  "prelaunchUtc": "$PRELAUNCH_UTC",
  "intentDurability": "fsynced-before-runner",
  "seed": 1203,
  "mode": "alternating-band",
  "maxTick": 3000,
  "stop": "actual extinction or tick 3000",
  "planSha256": "$(sha256 "$PLAN")",
  "modelSha256": "$(sha256 "$MODEL")",
  "runnerSha256": "$(sha256 "$RUNNER")",
  "packageJsonSha256": "$(sha256 package.json)",
  "pnpmLockSha256": "$(sha256 pnpm-lock.yaml)",
  "historicalArtifactSha256": "edc38df48f5d08d198fe59d18a5eb9af0dbd068e37a30a49de82ab91797b5f14",
  "historicalDataSha256": "d9e546968191c29d35d4e096cc891d0576d68531870643d6f44e144ced35e343",
  "historicalIndexSha256": "591ebadc051f55f7d8eeb774b9fab4694b820f814f719696029ad900fcde01f3",
  "historicalValidationSha256": "22800cadbd42548600909444065853854fd68062a8a636201f2bc415a43a9461",
  "copySourceModelSha256": "c6b5c37f20f8daa73858fd9e437d0b25d029c712c065ab11ef495c281b58b506",
  "historicalRunnerSha256": "5f60e71043ee4335ff178ed5521897723adf782bc2e3fb17e15a2bb0884c5baf",
  "launcherSha256": "$(shasum -a 256 "$LAUNCHER" | awk '{print $1}')",
  "nodeVersion": "24.2.0",
  "environment": {"NODE_NO_WARNINGS": "1"},
  "command": ["$NODE", "--experimental-strip-types", "$RUNNER", "--write", "--seed", "1203", "--attempt-dir", "$ROOT/$ATTEMPT_DIR"]
}
EOF_JSON
sync
INTENT_SHA256="$(sha256 "$INTENT")"
cat > "$ATTEMPTS_ROOT/reservation.json" <<EOF_RESERVATION
{
  "schemaVersion": 1,
  "status": "reserved",
  "runId": "$RUN_ID",
  "attemptDir": "run-$RUN_ID",
  "prelaunchUtc": "$PRELAUNCH_UTC",
  "gitHead": "$GIT_HEAD",
  "intentSha256": "$INTENT_SHA256"
}
EOF_RESERVATION
sync

echo "Intent recorded at $INTENT; beginning reviewed checks and the scheduled attempt."
export NODE_NO_WARNINGS=1
set +e
"$NODE" --experimental-strip-types "$RUNNER" --write --seed 1203 --attempt-dir "$ROOT/$ATTEMPT_DIR" > "$ATTEMPT_DIR/stdout.log" 2> "$ATTEMPT_DIR/stderr.log"
RUN_STATUS=$?
set -e
FINISHED_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RUN_RESULT="completed"
[[ "$RUN_STATUS" -eq 0 ]] || RUN_RESULT="failed"
cat > "$ATTEMPT_DIR/result.json" <<EOF_RESULT
{
  "status": "$RUN_RESULT",
  "exitStatus": $RUN_STATUS,
  "finishedUtc": "$FINISHED_UTC",
  "classification": "$(if [[ "$RUN_STATUS" -eq 0 ]]; then echo completed; elif [[ -f "$ATTEMPT_DIR/failures.jsonl" ]]; then "$NODE" -e 'const f=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(x=>JSON.parse(x));process.stdout.write(f.at(-1).classification)' "$ATTEMPT_DIR/failures.jsonl"; else echo invalid; fi)",
  "stdout": "stdout.log",
  "stderr": "stderr.log"
}
EOF_RESULT
sync
cat "$ATTEMPT_DIR/stdout.log"
cat "$ATTEMPT_DIR/stderr.log" >&2
exit "$RUN_STATUS"
