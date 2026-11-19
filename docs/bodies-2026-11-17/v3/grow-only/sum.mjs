import fs from 'fs';
const [,, dir]=process.argv;
const r=JSON.parse(fs.readFileSync(dir+'/readout.json'));
const S=r.series; const every=+(process.env.EVERY||10);
for(const x of S.filter((_,i)=>i%every==0||i==S.length-1)){console.log([x.t,'cells',x.cells,'comp',x.comps,'lcs',x.largestSharePermille,'basins',x.basins.n,'med',x.basins.q[1],'patch',x.patches.nBig,x.patches.sizesTop8.slice(0,4).join('/'),'seam',x.seams.seamPermille,'marks',x.kin.distinct,'dom',x.kin.dominantSharePermille,'pb/pd',x.patches.births+'/'+x.patches.deaths,'blk',x.counters.blockedGrow,'genes',x.genes.meansX10.join(',')].join(' '));}
