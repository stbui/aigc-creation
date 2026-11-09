/** 参考站左栏逐区块实测（高度 / 间距 / 控件尺寸），用于逐项对拍。 */
import { launchChromium } from './browser.mjs';
const URL='https://www.designkit.cn/shoppable-carousel?from=product_kit_web';
const b=await launchChromium({ args: ['--no-proxy-server'] });
const p=await (await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'})).newPage();
await p.goto(URL,{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('[class^="social-media-card-"]',{timeout:60000});
await p.waitForTimeout(5000);
const out=await p.evaluate(()=>{
  const scroll=document.querySelector('[class^="social-media-sidebarScroll-"]');
  const r=(el)=>{const b=el.getBoundingClientRect();return {y:Math.round(b.y),h:Math.round(b.height),w:Math.round(b.width)};};
  const sections=Array.from(scroll.children).map(el=>({
    cls:String(el.className).slice(0,50), rect:r(el),
    marginTop:getComputedStyle(el).marginTop,
    title:(el.querySelector('h2,[class*="Title-"]')?.textContent||'').trim().slice(0,20),
    children:Array.from(el.children).map(c=>({cls:String(c.className).slice(0,45),rect:r(c)})),
  }));
  const footer=document.querySelector('[class^="social-media-sidebarFooter-"]');
  const footKids=footer?Array.from(footer.querySelectorAll('*')).filter(e=>e.children.length===0||e.tagName==='BUTTON').slice(0,14).map(el=>({tag:el.tagName,t:(el.textContent||'').trim().slice(0,20),cls:String(el.className).slice(0,45),rect:r(el),bg:getComputedStyle(el).backgroundColor,fs:getComputedStyle(el).fontSize,radius:getComputedStyle(el).borderRadius,pad:getComputedStyle(el).padding})):[];
  return {sections, footer:footer&&{rect:r(footer),bg:getComputedStyle(footer).backgroundColor,border:getComputedStyle(footer).borderTop,pad:getComputedStyle(footer).padding}, footKids};
});
console.log(JSON.stringify(out,null,1));
await b.close();
