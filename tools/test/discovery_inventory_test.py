import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('inventory', pathlib.Path(__file__).parents[1] / 'discovery_inventory.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class InventoryTests(unittest.TestCase):
    def row(self, regen=0, light=4, weight=-1):
        return {'genome': {'mu':60,'sigma':20,'motGain':0,'weights':[weight]*160},
                'eval': {'reps':4,'survived':4,'regenerated':regen,'lightDependent':light}}

    def test_signed_bytes_and_repeated_observations(self):
        a,b=self.row(),self.row(4,weight=255)
        self.assertEqual(m.genome_key(a['genome']),m.genome_key(b['genome']))
        out=m.summarize({'evaluated':2},[a,b],{'gate.json':json.dumps([b]).encode()})
        self.assertEqual(out['unique_genomes'],1)
        self.assertEqual(out['unique_survivors_never_old_gate_eligible'],0)
        self.assertEqual(out['gate_missing_eligible'],0)
        self.assertIsNone(out['unique_admitted_to_confirmation'])

    def test_overlapping_failures_not_invented_downstream_results(self):
        r=self.row(light=0)
        self.assertEqual(m.failures(r['eval']),['regeneration','light_dependence'])
        out=m.summarize({'evaluated':1},[r],{'gate.json':b'[]'})
        self.assertEqual(out['unique_survivors_never_old_gate_eligible'],1)
        self.assertFalse(out['confirmation_present'])

    def test_only_committed_prefix_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=pathlib.Path(tmp)
            (p/'archive.json').write_text(json.dumps({'viableCount':1}))
            line=json.dumps(self.row())+'\n'
            (p/'viable.jsonl').write_text(line+'uncommitted garbage')
            _,rows,files=m.read_bundle(p)
            self.assertEqual(len(rows),1)
            self.assertEqual(files['viable.jsonl'],line.encode())
            (p/'archive.json').write_text(json.dumps({'viableCount':2}))
            with self.assertRaises(ValueError):m.read_bundle(p)

if __name__=='__main__': unittest.main()
