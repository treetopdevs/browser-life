#!/usr/bin/env python3
"""Preserve a JSON inventory [{source, sha256}] in a new checksummed directory.

python3 tools/soup-archive.py inventory.json NEW_DIRECTORY
No original is modified. SHA-256 pins identity, not producing revision/ancestry.
Publication/immutable remote storage is a separate step. Failed outputs are kept
for diagnosis; only a package with VERIFIED.json is complete.
"""
import hashlib
import json
from pathlib import Path
import sys
import zipfile


def digest(stream):
    result = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        result.update(chunk)
    return result.hexdigest()


def file_digest(path):
    with Path(path).open('rb') as stream:
        return digest(stream)


def pack(inventory, dest):
    rows = json.loads(Path(inventory).read_text())
    dest = Path(dest)
    dest.mkdir()  # refuse reuse, including interrupted attempts
    manifest = []
    archive = dest / 'originals.zip'
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as z:
        for i, row in enumerate(rows):
            source = Path(row['source'])
            actual = file_digest(source)
            if actual != row['sha256']:
                raise ValueError(f'checksum mismatch: {source}')
            name = f'originals/{i:04d}/{source.name}'
            z.write(source, name)
            manifest.append({**row, 'member': name, 'bytes': source.stat().st_size})
        z.writestr('manifest.json', json.dumps(manifest, indent=2) + '\n')
    # Read/decompress every member and recheck originals after packaging.
    with zipfile.ZipFile(archive) as z:
        for row in manifest:
            with z.open(row['member']) as stream:
                if digest(stream) != row['sha256']:
                    raise ValueError(f'archive mismatch: {row["member"]}')
            if file_digest(row['source']) != row['sha256']:
                raise ValueError(f'original changed during packaging: {row["source"]}')
    (dest / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    sha = file_digest(archive)
    (dest / 'originals.zip.sha256').write_text(f'{sha}  originals.zip\n')
    marker = dest / '.verification.tmp'
    marker.write_text(json.dumps({'sha256': sha, 'files': len(manifest),
        'verification': 'all archived members and originals rehashed',
        'publication': 'local only; not immutable remote storage'}, indent=2) + '\n')
    for path in dest.iterdir():
        path.chmod(0o444)
    # Publish only a complete, finalized marker. Failures before rename leave no
    # VERIFIED.json, including chmod failures; rename is atomic on this filesystem.
    marker.rename(dest / 'VERIFIED.json')
    return manifest


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    pack(*sys.argv[1:])
