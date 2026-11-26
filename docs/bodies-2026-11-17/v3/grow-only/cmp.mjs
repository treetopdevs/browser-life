import fs from 'fs';
// per-arm mean over seeds 1-3 of late means; extra: total patches over time
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
for(const arm of process.argv.slice(2)){
 const rows=[1,2,3].map(s=>{const r=JSON.parse(fs.readFileSync(`${arm}-s${s}/readout.json`));const L=r.series.filter(x=>x.t>=10000);const g=f=>mean(L.map(f));
  return {comp:g(x=>x.comps),basins:g(x=>x.basins.n),bmed:g(x=>x.basins.q[1]),big:g(x=>x.patches.nBig),seam:g(x=>x.seams.seamPermille),marks:g(x=>x.kin.distinct),lcs:g(x=>x.largestSharePermille),pb:L.reduce((a,x)=>a+(x.patches.births||0),0),pd:L.reduce((a,x)=>a+(x.patches.deaths||0),0),med:g(x=>x.patches.medianBig||0),cells:g(x=>x.cells),g:r.series.at(-1).genes.meansX10.join(',')}});
 console.log(arm.padEnd(12),Object.keys(rows[0]).map(k=>k+' '+(k=='g'?rows.map(r=>r.g).join(' | '):rows.map(r=>r[k].toFixed(0)).join('/'))).join('  '));
}
