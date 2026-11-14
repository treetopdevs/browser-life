import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import json
import zipfile
spec = importlib.util.spec_from_file_location('soup_repeat', Path(__file__).parents[1] / 'soup-repeat.py')
repeat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repeat)


class ComparisonTest(unittest.TestCase):
    def test_preserves_mismatches_missing_rows_and_checkpoints(self):
        with tempfile.TemporaryDirectory() as tmp:
            old, new = Path(tmp) / 'old', Path(tmp) / 'new'
            old.mkdir(); new.mkdir()
            (old / 'log.csv').write_text('epoch,value,seconds\n1,a,1\n65,b,2\n129,c,3\n193,d,4\n')
            (new / 'log.csv').write_text('epoch,value,seconds\n1,a,9\n65,changed,10\n130,e,11\n')
            (old / 'soup-64.bin').write_bytes(b'old')
            (new / 'soup-64.bin').write_bytes(b'new')
            (old / 'soup-128.bin').write_bytes(b'missing')
            (new / 'soup-130.bin').write_bytes(b'extra')
            result = repeat.compare(new, old, 130)
            self.assertEqual([r['epoch'] for r in result['series']['differences']], [65])
            self.assertEqual(result['series']['missingHistoricalRows'], [130])
            self.assertEqual(result['series']['missingRepeatRowsWithinRun'], [129])
            self.assertEqual(result['series']['historicalRowsBeyondRun'], 1)
            self.assertEqual(result['missingHistoricalCheckpointsWithinRun'][0]['snapshot'], 'soup-128.bin')
            self.assertFalse(next(r for r in result['checkpoints'] if r['snapshot'] == 'soup-64.bin')['matchesHistorical'])

    def test_duplicate_epoch_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'log.csv'; p.write_text('epoch,value,seconds\n1,a,1\n1,b,2\n')
            with self.assertRaisesRegex(ValueError, 'duplicate census'):
                list(repeat.rows(p))

    def test_failed_children_all_run_then_return_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); archive = root / 'archive.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('manifest.json', '[]')
            with patch.object(repeat, 'ARCHIVE_SHA256', repeat.sha(archive)), patch.object(repeat.subprocess, 'run', return_value=SimpleNamespace(returncode=17)) as child:
                status = repeat.main(archive, root / 'result', execute=True)
            self.assertEqual(status, 1)
            self.assertEqual(child.call_count, 4)
            manifest = json.loads((root / 'result/manifest.json').read_text())
            self.assertEqual([r['seed'] for r in manifest['runs']], [2, 1, 3, 4])
            self.assertEqual(manifest['status'], 'finished-with-failures')
            self.assertTrue(all(r['exitCode'] == 17 and r['status'] == 'failed' for r in manifest['runs']))

    def test_spawn_and_malformed_evidence_failures_do_not_stop_queue(self):
        for failure in ['spawn', 'completion', 'snapshot', 'csv']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); archive = root / 'archive.zip'
                with zipfile.ZipFile(archive, 'w') as z:
                    z.writestr('manifest.json', '[]')
                launched = []
                def child(command, **kwargs):
                    seed = int(command[command.index('--seed') + 1]); launched.append(seed)
                    if failure == 'spawn':
                        raise OSError('launch failed')
                    dest = Path(command[command.index('--out') + 1]); dest.mkdir()
                    if failure == 'completion':
                        (dest / 'completion.json').write_text('{broken')
                    else:
                        completion = {'finalEpoch': 16384, 'thresholdCrossingEpoch': None}
                        (dest / 'completion.json').write_text(json.dumps(completion))
                        epochs = list(range(1, 16385, 64)) + [16384]
                        if failure == 'csv': epochs[-1] = epochs[-2]
                        (dest / 'log.csv').write_text(','.join(repeat.CSV_FIELDS) + '\n' + ''.join(f'{e},100,131072,0.5,10,0.1,1,1\n' for e in epochs))
                    return SimpleNamespace(returncode=0)
                with patch.object(repeat, 'ARCHIVE_SHA256', repeat.sha(archive)), patch.object(repeat.subprocess, 'run', side_effect=child):
                    self.assertEqual(repeat.main(archive, root / 'result', execute=True), 1)
                manifest = json.loads((root / 'result/manifest.json').read_text())
                self.assertEqual(launched, [2, 1, 3, 4])
                self.assertEqual(manifest['status'], 'finished-with-failures')
                self.assertTrue(all(r['status'] == 'failed' and r.get('error') and r.get('finished') for r in manifest['runs']))

    def test_protocol_requires_terminal_census_precrossing_and_independent_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            completion = {'finalEpoch': 16384, 'thresholdCrossingEpoch': 65}
            epochs = list(range(1, 16385, 64)) + [16384]
            def log(values):
                (dest / 'log.csv').write_text(','.join(repeat.CSV_FIELDS) + '\n' + ''.join(f'{e},100,131072,{0.5 if e < 65 else 1.5},10,0.1,1,1\n' for e in values))
            log(epochs)
            (dest / 'transition.json').write_text(json.dumps({'epoch': 65, 'observedInInvocation': True}))
            for name in ['soup-4096.bin', 'soup-8192.bin', 'soup-12288.bin', 'soup-16384.bin', 'soup-65-transition.bin', 'soup-1-pre-transition.bin']:
                with (dest / name).open('wb') as f: f.truncate(131072 * 64)
            repeat.validate_protocol(dest, 1, completion)
            with self.assertRaisesRegex(ValueError, 'post-crossing window'):
                repeat.validate_protocol(dest, 2, completion)
            log(epochs[:-1])
            with self.assertRaisesRegex(ValueError, 'census schedule'):
                repeat.validate_protocol(dest, 1, completion)
            log(epochs)
            (dest / 'soup-1-pre-transition.bin').unlink()
            with self.assertRaises(FileNotFoundError): repeat.validate_protocol(dest, 1, completion)
            with self.assertRaisesRegex(ValueError, 'epoch cap'):
                repeat.validate_protocol(dest, 3, {'finalEpoch': 1089, 'thresholdCrossingEpoch': 65})

    def test_assay_receipt_must_identify_measured_bytes_and_encoder(self):
        with tempfile.TemporaryDirectory() as tmp:
            snapshot = Path(tmp) / 'soup-1.bin'; snapshot.write_bytes(bytes(64))
            receipt = {'sha256': repeat.sha(snapshot), 'bytes': 64, 'num': 1, 'lang': 'noheads', 'compressor': {'implementation': 'test'}}
            repeat.validate_receipt(snapshot, json.dumps(receipt), {'implementation': 'test'})
            receipt['sha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'invalid assay receipt'):
                repeat.validate_receipt(snapshot, json.dumps(receipt), {'implementation': 'test'})

    def test_success_and_invalid_evidence_statuses(self):
        for variant, expected in [('valid', 0), ('initial', 2), ('counts', 1), ('receipt', 1), ('encoder', 1), ('receipt-exit', 1), ('receipt-timeout', 1), ('timeout', 1)]:
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); archive = root / 'archive.zip'
                init = json.dumps([{'seed': seed, 'sha256': 'initial'} for seed in [1, 2, 3, 4]]).encode()
                import hashlib
                with zipfile.ZipFile(archive, 'w') as z:
                    z.writestr('initial.json', init)
                    z.writestr('manifest.json', json.dumps([{'source': '/initial-state-hashes.json', 'member': 'initial.json', 'sha256': hashlib.sha256(init).hexdigest()}]))
                def child(command, **kwargs):
                    if '--seed' in command:
                        if variant == 'timeout':
                            raise repeat.subprocess.TimeoutExpired(command, kwargs['timeout'])
                        seed = int(command[command.index('--seed') + 1])
                        dest = Path(command[command.index('--out') + 1]); dest.mkdir()
                        epoch = 12609 if seed == 2 else 16384
                        snapshot = dest / f'soup-{epoch}.bin'; snapshot.write_bytes(bytes(64))
                        (dest / 'invocation.json').write_text(json.dumps({'startingStateSha256': 'wrong' if variant == 'initial' else 'initial', 'compressor': {'implementation': 'test'}}))
                        (dest / 'completion.json').write_text(json.dumps({'finalEpoch': epoch, 'thresholdCrossingEpoch': None, 'finalStateSha256': repeat.sha(snapshot), 'gpuIntegrity': {'checkedEpochs': epoch, 'completedPairs': epoch * 65536 if variant != 'counts' else 0}}))
                        return SimpleNamespace(returncode=0)
                    if variant == 'receipt-timeout':
                        raise repeat.subprocess.TimeoutExpired(command, kwargs['timeout'])
                    if variant == 'receipt-exit':
                        return SimpleNamespace(returncode=3, stdout='partial', stderr='failed assay')
                    snapshot = Path(command[-1])
                    receipt = {'sha256': repeat.sha(snapshot), 'bytes': 64, 'num': 1, 'lang': 'noheads', 'compressor': {'implementation': 'test'}}
                    if variant == 'receipt': receipt['sha256'] = 'bad'
                    if variant == 'encoder': receipt['compressor']['implementation'] = 'changed'
                    return SimpleNamespace(returncode=0, stdout=json.dumps(receipt))
                comparison = {'checkpoints': [], 'missingHistoricalCheckpointsWithinRun': [], 'series': {'differences': [], 'missingRepeatRowsWithinRun': []}}
                with patch.object(repeat, 'ARCHIVE_SHA256', repeat.sha(archive)), patch.object(repeat.subprocess, 'run', side_effect=child), patch.object(repeat, 'validate_protocol'), patch.object(repeat, 'compare', return_value=comparison):
                    self.assertEqual(repeat.main(archive, root / 'result', execute=True), expected)
                manifest = json.loads((root / 'result/manifest.json').read_text())
                self.assertEqual(len(manifest['runs']), 4)
                if variant in ('receipt-exit', 'receipt-timeout'):
                    self.assertTrue(all(r['status'] == 'failed' for r in manifest['runs']))
                self.assertTrue(all(r.get('finished') and r['status'] != 'running' for r in manifest['runs']))

    def test_malformed_census_and_contradictory_crossing_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            epochs = list(range(1, 16385, 64)) + [16384]
            completion = {'finalEpoch': 16384, 'thresholdCrossingEpoch': None}
            for variant in ['terminal', 'nan', 'crossing']:
                with self.subTest(variant=variant):
                    lines = [f'{e},100,131072,0.5,10,0.1,1,1' for e in epochs]
                    if variant == 'terminal': lines[-1] = '16384'
                    if variant == 'nan': lines[-1] = '16384,100,131072,nan,10,0.1,1,1'
                    if variant == 'crossing': lines[-1] = '16384,100,131072,1.000001,10,0.1,1,1'
                    (dest / 'log.csv').write_text(','.join(repeat.CSV_FIELDS) + '\n' + '\n'.join(lines) + '\n')
                    with self.assertRaises(ValueError): repeat.validate_protocol(dest, 1, completion)
