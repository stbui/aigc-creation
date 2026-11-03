import { chromium } from 'playwright';
const CHROME='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-proxy-server']});
const p=await (await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'})).newPage();
await p.goto('http://localhost:5100/tools/shoppable_carousel',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(3500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const el=document.querySelector('.tool-page');
  const b=el.getBoundingClientRect();
  return {cls:el.className,cap:el.dataset.capability,rect:[Math.round(b.x),Math.round(b.width)],maxWidth:getComputedStyle(el).maxWidth};
})));
await p.screenshot({path:'/tmp/designkit-shoppable-carousel/tools-fullwidth.png'});
await b.close();
