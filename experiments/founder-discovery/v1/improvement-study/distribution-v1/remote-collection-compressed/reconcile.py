#!/usr/bin/env python3
"""One-off reviewed CPU reconciliation, after all collection operations close."""
import argparse, hashlib, json, math, os, signal, subprocess, sys, time
from pathlib import Path
ROOT=Path('/Users/nicholas/develop/browser-life-founder-policy')
BASE=ROOT/'experiments/founder-discovery/v1/improvement-study/distribution-v1'
OPS=BASE/'importer-operations';LEDGER=BASE/'budget-successor-v1/ledger.json'
MANIFEST=BASE.parent/'manifest.json';ALLOCATION=BASE/'allocation.json'
DEST=ROOT/'runs/founder-discovery-improvement-consolidated-v1'
VERIFIER=ROOT/'tools/discovery_improvement_reconcile.ts'
VERIFIER_SHA='99b8bb09dab4eebb6890454f58038b81213ab99106cae6ab3ed11753498d6874'
LEDGER_SHA='c42017cfaee39d9fe414fbd1d7673f6f6041c57da2d46f193d1f6f845a70285e'
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
 for path,h in [(Path(__file__),args.helper_sha),(VERIFIER,VERIFIER_SHA),(LEDGER,LEDGER_SHA),(ALLOCATION,'dd235c06811583e4f37d6682572f16b156a49b44a3aec787a5f52e0edbebaa6f'),(MANIFEST,'4d7d8bd03e7842d1af2476a8b06ea33892d029d84bdb5a2d2e15e3c1e257dda5')]:
  safe(path)
  if digest(path)!=h:raise RuntimeError('reviewed input/source drift')
 for lock in ['RUNNING','SHARD_RUNNING','SHARD_SUPERVISOR','IMPORT_RUNNING','ASSAY_IMPORT_RUNNING']:
  if (DEST/lock).exists():raise RuntimeError('collection active/stale lock')
 units=[u['id'] for u in read(MANIFEST)['units']];entries=list((DEST/'histories').iterdir())
 if len(units)!=64 or sorted(x.name for x in entries)!=sorted(units) or any(not x.is_dir() or x.is_symlink() for x in entries):raise RuntimeError('exact64 history directories required')
 prior=sorted(OPS.glob('*.json'))
 if len(prior)!=34:raise RuntimeError('exact001034 completed operation prefix required')
 pins={};charged=0;ledger=read(LEDGER)
 for index,path in enumerate(prior,1):
  safe(path);r=read(path)
  if not path.name.startswith(f'{index:03}-') or r['status'] not in ['settled','reserved','failed'] or not math.isfinite(r['chargedSeconds']) or r['chargedSeconds']<0 or (r['status']!='settled' and r['chargedSeconds']!=600):raise RuntimeError('CPU charge prefix invalid')
  if index<=14:
   if digest(path)!=ledger['payload']['cpu']['operationFiles'].get(path.name):raise RuntimeError('frozen CPU prefix drift')
  elif r.get('releaseSha256')!=LEDGER_SHA or r['status']!='settled':raise RuntimeError('recovery/collection not settled')
  pins[path.name]=digest(path);charged+=r['chargedSeconds']
 if charged+600>13600:raise RuntimeError('CPU reserve exhausted')
 fs=os.statvfs(DEST)
 if fs.f_bavail*fs.f_frsize<20*1024**3:raise RuntimeError('20GiB floor unavailable')
 out=BASE/'reconciliation-v1';safe(out)
 if out.exists():raise RuntimeError('new reconciliation output directory required')
 receipt=OPS/'035-global-history-reconciliation.json';value={'operation':'original-full64-history-reconciliation','status':'reserved','chargedSeconds':600,'releaseSha256':LEDGER_SHA,'helperSha256':args.helper_sha,'verifierSha256':VERIFIER_SHA,'priorReceiptPins':pins,'startedAt':time.time()};record(receipt,value);started=time.monotonic();child=None
 try:
  out.mkdir();report=out/'readiness.json';roster=out/'assay-roster.json'
  command=['deno','run','--no-lock','-A',str(VERIFIER),str(MANIFEST),str(ALLOCATION),str(DEST),str(report),str(roster)]
  child=subprocess.Popen(command,cwd=ROOT,start_new_session=True)
  if child.wait(timeout=570):raise RuntimeError('original reconciliation failed')
  result=read(report)
  if result.get('physicalComplete') is not True or len(result.get('slots',[]))!=64 or any(s['status']!='complete' for s in result['slots']) or result.get('unexpected') or not roster.is_file() or digest(roster)!=result.get('rosterSha256'):raise RuntimeError('reconciliation incomplete; assay readiness not established')
  for name,h in pins.items():
   if digest(OPS/name)!=h:raise RuntimeError('CPU prefix changed during reconciliation')
  value.update(status='settled',chargedSeconds=time.monotonic()-started+1,finishedAt=time.time(),reportSha256=digest(report),rosterSha256=digest(roster))
 except BaseException as error:
  if child is not None:
   try:os.killpg(child.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:child.wait(timeout=10)
   except subprocess.TimeoutExpired:pass
   try:os.killpg(child.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   child.wait()
  value.update(status='failed',chargedSeconds=600,finishedAt=time.time(),error=str(error));temporary=receipt.with_suffix('.failure');record(temporary,value);temporary.replace(receipt);raise
 temporary=receipt.with_suffix('.settlement');record(temporary,value);temporary.replace(receipt)
 print('Readiness verified; this wrapper does not authorize assay execution.')
if __name__=='__main__':main()
