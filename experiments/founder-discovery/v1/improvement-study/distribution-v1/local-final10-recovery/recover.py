#!/usr/bin/env python3
"""One-off CPU recovery. Root must review this file and supply its evidence pins."""
import argparse, datetime, hashlib, json, os, signal, subprocess, sys, time
from pathlib import Path
ROOT = Path('/Users/nicholas/develop/browser-life-founder-policy')
BASE = ROOT / 'experiments/founder-discovery/v1/improvement-study/distribution-v1'
OPS = BASE / 'importer-operations'
DEST = ROOT / 'runs/founder-discovery-improvement-consolidated-v1'
STAGE = ROOT / 'runs/founder-discovery-import-staging/local-final10'
MANIFEST = BASE.parent / 'manifest.json'
ALLOCATION = BASE / 'allocation.json'
LEDGER = BASE / 'budget-successor-v1/ledger.json'
INVENTORY = BASE / 'inventory-local-final10.json'
IMPORTER = ROOT / 'tools/discovery_improvement_import.ts'

def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        while b:=f.read(1024*1024): h.update(b)
    return h.hexdigest()
def read(p): return json.loads(p.read_text())
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def safe(p):
    for a in [p,*p.parents]:
        if a.is_symlink(): raise RuntimeError('symlink forbidden: '+str(a))
def record(p,v):
    with p.open('x') as f: json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def inventory_tree(p):
    result={}
    for x in sorted(p.rglob('*')):
        safe(x)
        if x.is_file(): result[str(x.relative_to(p))]=digest(x)
        elif not x.is_dir(): raise RuntimeError('foreign quarantine entry')
    return result

def worker(args):
    fs=os.statvfs(DEST)
    if fs.f_bavail*fs.f_frsize < 20*1024**3: raise RuntimeError('20GiB storage floor unavailable')
    for p,h in [(LEDGER,args.ledger_sha),(INVENTORY,args.inventory_sha),(IMPORTER,args.importer_sha)]:
        safe(p)
        if digest(p)!=h: raise RuntimeError('pinned input drift: '+str(p))
    check='import {verifySuccessorLedger} from "./tools/discovery_improvement_budget.ts"; import {sha256} from "./tools/lib/founder-policy.ts"; const ab=await Deno.readFile(Deno.args[0]); console.log(JSON.stringify(await verifySuccessorLedger(JSON.parse(new TextDecoder().decode(ab)),sha256(ab),JSON.parse(await Deno.readTextFile(Deno.args[1])))));'
    subprocess.run(['deno','eval','--no-lock',check,str(ALLOCATION),str(LEDGER)],cwd=ROOT,check=True)
    recovery=Path(args.recovery); recovery.mkdir(exist_ok=True)
    if args.operation==15:
        try: os.kill(82697,0)
        except ProcessLookupError: pass
        else: raise RuntimeError('old importer PID82697 still exists')
        references=[str(p) for p in (DEST/'provenance').glob('*.json') if read(p).get('inventorySha256')==args.inventory_sha]
        if references: raise RuntimeError('full10 inventory already referenced; root decision required')
        events=[]; stale=DEST/'IMPORT_RUNNING'
        def journal(event):
            with (recovery/'quarantine-journal.jsonl').open('a') as f:
                f.write(json.dumps(event)+'\n');f.flush();os.fsync(f.fileno())
        journal({'kind':'preflight','pid82697Absent':True,'full10References':references})
        if stale.exists():
            safe(stale); original=read(stale); pid=original.get('pid')
            if pid!=82697: raise RuntimeError('unexpected stale lock PID')
            try: os.kill(pid,0)
            except ProcessLookupError: pass
            else: raise RuntimeError('old importer remains alive')
            h=digest(stale); target=recovery/'stale-IMPORT_RUNNING'
            if target.exists(): raise RuntimeError('stale quarantine target exists')
            journal({'kind':'planned-stale-lock','sha256':h,'target':str(target)});stale.rename(target)
            if digest(target)!=h: raise RuntimeError('stale lock relocation drift')
            events.append({'kind':'stale-lock','pidAbsent':pid,'sha256':h,'target':str(target)});journal(events[-1])
        for orphan in sorted((DEST/'histories').glob('.import-*')):
            safe(orphan);before=inventory_tree(orphan);target=recovery/orphan.name
            if target.exists(): raise RuntimeError('quarantine target exists')
            journal({'kind':'planned-orphan','source':str(orphan),'target':str(target),'files':before});orphan.rename(target)
            if inventory_tree(target)!=before: raise RuntimeError('orphan relocation drift')
            events.append({'kind':'orphan','source':str(orphan),'target':str(target),'files':before});journal(events[-1])
        raw_inventory=DEST/'inventories'/f'{args.inventory_sha}.json'
        references=[str(p) for p in (DEST/'provenance').glob('*.json') if read(p).get('inventorySha256')==args.inventory_sha]
        events.append({'kind':'full10-inventory-check','inventoryPresent':raw_inventory.exists(),'provenanceReferences':references,'sha256':args.inventory_sha})
        if raw_inventory.exists():
            if digest(raw_inventory)!=args.inventory_sha: raise RuntimeError('full10 inventory drift')
            for p in (DEST/'provenance').glob('*.json'):
                if read(p).get('inventorySha256')==args.inventory_sha: raise RuntimeError('full10 inventory already referenced; root decision required')
            target=recovery/'unreferenced-full10-inventory.json'
            if target.exists(): raise RuntimeError('inventory quarantine target exists')
            journal({'kind':'planned-inventory','sha256':args.inventory_sha,'target':str(target)});raw_inventory.rename(target)
            if digest(target)!=args.inventory_sha: raise RuntimeError('inventory relocation drift')
            events.append({'kind':'unreferenced-inventory','sha256':args.inventory_sha,'target':str(target)});journal(events[-1])
        record(recovery/'quarantine-evidence.json',{'observedAt':now(),'events':events})
    inv=read(INVENTORY)
    if len(inv['units'])!=10 or len({u['id'] for u in inv['units']})!=10: raise RuntimeError('original unit roster drift')
    offset=(args.operation-15)*2; subset=dict(inv); subset['units']=inv['units'][offset:offset+2]
    batch=recovery/f'batch-{args.operation}'; batch.mkdir()
    for unit in subset['units']:
        if len(unit['files'])!=33: raise RuntimeError('expected canonical33 files')
        target=batch/'histories'/unit['id'];target.mkdir(parents=True)
        for name,h in unit['files'].items():
            if Path(name).name!=name: raise RuntimeError('foreign canonical path')
            source=STAGE/'histories'/unit['id']/name;safe(source)
            if digest(source)!=h: raise RuntimeError('preserved stage drift')
            os.link(source,target/name)
    subset_path=recovery/f'inventory-{args.operation}.json';record(subset_path,subset)
    subprocess.run(['deno','run','--no-lock','-A',str(IMPORTER),'import',str(MANIFEST),str(ALLOCATION),str(subset_path),str(batch),str(DEST)],cwd=ROOT,check=True)
    h=digest(subset_path);preserved=DEST/'inventories'/f'{h}.json'
    if preserved.exists():
        if digest(preserved)!=h: raise RuntimeError('subset inventory conflict')
    else: os.link(subset_path,preserved)
    record(recovery/f'batch-{args.operation}-complete.json',{'operation':args.operation,'inventorySha256':h,'units':[u['id'] for u in subset['units']],'finishedAt':now()})

def main():
    p=argparse.ArgumentParser();p.add_argument('--ledger-sha',required=True);p.add_argument('--inventory-sha',required=True);p.add_argument('--importer-sha',required=True);p.add_argument('--recovery',required=True);p.add_argument('--helper-sha',required=True);p.add_argument('--operation',type=int);args=p.parse_args()
    os.chdir(ROOT)
    if digest(Path(__file__).resolve())!=args.helper_sha: raise RuntimeError('reviewed helper source drift')
    def terminate(signum,frame): raise KeyboardInterrupt('root requested termination')
    signal.signal(signal.SIGTERM,terminate)
    if args.operation: return worker(args)
    recovery=Path(args.recovery).resolve();safe(recovery)
    if recovery.exists(): raise RuntimeError('fresh recovery directory required')
    for operation in range(15,20):
        prior=sorted(OPS.glob('*.json'))
        if len(prior)!=operation-1: raise RuntimeError('unexpected CPU prefix count')
        charged=0
        for i,path in enumerate(prior,1):
            safe(path);r=read(path)
            if not path.name.startswith(f'{i:03}-') or r['status'] not in ('settled','reserved','failed') or not isinstance(r['chargedSeconds'],(int,float)) or not __import__('math').isfinite(r['chargedSeconds']) or r['chargedSeconds']<0: raise RuntimeError('invalid CPU prefix')
            if i<=14:
                if digest(path)!=read(LEDGER)['payload']['cpu']['operationFiles'].get(path.name): raise RuntimeError('original CPU prefix bytes drift')
            elif r.get('releaseSha256')!=args.ledger_sha or r['status']!='settled': raise RuntimeError('prior recovery incomplete/foreign')
            if r['status']!='settled' and r['chargedSeconds']!=600: raise RuntimeError('failed CPU reserve discounted')
            charged+=r['chargedSeconds']
        if charged+600>13600: raise RuntimeError('successor CPU reserve exhausted')
        receipt=OPS/f'{operation:03}-local-final10-recovery-batch.json'
        value={'operation':'reviewed-successor-final10-two-unit-recovery','status':'reserved','chargedSeconds':600,'startedAt':now(),'releaseSha256':args.ledger_sha,'originalImporterSha256':args.importer_sha,'originalInventorySha256':args.inventory_sha,'helperSha256':args.helper_sha}
        started=time.monotonic();record(receipt,value)
        command=[sys.executable,str(Path(__file__).resolve()),'--ledger-sha',args.ledger_sha,'--inventory-sha',args.inventory_sha,'--importer-sha',args.importer_sha,'--recovery',str(recovery),'--helper-sha',args.helper_sha,'--operation',str(operation)]
        child=None
        try:
            if digest(Path(__file__).resolve())!=args.helper_sha: raise RuntimeError('helper changed before child launch')
            child=subprocess.Popen(command,cwd=ROOT,start_new_session=True)
            if child.wait(timeout=570): raise RuntimeError('recovery batch failed; full600 reservation retained')
        except BaseException as error:
            if child is not None and child.poll() is None:
                os.killpg(child.pid,signal.SIGTERM)
                try: child.wait(timeout=10)
                except subprocess.TimeoutExpired: os.killpg(child.pid,signal.SIGKILL);child.wait()
            value.update(status='failed',chargedSeconds=600,finishedAt=now(),error=str(error))
            failed=receipt.with_suffix('.failure');record(failed,value);failed.replace(receipt)
            raise
        value.update(status='settled',chargedSeconds=time.monotonic()-started+1,finishedAt=now())
        temp=receipt.with_suffix('.settlement');record(temp,value);temp.replace(receipt)
if __name__=='__main__': main()
