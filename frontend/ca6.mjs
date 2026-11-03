const lum=(h)=>{h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const v=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};
const cr=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);};
// 冷灰（蓝紫调, 与 --text-muted #667085 同族）: r=g+δ, b=g+2δ
function makeGrey(targetRatio, bg, delta=6) {
  // 二分找 sRGB 灰阶 g
  let lo=0, hi=255;
  for (let i=0;i<40;i++){
    const g=Math.round((lo+hi)/2);
    const hex='#'+[g,g+Math.round(delta/2),g+delta].map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('');
    if (cr(hex,bg) < targetRatio) hi=g; else lo=g;
  }
  const g=Math.round((lo+hi)/2);
  return '#'+[g,g+Math.round(delta/2),g+delta].map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('');
}
console.log('== 各族弱尾阶梯候选（目标: 对白底与 #f2f4f7 均 ≥4.5）==');
for (const [name, bg] of [['白底','#ffffff'],['浅灰底','#f2f4f7'],['最浅灰底','#eef1f5']]) {
  console.log('\n--- ' + name + ' ---');
  for (const r of [4.6,5.2,6.0,7.0,8.5]) {
    const h=makeGrey(r,bg);
    console.log(`  目标 ${r}  ${h}   vs#fff=${cr(h,'#ffffff').toFixed(2)}  vs#f2f4f7=${cr(h,'#f2f4f7').toFixed(2)}  vs#eef1f5=${cr(h,'#eef1f5').toFixed(2)}`);
  }
}
console.log('\n== 现有全局语义色作为落点 ==');
for (const t of ['--text-strong','--text-body','--text-muted','--text-desc']) {
  console.log(t);
}
for (const h of ['#171a2b','#4e5969','#667085','#5f6b7a','#616c7d']) {
  console.log(`  ${h}  vs#fff=${cr(h,'#ffffff').toFixed(2)}  vs#f2f4f7=${cr(h,'#f2f4f7').toFixed(2)}  vs#eef1f5=${cr(h,'#eef1f5').toFixed(2)}`);
}
