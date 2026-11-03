import postcss from 'postcss';
import fs from 'node:fs';
const css = fs.readFileSync('src/styles/global.css', 'utf8');
const root = postcss.parse(css);

const defs = new Map();
root.walkRules((r)=>{ if(!/^:root\b/.test(r.selector)) return; r.walkDecls((d)=>{ if(d.prop.startsWith('--') && /^#[0-9a-fA-F]{3,8}$/.test(d.value.trim())) defs.set(d.prop,d.value.trim()); }); });

// 每个令牌的「实际背景」: 规则自身 background 优先, 否则白底; 取最亮(=最难)的已知底
const bgOf = new Map();
root.walkRules((rule)=>{
  const decls={}; rule.walkDecls(d=>{decls[d.prop]=d.value.trim();});
  rule.each(node=>{
    if(node.type!=='decl'||node.prop!=='color') return;
    const m=/^var\((--[a-z0-9-]+)\)$/.exec(node.value.trim()); if(!m) return;
    const raw=decls['background']||decls['background-color']||null;
    let bg='#ffffff';
    if(raw){
      const mm=/var\((--[a-z0-9-]+)\)/.exec(raw);
      if(mm&&defs.has(mm[1])) bg=defs.get(mm[1]);
      else if(/^#[0-9a-fA-F]{3,8}$/.test(raw.trim())) bg=raw.trim();
    }
    const cur=bgOf.get(m[1]);
    if(!cur||lum(bg)>lum(cur)) bgOf.set(m[1],bg);
  });
});
function lum(h){h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const v=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];}
const cr=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);};
function hexToHsl(hex){let h=hex.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');
 const r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255;
 const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let hh=0,s=0;const l=(mx+mn)/2,d=mx-mn;
 if(d){s=l>0.5?d/(2-mx-mn):d/(mx+mn);
  if(mx===r)hh=((g-b)/d+(g<b?6:0));else if(mx===g)hh=(b-r)/d+2;else hh=(r-g)/d+4;hh*=60;}
 return{h:hh,s:s*100,l:l*100};}
function hslToHex(h,s,l){s/=100;l/=100;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;let r,g,b;
 if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];
 else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];
 return '#'+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');}
function darkenTo(target,bg,seed){const hsl=hexToHsl(seed);
 for(let l=hsl.l;l>=0;l-=0.002){const hex=hslToHex(hsl.h,hsl.s,l);if(cr(hex,bg)>=target)return hex;} return '#000000';}

const TARGET = 4.62;   // AA 4.5 + 余量
const SKIP = new Set(['--card-bg','--on-brand','--mif-text-on-brand','--shell-text-danger','--mif-text-art','--mif-text-accent','--mif-surface-success','--mif-surface-info','--mif-surface-error','--mif-status-failed-text','--color-cta','--color-success','--danger-ref','--border-dot','--text-6','--text-7','--mif-text-muted-btn','--mif-text-muted-btn-2','--mif-resolution-option-sub','--color-slate-400','--wb-status-completed','--wb-status-failed','--mup-text-success-1','--mup-text-success-2','--wb-flow-expense-fg','--wb-thumb-fg','--shell-text-2']);
const out=[];
for(const [tok,hex] of defs){
  if(SKIP.has(tok)) continue;
  const bg=bgOf.get(tok)||'#ffffff';
  if(!bgOf.has(tok)) continue;         // 只改确实作为文字色使用的令牌
  if(cr(hex,bg)>=TARGET) continue;
  const neu=darkenTo(TARGET,bg,hex);
  out.push([tok,hex,neu,bg,cr(hex,bg),cr(neu,bg)]);
}
console.log('token                       old      new      bg        old→new');
for(const [t,o,n,b,r1,r2] of out) console.log(`${t.padEnd(26)} ${o} ${n} ${b.padEnd(9)} ${r1.toFixed(2)}→${r2.toFixed(2)}`);
console.log('\n需人工单独定值: '+[...SKIP].length+' 个（背景/状态色，单独处理）');
