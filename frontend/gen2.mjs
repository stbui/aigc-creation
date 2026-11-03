import postcss from 'postcss';
import fs from 'node:fs';
const css = fs.readFileSync('src/styles/global.css', 'utf8');
const root = postcss.parse(css);
const defs=new Map();
root.walkRules(r=>{if(!/^:root\b/.test(r.selector))return;r.walkDecls(d=>{if(d.prop.startsWith('--')&&/^#[0-9a-fA-F]{3,8}$/.test(d.value.trim()))defs.set(d.prop,d.value.trim());});});
const norm=(h)=>{h=h.replace('#','');if(h.length===3||h.length===4)h=h.split('').map(c=>c+c).join('');return '#'+h.slice(0,6);};
function lum(h){h=norm(h).replace('#','');const v=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];}
const cr=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);};
function hexToHsl(hex){const h=norm(hex).replace('#','');const r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255;
 const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let hh=0,s=0;const l=(mx+mn)/2,d=mx-mn;
 if(d){s=l>0.5?d/(2-mx-mn):d/(mx+mn);if(mx===r)hh=((g-b)/d+(g<b?6:0));else if(mx===g)hh=(b-r)/d+2;else hh=(r-g)/d+4;hh*=60;}
 return{h:hh,s:s*100,l:l*100};}
function hslToHex(h,s,l){s/=100;l/=100;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;let r,g,b;
 if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];
 else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];
 return '#'+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');}
function darkenTo(target,bg,seed){const hsl=hexToHsl(seed);for(let l=hsl.l;l>=0;l-=0.002){const hex=hslToHex(hsl.h,hsl.s,l);if(cr(hex,bg)>=target)return hex;}return '#000000';}
const T=4.62;
const cases=[
 ['--danger-ref','#ffffff',T],['--color-cta','#ffffff',T],['--color-success','#ffffff',T],
 ['--mif-surface-success','#ffffff',T],['--mif-surface-info','#ffffff',T],['--mif-surface-error','#ffffff',T],
 ['--mif-status-failed-text','#fff0f3',T],['--mif-text-muted-btn','#ffffff',T],['--mif-text-muted-btn-2','#ffffff',T],
 ['--mif-resolution-option-sub','#ffffff',T],['--mif-text-accent','#eeebff',T],['--mif-text-art','#f2efff',T],
 ['--color-slate-400','#ffffff',T],['--wb-status-completed','#ffffff',T],['--wb-status-failed','#ffffff',T],
 ['--mup-text-success-1','#edf8f1',T],['--mup-text-success-2','#ffffff',T],
 ['--wb-flow-expense-fg','#f2f3f5',T],['--wb-thumb-fg','#f2f3f7',T],['--shell-text-2','#ffffff',T],
 ['--text-6','#f3f4f8',T],['--border-dot','#ffffff',T],
 ['--shell-text-danger','#fde8e8',T],
];
console.log('token                       old      new      bg        ratio');
for(const [tok,bg,target] of cases){
  const seed=defs.get(tok); if(!seed){console.log(tok,'(未定义)');continue;}
  const neu=darkenTo(target,bg,seed);
  console.log(`${tok.padEnd(26)} ${seed} ${neu} ${bg.padEnd(9)} ${cr(seed,bg).toFixed(2)}→${cr(neu,bg).toFixed(2)}`);
}
