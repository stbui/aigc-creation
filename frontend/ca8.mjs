const lum=(h)=>{h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const v=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};
const cr=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);};
function hexToHsl(hex){
  let h=hex.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join('');
  const r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b); let hh=0,s=0; const l=(mx+mn)/2; const d=mx-mn;
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
  return '#'+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
}
// 保持色相/饱和度, 找到刚好达标的明度
function darkenTo(target, bg, seed){
  const hsl=hexToHsl(seed);
  for(let l=hsl.l; l>=0; l-=0.002){
    const hex=hslToHex(hsl.h,hsl.s,l);
    if(cr(hex,bg)>=target) return hex;
  }
  return '#000000';
}
const BGS=['#ffffff','#f2f4f7','#eef1f5','#e7e9ef','#fbfaff','#f3f4f7','#f4f5f8','#fff0f3','#edf8f1','#f2f3f5','#f2f3f7','#f3f4f8','#f4f5f8'];
console.log('== 校验候选灰阶在各浅底上的对比度 ==');
for(const c of ['#4e5969','#5b6474','#5f6b7a','#616c7d','#667085','#5a6577','#596477']){
  const worst=Math.min(...BGS.map(b=>cr(c,b)));
  console.log(`  ${c}  最差底=${worst.toFixed(2)}  ${BGS.map(b=>cr(c,b).toFixed(2)).join(' ')}`);
}
console.log('\n== 各族色相（取族内中段） ==');
for(const [fam,seed] of [['text','#8b94a3'],['sku','#98a1af'],['tool','#8791a1'],['alp','#8d95a8'],['mif','#9897aa'],['mup','#948ca9'],['wb','#98a0af'],['mum','#9893a3']]){
  const h=hexToHsl(seed);
  console.log(`  ${fam.padEnd(6)} seed=${seed} h=${h.h.toFixed(0)} s=${h.s.toFixed(0)}% l=${h.l.toFixed(0)}%`);
}
