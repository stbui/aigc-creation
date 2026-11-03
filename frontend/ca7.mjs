const lum=(h)=>{h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const v=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};
const cr=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);};
// 把一个冷灰(带蓝紫倾向)在保持色相的前提下压深到目标对比度
function darkenTo(target, bg, seed) {
  let best = seed;
  const hsl = hexToHsl(seed);
  for (let l = hsl.l; l >= 0; l -= 0.002) {
    const hex = hslToHex(hsl.h, hsl.s, l);
    if (cr(hex, bg) >= target) return hex;
    best = hex;
  }
  return best;
}
function hexToHsl(hex){
  let h=hex.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join('');
  const r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b); let hh=0,s=0; const l=(mx+mn)/2;
  const d=mx-mn;
  if(d){ s=l>0.5? d/(2-mx-mn) : d/(mx+mn);
    if(mx===r) hh=((g-b)/d+(g<b?6:0)); else if(mx===g) hh=(b-r)/d+2; else hh=(r-g)/d+4; hh*=60; }
  return {h:hh,s:s*100,l:l*100};
}
function hslToHex(h,s,l){
  s/=100; l/=100;
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  let r,g,b;
  if(h<60)[r,g,b]=[c,x,0]; else if(h<120)[r,g,b]=[x,c,0]; else if(h<180)[r,g,b]=[0,c,x];
  else if(h<240)[r,g,b]=[0,x,c]; else if(h<300)[r,g,b]=[x,0,c]; else [r,g,b]=[c,0,x];
  return '#'+[r,m,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
}
// 目标: 保持原色相与饱和度, 压到恰好达标
const plan = [
  // [token, seed, bg, target]
  ['--text-8',      '#8b94a3', '#ffffff', 4.6],
  ['--text-9',      '#9aa1ad', '#ffffff', 4.6],
  ['--text-10',     '#b6bcc8', '#ffffff', 4.6],
  ['--sku-text-14', '#7c8492', '#ffffff', 4.6],
  ['--sku-text-15', '#8f96a5', '#ffffff', 4.6],
  ['--sku-text-16', '#98a1af', '#ffffff', 4.6],
  ['--sku-text-17', '#98a2b1', '#ffffff', 4.6],
  ['--sku-text-18', '#a3aab7', '#ffffff', 4.6],
  ['--sku-text-19', '#a6adba', '#ffffff', 4.6],
  ['--sku-text-20', '#a8afbb', '#ffffff', 4.6],
  ['--sku-text-21', '#adb3c0', '#ffffff', 4.6],
  ['--sku-text-22', '#c1c8d3', '#eef1f5', 4.6],
  ['--tool-text-2', '#748093', '#ffffff', 4.6],
  ['--tool-text-3', '#7d8596', '#ffffff', 4.6],
  ['--tool-text-4', '#7d8797', '#ffffff', 4.6],
  ['--tool-text-5', '#8791a1', '#ffffff', 4.6],
  ['--tool-text-6', '#b4adc9', '#ffffff', 4.6],
  ['--tool-text-7', '#b8bec8', '#ffffff', 4.6],
  ['--alp-text-8',  '#7b8498', '#f3f4f7', 4.6],
  ['--alp-text-9',  '#8d95a8', '#ffffff', 4.6],
  ['--alp-text-10', '#8f98a8', '#ffffff', 4.6],
  ['--alp-text-11', '#9ca4b4', '#ffffff', 4.6],
  ['--alp-text-12', '#a4aab8', '#e7e9ef', 4.6],
  ['--alp-text-13', '#a8afbd', '#ffffff', 4.6],
  ['--mif-text-sub','#85869c', '#ffffff', 4.6],
  ['--mif-text-dim','#9897aa', '#ffffff', 4.6],
  ['--mif-text-dim-2','#aaa7ba','#ffffff',4.6],
  ['--mif-text-dim-3','#aaa9ba','#ffffff',4.6],
  ['--mif-text-dim-4','#b5b2c2','#ffffff',4.6],
  ['--mif-text-count','#aeacbd','#ffffff',4.6],
  ['--mif-text-count-2','#aaa7bc','#fbfaff',4.6],
  ['--mif-text-4',  '#aaa8ba', '#ffffff', 4.6],
  ['--mif-text-muted-btn','#77758c','#ffffff',4.6],
  ['--mif-text-muted-btn-2','#716f86','#ffffff',4.6],
  ['--mif-text-on-dark-2','#aaa7b8','#ffffff',4.6],
  ['--mif-text-accent','#7366d1','#eeebff',4.6],
  ['--mif-resolution-option-sub','#7c8493','#ffffff',4.6],
  ['--mif-surface-success','#19936c','#ffffff',4.6],
  ['--mif-surface-info','#7c6fbb','#ffffff',4.6],
  ['--mif-surface-error','#d75a70','#ffffff',4.6],
  ['--mif-status-failed-text','#c6455e','#fff0f3',4.6],
  ['--lp-text-2','#8a93a3','#ffffff',4.6],
  ['--wb-flow-expense-fg','#818797','#f2f3f5',4.6],
  ['--wb-thumb-fg','#afb5c1','#f2f3f7',4.6],
  ['--wb-empty','#98a0af','#ffffff',4.6],
  ['--wb-status-completed','#24a36d','#ffffff',4.6],
  ['--wb-status-failed','#f53f3f','#ffffff',4.6],
  ['--mum-text-3','#9893a3','#ffffff',4.6],
  ['--mup-text-4','#948ca9','#ffffff',4.6],
  ['--mup-text-5','#9993a5','#ffffff',4.6],
  ['--mup-text-success-1','#24824b','#edf8f1',4.6],
  ['--mup-text-success-2','#2fad63','#ffffff',4.6],
  ['--color-slate-400','#94a3b8','#ffffff',4.6],
  ['--shell-text-2','#98a2b3','#ffffff',4.6],
  ['--danger-ref','#eb5757','#ffffff',4.6],
  ['--color-cta','#ea580c','#ffffff',4.6],
  ['--color-success','#16a34a','#ffffff',4.6],
  ['--text-6','#697386','#f3f4f8',4.6],
  ['--text-7','#777181','#ffffff',4.6],
];
console.log('token                  old      new      vsOldBG  vs#fff  vs#f2f4f7');
for (const [tok, seed, bg, target] of plan) {
  const hex = darkenTo(target, bg, seed);
  console.log(`${tok.padEnd(24)} ${seed} ${hex}  ${cr(hex,bg).toFixed(2).padStart(6)}  ${cr(hex,'#ffffff').toFixed(2).padStart(6)}  ${cr(hex,'#f2f4f7').toFixed(2).padStart(7)}`);
}
