"""CPU-only original analysis, operation042; root completes approval after041.
Usage: PYTHONDONTWRITEBYTECODE=1 python3 analyze.py APPROVAL.json APPROVAL_SHA256
"""
import hashlib,json,math,os,pathlib,signal,subprocess,sys,time,shutil
if sys.flags.optimize:raise RuntimeError('Python optimization forbidden')
R=pathlib.Path('/Users/nicholas/develop/browser-life-founder-policy');os.chdir(R)
B=R/'experiments/founder-discovery/v1/improvement-study/distribution-v1';OPS=B/'importer-operations';D=R/'runs/founder-discovery-improvement-consolidated-v1'
def h(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def j(p):return json.loads(pathlib.Path(p).read_text())
def safe(p):
 for q in [pathlib.Path(p)]+list(pathlib.Path(p).parents):
  if q.is_symlink():raise RuntimeError('symlink '+str(q))
def atomic(p,v,new=False):
 t=p.with_name(p.name+'.tmp-'+str(os.getpid()))
 with t.open('x') as f:json.dump(v,f,indent=2);f.flush();os.fsync(f.fileno())
 if new:
  try:os.link(t,p)
  finally:t.unlink()
 else:os.replace(t,p)
def interrupted(*_):raise KeyboardInterrupt('operation deadline or termination')
def stop(p):
 signal.setitimer(signal.ITIMER_REAL,0)
 for sig in [signal.SIGTERM,signal.SIGKILL]:
  try:os.killpg(p.pid,sig)
  except ProcessLookupError:pass
  if sig==signal.SIGTERM:
   try:p.wait(timeout=10)
   except subprocess.TimeoutExpired:pass
 p.wait()
aPath=pathlib.Path(sys.argv[1]).resolve();safe(aPath)
assert h(aPath)==sys.argv[2];a=j(aPath)
assert a['format']=='discovery-improvement-original-analysis-approval/v1' and a['status']=='AUTHORIZED-CPU-ONLY'
assert a['reservationSeconds']==1800 and a['deadlineSeconds']==1770 and a['cpuTotalCapSeconds']==13600
assert h(__file__)==a['helperSha256']
assert a['pins'].get('tools/discovery_improvement.ts')=='33ebec938c2dbd2722773b6dc7e8525e3ae2df6726c29948dfe2b1e11f52e268'
required={'tools/discovery_improvement.ts','experiments/founder-discovery/v1/improvement-study/manifest.json','experiments/founder-discovery/v1/improvement-study/distribution-v1/budget-successor-v1/ledger.json',a['finalCollectionObservation']}
manifest=j(B.parent/'manifest.json')
required.update(manifest['sources'])
required.add('experiments/founder-discovery/v1/improvement-study/distribution-v1/assay-candidate-v1.json')
required.add('experiments/founder-discovery/v1/improvement-study/distribution-v1/assay-release-v1.json')
required.update(str(pathlib.Path(p).relative_to(manifest['sourceRoot'])) for p in manifest['inputs'])
assert required<=set(a['pins'])
for path,w in a['pins'].items():safe(R/path);assert h(R/path)==w,path
prefix={p.name:h(p) for p in sorted(OPS.glob('*.json'))}
assert prefix==a['priorOperations'] and len(prefix)==41 and set(int(n[:3]) for n in prefix)==set(range(1,42))
ledger=j(B/'budget-successor-v1/ledger.json');charge=0
for name,sha in prefix.items():
 row=j(OPS/name);amount=row['chargedSeconds'];assert isinstance(amount,(int,float)) and math.isfinite(amount) and amount>=0
 assert row['status'] in ['settled','failed','reserved']
 if row['status']=='reserved':assert int(name[:3]) in [8,11,12] and amount==600 and ledger['payload']['cpu']['operationFiles'][name]==sha
 if int(name[:3]) in [40,41]:assert row['status']=='settled'
 charge+=amount
assert charge+1800<=13600
receipt=OPS/'042-original-scientific-analysis.json';v={'status':'reserved','chargedSeconds':1800,'releaseSha256':h(B/'budget-successor-v1/ledger.json'),'approvalSha256':sys.argv[2],'helperSha256':h(__file__),'priorReceiptPins':prefix,'startedAt':time.time()};atomic(receipt,v,True)
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGALRM,interrupted);signal.setitimer(signal.ITIMER_REAL,1770);start=time.monotonic();child=None
try:
 observation=j(R/a['finalCollectionObservation']);assert observation['globalComplete'] is True and observation['globalResultCount']==1920 and observation['globalUniqueConfigurations']==1920 and set(observation['committedHosts'])=={'local','work-mac'}
 release=j(B/'assay-release-v1.json');candidate=j(B/'assay-candidate-v1.json')
 assert release['status']=='RELEASED' and release['candidateSha256']==h(B/'assay-candidate-v1.json') and observation['releaseSha256']==h(B/'assay-release-v1.json')
 assert observation['manifestHash']==candidate['manifestHash'] and observation['rosterSha256']==candidate['inputs']['roster']['sha256'] and observation['readinessSha256']==candidate['inputs']['readiness']['sha256']
 keys=sorted(k for host in candidate['hosts'] for k in host['keys']);assert len(keys)==1920 and len(set(keys))==1920
 for host in candidate['hosts']:
  commitPath=D/'assay-import-receipts'/f"{host['id']}.json";assert str(commitPath.relative_to(R)) in a['pins'];commit=j(commitPath)
  assert commit['assignedKeys']==host['keys'] and commit['releaseSha256']==observation['releaseSha256']
  for rel,w in commit['publishedFiles'].items():safe(D/rel);assert h(D/rel)==w
 assert sorted(p.name for p in (D/'assays').iterdir())==[k+'.json' for k in keys]
 for lock in ['RUNNING','SHARD_RUNNING','SHARD_SUPERVISOR','IMPORT_RUNNING','ASSAY_IMPORT_RUNNING']:
  assert not (D/lock).exists()
 assert shutil.disk_usage(D).free>=20*1024**3
 report=R/a['newReport'];safe(report);assert not report.exists();assert report.parent.is_dir()
 child=subprocess.Popen(['/opt/homebrew/bin/deno','run','--no-lock','-A','tools/discovery_improvement.ts','analyze',str(B.parent/'manifest.json'),str(D),str(report)],start_new_session=True)
 if child.wait(timeout=1770):raise RuntimeError('original analysis failed')
 for path,w in a['pins'].items():assert h(R/path)==w
 for name,w in prefix.items():assert h(OPS/name)==w
 for host in candidate['hosts']:
  commit=j(D/'assay-import-receipts'/f"{host['id']}.json")
  for rel,w in commit['publishedFiles'].items():assert h(D/rel)==w
 assert sorted(p.name for p in (D/'assays').iterdir())==[k+'.json' for k in keys]
 assert report.is_file()
 result=j(report)
 assert result['format']=='discovery-improvement-analysis/v1' and result['manifestHash']==manifest['manifestHash']
 assert result['requestedDraws']==384 and result['requestedAssays']==6144 and result['distinctConfigurations']==1920 and len(result['observations'])==6144
 assert len(result['rows'])==64 and [row['time'] for row in result['byTime']]==manifest['times']
 assert isinstance(result['technicalComplete'],bool)
 v.update(status='settled',chargedSeconds=time.monotonic()-start+1,finishedAt=time.time(),reportSha256=h(report))
except BaseException as e:
 if child is not None:stop(child)
 v.update(status='failed',chargedSeconds=1800,finishedAt=time.time(),error=str(e));raise
finally:
 signal.setitimer(signal.ITIMER_REAL,0);atomic(receipt,v)
