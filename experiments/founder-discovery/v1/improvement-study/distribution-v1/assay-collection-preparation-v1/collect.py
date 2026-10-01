"""Root-reviewed post-completion collection only; never runs assays.
Usage: collect.py APPROVAL_JSON
Approval pins self, release, candidate, importer, ledger, closure attestation,
CPU prefix receipts; provides hostId, operationNumber, source, destination,
newReceipt, remote(bool). Root supplies actual terminal closure assertions.
"""
import hashlib,json,os,pathlib,signal,subprocess,sys,time,tarfile,shutil,math
if sys.flags.optimize:raise RuntimeError("Python optimization forbidden")
R=pathlib.Path('/Users/nicholas/develop/browser-life-founder-policy');os.chdir(R)
B=R/'experiments/founder-discovery/v1/improvement-study/distribution-v1'
def h(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def j(p):return json.loads(pathlib.Path(p).read_text())
def atomic(p,v,new=False):
 p=pathlib.Path(p);t=p.with_name(p.name+'.tmp-'+str(os.getpid()))
 with t.open('x') as f:json.dump(v,f,indent=2);f.flush();os.fsync(f.fileno())
 if new:
  try:os.link(t,p)
  finally:t.unlink()
 else:os.replace(t,p)
def safe(p):
 for q in [pathlib.Path(p)]+list(pathlib.Path(p).parents):
  if q.is_symlink():raise RuntimeError('symlink '+str(q))
def stop(child):
 signal.setitimer(signal.ITIMER_REAL,0)
 for sig in [signal.SIGTERM,signal.SIGKILL]:
  try:os.killpg(child.pid,sig)
  except ProcessLookupError:pass
  if sig==signal.SIGTERM:
   try:child.wait(timeout=10)
   except subprocess.TimeoutExpired:pass
 child.wait()
def interrupted(*_):raise KeyboardInterrupt()
signal.signal(signal.SIGTERM,interrupted)
a=j(sys.argv[1]);approvalHash=h(sys.argv[1])
assert a['format']=='discovery-improvement-assay-collection-approval/v1'
assert h(__file__)==a['helperSha256']
required={a['release'],a['attestation'],'tools/discovery_improvement_assay_import.ts','experiments/founder-discovery/v1/improvement-study/distribution-v1/budget-successor-v1/ledger.json'}
assert required<=set(a['pins'])
for p,w in a['pins'].items():safe(R/p);assert h(R/p)==w,p
ops=B/'importer-operations';actual={p.name:h(p) for p in sorted(ops.glob('*.json'))}
assert actual==a['priorOperations'],'CPU prefix drift'
assert a['operationNumber']==len(actual)+1 and set(int(x[:3]) for x in actual)==set(range(1,len(actual)+1))
snapshot=R/'experiments/founder-discovery/v1/improvement-study/distribution-v1/budget-successor-v1/cpu-prior-operations'
ledgerData=j(B/'budget-successor-v1/ledger.json');snapshot=R/ledgerData['payload']['cpu']['snapshotDirectory']
charge=0
for name,sha in actual.items():
 row=j(ops/name);amount=row['chargedSeconds']
 assert isinstance(amount,(int,float)) and math.isfinite(amount) and amount>=0
 assert row['status'] in ['settled','failed','reserved']
 if row['status']=='reserved':assert int(name[:3]) in [8,11,12] and amount==600 and h(snapshot/name)==sha
 charge+=amount
assert charge+600<=13600
release=R/a['release'];releaseData=j(release);assert releaseData['status']=='RELEASED'
assert releaseData['candidatePath'] in a['pins'] and a['pins'][releaseData['candidatePath']]==releaseData['candidateSha256']
candidate=j(R/releaseData['candidatePath']);host=next(x for x in candidate['hosts'] if x['id']==a['hostId'])
att=R/a['attestation'];closure=j(att);source=pathlib.Path(a['source']).resolve();destination=pathlib.Path(a['destination']).resolve()
assert closure['hostId']==host['id'] and closure['originalRoot']==host['root'] and closure['originalOutputRel']==host['outputRel']
assert closure['releaseSha256']==h(release) and closure['stagedSource']==str(source)
assert closure['osAssertions']=={'originalSupervisorAbsent':True,'originalWorkerAbsent':True}
assert not source.exists() if a['remote'] else source.is_dir()
assert source!=destination and not source.is_relative_to(destination) and not destination.is_relative_to(source)
assert not pathlib.Path(a['newReceipt']).exists()
safe(source);safe(destination);assert shutil.disk_usage(destination).free>=20*1024**3
receipt=ops/('%03d-assay-collection-%s.json'%(a['operationNumber'],host['id']))
v={'status':'reserved','chargedSeconds':600,'releaseSha256':h(B/'budget-successor-v1/ledger.json'),'approvalSha256':approvalHash,'helperSha256':h(__file__),'hostId':host['id'],'startedAt':time.time()}
atomic(receipt,v,True);start=time.monotonic()
signal.signal(signal.SIGALRM,interrupted);signal.setitimer(signal.ITIMER_REAL,570)
def run(cmd,**kw):
 remaining=570-(time.monotonic()-start)
 if remaining<=0:raise TimeoutError('operation deadline before launch')
 child=subprocess.Popen(cmd,start_new_session=True,**kw)
 try:
  remaining=570-(time.monotonic()-start)
  if remaining<=0:raise TimeoutError('operation deadline')
  out,err=child.communicate(timeout=remaining)
  if child.returncode:raise RuntimeError((err or b'').decode() or 'child failed')
  return out
 except BaseException:stop(child);raise
try:
 if a['remote']:
  ssh=['ssh','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-i','/Users/nicholas/.ssh/id_ed25519','180471@192.168.1.19']
  # Remote only reads canonical pinned files. No remote staging or writes.
  code="""import pathlib,hashlib,tarfile,sys
root=pathlib.Path(ROOT);files=FILES
for ancestor in [root]+list(root.parents):
 if ancestor.is_symlink():raise RuntimeError('source symlink')
for rel,w in files.items():
 p=root/rel
 for q in [p]+list(p.parents):
  if q.is_symlink():raise RuntimeError('file symlink')
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=w:raise RuntimeError('source drift')
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz') as tar:
 for rel in files:tar.add(root/rel,arcname=rel,recursive=False)
for rel,w in files.items():
 if hashlib.sha256((root/rel).read_bytes()).hexdigest()!=w:raise RuntimeError('source changed')
""".replace('ROOT',repr(str(pathlib.Path(host['root'])/host['outputRel']))).replace('FILES',repr(closure['sourceFiles']))
  source.parent.mkdir(parents=True,exist_ok=True);safe(source.parent)
  archive=source.with_name(source.name+'.tar.gz');safe(archive)
  archiveOut=archive.open('xb')
  remaining=570-(time.monotonic()-start)
  if remaining<=0:raise TimeoutError('operation deadline before remote launch')
  child=subprocess.Popen(ssh+['/usr/bin/python3 -'],stdin=subprocess.PIPE,stdout=archiveOut,stderr=subprocess.PIPE,start_new_session=True)
  try:
   _,err=child.communicate(code.encode(),timeout=max(1,570-(time.monotonic()-start)))
   if child.returncode:raise RuntimeError(err.decode())
  except BaseException:stop(child);raise
  finally:archiveOut.close()
  source.mkdir()
  with tarfile.open(archive,'r:gz') as tar:
   members=tar.getmembers();assert len(members)==len(closure['sourceFiles']) and set(x.name for x in members)==set(closure['sourceFiles'])
   for x in members:
    p=pathlib.PurePosixPath(x.name);assert x.isfile() and not p.is_absolute() and '..' not in p.parts
   for x in members:
    assert shutil.disk_usage(source).free>=20*1024**3+x.size
    p=source/x.name;p.parent.mkdir(parents=True,exist_ok=True)
    with tar.extractfile(x) as f,p.open('xb') as out:shutil.copyfileobj(f,out)
 for rel,w in closure['sourceFiles'].items():safe(source/rel);assert h(source/rel)==w
 for p,w in a['pins'].items():assert h(R/p)==w
 run(['/opt/homebrew/bin/deno','run','--no-lock','-A','tools/discovery_improvement_assay_import.ts',str(release),host['id'],str(source),str(att),str(destination),a['newReceipt']],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 for p,w in a['pins'].items():assert h(R/p)==w
 for rel,w in closure['sourceFiles'].items():assert h(source/rel)==w
 v.update(status='settled',chargedSeconds=time.monotonic()-start+1,finishedAt=time.time(),importReceiptSha256=h(a['newReceipt']))
except BaseException as e:v.update(status='failed',chargedSeconds=600,finishedAt=time.time(),error=str(e));raise
finally:
 signal.setitimer(signal.ITIMER_REAL,0)
 atomic(receipt,v)
