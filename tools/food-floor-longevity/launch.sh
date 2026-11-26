#!/bin/bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
NODE="/Users/nicholas/.nvm/versions/node/v24.2.0/bin/node"
PLAN="docs/creative-prototypes/food-floor-longevity-plan.md"
MODEL="apps/lab/src/food-band-foothold/model.ts"
RUNNER="tools/food-floor-longevity/explore.ts"
LAUNCHER="tools/food-floor-longevity/launch.sh"
PLAN_SHA="8e0985d08122792a7c4c3b76ff51de9b29601dc92be292e7a5b001cff71f56b7"

cd "$ROOT"
[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || { echo 'Launch requires darwin/arm64.' >&2; exit 2; }
[[ -x "$NODE" ]] || { echo "Required Node executable is missing: $NODE" >&2; exit 2; }
[[ "$("$NODE" --version)" == "v24.2.0" ]] || { echo 'Launch requires Node 24.2.0.' >&2; exit 2; }
[[ -d node_modules ]] || { echo 'Workspace dependencies are not installed.' >&2; exit 2; }
[[ ! -e docs/creative-prototypes/food-floor-longevity-seed-1203.json && ! -e docs/creative-prototypes/food-floor-longevity-seed-1203.md ]] || { echo 'Refusing to overwrite foothold evidence.' >&2; exit 2; }

sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
[[ "$(sha256 "$PLAN")" == "$PLAN_SHA" ]] || { echo 'Committed plan hash does not match the reviewed plan.' >&2; exit 2; }
for path in "$PLAN" "$MODEL" "$RUNNER" "$LAUNCHER" package.json pnpm-lock.yaml; do
  git ls-files --error-unmatch "$path" >/dev/null 2>&1 || { echo "Required committed input is not tracked: $path" >&2; exit 2; }
  [[ -z "$(git status --porcelain -- "$path")" ]] || { echo "Required input has uncommitted changes: $path" >&2; exit 2; }
  [[ "$(sha256 "$path")" == "$(git show "HEAD:$path" | shasum -a 256 | awk '{print $1}')" ]] || { echo "Working input differs from committed input: $path" >&2; exit 2; }
done
[[ "$(sha256 docs/creative-prototypes/food-floor-replication-seed-1203.json)" == "7b535bf0eb53c1c3ee192974efd7de61fa15bb99fe84308478b1639eaa8b753d" ]] || { echo 'Historical food-floor artifact pin mismatch.' >&2; exit 2; }
[[ "$(sha256 docs/creative-prototypes/food-floor-replication-index-1203.json)" == "0f792ca72c287d5cb09c12a9daa7290aaed40dd53e2eab86008ab0f1df69994f" ]] || { echo 'Historical food-floor index pin mismatch.' >&2; exit 2; }
for path in apps/lab/src/food-band-foothold/model.ts tools/food-floor-replication/explore.ts tools/food-floor-replication/launch.sh docs/creative-prototypes/food-floor-replication-validation.md; do
  git ls-files --error-unmatch "$path" >/dev/null 2>&1 || { echo "Required historical input is not tracked: $path" >&2; exit 2; }
  [[ -z "$(git status --porcelain -- "$path")" ]] || { echo "Historical input has uncommitted changes: $path" >&2; exit 2; }
done
[[ "$(sha256 docs/creative-prototypes/food-floor-replication-validation.md)" == "72a2d688217fa0d3369ac00f652cff097bdd811bceb6996493ceab358e471ed3" ]] || { echo 'Historical validation pin mismatch.' >&2; exit 2; }

"$NODE" --experimental-strip-types tools/food-floor-replication/explore.ts --check --seed 1203

PRELAUNCH_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_HEAD="$(git rev-parse HEAD)"
ATTEMPTS_ROOT="runs/food-floor-longevity/attempts"
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
  "mode": "foothold-band",
  "maxTick": 6000,
  "stop": "actual extinction or tick 6000",
  "planSha256": "$(sha256 "$PLAN")",
  "modelSha256": "$(sha256 "$MODEL")",
  "runnerSha256": "$(sha256 "$RUNNER")",
  "packageJsonSha256": "$(sha256 package.json)",
  "pnpmLockSha256": "$(sha256 pnpm-lock.yaml)",
  "historicalArtifactSha256": "7b535bf0eb53c1c3ee192974efd7de61fa15bb99fe84308478b1639eaa8b753d",
  "historicalDataSha256": "16d01d50bd909e3058295d23719d161722952b1349f2a5ebd16780d9a5b88bc2",
  "historicalIndexSha256": "0f792ca72c287d5cb09c12a9daa7290aaed40dd53e2eab86008ab0f1df69994f",
  "historicalValidationSha256": "72a2d688217fa0d3369ac00f652cff097bdd811bceb6996493ceab358e471ed3",
  "historicalModelSha256": "d3e0b36594b43a40d77befbe846d4365b25655d7d670c50d74f6fadefa988403",
  "historicalRunnerSha256": "17ffccbdc1be97b4859f9bbbc082f6449497f86f00eb1db01987439c16d3b09b",
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
