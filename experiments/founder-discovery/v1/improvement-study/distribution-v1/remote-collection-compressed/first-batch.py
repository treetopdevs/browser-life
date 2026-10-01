#!/usr/bin/env python3
"""Reviewed one-off remote collection. Each two-history batch has a 570s watchdog."""
import argparse, hashlib, json, math, os, signal, subprocess, sys, time
from pathlib import Path
ROOT=Path('/Users/nicholas/develop/browser-life-founder-policy')
BASE=ROOT/'experiments/founder-discovery/v1/improvement-study/distribution-v1'
OPS=BASE/'importer-operations'; LEDGER=BASE/'budget-successor-v1/ledger.json'
MANIFEST=BASE.parent/'manifest.json'; ALLOCATION=BASE/'allocation.json'
IMPORTER=ROOT/'tools/discovery_improvement_import.ts'
DEST=ROOT/'runs/founder-discovery-improvement-consolidated-v1'
REMOTE='/Users/180471/bl-founder-discovery'
SSH=['ssh','-o','ConnectTimeout=10','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-i','/Users/nicholas/.ssh/id_ed25519','180471@192.168.1.19']
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def safe(p):
 for a in [p,*p.parents]:
  if a.is_symlink():raise RuntimeError('symlink forbidden')
def record(p,v):
 with p.open('x') as f:json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def call(command,**kw):return subprocess.run(command,cwd=ROOT,check=True,**kw)
def worker(args):
 for p,h in [(Path(__file__),args.helper_sha),(LEDGER,args.ledger_sha),(IMPORTER,args.importer_sha),(ALLOCATION,args.allocation_sha),(MANIFEST,args.manifest_sha)]:
  safe(p)
  if digest(p)!=h:raise RuntimeError('pinned code/input drift')
 fs=os.statvfs(DEST)
 if fs.f_bavail*fs.f_frsize<20*1024**3:raise RuntimeError('20GiB floor')
 eval_code='import {verifySuccessorLedger} from "./tools/discovery_improvement_budget.ts";import {sha256} from "./tools/lib/founder-policy.ts";const b=await Deno.readFile(Deno.args[0]);await verifySuccessorLedger(JSON.parse(new TextDecoder().decode(b)),sha256(b),JSON.parse(await Deno.readTextFile(Deno.args[1])));'
 call(['deno','eval','--no-lock',eval_code,str(ALLOCATION),str(LEDGER)])
 plan=read(Path(args.stage)/'plan.json');ids=plan['batches'][args.batch];host=next(h for h in read(ALLOCATION)['hosts'] if h['id']!='local')
 # UUID stage isolates recovery artifacts; remote export uses exact original inventory CLI.
 remote_stage=REMOTE+'/runs/'+Path(args.stage).name;remote_inventory=remote_stage+f'/inventory-{args.batch}.json'
 command=f'cd {REMOTE} && mkdir -p {remote_stage} && test "$(shasum -a 256 tools/discovery_improvement_import.ts | cut -d " " -f 1)" = "{args.importer_sha}" && /Users/180471/bin/deno run --no-lock -A tools/discovery_improvement_import.ts inventory experiments/founder-discovery/v1/improvement-study/manifest.json experiments/founder-discovery/v1/improvement-study/distribution-v1/allocation.json {host["id"]} {REMOTE}/{host["outputRel"]} {remote_inventory} '+ ' '.join(ids)
 call(SSH+[command]);batch=Path(args.stage)/f'batch-{args.batch}';batch.mkdir();inventory=batch/'inventory.json'
 with inventory.open('xb') as output:call(SSH+[f'cat {remote_inventory}'],stdout=output)
 inv=read(inventory)
 if [u['id'] for u in inv['units']]!=ids:raise RuntimeError('remote inventory roster drift')
 paths=[]
 for unit in inv['units']:
  if len(unit['files'])!=33:raise RuntimeError('canonical33 required')
  for name in unit['files']:
   if Path(name).name!=name:raise RuntimeError('foreign archive path')
   paths.append('histories/'+unit['id']+'/'+name)
 archive=batch/'histories.tar.gz'
 with archive.open('xb') as output:call(SSH+[f'cd {REMOTE}/{host["outputRel"]} && tar -czf - '+ ' '.join(paths)],stdout=output)
 import tarfile
 with tarfile.open(archive,'r:gz') as tar:
  members=tar.getmembers()
  if sorted(m.name for m in members)!=sorted(paths) or any(not m.isfile() for m in members):raise RuntimeError('archive foreign/missing entries')
  tar.extractall(batch,filter='data')
 for unit in inv['units']:
  for name,h in unit['files'].items():
   p=batch/'histories'/unit['id']/name;safe(p)
   if digest(p)!=h:raise RuntimeError('transferred canonical hash drift')
 call(['deno','run','--no-lock','-A',str(IMPORTER),'import',str(MANIFEST),str(ALLOCATION),str(inventory),str(batch),str(DEST)])
 target=DEST/'inventories'/f'{digest(inventory)}.json'
 if target.exists():
  if digest(target)!=digest(inventory):raise RuntimeError('inventory conflict')
 else:os.link(inventory,target)
 record(batch/'complete.json',{'units':ids,'inventorySha256':digest(inventory),'archiveSha256':digest(archive)})
def main():
 p=argparse.ArgumentParser()
 for name in ['helper-sha','ledger-sha','importer-sha','allocation-sha','manifest-sha','stage']:p.add_argument('--'+name,required=True)
 p.add_argument('--batch',type=int);args=p.parse_args();os.chdir(ROOT)
 if digest(Path(__file__))!=args.helper_sha:raise RuntimeError('reviewed helper drift')
 def terminate(*_):raise KeyboardInterrupt('termination requested')
 signal.signal(signal.SIGTERM,terminate)
 if args.batch is not None:return worker(args)
 stage=Path(args.stage).resolve();safe(stage)
 if stage.exists():raise RuntimeError('fresh stage required; no automatic resume')
 if not stage.exists():
  stage.mkdir();a=read(ALLOCATION);host=next(h for h in a['hosts'] if h['id']!='local');existing=set()
  for receipt in (DEST/'provenance').glob('*.json'):
   value=read(receipt)
   if value.get('hostId')==host['id']:existing.update(u['id'] for u in value['units'])
  ids=[id for id in host['unitIds'] if id not in existing]
  if len(ids)!=30:raise RuntimeError('expected exactly30 remaining remote units')
  record(stage/'plan.json',{'batches':[ids[i:i+2] for i in range(0,len(ids),2)],'allocationSha256':args.allocation_sha})
 plan_sha=digest(stage/'plan.json');plan=read(stage/'plan.json')
 if len(plan['batches'])!=15 or any(len(b)!=2 for b in plan['batches']) or len(set(x for b in plan['batches'] for x in b))!=30:raise RuntimeError('plan roster malformed')
 prior_pins={p.name:digest(p) for p in OPS.glob('*.json')}
 if len(prior_pins)!=19:raise RuntimeError('expected exact001019 prefix')
 for index,ids in enumerate(plan['batches']):
  if index>0:print('First batch complete; separate reviewed continuation required.');return
  prior=sorted(OPS.glob('*.json'));number=len(prior)+1;charged=0
  if number<20:raise RuntimeError('operation prefix incomplete')
  for i,receipt in enumerate(prior,1):
   safe(receipt);r=read(receipt)
   if not receipt.name.startswith(f'{i:03}-') or r['status'] not in ['settled','failed','reserved'] or not math.isfinite(r['chargedSeconds']) or r['chargedSeconds']<0 or (r['status']!='settled' and r['chargedSeconds']!=600):raise RuntimeError('CPU receipt drift')
   if digest(receipt)!=prior_pins.get(receipt.name):raise RuntimeError('prior receipt snapshot drift')
   if i<=14:
    if digest(receipt)!=read(LEDGER)['payload']['cpu']['operationFiles'].get(receipt.name):raise RuntimeError('frozen CPU prefix drift')
   elif r.get('releaseSha256')!=args.ledger_sha or r['status']!='settled':raise RuntimeError('prior recovery proof drift')
   charged+=r['chargedSeconds']
  if charged+600>13600:raise RuntimeError('CPU reserve exhausted')
  for pinned_path,pinned_hash in [(Path(__file__),args.helper_sha),(LEDGER,args.ledger_sha),(IMPORTER,args.importer_sha),(ALLOCATION,args.allocation_sha),(MANIFEST,args.manifest_sha)]:
   if digest(pinned_path)!=pinned_hash:raise RuntimeError('parent input pin drift')
  if digest(stage/'plan.json')!=plan_sha:raise RuntimeError('plan changed')
  path=OPS/f'{number:03}-remote-two-history-collection.json';value={'operation':'compressed-remote-two-history-transfer-and-semantic-import','status':'reserved','chargedSeconds':600,'releaseSha256':args.ledger_sha,'helperSha256':args.helper_sha,'unitIds':ids,'planSha256':plan_sha,'priorReceiptPins':prior_pins,'startedAt':time.time()};record(path,value);started=time.monotonic();child=None
  try:
   if digest(Path(__file__))!=args.helper_sha:raise RuntimeError('helper changed')
   command=[sys.executable,str(Path(__file__).resolve())]
   for name in ['helper_sha','ledger_sha','importer_sha','allocation_sha','manifest_sha','stage']:command+=['--'+name.replace('_','-'),str(getattr(args,name))]
   command+=['--batch',str(index)];child=subprocess.Popen(command,cwd=ROOT,start_new_session=True)
   if child.wait(timeout=570):raise RuntimeError('collection batch failed')
   value.update(status='settled',chargedSeconds=time.monotonic()-started+1,finishedAt=time.time())
  except BaseException as error:
   if child is not None and child.poll() is None:
    os.killpg(child.pid,signal.SIGTERM)
    try:child.wait(timeout=10)
    except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
   if child is not None:
    try:os.killpg(child.pid,signal.SIGKILL)
    except ProcessLookupError:pass
   value.update(status='failed',chargedSeconds=600,error=str(error),finishedAt=time.time());temporary=path.with_suffix('.failure');record(temporary,value);temporary.replace(path);raise
  temporary=path.with_suffix('.settlement');record(temporary,value);temporary.replace(path)
  if index==0:record(stage/'throughput-gate.json',{'elapsedSeconds':value['chargedSeconds'],'units':ids,'complete':True})
if __name__=='__main__':main()
