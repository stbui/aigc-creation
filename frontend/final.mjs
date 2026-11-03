import postcss from 'postcss';
import fs from 'node:fs';
const css = fs.readFileSync('src/styles/global.css', 'utf8');
const root = postcss.parse(css);
const defs=new Map();
root.walkRules(r=>{if(!/^:root\b/.test(r.selector))return;r.walkDecls(d=>{if(d.prop.startsWith('--')&&/^#[0-9a-fA-F]{3,8}$/.test(d.value.trim()))defs.set(d.prop,d.value.trim());});});
const lum=(h)=>{h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const v=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};
const cr=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);};
function hexToHsl(hex){const h=hex.replace('#','');const r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255;
 const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let hh=0,s=0;const l=(mx+mn)/2,d=mx-mn;
 if(d){s=l>0.5?d/(2-mx-mn):d/(mx+mn);if(mx===r)hh=((g-b)/d+(g<b?6:0));else if(mx===g)hh=(b-r)/d+2;else hh=(r-g)/d+4;hh*=60;}
 return{h:hh,s:s*100,l:l*100};}
function hslToHex(h,s,l){s/=100;l/=100;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;let r,g,b;
 if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];
 else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];
 return '#'+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');}
function darkenTo(t,bg,seed){const h=hexToHsl(seed);for(let l=h.l;l>=0;l-=0.001){const x=hslToHex(h.h,h.s,l);if(cr(x,bg)>=t)return x;}return '#000000';}
const T=4.62;
// 每个令牌的真实背景 (人工核定)
const BG={
 '--text-8':'#ffffff','--text-9':'#ffffff','--text-10':'#ffffff','--text-6':'#f3f4f8','--text-7':'#ffffff',
 '--sku-text-14':'#ffffff','--sku-text-15':'#ffffff','--sku-text-16':'#ffffff','--sku-text-17':'#ffffff',
 '--sku-text-18':'#ffffff','--sku-text-19':'#ffffff','--sku-text-20':'#ffffff','--sku-text-21':'#ffffff','--sku-text-22':'#eef1f5',
 '--tool-text-2':'#ffffff','--tool-text-3':'#ffffff','--tool-text-4':'#ffffff','--tool-text-5':'#ffffff',
 '--tool-text-6':'#ffffff','--tool-text-7':'#ffffff',
 '--alp-text-8':'#f3f4f7','--alp-text-9':'#ffffff','--alp-text-10':'#ffffff','--alp-text-11':'#ffffff',
 '--alp-text-12':'#e7e9ef','--alp-text-13':'#ffffff',
 '--mif-text-sub':'#ffffff','--mif-text-dim':'#ffffff','--mif-text-dim-2':'#ffffff','--mif-text-dim-3':'#ffffff',
 '--mif-text-dim-4':'#ffffff','--mif-text-count':'#ffffff','--mif-text-count-2':'#fbfaff','--mif-text-4':'#ffffff',
 '--mif-text-muted-btn':'#ffffff','--mif-text-muted-btn-2':'#ffffff','--mif-text-on-dark-2':'#ffffff',
 '--mif-text-accent':'#eeebff','--mif-text-art':'#f2efff',
 '--mif-resolution-option-sub':'#ffffff',
 '--mif-surface-success':'#ffffff','--mif-surface-info':'#ffffff','--mif-surface-error':'#ffffff',
 '--mif-status-failed-text':'#fff0f3',
 '--mup-text-4':'#ffffff','--mup-text-5':'#ffffff','--mup-text-success-1':'#edf8f1','--mup-text-success-2':'#ffffff',
 '--mum-text-3':'#ffffff',
 '--lp-text-2':'#ffffff',
 '--wb-empty':'#ffffff','--wb-flow-expense-fg':'#f2f3f5','--wb-thumb-fg':'#f2f3f7',
 '--wb-status-completed':'#ffffff','--wb-status-failed':'#ffffff',
 '--shell-text-2':'#ffffff','--color-slate-400':'#ffffff','--danger-ref':'#ffffff',
};
console.log('令牌                        旧值      新值      背景        对比度');
for(const [tok,bg] of Object.entries(BG)){
  const seed=defs.get(tok); if(!seed){console.log(tok.padEnd(26),'(未定义)');continue;}
  if(cr(seed,bg)>=T){console.log(`${tok.padEnd(26)} ${seed} ${'(已达标)'.padEnd(9)} ${bg}`);continue;}
  const neu=darkenTo(T,bg,seed);
  console.log(`${tok.padEnd(26)} ${seed} ${neu} ${bg.padEnd(10)} ${cr(seed,bg).toFixed(2)}→${cr(neu,bg).toFixed(2)}`);
}
