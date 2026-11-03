/** 余额不足态：新注册用户（0 积分）提交 → 402，余额不变。 */
const BASE='http://127.0.0.1:4100/api/v1';
async function call(path,opt={}){const h={};if(opt.token)h.Authorization=`Bearer ${opt.token}`;let b;if(opt.body instanceof FormData){b=opt.body;}else if(opt.body){h['Content-Type']='application/json';b=JSON.stringify(opt.body);}const r=await fetch(BASE+path,{method:opt.method||'GET',headers:h,body:b});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,200)}};if(!r.ok||(j.code!==undefined&&j.code!==0)){const e=new Error(j.message||('HTTP '+r.status));e.code=j.code;e.status=r.status;throw e;}return j.data??j;}
import zlib from 'node:zlib';
function png(){const W=32,H=32;const raw=Buffer.alloc((W*3+1)*H);let o=0;for(let y=0;y<H;y++){raw[o++]=0;for(let x=0;x<W;x++){raw[o++]=120;raw[o++]=90;raw[o++]=200;}}const tbl=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;tbl[n]=c>>>0;}const crc32=(buf)=>{let c=0xffffffff;for(const b of buf)c=tbl[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));return Buffer.concat([len,body,crc]);};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}

const email=`sc-zero-${Date.now()}@test.local`;
const reg=await call('/auth/register',{method:'POST',body:{email,name:'零余额',password:'Sctest123456'}});
const token=reg.accessToken;
// 建项目
let pid;
try{ const list=await call('/projects',{token}); pid=Array.isArray(list)?list[0]?.id:list.items?.[0]?.id; }catch{}
if(!pid){ const p=await call('/projects',{method:'POST',token,body:{name:'零余额项目'}}); pid=p?.id ?? p?.project?.id; }
const form=new FormData();
form.append('file',new Blob([png()],{type:'image/png'}),'p.png');
form.append('projectId',pid);
const asset=await call('/assets/upload',{method:'POST',token,body:form});
const balBefore=await call('/credits/balance',{token});
console.log('balance before:', balBefore.balance);
try{
  await call('/generate',{method:'POST',token,body:{projectId:pid,capability:'shoppable_carousel',logicalModelId:'cmw0b9tbl00054669vzrwa5zr',inputAssetIds:[asset.id],params:{sellingPoints:'x',count:6,mode:'ai',templateId:'',platform:'tiktok',market:'us',language:'en',ratio:'3:4',size:'1k'}}});
  console.log('UNEXPECTED: 提交成功');
}catch(e){ console.log('EXPECTED:', e.code, 'HTTP', e.status, e.message); }
const balAfter=await call('/credits/balance',{token});
console.log('balance after:', balAfter.balance, '| unchanged:', balBefore.balance===balAfter.balance);
