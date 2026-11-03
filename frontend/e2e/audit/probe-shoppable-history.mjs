/** 参考站 shoppable-carousel 取证: 历史记录入口 / 卡片按钮默认可见性 / 选用后行为。 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const CHROME='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const URL='https://www.designkit.cn/shoppable-carousel?from=product_kit_web';
const b=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-proxy-server']});
const page=await (await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'})).newPage();
await page.goto(URL,{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForSelector('[class^="social-media-card-"]',{timeout:60000});
await page.waitForTimeout(5000);
const out={};

// 页面里所有含「历史」的文本节点
out.historyMentions = await page.evaluate(()=>{
  const hits=[];
  document.querySelectorAll('*').forEach(el=>{ if(el.children.length===0 && /历史/.test(el.textContent||'')) hits.push({t:el.textContent.trim().slice(0,40),cls:String(el.className).slice(0,60)}); });
  return hits.slice(0,20);
});
// 所有按钮文案(去重)
out.allButtonTexts = await page.evaluate(()=>[...new Set(Array.from(document.querySelectorAll('button')).map(b=>(b.innerText||'').trim()).filter(Boolean))].slice(0,60));

// 卡片按钮默认可见性
out.cardButtons = await page.evaluate(()=>{
  const c=document.querySelector('[class^="social-media-card-"]');
  const pick=(sel)=>{const el=c.querySelector(sel); if(!el) return null; const cs=getComputedStyle(el); const r=el.getBoundingClientRect(); return {opacity:cs.opacity,visibility:cs.visibility,display:cs.display,w:Math.round(r.width),h:Math.round(r.height),pos:cs.position};};
  return { use:pick('[class^="social-media-useButton-"]'), preview:pick('[class^="social-media-previewButton-"]'), select:pick('[class^="social-media-selectButton-"]') };
});

// 点击「选用」后的状态
const card=await page.$('[class^="social-media-card-"]');
await (await card.$('[class^="social-media-selectButton-"]')).click().catch(()=>{});
await page.waitForTimeout(800);
out.afterPick = await page.evaluate(()=>{
  const c=document.querySelector('[class^="social-media-card-"]');
  const gen=Array.from(document.querySelectorAll('button')).find(b=>/生成带货图文|立即生成/.test(b.innerText||''));
  return { cardCls:c.className, useText:(c.querySelector('[class^="social-media-useButton-"]')||{}).innerText, genText:(gen?.innerText||'').replace(/\n/g,'|'), genDisabled:gen?.disabled,
    modePressed: Array.from(document.querySelectorAll('[class^="social-media-option-"]')).map(o=>o.getAttribute('aria-pressed')) };
});

// 点「新建任务」看是否出现历史/任务列表
const nt=await page.$('button:has-text("新建任务")');
await nt.click().catch(()=>{});
await page.waitForTimeout(1200);
out.afterNewTask = await page.evaluate(()=>{
  const modal=Array.from(document.querySelectorAll('[class*=modal],[class*=Modal],[class*=drawer],[class*=Drawer],[role=dialog]')).filter(e=>e.getBoundingClientRect().height>50).map(e=>({cls:String(e.className).slice(0,70),text:(e.innerText||'').replace(/\n/g,' | ').slice(0,200)}));
  return { url:location.href, overlays:modal.slice(0,6) };
});
await writeFile('/tmp/designkit-shoppable-carousel/history.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,1));
await b.close();
