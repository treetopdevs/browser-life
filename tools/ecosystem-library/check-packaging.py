"""Check Docker exclusion patterns against an actual build without running Docker.

Run after pnpm build. Never modifies the build tree.
"""
import fnmatch
import json
import shlex
from pathlib import Path

root = Path(__file__).resolve().parents[2]
dist = root / 'apps/lab/dist'
required = ['ecosystem/index.html', 'ecosystem/archive/index.html', 'playground/index.html']
for name in required:
    if not (dist / name).is_file():
        raise SystemExit(f'Missing built page {name}; run pnpm build first')
line = next(line for line in (root / 'Dockerfile.site').read_text().splitlines() if '&& rm -rf ' in line)
patterns = shlex.split(line.split('&& rm -rf ', 1)[1])
files = [p.relative_to(root).as_posix() for p in dist.rglob('*') if p.is_file()]
targets = [p for p in files if p.startswith(('apps/lab/dist/ecosystem/', 'apps/lab/dist/playground/')) or Path(p).name.startswith(('ecosystem-', 'ecosystemArchive', 'playground-'))]
assert len([p for p in targets if p.endswith('.mp4')]) == 3, 'Expected three built movies'
for path in targets:
    if not any(fnmatch.fnmatchcase(path, pattern) or path.startswith(pattern + '/') for pattern in patterns):
        raise SystemExit(f'Production removal misses {path}')
print(json.dumps({'passed': True, 'excludedFiles': targets, 'scope': 'Built output versus Docker removal patterns; no Docker/Caddy runtime execution'}, indent=2))
