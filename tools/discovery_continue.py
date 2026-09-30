"""Complete the frozen local capability roster in bounded resumable tranches.

Does not provision compute or modify the design. Stops on any runner error.
"""
import datetime
import json
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
design = json.loads((root / 'capability-design.json').read_text())
log = root / 'capability-continuation.log'
report = root / 'capability-continuation.json'
if report.exists():
    raise SystemExit('Continuation receipt already exists; inspect before restarting')
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
commands = []
with log.open('x') as output:
    for tranche in range(6):
        cmd = ['deno', 'run', '-A', '--unstable-webgpu', 'tools/discovery_capability.ts', 'run', str(root), '600']
        result = subprocess.run(cmd, stdout=output, stderr=subprocess.STDOUT)
        commands.append({'command':cmd,'exitCode':result.returncode})
        output.flush()
        if result.returncode:
            break
        if all((root/'capability-results'/f'{unit["id"]}.json').exists() for unit in design['units']):
            for ident in ('waste-3-gradient-6300001','no-candidate-gradient-6300001'):
                cmd = ['deno','run','-A','--unstable-webgpu','tools/discovery_capability_replay.ts',str(root),ident,str(root/f'replay-{ident}.json')]
                result = subprocess.run(cmd,stdout=output,stderr=subprocess.STDOUT)
                commands.append({'command':cmd,'exitCode':result.returncode})
                output.flush()
                if result.returncode:break
            if result.returncode==0:
                cmd=['deno','run','-A','tools/discovery_capability_analyze.ts',str(root),str(root/'capability-final.json')]
                result=subprocess.run(cmd,stdout=output,stderr=subprocess.STDOUT)
                commands.append({'command':cmd,'exitCode':result.returncode})
            break
receipt={'started':started,'finished':datetime.datetime.now(datetime.timezone.utc).isoformat(),'commands':commands,'paidUSD':0,'completeReportExists':(root/'capability-final.json').exists()}
report.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'completeReportExists':receipt['completeReportExists'],'commands':len(commands),'lastExitCode':commands[-1]['exitCode']}))
if commands[-1]['exitCode']:sys.exit(commands[-1]['exitCode'])
