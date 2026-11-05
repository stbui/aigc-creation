/** 最终结构截图：空态 / 有历史 / 全部记录抽屉。 */
import { chromium } from 'playwright';
const CHROME='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-proxy-server']});
const p=await (await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'})).newPage();
await p.goto('http://localhost:5100/shoppable-carousel',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.sc-template-card',{timeout:60000});
const token=await p.evaluate(async()=>{const r=await fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'sc-e2e@test.local',password:'Sctest123456'})});return (await r.json()).data.accessToken;});
await p.evaluate((t)=>{localStorage.setItem('huojue_token',t);localStorage.setItem('huojue_email','sc-e2e@test.local');localStorage.setItem('huojue_role','user');},token);
await p.reload({waitUntil:'domcontentloaded'});
await p.waitForSelector('.sc-template-card',{timeout:60000});
await p.waitForTimeout(2500);
await p.screenshot({path:'/tmp/designkit-shoppable-carousel/final-history-1440.png'});
await p.click('.sc-history-link');
await p.waitForTimeout(1200);
await p.screenshot({path:'/tmp/designkit-shoppable-carousel/final-drawer-1440.png'});
console.log('captured');
await b.close();
