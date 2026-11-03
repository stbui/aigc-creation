import { chromium } from 'playwright';
const CHROME='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-proxy-server']});
const p=await (await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'})).newPage();
p.on('response',r=>{if(r.url().includes('/api/'))console.log('HTTP',r.status(),r.url().replace('http://localhost:5100',''));});
await p.goto('http://localhost:5100/shoppable-carousel',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(5000);
console.log(JSON.stringify(await p.evaluate(()=>({
  cards:document.querySelectorAll('.sc-template-card').length,
  cats:document.querySelectorAll('.sc-category').length,
  gridEmpty:document.querySelector('.sc-template-grid-empty')?.textContent,
  err:document.querySelector('.tool-submit-notice-error')?.textContent,
  showcase:!!document.querySelector('.sc-showcase'),
  body:document.body.innerText.slice(0,300),
})),null,1));
await b.close();
