// 最终映射: 弱尾 → 全局语义档 (保留各族色相差异: 冷灰族 / 紫调族)
const T=4.62;
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
function darkenTo(t,bg,seed){const h=hexToHsl(seed);for(let l=h.l;l>=0;l-=0.002){const x=hslToHex(h.h,h.s,l);if(cr(x,bg)>=t)return x;}return '#000000';}

// 冷灰族种子 (h≈217) 与紫调族种子 (h≈243/257)
const COOL='#8b94a3', PURPLE='#9897aa', PURPLE2='#948ca9';
const set=[
  // [token, seed, bg]
  ['--text-8',COOL,'#ffffff'],['--text-9',COOL,'#ffffff'],['--text-10',COOL,'#ffffff'],
  ['--text-6',COOL,'#f3f4f8'],
  ['--sku-text-14',COOL,'#ffffff'],['--sku-text-15',COOL,'#ffffff'],['--sku-text-16',COOL,'#ffffff'],
  ['--sku-text-17',COOL,'#ffffff'],['--sku-text-18',COOL,'#ffffff'],['--sku-text-19',COOL,'#ffffff'],
  ['--sku-text-20',COOL,'#ffffff'],['--sku-text-21',COOL,'#ffffff'],['--sku-text-22',COOL,'#eef1f5'],
  ['--tool-text-2',COOL,'#ffffff'],['--tool-text-3',COOL,'#ffffff'],['--tool-text-4',COOL,'#ffffff'],
  ['--tool-text-5',COOL,'#ffffff'],['--tool-text-6',PURPLE,'#ffffff'],['--tool-text-7',COOL,'#ffffff'],
  ['--alp-text-8',COOL,'#f3f4f7'],['--alp-text-9',COOL,'#ffffff'],['--alp-text-10',COOL,'#ffffff'],
  ['--alp-text-11',COOL,'#ffffff'],['--alp-text-12',COOL,'#e7e9ef'],['--alp-text-13',COOL,'#ffffff'],
  ['--mif-text-sub',PURPLE,'#ffffff'],['--mif-text-dim',PURPLE,'#ffffff'],['--mif-text-dim-2',PURPLE,'#ffffff'],
  ['--mif-text-dim-3',PURPLE,'#ffffff'],['--mif-text-dim-4',PURPLE,'#ffffff'],['--mif-text-count',PURPLE,'#ffffff'],
  ['--mif-text-count-2',PURPLE,'#fbfaff'],['--mif-text-4',PURPLE,'#ffffff'],
  ['--mif-text-muted-btn',PURPLE,'#ffffff'],['--mif-text-muted-btn-2',PURPLE,'#ffffff'],
  ['--mif-text-on-dark-2',PURPLE,'#ffffff'],['--mif-text-accent',PURPLE,'#eeebff'],
  ['--mif-resolution-option-sub',COOL,'#ffffff'],
  ['--mup-text-4',PURPLE2,'#ffffff'],['--mup-text-5',PURPLE2,'#ffffff'],
  ['--mum-text-3',PURPLE2,'#ffffff'],
  ['--lp-text-2',COOL,'#ffffff'],
  ['--wb-empty',COOL,'#ffffff'],['--wb-flow-expense-fg',COOL,'#f2f3f5'],['--wb-thumb-fg',COOL,'#f2f3f7'],
  ['--shell-text-2',COOL,'#ffffff'],['--color-slate-400',COOL,'#ffffff'],
  ['--border-dot',COOL,'#ffffff'],
  ['--mif-text-art',PURPLE,'#f2efff'],
  ['--mif-surface-success','#19936c','#ffffff'],['--mif-surface-info','#7c6fbb','#ffffff'],
  ['--mif-surface-error','#d75a70','#ffffff'],['--mif-status-failed-text','#c6455e','#fff0f3'],
  ['--mup-text-success-1','#24824b','#edf8f1'],['--mup-text-success-2','#2fad63','#ffffff'],
  ['--wb-status-completed','#24a36d','#ffffff'],['--wb-status-failed','#f53f3f','#ffffff'],
  ['--danger-ref','#eb5757','#ffffff'],
];
console.log('| 令牌 | 旧值 | 新值 | 背景 | 对比度 |');
console.log('| --- | --- | --- | --- | --- |');
for(const [tok,seed,bg] of set){
  const neu=darkenTo(T,bg,seed);
  console.log(`| \`${tok}\` | \`${seed}\` | \`${neu}\` | \`${bg}\` | ${cr(seed,bg).toFixed(2)} → ${cr(neu,bg).toFixed(2)} |`);
}
