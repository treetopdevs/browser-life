import json, os, subprocess, tempfile, unittest
from pathlib import Path
SCRIPT = Path(__file__).resolve().parents[1] / 'discovery_improvement_shard_continue.py'

class SupervisorTest(unittest.TestCase):
    def exercise(self, outcome):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            tools = root / 'tools'; tools.mkdir()
            script = tools / SCRIPT.name; script.write_bytes(SCRIPT.read_bytes())
            (tools / 'discovery_improvement_shard.ts').write_text('fake operational worker')
            manifest = root / 'manifest.json'; manifest.write_text('{}')
            out = root / 'runs' / 'owned'; out.mkdir(parents=True)
            allocation = root / 'allocation.json'; allocation.write_text(json.dumps({'hosts':[{'id':'local','root':str(root),'outputRel':'runs/owned','capSeconds':10000,'maxInvocations':4}]}))
            deno = root / 'deno'
            deno.write_text('#!/usr/bin/env python3\nimport os,json,pathlib,sys\nr=pathlib.Path(os.environ["BL_SHARD_RESERVATION"])\nassert json.loads(r.read_text())["status"]=="reserved"\n'+('print(json.dumps({"complete":True}))\n' if outcome=='complete' else 'sys.exit(7)\n'))
            deno.chmod(0o755)
            env = dict(os.environ, PATH=str(root)+os.pathsep+os.environ['PATH'])
            run = subprocess.run(['python3',str(script),str(manifest),str(allocation),'local',str(out)],cwd=root,env=env,capture_output=True)
            receipts = list(out.glob('parent-invocation-*.json')); self.assertEqual(len(receipts),1)
            record = json.loads(receipts[0].read_text())
            self.assertEqual(record['status'],'settled' if outcome=='complete' else 'reserved')
            if outcome=='complete': self.assertEqual(run.returncode,0)
            else:
                self.assertNotEqual(run.returncode,0); self.assertEqual(record['chargedSeconds'],3600)
                second=subprocess.run(['python3',str(script),str(manifest),str(allocation),'local',str(out)],cwd=root,env=env,capture_output=True)
                self.assertNotEqual(second.returncode,0); self.assertEqual(len(list(out.glob('parent-invocation-*.json'))),1)
    def test_completed_exits_after_one_reserved_child(self): self.exercise('complete')
    def test_failure_retains_full_reservation_and_blocks_resume(self): self.exercise('failure')

if __name__=='__main__': unittest.main()
