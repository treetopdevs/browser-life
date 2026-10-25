"""Read-only geometric audit; no simulation, GPU, or selection by future recovery."""
import hashlib, json, pathlib, statistics
root=pathlib.Path(__file__).resolve().parents[2]
rows=[]
for p in sorted((root/'runs/recovery-accessibility/v1/cases').glob('science-*/case.json')):
 c=json.loads(p.read_text());o=c['observation'];M=o['target']['mass'];tc=o['targetCells'];old=o['target']['lesion']['center']
 def dose(center,r):
  return sum(t['B']+t['P'] for t in tc if min(abs(t['cell']%64-center%64),64-abs(t['cell']%64-center%64))**2+min(abs(t['cell']//64-center//64),64-abs(t['cell']//64-center//64))**2<=r*r)/M
 rows.append({'id':c['id'],'source_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'recovered':o['R_clean'],'dose':o['removedMass']/M,'fixed_center_40':any(abs(dose(old,r)-.4)<=.025 for r in range(1,32)), 'target_center_40':any(abs(dose(t['cell'],r)-.4)<=.025 for t in tc for r in range(1,32))})
assert len(rows)==64
report={'scope':'64 v1 scientific cases; geometric mass only, not remnant topology, collateral damage, or paired dose tolerance', 'cases':rows, 'fixed_center_40':sum(r['fixed_center_40'] for r in rows),'target_center_40':sum(r['target_center_40'] for r in rows)}
for label,success in [('success',True),('failure',False)]:
 a=[r['dose'] for r in rows if r['recovered']==success];report[label]={'n':len(a),'min':min(a),'median':statistics.median(a),'max':max(a)}
print(json.dumps(report,indent=2))
