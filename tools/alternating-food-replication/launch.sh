#!/bin/bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
NODE="/Users/nicholas/.nvm/versions/node/v24.2.0/bin/node"
PLAN="docs/creative-prototypes/alternating-food-replication-plan.md"
MODEL="apps/lab/src/alternating-food/model.ts"
RUNNER="tools/alternating-food-replication/explore.ts"
LAUNCHER="tools/alternating-food-replication/launch.sh"
PLAN_SHA="2070ef956ca73855e9b032a7cbaa5e53e594dddaa9ed82f84f72c49256f5c743"

cd "$ROOT"
[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || { echo 'Launch requires darwin/arm64.' >&2; exit 2; }
[[ -x "$NODE" ]] || { echo "Required Node executable is missing: $NODE" >&2; exit 2; }
[[ "$("$NODE" --version)" == "v24.2.0" ]] || { echo 'Launch requires Node 24.2.0.' >&2; exit 2; }
[[ -d node_modules ]] || { echo 'Workspace dependencies are not installed.' >&2; exit 2; }
[[ ! -e docs/creative-prototypes/alternating-food-replication-seed-1202.json && ! -e docs/creative-prototypes/alternating-food-replication-seed-1202.md ]] || { echo 'Refusing to overwrite alternating-food evidence.' >&2; exit 2; }

sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
[[ "$(sha256 "$PLAN")" == "$PLAN_SHA" ]] || { echo 'Committed plan hash does not match the reviewed plan.' >&2; exit 2; }
for path in "$PLAN" "$MODEL" "$RUNNER" "$LAUNCHER" package.json pnpm-lock.yaml; do
  git ls-files --error-unmatch "$path" >/dev/null 2>&1 || { echo "Required committed input is not tracked: $path" >&2; exit 2; }
  [[ -z "$(git status --porcelain -- "$path")" ]] || { echo "Required input has uncommitted changes: $path" >&2; exit 2; }
  [[ "$(sha256 "$path")" == "$(git show "HEAD:$path" | shasum -a 256 | awk '{print $1}')" ]] || { echo "Working input differs from committed input: $path" >&2; exit 2; }
done
[[ "$(sha256 docs/creative-prototypes/split-food-seed-1202.json)" == "3f99cf98531a9908a1a2ab9adb7ce2dd6566d2edd08afb4855d99267fbee033b" ]] || { echo 'Historical split artifact pin mismatch.' >&2; exit 2; }
[[ "$(sha256 docs/creative-prototypes/split-food-index-1202.json)" == "e3e3aa26ace9722ca15175d208ba0d5e2aaa09608e03af072695066c14089afc" ]] || { echo 'Historical split index pin mismatch.' >&2; exit 2; }
for path in apps/lab/src/split-food/model.ts tools/split-food/explore.ts docs/creative-prototypes/split-food-validation.md; do
  git ls-files --error-unmatch "$path" >/dev/null 2>&1 || { echo "Required historical input is not tracked: $path" >&2; exit 2; }
  [[ -z "$(git status --porcelain -- "$path")" ]] || { echo "Historical input has uncommitted changes: $path" >&2; exit 2; }
done
[[ "$(sha256 docs/creative-prototypes/split-food-validation.md)" == "56a5a32d86286a425f1f0f0f83cd8b0b76cf4aaae351d0be52afdf14665ce7c5" ]] || { echo 'Historical validation pin mismatch.' >&2; exit 2; }

"$NODE" --experimental-strip-types tools/split-food/explore.ts --check --seed 1202

PRELAUNCH_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_HEAD="$(git rev-parse HEAD)"
ATTEMPTS_ROOT="runs/alternating-food-replication/attempts"
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
  "seed": 1202,
  "mode": "alternating-band",
  "maxTick": 3000,
  "stop": "actual extinction or tick 3000",
  "planSha256": "$(sha256 "$PLAN")",
  "modelSha256": "$(sha256 "$MODEL")",
  "runnerSha256": "$(sha256 "$RUNNER")",
  "packageJsonSha256": "$(sha256 package.json)",
  "pnpmLockSha256": "$(sha256 pnpm-lock.yaml)",
  "historicalArtifactSha256": "3f99cf98531a9908a1a2ab9adb7ce2dd6566d2edd08afb4855d99267fbee033b",
  "historicalDataSha256": "1379b36370340873e531443ab8f9176a19a69d88b942d20e4d982ed81a81a349",
  "historicalIndexSha256": "e3e3aa26ace9722ca15175d208ba0d5e2aaa09608e03af072695066c14089afc",
  "historicalValidationSha256": "56a5a32d86286a425f1f0f0f83cd8b0b76cf4aaae351d0be52afdf14665ce7c5",
  "copySourceModelSha256": "c6b5c37f20f8daa73858fd9e437d0b25d029c712c065ab11ef495c281b58b506",
  "historicalRunnerSha256": "aa2d3aeca0cd7a1a58e405c681cc6e61b5b15da2b0b85262a12c4f6fa95009bd",
  "launcherSha256": "$(shasum -a 256 "$LAUNCHER" | awk '{print $1}')",
  "nodeVersion": "24.2.0",
  "environment": {"NODE_NO_WARNINGS": "1"},
  "command": ["$NODE", "--experimental-strip-types", "$RUNNER", "--write", "--seed", "1202", "--attempt-dir", "$ROOT/$ATTEMPT_DIR"]
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
"$NODE" --experimental-strip-types "$RUNNER" --write --seed 1202 --attempt-dir "$ROOT/$ATTEMPT_DIR" > "$ATTEMPT_DIR/stdout.log" 2> "$ATTEMPT_DIR/stderr.log"
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
