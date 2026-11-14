#!/usr/bin/env bash
# Restore the out-of-git replay files listed in docs/creative-prototypes/ARTIFACTS.md. Usage and flags: restore.mjs header.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node_bin="$(ls -d "$HOME"/.nvm/versions/node/v24*/bin 2>/dev/null | tail -1 || true)"
[ -n "$node_bin" ] && PATH="$node_bin:$PATH"
exec node "$here/restore.mjs" "$@"
