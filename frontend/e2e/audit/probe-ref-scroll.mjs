/** 参考站左栏: 哪些内容在滚动容器内, 哪些是固定底栏。 */
import { launchChromium } from './browser.mjs';
const URL='https://www.designkit.cn/shoppable-carousel?from=product_kit_web';
const b=await launchChromium({ args: ['--no-proxy-server'] });
const p=await (await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'})).newPage();
await p.goto(URL,{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('[class^="social-media-card-"]',{timeout:60000});
await p.waitForTimeout(5000);
const out = await p.evaluate(()=>{
  const scroll=document.querySelector('[class^="social-media-sidebarScroll-"]');
  const sidebar=document.querySelector('[class^="social-media-sidebar-"]');
  const r=(el)=>{const b=el.getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)};};
  // 滚动容器的直接子节点
  const kids=Array.from(scroll.children).map(el=>({
    cls:String(el.className).slice(0,60), rect:r(el),
    text:(el.innerText||'').replace(/\n/g,' | ').slice(0,70),
  }));
  // 滚动容器之外、但仍在 sidebar 里的节点 (固定底栏)
  const outside=Array.from(sidebar.children).filter(el=>el!==scroll && el!==scroll.parentElement).map(el=>({
    cls:String(el.className).slice(0,60), rect:r(el), text:(el.innerText||'').replace(/\n/g,' | ').slice(0,70)
  }));
  // 侧栏整条链
  const chain=[];
  let el=scroll;
  while(el && el!==document.body){ chain.push({tag:el.tagName,cls:String(el.className).slice(0,60),rect:r(el),overflowY:getComputedStyle(el).overflowY,position:getComputedStyle(el).position}); el=el.parentElement; }
  return {scrollRect:r(scroll), scrollH:scroll.scrollHeight, clientH:scroll.clientHeight, kids, outside, chain,
    sidebarHTMLTail: sidebar.outerHTML.slice(-1400)};
});
console.log(JSON.stringify(out,null,1).slice(0,4200));
await b.close();
