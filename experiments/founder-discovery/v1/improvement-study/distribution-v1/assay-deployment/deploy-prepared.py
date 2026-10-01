import hashlib,json,os,pathlib,subprocess,tarfile,time,signal
R=pathlib.Path('/Users/nicholas/develop/browser-life-founder-policy');os.chdir(R)
B=pathlib.Path('experiments/founder-discovery/v1/improvement-study/distribution-v1'); C=B/'assay-candidate-v1.json';A=B/'allocation.json';M=B.parent/'manifest.json';D=pathlib.Path('runs/assay-prepared-deployment-20261001');D.mkdir()
def h(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def j(p):return json.loads(p.read_text())
def record(p,v):
 with p.open('x') as f:json.dump(v,f,indent=2);f.flush();os.fsync(f.fileno())
ops=sorted((B/'importer-operations').glob('*.json'));assert len(ops)==37
charged=sum(j(p)['chargedSeconds'] for p in ops);assert charged+600<=13600
receipt=B/'importer-operations/038-prepared-assay-deployment.json';v={'operation':'prepared-assay-dependencies-only-remote-deployment','status':'reserved','chargedSeconds':600,'releaseSha256':h(B/'budget-successor-v1/ledger.json'),'startedAt':time.time()};record(receipt,v);start=time.monotonic()
try:
 c=j(C);a=j(A);m=j(M);files=set(m['sources'])|set(c['executionSources'])|{str(C),str(A),str(M)}
 for p in m['inputs']:files.add(str(pathlib.Path(p).relative_to(m['sourceRoot'])))
 files.update(x['path'] for x in c['inputs'].values());files.add(a['routingPath']);files.update(str(p) for p in pathlib.Path(a['priorReceiptDir']).glob('*.json'))
 ledger=c['successorBudgetLedger'];files.add(ledger['path']);l=j(pathlib.Path(ledger['path']));files.add(l['decision']['path']);files.add(l['payload']['cpu']['priorRelease']['path']);files.update(str(p) for p in pathlib.Path(l['payload']['cpu']['snapshotDirectory']).glob('*'))
 for retirement in l['payload']['retirements']:files.update(str(p) for p in pathlib.Path(retirement['evidenceDirectory']).glob('*'))
 pins={p:h(pathlib.Path(p)) for p in sorted(files)};science=set(m['sources'])|{str(pathlib.Path(p).relative_to(m['sourceRoot'])) for p in m['inputs']}
 record(D/'file-pins.json',pins);archive=D/'payload.tar.gz'
 with tarfile.open(archive,'w:gz') as t:
  for p in sorted(files):t.add(p,arcname=p,recursive=False)
 remote='/Users/180471/bl-founder-discovery';transport='/Users/180471/bl-assay-prepared-deploy-20261001';ssh=['ssh','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-i','/Users/nicholas/.ssh/id_ed25519','180471@192.168.1.19']
 def run(cmd,**kw):
  child=subprocess.Popen(cmd,start_new_session=True,**kw)
  try:
   output=child.communicate(timeout=max(1,570-(time.monotonic()-start)))[0]
   if child.returncode:raise RuntimeError('deployment subprocess failed')
   return output
  except BaseException:
   try:os.killpg(child.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:child.wait(timeout=10)
   except subprocess.TimeoutExpired:pass
   try:os.killpg(child.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   child.wait();raise
 run(ssh+[f'mkdir {transport}'])
 with archive.open('rb') as f:run(ssh+[f'cat > {transport}/payload.tar.gz'],stdin=f)
 remote_code='''import hashlib,json,pathlib,tarfile,shutil,os,subprocess
root=pathlib.Path(ROOT);stage=pathlib.Path(STAGE);pins=PINS;science=set(SCIENCE)
with tarfile.open(stage/'payload.tar.gz','r:gz') as tar:tar.extractall(stage/'unpacked',filter='data')
def h(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for rel,want in pins.items():
 p=root/rel
 if p.is_symlink():raise RuntimeError('remote symlink')
 if rel in science and (not p.is_file() or h(p)!=want):raise RuntimeError('frozen scientific drift '+rel)
for rel,want in pins.items():
 p=root/rel;source=stage/'unpacked'/rel
 if h(source)!=want:raise RuntimeError('transport hash drift')
 if rel in science:continue
 if p.exists() and h(p)!=want:
  backup=stage/'backup'/rel;backup.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,backup)
 if not p.exists() or h(p)!=want:p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,p)
for rel,want in pins.items():
 if h(root/rel)!=want:raise RuntimeError('deployed hash drift')
free=shutil.disk_usage(root).free
if free<20*1024**3:raise RuntimeError('20GiB floor')
process=subprocess.run(['pgrep','-fl','deno.*discovery_improvement.*(run|assay)'],text=True,capture_output=True)
print(json.dumps({'files':len(pins),'hashMismatches':0,'freeBytes':free,'processQueryExit':process.returncode,'processOutput':process.stdout,'preparedOnly':True,'backupDirectory':str(stage/'backup')}))
'''.replace('ROOT',repr(remote)).replace('STAGE',repr(transport)).replace('PINS',repr(pins)).replace('SCIENCE',repr(sorted(science)))
 output=run(ssh+['/usr/bin/python3 -'],stdin=subprocess.PIPE,stdout=subprocess.PIPE) if False else None
 child=subprocess.Popen(ssh+['/usr/bin/python3 -'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 try:out,err=child.communicate(remote_code.encode(),timeout=max(1,570-(time.monotonic()-start)))
 except BaseException:
  os.killpg(child.pid,signal.SIGTERM)
  try:child.wait(timeout=10)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
  raise
 if child.returncode:raise RuntimeError(err.decode())
 record(D/'remote-verification.json',json.loads(out));v.update(status='settled',chargedSeconds=time.monotonic()-start+1,finishedAt=time.time(),transferredFiles=len(pins),filePinsSha256=h(D/'file-pins.json'));print(out.decode())
except BaseException as error:
 v.update(status='failed',chargedSeconds=600,finishedAt=time.time(),error=str(error));raise
finally:
 temp=receipt.with_suffix('.settlement');record(temp,v);temp.replace(receipt)
