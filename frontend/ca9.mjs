import postcss from 'postcss';
import fs from 'node:fs';
const css = fs.readFileSync('src/styles/global.css', 'utf8');
const root = postcss.parse(css);
const defs = new Map();
root.walkRules((r)=>{ if(!/^:root\b/.test(r.selector)) return; r.walkDecls((d)=>{ if(d.prop.startsWith('--') && /^#[0-9a-fA-F]{3,8}$/.test(d.value.trim())) defs.set(d.prop,d.value.trim()); }); });
const use=new Map();
root.walkDecls((d)=>{ const m=/^var\((--[a-z0-9-]+)\)$/.exec(d.value.trim()); if(!m) return; use.set(m[1],(use.get(m[1])||0)+1); });
// Lab
function lab(hex){let h=hex.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');
 const r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255;
 const f=v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
 const R=f(r),G=f(g),B=f(b);
 let x=(R*0.4124+G*0.3576+B*0.1805)/0.95047, y=R*0.2126+G*0.7152+B*0.0722, z=(R*0.0193+G*0.1192+B*0.9505)/1.08883;
 const g2=v=>v>0.008856?Math.cbrt(v):(7.787*v+16/116);
 x=g2(x);y=g2(y);z=g2(z);
 return [116*y-16, 500*(x-y), 200*(y-z)];}
const dE=(a,b)=>{const A=lab(a),B=lab(b);return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]);};
const fams={ 'text':/--text-(\d+)$/,'sku-text':/--sku-text-(\d+)$/,'tool-text':/--tool-text-(\d+)$/,'alp-text':/--alp-text-(\d+)$/ };
for(const [fam,re] of Object.entries(fams)){
  const rows=[...defs].filter(([k])=>re.test(k)).sort((a,b)=>+re.exec(a[0])[1]-+re.exec(b[0])[1]);
  console.log('\n=== '+fam+' 相邻 ΔE (Lab, <3 视为肉眼无差) ===');
  for(let i=0;i<rows.length;i++){
    const d = i? dE(rows[i-1][1],rows[i][1]).toFixed(1):'-';
    const mark = (i && dE(rows[i-1][1],rows[i][1])<3)?'  << 肉眼无差':'';
    console.log(`  ${rows[i][0].padEnd(24)} ${rows[i][1]}  ΔE=${String(d).padStart(5)}  uses=${use.get(rows[i][0])||0}${mark}`);
  }
}
