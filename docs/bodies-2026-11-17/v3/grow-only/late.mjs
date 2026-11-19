import fs from 'fs';
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;
for(const dir of process.argv.slice(2)){
 const r=JSON.parse(fs.readFileSync(dir+'/readout.json'));const L=r.series.filter(x=>x.t>=10000);const e=r.series.at(-1);
 const f=(g)=>mean(L.map(g)).toFixed(1);
 console.log(dir.padEnd(26),'cells',f(x=>x.cells),'comp',f(x=>x.comps),'lcs',f(x=>x.largestSharePermille),'basins',f(x=>x.basins.n),'bmed',f(x=>x.basins.q[1]),'nBigPatch',f(x=>x.patches.nBig),'seamPm',f(x=>x.seams.seamPermille),'marks',f(x=>x.kin.distinct),'pBirth',L.reduce((a,x)=>a+(x.patches.births||0),0),'pDeath',L.reduce((a,x)=>a+(x.patches.deaths||0),0),'repl',L.reduce((a,x)=>a+(x.patches.replacedTiles||0),0),'| end patches',e.patches.sizesTop8.join('/'),'blk',e.counters.blockedGrow,'mut',e.counters.tagMutations,'genes',e.genes.meansX10.join(','));
}
