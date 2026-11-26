#!/bin/bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
NODE="/Users/nicholas/.nvm/versions/node/v24.2.0/bin/node"
PLAN="docs/creative-prototypes/food-band-foothold-replication-plan.md"
MODEL="apps/lab/src/food-band-foothold/model.ts"
RUNNER="tools/food-band-foothold-replication/explore.ts"
LAUNCHER="tools/food-band-foothold-replication/launch.sh"
PLAN_SHA="2e9f72dae2fb1c5755bf5d78559b83f8e7b6a04cbe00b384d867b826e9dadc99"

cd "$ROOT"
[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || { echo 'Launch requires darwin/arm64.' >&2; exit 2; }
[[ -x "$NODE" ]] || { echo "Required Node executable is missing: $NODE" >&2; exit 2; }
[[ "$("$NODE" --version)" == "v24.2.0" ]] || { echo 'Launch requires Node 24.2.0.' >&2; exit 2; }
[[ -d node_modules ]] || { echo 'Workspace dependencies are not installed.' >&2; exit 2; }
[[ ! -e docs/creative-prototypes/food-band-foothold-replication-seed-1203.json && ! -e docs/creative-prototypes/food-band-foothold-replication-seed-1203.md ]] || { echo 'Refusing to overwrite foothold evidence.' >&2; exit 2; }

sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
[[ "$(sha256 "$PLAN")" == "$PLAN_SHA" ]] || { echo 'Committed plan hash does not match the reviewed plan.' >&2; exit 2; }
for path in "$PLAN" "$MODEL" "$RUNNER" "$LAUNCHER" package.json pnpm-lock.yaml; do
  git ls-files --error-unmatch "$path" >/dev/null 2>&1 || { echo "Required committed input is not tracked: $path" >&2; exit 2; }
  [[ -z "$(git status --porcelain -- "$path")" ]] || { echo "Required input has uncommitted changes: $path" >&2; exit 2; }
  [[ "$(sha256 "$path")" == "$(git show "HEAD:$path" | shasum -a 256 | awk '{print $1}')" ]] || { echo "Working input differs from committed input: $path" >&2; exit 2; }
done
[[ "$(sha256 docs/creative-prototypes/alternating-food-seed-1203.json)" == "f4f5e28294c4806b2b31b4776dbdd42ab9cf70d4307279787c2649298d34123b" ]] || { echo 'Historical alternating artifact pin mismatch.' >&2; exit 2; }
[[ "$(sha256 docs/creative-prototypes/alternating-food-index-1203.json)" == "aa6979c401989913ab5b6f69aa7db0e778ca493dbaf1f6261b529da33ae26915" ]] || { echo 'Historical alternating index pin mismatch.' >&2; exit 2; }
for path in apps/lab/src/alternating-food/model.ts tools/alternating-food/explore.ts docs/creative-prototypes/alternating-food-validation.md; do
  git ls-files --error-unmatch "$path" >/dev/null 2>&1 || { echo "Required historical input is not tracked: $path" >&2; exit 2; }
  [[ -z "$(git status --porcelain -- "$path")" ]] || { echo "Historical input has uncommitted changes: $path" >&2; exit 2; }
done
[[ "$(sha256 docs/creative-prototypes/alternating-food-validation.md)" == "d28ab30e1566098a29d398e8a8a1e9b1e8d5098f20412a78cf4394e07aacd943" ]] || { echo 'Historical validation pin mismatch.' >&2; exit 2; }

"$NODE" --experimental-strip-types tools/alternating-food/explore.ts --check --seed 1203
"$NODE" --experimental-strip-types tools/food-band-foothold/explore.ts --check --seed 1202

"$NODE" --experimental-strip-types --input-type=module -e 'import {preflight} from "./tools/food-band-foothold-replication/explore.ts";preflight();'

PRELAUNCH_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_HEAD="$(git rev-parse HEAD)"
ATTEMPTS_ROOT="runs/food-band-foothold-replication/attempts"
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
  "sourceSha256": $("$NODE" --experimental-strip-types --input-type=module -e 'import {LOADED_SOURCE_SHA256} from "./tools/food-band-foothold-replication/explore.ts";process.stdout.write(JSON.stringify(LOADED_SOURCE_SHA256))'),
  "platform": "darwin",
  "arch": "arm64",
  "status": "intent-recorded-before-launch",
  "runId": "$RUN_ID",
  "gitHead": "$GIT_HEAD",
  "prelaunchUtc": "$PRELAUNCH_UTC",
  "intentDurability": "fsynced-before-runner",
  "seed": 1203,
  "mode": "foothold-band",
  "maxTick": 3000,
  "stop": "actual extinction or tick 3000",
  "planSha256": "$(sha256 "$PLAN")",
  "modelSha256": "$(sha256 "$MODEL")",
  "runnerSha256": "$(sha256 "$RUNNER")",
  "packageJsonSha256": "$(sha256 package.json)",
  "pnpmLockSha256": "$(sha256 pnpm-lock.yaml)",
  "historicalArtifactSha256": "f4f5e28294c4806b2b31b4776dbdd42ab9cf70d4307279787c2649298d34123b",
  "historicalDataSha256": "5f958ff21d67940e8d92c345de4b2fff58c74368ddaea7227cab98e7cbfc63e4",
  "historicalIndexSha256": "aa6979c401989913ab5b6f69aa7db0e778ca493dbaf1f6261b529da33ae26915",
  "historicalValidationSha256": "d28ab30e1566098a29d398e8a8a1e9b1e8d5098f20412a78cf4394e07aacd943",
  "copySourceModelSha256": "5dc6ce46ee36d2d008f802e81e0f7aae80d7bfeaa58984512d13cad714729b31",
  "historicalRunnerSha256": "6a172232d875eaff523bc729c24026a3166818dab58f4d494d25ea3d343a769a",
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
