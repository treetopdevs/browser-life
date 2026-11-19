import fs from 'fs';
const [d,step=2000]=process.argv.slice(2);
const r=JSON.parse(fs.readFileSync(d+'/readout.json'));
let cb=0,cd=0;
for(const x of r.series){cb+=x.patches?.births||0;cd+=x.patches?.deaths||0;
 if(x.t%step===0) console.log(x.t,'cells',x.cells,'comps',x.comps,'big',x.patches?.nBig,'cumBirth',cb,'cumDeath',cd,'marks',x.kin?.distinct,'genes',JSON.stringify(x.genes),'blocked',JSON.stringify(x.counters?.blockedGrow));}
console.log('wound',JSON.stringify(r.wound));
