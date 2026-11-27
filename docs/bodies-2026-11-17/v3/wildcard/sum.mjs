import fs from 'fs';
const f=(x,d=1)=>x==null?'-':(+x).toFixed(d);
for(const d of process.argv.slice(2)){
  let r; try{r=JSON.parse(fs.readFileSync(d+'/readout.json','utf8'))}catch(e){console.log(d,'NO READOUT');continue}
  const S=r.series, last=S[S.length-1], T=last.t;
  const late=S.filter(x=>x.t>=T/2);
  const m=(g)=>{const v=late.map(g).filter(x=>x!=null&&!isNaN(x));return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
  console.log(d.split('/').pop().padEnd(20),'T',T,'cells',last.cells,'mean',f(m(x=>x.cells),0),'comp',f(m(x=>x.comps),2),'lc',f(m(x=>x.largestSharePermille),0),
   'basin#',f(m(x=>x.basins?.n)),'bMed',f(m(x=>x.basins?.q?.[1]),0),'big#',f(m(x=>x.patches?.nBig)),'sizes',JSON.stringify(last.patches?.sizesTop8?.slice(0,6)),'seam‰',f(m(x=>x.seams?.seamPermille),1),'marks',last.kin?.distinct,'bth/dth(per sample)',f(m(x=>x.patches?.births),2),f(m(x=>x.patches?.deaths),2),'ageMax',last.patches?.ageMax, 'rep',f(m(x=>x.patches?.replacedTiles),0));
}
