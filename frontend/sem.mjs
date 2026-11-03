const lum=(h)=>{h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const v=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};
const cr=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);};
const BGS=['#ffffff','#f2f4f7','#eef1f5','#e7e9ef','#fbfaff','#f2f3f5','#f2f3f7','#f3f4f7','#f4f5f8','#fff0f3','#edf8f1','#f6f7fb','#fafbfc'];
console.log('候选                vs最浅底  最差底  最差底色值');
for(const c of ['#667085','#616c7d','#5f6b7a','#5b6474','#596477','#5a6577','#566173','#525d6e']){
  const rs=BGS.map(b=>cr(c,b));
  const min=Math.min(...rs);
  const worstB=BGS[rs.indexOf(min)];
  console.log(`${c}  ${min.toFixed(2).padStart(6)}  ${worstB}`);
}
console.log('\n== 紫调族 (mif/mup/mum, h≈243/257) ==');
for(const c of ['#74728c','#71718a','#6e6e87','#7a7392','#787285','#797188','#76718d','#737089']){
  const rs=BGS.map(b=>cr(c,b));
  const min=Math.min(...rs);
  console.log(`${c}  ${min.toFixed(2).padStart(6)}  ${BGS[rs.indexOf(min)]}`);
}
