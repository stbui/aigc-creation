import { chromium } from 'playwright';
const CHROME='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-proxy-server']});
const p=await (await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'})).newPage();
await p.goto('http://localhost:5100/shoppable-carousel',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.sc-template-card',{state:'attached',timeout:60000});
await p.waitForTimeout(2000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const f=document.querySelector('.sc-form-footer');
  const row=document.querySelector('.sc-footer-row');
  const sum=document.querySelector('.pk-settings-summary');
  const fr=f.getBoundingClientRect(), rr=row.getBoundingClientRect(), sr=sum?.getBoundingClientRect();
  return {footer:{h:Math.round(fr.height),bottom:Math.round(fr.bottom)}, row:{h:Math.round(rr.height),right:Math.round(rr.right)},
    settingsRight: sr?Math.round(sr.right):null, footerRight:Math.round(fr.right),
    overflow: sr? sr.right>fr.right : null};
}),null,1));
await b.close();
