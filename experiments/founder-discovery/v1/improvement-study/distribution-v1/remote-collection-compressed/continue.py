#!/usr/bin/env python3
"""One-off fixed14-batch continuation; reuses byte-pinned reviewed worker unchanged."""
import argparse, hashlib, importlib.util, json, math, os, signal, subprocess, sys, time
from pathlib import Path
ROOT=Path('/Users/nicholas/develop/browser-life-founder-policy')
WORKER=ROOT/'runs/remote-history-closure-capture-20261001/collect.py'
WORKER_SHA='98858967a83892de8dc3c1ea47617601bdc90648aab0b677d2007138fbf4643b'
PLAN_SHA='66768bea0a6f03e797fd9c9b6cbac23385f43b546cf4f7c22f7047853a38eea7'
STAGE=ROOT/'runs/remote-collection-compressed-20261001'
BASE=ROOT/'experiments/founder-discovery/v1/improvement-study/distribution-v1'
OPS=BASE/'importer-operations';DEST=ROOT/'runs/founder-discovery-improvement-consolidated-v1'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def safe(p):
 for a in [p,*p.parents]:
  if a.is_symlink():raise RuntimeError('symlink forbidden')
def record(p,v):
 with p.open('x') as f:json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def main():
 p=argparse.ArgumentParser();p.add_argument('--helper-sha',required=True);args=p.parse_args();os.chdir(ROOT)
 def terminate(*_):raise KeyboardInterrupt('termination requested')
 signal.signal(signal.SIGTERM,terminate)
 for path,h in [(Path(__file__),args.helper_sha),(WORKER,WORKER_SHA),(STAGE/'plan.json',PLAN_SHA)]:
  safe(path)
  if digest(path)!=h:raise RuntimeError('reviewed helper/plan drift')
 plan=read(STAGE/'plan.json');batches=plan['batches']
 if len(batches)!=15 or any(len(b)!=2 for b in batches) or len(set(x for b in batches for x in b))!=30:raise RuntimeError('fixed plan malformed')
 prior=sorted(OPS.glob('*.json'))
 if len(prior)!=20:raise RuntimeError('continuation requires exact001020 prefix')
 pins={p.name:digest(p) for p in prior};proof=read(prior[-1]);gate=read(STAGE/'throughput-gate.json');complete=read(STAGE/'batch-0/complete.json')
 if proof['status']!='settled' or proof['helperSha256']!=WORKER_SHA or proof['planSha256']!=PLAN_SHA or proof['unitIds']!=batches[0] or not gate['complete'] or gate['units']!=batches[0] or gate['elapsedSeconds']!=proof['chargedSeconds'] or complete['units']!=batches[0]:raise RuntimeError('first batch closure mismatch')
 if digest(STAGE/'batch-0/inventory.json')!=complete['inventorySha256'] or digest(STAGE/'batch-0/histories.tar.gz')!=complete['archiveSha256']:raise RuntimeError('first batch artifact drift')
 provenance=[read(p) for p in (DEST/'provenance').glob('*.json')]
 if not any(p.get('inventorySha256')==complete['inventorySha256'] and [u['id'] for u in p['units']]==batches[0] for p in provenance):raise RuntimeError('first batch provenance absent')
 for name,h in proof['priorReceiptPins'].items():
  if pins.get(name)!=h:raise RuntimeError('001019 reviewed prefix drift')
 evidence_pins={str(p):digest(p) for p in [STAGE/'throughput-gate.json',STAGE/'batch-0/complete.json']}
 ledger=BASE/'budget-successor-v1/ledger.json';ledger_sha=proof['releaseSha256'];allocation=BASE/'allocation.json';manifest=BASE.parent/'manifest.json';importer=ROOT/'tools/discovery_improvement_import.ts'
 worker_args=['--helper-sha',WORKER_SHA,'--ledger-sha',ledger_sha,'--importer-sha','6855f02b3ef9e9ca52d0e96b02f05b88ec41ea9bfa6848cab856d7d4ce9a26d7','--allocation-sha',plan['allocationSha256'],'--manifest-sha','4d7d8bd03e7842d1af2476a8b06ea33892d029d84bdb5a2d2e15e3c1e257dda5','--stage',str(STAGE)]
 for index in range(1,15):
  if (STAGE/f'batch-{index}').exists():raise RuntimeError('existing continuation stage; explicit recovery required')
  if digest(Path(__file__))!=args.helper_sha or digest(WORKER)!=WORKER_SHA or digest(STAGE/'plan.json')!=PLAN_SHA:raise RuntimeError('code/plan drift')
  for name,h in pins.items():
   if digest(OPS/name)!=h:raise RuntimeError('settled prefix drift')
  for path,h in evidence_pins.items():
   if digest(Path(path))!=h:raise RuntimeError('first batch evidence drift')
  actual=sorted(OPS.glob('*.json'))
  if len(actual)!=19+index:raise RuntimeError('operation roster drift')
  charged=0
  for position,p in enumerate(actual,1):
   safe(p);r=read(p)
   if not p.name.startswith(f'{position:03}-') or r['status'] not in ['settled','reserved','failed'] or not math.isfinite(r['chargedSeconds']) or r['chargedSeconds']<0 or (r['status']!='settled' and r['chargedSeconds']!=600):raise RuntimeError('invalid prior charge')
   if position>=15 and (r.get('releaseSha256')!=ledger_sha or r['status']!='settled'):raise RuntimeError('prior successor operation incomplete')
   charged+=r['chargedSeconds']
  if charged+600>13600:raise RuntimeError('successor CPU reserve exhausted')
  number=20+index;receipt=OPS/f'{number:03}-remote-two-history-continuation.json';value={'operation':'fixed-reviewed-remote-two-history-continuation','status':'reserved','chargedSeconds':600,'releaseSha256':ledger_sha,'helperSha256':args.helper_sha,'workerSha256':WORKER_SHA,'planSha256':PLAN_SHA,'unitIds':batches[index],'priorReceiptPins':pins,'firstBatchEvidencePins':evidence_pins,'startedAt':time.time()};record(receipt,value);started=time.monotonic();child=None
  try:
   child=subprocess.Popen([sys.executable,str(WORKER),*worker_args,'--batch',str(index)],cwd=ROOT,start_new_session=True)
   if child.wait(timeout=571):raise RuntimeError('continuation worker failed')
   if read(STAGE/f'batch-{index}/complete.json')['units']!=batches[index]:raise RuntimeError('batch commit mismatch')
   value.update(status='settled',chargedSeconds=time.monotonic()-started+1,finishedAt=time.time())
  except BaseException as error:
   if child is not None:
    try:os.killpg(child.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    try:child.wait(timeout=10)
    except subprocess.TimeoutExpired:pass
    try:os.killpg(child.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    child.wait()
   value.update(status='failed',chargedSeconds=600,error=str(error),finishedAt=time.time());temporary=receipt.with_suffix('.failure');record(temporary,value);temporary.replace(receipt);raise
  temporary=receipt.with_suffix('.settlement');record(temporary,value);temporary.replace(receipt);pins[receipt.name]=digest(receipt)
 print('Fixed remaining28 histories collected; reconciliation is separate and not authorized by this helper.')
if __name__=='__main__':main()
