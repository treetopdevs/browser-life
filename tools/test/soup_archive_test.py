"""python3 -m unittest discover -s tools/test -p 'soup_archive_test.py'"""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('soup_archive', Path(__file__).parents[1] / 'soup-archive.py')
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


class ArchiveTest(unittest.TestCase):
    def test_preserves_duplicate_names_and_refuses_reuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rows = []
            for seed in [1, 2]:
                folder = root / str(seed)
                folder.mkdir()
                source = folder / 'params.json'
                source.write_text(str(seed))
                rows.append({'source': str(source), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
            inventory = root / 'inventory.json'
            inventory.write_text(json.dumps(rows))
            result = archive.pack(inventory, root / 'archive')
            with zipfile.ZipFile(root / 'archive/originals.zip') as z:
                self.assertEqual([z.read(r['member']) for r in result], [b'1', b'2'])
            self.assertTrue((root / 'archive/VERIFIED.json').exists())
            with self.assertRaises(FileExistsError):
                archive.pack(inventory, root / 'archive')

    def test_changed_input_cannot_be_verified(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'snapshot.bin'
            source.write_bytes(b'changed')
            inventory = root / 'inventory.json'
            inventory.write_text(json.dumps([{'source': str(source), 'sha256': '0' * 64}]))
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                archive.pack(inventory, root / 'archive')
            self.assertFalse((root / 'archive/VERIFIED.json').exists())
            self.assertEqual(source.read_bytes(), b'changed')

    def test_finalization_failure_does_not_publish_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inventory = root / 'inventory.json'
            inventory.write_text('[]')
            with patch.object(Path, 'chmod', side_effect=OSError('finalization failed')):
                with self.assertRaisesRegex(OSError, 'finalization failed'):
                    archive.pack(inventory, root / 'archive')
            self.assertFalse((root / 'archive/VERIFIED.json').exists())
